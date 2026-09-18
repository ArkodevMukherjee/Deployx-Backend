const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Worker } = require('bullmq');
const Deployment = require('../models/Deployments');
const {connectToDb} = require("../connectToDb");
const emailQueue = require("../queue/emailQueue");
const User = require("../models/User");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { spawn } = require('child_process');
const { connection } = require("../redis");

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
    console.error('Error fetching installation token:', err.response?.data || err.message);
    throw err;
  }
}



// const HOST_APPS_DIR = '/var/www/apps';
const HOST_APPS_DIR = process.env.DOCKER_APPS_DIR;

// MongoDB Connection
(async () => {
  await connectToDb();
})();



/**
 * BullMQ Worker
 */
const worker = new Worker(
  'deployment-queue',
  async job => {

    // Data input to the worker from routes
    const { deploymentId, installationId,deployPath, fullName, branchName, userId , liveUrl } = job.data;

    // Logging the name in the format github-username/repository-name
    console.log(`\n[Job ${job.id}] Received deployment for: ${fullName}`);

    // Getting the repostory-name
    const repoName = fullName.split('/')[1];

    // Updating the deployment model data to the status inp progress to notify the user that the deployment process has been started in the server
    await Deployment.findByIdAndUpdate(deploymentId, { status: 'in_progress' });

    let combinedLogs = "";

    try {
      // Generating the Github JWT with the function generateAppJWT()
      console.log(`   [${job.id}] Generating GitHub JWT...`);
      const appJwt = generateAppJWT();

      // With the help of the jwt token and installationId the installation token is recieved from the github server to clone the private repository
      console.log(`   [${job.id}] Fetching Installation Token...`);
      const installationToken = await getInstallationToken(installationId, appJwt);

      // Starting the docker container
      console.log(`   [${job.id}] Starting Docker container...`);

      // These are the docker arguments
      const dockerArgs = [
        'run', '--rm',
        '-v', `${HOST_APPS_DIR}:${HOST_APPS_DIR}`,
        '-e', `INSTALLATION_TOKEN=${installationToken}`,
        '-e', `REPO_FULL_NAME=${fullName}`,
        '-e', `BRANCH=${branchName}`,
        '-e', `DEPLOY_PATH=${deployPath}`,
        '-e', `APPS_DIR=${HOST_APPS_DIR}`,
        'deploy-react-private-image'
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
            console.log(`\n   [${job.id}] Docker finished successfully.`);
            resolve();
          } else {
            console.error(`\n   [${job.id}] Docker failed with Exit Code: ${code}`);
            reject(new Error(`Docker Exit ${code}`));
          }
        });
      });

      // Update success status and save logs
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'success',
        logs: combinedLogs
      });

      let user = await User.findById(userId);
      let email = user.email;


      if(email){
        await emailQueue.add("githubDeploymentSuccessfulEmail",{to:email,liveUrl:liveUrl});
      }

      console.log(`[Job ${job.id}] Deployment Complete!`);

    } catch (error) {
      let user = await User.findById(userId);
      let email = user.email;


      if(email){
        await emailQueue.add("githubDeploymentFailedEmail",{to:email});
      }
      console.error(`[Job ${job.id}] Critical Failure:`, error.message);

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

console.log("Worker is active and listening for jobs...");
