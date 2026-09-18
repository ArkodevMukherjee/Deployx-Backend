/**
 * @file deploymentWorker.js
 * @description BullMQ worker for executing GitHub App private repository deployments.
 * Handles GitHub App JWT authentication, installation token acquisition, Docker container lifecycle,
 * GCP Cloud Storage source code upload, and asynchronous email notification.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const { spawn } = require('child_process');
const { Worker } = require('bullmq');

const Deployment = require('../models/Deployments');
const User = require('../models/User');
const { connectToDb } = require('../connectToDb');
const emailQueue = require('../queue/emailQueue');
const { connection } = require('../redis');
const { generateAppJWT, getInstallationToken } = require('../utility/github.utility');

const HOST_APPS_DIR = process.env.HOST_APPS_DIR;

// Initialize database connection for worker process
(async () => {
  await connectToDb();
})();

/**
 * Builds the array of GCP Cloud Storage environment variables and volume mounts
 * to pass into the Docker container.
 * @returns {string[]} Docker CLI arguments
 */
function getGcpDockerArgs() {
  const gcpArgs = [];

  if (process.env.GCP_BUCKET_NAME) {
    gcpArgs.push('-e', `GCP_BUCKET_NAME=${process.env.GCP_BUCKET_NAME}`);
  }
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    gcpArgs.push('-e', `GCP_SERVICE_ACCOUNT_KEY=${process.env.GCP_SERVICE_ACCOUNT_KEY}`);
  }

  // Handle service account JSON key file mounting
  const keyPath = process.env.GCP_KEY_FILE_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && fs.existsSync(keyPath)) {
    const resolvedKeyPath = path.resolve(keyPath);
    gcpArgs.push('-v', `${resolvedKeyPath}:/app/gcp-key.json`, '-e', 'GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json');
  }

  if (process.env.GCP_UPLOAD_MODE) {
    gcpArgs.push('-e', `GCP_UPLOAD_MODE=${process.env.GCP_UPLOAD_MODE}`);
  }
  if (process.env.GCP_PROJECT_ID) {
    gcpArgs.push('-e', `GCP_PROJECT_ID=${process.env.GCP_PROJECT_ID}`);
  }

  return gcpArgs;
}

/**
 * BullMQ Worker: 'deployment-queue'
 */
const worker = new Worker(
  'deployment-queue',
  async job => {
    const { deploymentId, installationId, deployPath, fullName, branchName, userId, liveUrl } = job.data;
    console.log(`\n[Job ${job.id}] Processing GitHub deployment for: ${fullName} (Branch: ${branchName})`);

    // Transition status to 'in_progress'
    await Deployment.findByIdAndUpdate(deploymentId, { status: 'in_progress' });

    let combinedLogs = '';

    try {
      // Step 1: Generate GitHub App JWT and fetch installation token
      console.log(`   [Job ${job.id}] Authenticating with GitHub App...`);
      const appJwt = generateAppJWT();
      const installationToken = await getInstallationToken(installationId, appJwt);

      // Step 2: Prepare Docker execution arguments
      console.log(`   [Job ${job.id}] Spawning isolated Docker build container...`);
      const gcpArgs = getGcpDockerArgs();

      const dockerArgs = [
        'run', '--rm',
        '-v', `${HOST_APPS_DIR}:${HOST_APPS_DIR}`,
        ...gcpArgs,
        '-e', `INSTALLATION_TOKEN=${installationToken}`,
        '-e', `REPO_FULL_NAME=${fullName}`,
        '-e', `BRANCH=${branchName}`,
        '-e', `DEPLOY_PATH=${deployPath}`,
        '-e', `APPS_DIR=${HOST_APPS_DIR}`,
        'deploy-react-private-image'
      ];

      // Step 3: Execute container process and capture real-time stdout/stderr
      await new Promise((resolve, reject) => {
        const child = spawn('docker', dockerArgs);

        child.stdout.on('data', data => {
          const chunk = data.toString();
          combinedLogs += chunk;
          process.stdout.write(chunk);
        });

        child.stderr.on('data', data => {
          const chunk = data.toString();
          combinedLogs += chunk;
          process.stderr.write(chunk);
        });

        child.on('error', err => {
          combinedLogs += `\nDocker Process Spawn Error: ${err.message}`;
          reject(err);
        });

        child.on('exit', code => {
          if (code === 0) {
            console.log(`\n   [Job ${job.id}] Container build completed successfully.`);
            resolve();
          } else {
            console.error(`\n   [Job ${job.id}] Container exited with non-zero code: ${code}`);
            reject(new Error(`Docker build container exited with code ${code}`));
          }
        });
      });

      // Step 4: Mark deployment as success and save logs
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'success',
        logs: combinedLogs
      });

      // Step 5: Dispatch success email notification
      const user = await User.findById(userId);
      if (user && user.email) {
        await emailQueue.add(
          'githubDeploymentSuccessfulEmail',
          { to: user.email, liveUrl, projectName: fullName },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
        );
      }

      console.log(`[Job ${job.id}] GitHub deployment complete: ${liveUrl}`);
    } catch (error) {
      console.error(`[Job ${job.id}] Deployment failed:`, error.message);

      // Save build logs even on failure for developer inspection
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'failed',
        logs: combinedLogs + `\nError: ${error.message}`
      });

      // Dispatch failure email notification
      try {
        const user = await User.findById(userId);
        if (user && user.email) {
          await emailQueue.add(
            'githubDeploymentFailEmail',
            { to: user.email, projectName: fullName },
            { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
          );
        }
      } catch (emailErr) {
        console.error(`[Job ${job.id}] Failed to enqueue failure notification email:`, emailErr.message);
      }

      throw error; // Re-throw so BullMQ records job failure
    }
  },
  {
    connection,
    concurrency: 5
  }
);

worker.on('ready', () => {
  console.log('[Worker: deployment-queue] Connected to Redis and ready for jobs.');
});

worker.on('failed', (job, err) => {
  console.error(`[Worker: deployment-queue] Job ${job?.id} failed with error:`, err.message);
});

module.exports = worker;