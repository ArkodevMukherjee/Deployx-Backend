// workers/deploymentWorker.js
require("dotenv").config();
const { Worker } = require('bullmq');
const { exec } = require('child_process');
const Deployment = require('../models/Deployments');
const Redis = require("ioredis");
const mongoose = require("mongoose");
const fs = require("fs")
const jwt = require("jsonwebtoken")
const axios = require("axios")

const connection = new Redis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null  // IMPORTANT for BullMQ
});


mongoose.connect('mongodb://127.0.0.1:27017/github-app')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

// const { generateAppJWT, getInstallationToken } = require('../utils/github');

function generateAppJWT() {
  // Read your GitHub App private key (PEM file)
  const privateKey = fs.readFileSync("D:\\express\\oauth-login\\private4.pem", 'utf8');
  const appId = process.env.GITHUB_APP_ID;
  console.log("App Id",appId);

  const payload = {
    iat: Math.floor(Date.now() / 1000),       // issued at
    exp: Math.floor(Date.now() / 1000) + 600, // expires after 10 minutes
    iss: appId                                 // GitHub App ID
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

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
    console.error('Error fetching installation token:', err.response?.data || err.message);
    throw err;
  }
}


const worker = new Worker(
  'deployment-queue',
  async job => {
    const {
      deploymentId,
      installationId,
      fullName,
      branchName,
      deployPath
    } = job.data;

    console.log("DeploymentWorker working");

    // 1️⃣ Mark deployment as running
    await Deployment.findByIdAndUpdate(deploymentId, {
      status: 'in_progress'
    });

    try {
      // 2️⃣ Generate GitHub installation token
      const appJwt = generateAppJWT();
      const installationToken = await getInstallationToken(
        installationId,
        appJwt
      );

      console.log("Installation Token",installationToken)


      // 3️⃣ Run Docker container using spawn for better env handling
      const { spawn } = require('child_process');
      const dockerArgs = [
        'run',
        '-e', `INSTALLATION_TOKEN=${installationToken}`,
        '-e', `REPO_FULL_NAME=${fullName}`,
        '-e', `BRANCH=${branchName}`,
        '-e', `AZURE_ACCOUNT=${process.env.AZURE_ACCOUNT}`,
        '-e', `AZURE_STORAGE_KEY=${process.env.AZURE_STORAGE_KEY}`,
        '-e', `DEPLOY_PATH=${deployPath}`,
        'deploy'
      ];

      console.log("Deployment Worker is working");

      await new Promise((resolve, reject) => {
        const child = spawn('docker', dockerArgs, { stdio: 'inherit' });
        child.on('error', (err) => {
          reject(err);
        });
        child.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Docker process exited with code ${code}`));
          }
        });
      });


      // 4️⃣ Mark success
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'success'
      });

    } catch (error) {
      // 5️⃣ Mark failure
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'failed',
        logs: error.toString()
      });

      throw error;
    }
  },
  { connection }
);

worker.on("completed", job => {
    console.log(`Job completed: ${job.id}`);
});

worker.on("failed", (job, err) => {
    console.log(`Job failed: ${job.id}`, err);
})