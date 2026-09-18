/**
 * @file urlDeploymentWorker.js
 * @description BullMQ worker for executing deployments from arbitrary/public Git URLs.
 * Clones repository, runs containerized build, uploads source to GCP Cloud Storage,
 * exports built static bundle, and sends email notifications.
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

const HOST_APPS_DIR = process.env.HOST_APPS_DIR;
const DOCKER_APPS_DIR = process.env.DOCKER_APPS_DIR || '/var/www/apps';

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
 * BullMQ Worker: 'url-deployment-queue'
 */
const worker = new Worker(
  'url-deployment-queue',
  async job => {
    const { deploymentId, url, deployPath, projectType, userId, liveUrl } = job.data;
    console.log(`\n[Job ${job.id}] Processing URL deployment for source: ${url}`);

    // Transition status to 'in_progress'
    await Deployment.findByIdAndUpdate(deploymentId, { status: 'in_progress' });

    let combinedLogs = '';

    try {
      console.log(`   [Job ${job.id}] Spawning public URL build container...`);
      const gcpArgs = getGcpDockerArgs();

      const dockerArgs = [
        'run', '--rm',
        '-v', `${HOST_APPS_DIR}:${DOCKER_APPS_DIR}`,
        ...gcpArgs,
        '-e', `URL=${url}`,
        '-e', `DEPLOY_PATH=${deployPath}`,
        '-e', `APPS_DIR=${DOCKER_APPS_DIR}`,
        'deploy-public-react-image'
      ];

      // Execute container process and capture real-time stdout/stderr
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
            console.error(`\n   [Job ${job.id}] Container exited with code: ${code}`);
            reject(new Error(`Docker build container exited with code ${code}`));
          }
        });
      });

      // Save build logs and set status to 'success'
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'success',
        logs: combinedLogs
      });

      // Dispatch success notification email
      const user = await User.findById(userId);
      if (user && user.email) {
        await emailQueue.add(
          'urlDeploymentSuccessfulEmail',
          { to: user.email, liveUrl, sourceUrl: url },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
        );
      }

      console.log(`[Job ${job.id}] URL deployment complete: ${liveUrl}`);
    } catch (error) {
      console.error(`[Job ${job.id}] URL deployment failed:`, error.message);

      // Save build logs for debugging
      await Deployment.findByIdAndUpdate(deploymentId, {
        status: 'failed',
        logs: combinedLogs + `\nError: ${error.message}`
      });

      // Dispatch failure email
      try {
        const user = await User.findById(userId);
        if (user && user.email) {
          await emailQueue.add(
            'urlDeploymentFailEmail',
            { to: user.email, sourceUrl: url },
            { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
          );
        }
      } catch (emailErr) {
        console.error(`[Job ${job.id}] Failed to enqueue failure email:`, emailErr.message);
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: 5
  }
);

worker.on('ready', () => {
  console.log('[Worker: url-deployment-queue] Connected to Redis and ready for jobs.');
});

worker.on('failed', (job, err) => {
  console.error(`[Worker: url-deployment-queue] Job ${job?.id} failed with error:`, err.message);
});

module.exports = worker;