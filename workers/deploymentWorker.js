const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Worker } = require('bullmq');
const Deployment = require('../models/Deployments');
const Redis = require("ioredis");
const mongoose = require("mongoose");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { spawn } = require('child_process');

// Redis Connection
const connection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null
});

connection.on("error", (err) => console.error("❌ Redis Connection Error:", err));
connection.on("connect", () => console.log("✅ Worker connected to Redis"));

const SHARED_APPS_DIR = '/var/www/apps';

// MongoDB Connection
mongoose.connect(`${process.env.MONGO_URI}/github-app`)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

/**
 * Generates a GitHub App JWT
 */
function generateAppJWT() {
  const privateKeyPath = path.join(__dirname, "../private4.pem");
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key missing at: ${privateKeyPath}`);
  }
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const appId = process.env.GITHUB_APP_ID;
  const payload = {
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 9 * 60,
    iss: appId
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Fetches GitHub Installation Access Token
 */
async function getInstallationToken(installationId, appJwt) {
  try {
    const response = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json'
        }
      }
    );
    return response.data.token;
  } catch (err) {
    console.error('❌ Error fetching installation token:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * BullMQ Worker
 */
const worker = new Worker(
  'deployment-queue',
  async job => {
    const { deploymentId, installationId, fullName, branchName } = job.data;
    console.log(`\n🚀 [Job ${job.id}] Received deployment for: ${fullName}`);

    const repoName = fullName.split('/')[1];
    const deployPath = `${installationId}/${repoName}/${deploymentId}`;

    await Deployment.findByIdAndUpdate(deploymentId, { status: 'in_progress' });

    let combinedLogs = ""; // Variable to store build output

    try {
      console.log(`   [${job.id}] Generating GitHub JWT...`);
      const appJwt = generateAppJWT();
      
      console.log(`   [${job.id}] Fetching Installation Token...`);
      const installationToken = await getInstallationToken(installationId, appJwt);

      console.log(`   [${job.id}] Starting Docker container...`);
      const dockerArgs = [
        'run', '--rm',
        '-v', `${SHARED_APPS_DIR}:${SHARED_APPS_DIR}`,
        '-e', `INSTALLATION_TOKEN=${installationToken}`,
        '-e', `REPO_FULL_NAME=${fullName}`,
        '-e', `BRANCH=${branchName}`,
        '-e', `DEPLOY_PATH=${deployPath}`,
        '-e', `APPS_DIR=${SHARED_APPS_DIR}`,
        '-e', `AZURE_ACCOUNT=${process.env.AZURE_ACCOUNT}`,
        '-e', `AZURE_STORAGE_KEY=${process.env.AZURE_STORAGE_KEY}`,
        'deploy'
      ];

      await new Promise((resolve, reject) => {
        // Using 'pipe' to capture output for MongoDB storage
        const child = spawn('docker', dockerArgs);

        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          combinedLogs += chunk;
          process.stdout.write(chunk); // Stream to terminal
        });

        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          combinedLogs += chunk;
          process.stderr.write(chunk); // Stream to terminal
        });

        child.on('error', (err) => {
          combinedLogs += `\nSpawn Error: ${err.message}`;
          reject(err);
        });

        child.on('exit', (code) => {
          if (code === 0) {
            console.log(`\n   [${job.id}] ✅ Docker finished successfully.`);
            resolve();
          } else {
            console.error(`\n   [${job.id}] ❌ Docker failed with Exit Code: ${code}`);
            reject(new Error(`Docker Exit ${code}`));
          }
        });
      });

      // Update success status and save logs
      await Deployment.findByIdAndUpdate(deploymentId, { 
        status: 'success',
        logs: combinedLogs 
      });
      console.log(`✅ [Job ${job.id}] Deployment Complete!`);

    } catch (error) {
      console.error(`❌ [Job ${job.id}] Critical Failure:`, error.message);
      
      // Save logs even on failure so you can debug the npm/git errors
      await Deployment.findByIdAndUpdate(deploymentId, { 
        status: 'failed', 
        logs: combinedLogs + `\nError: ${error.message}`
      });
      throw error;
    }
  },
  { 
    connection,
    concurrency: 1 
  }
);

console.log("🛠️ Worker is active and listening for jobs...");
