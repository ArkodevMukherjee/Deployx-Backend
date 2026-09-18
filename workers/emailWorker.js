/**
 * @file emailWorker.js
 * @description BullMQ worker for processing asynchronous email notifications via Nodemailer.
 * Handles OTP verification emails, signup welcome notes, and deployment status updates.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Worker } = require('bullmq');
const {
  sendOtpEmail,
  sendThankYouEmail,
  githubDeploymentFailedEmail,
  githubDeploymentSuccessfulEmail,
  urlDeploymentFailEmail,
  urlDeploymentSuccessfulEmail
} = require('../services/email.service');
const { connection } = require('../redis');

/**
 * BullMQ Worker: 'email-queue'
 */
const worker = new Worker(
  'email-queue',
  async job => {
    const { to, otp, liveUrl, sourceUrl, projectName } = job.data;
    console.log(`[Job ${job.id}] Processing email: "${job.name}" for recipient: <${to}>`);

    try {
      switch (job.name) {
        case 'sendOtp':
          await sendOtpEmail(to, otp);
          break;

        case 'thankOtp':
          await sendThankYouEmail(to);
          break;

        case 'githubDeploymentFailEmail':
        case 'githubDeploymentFailedEmail':
          await githubDeploymentFailedEmail(to, projectName || 'Your Project');
          break;

        case 'githubDeploymentSuccessfulEmail':
          await githubDeploymentSuccessfulEmail(to, projectName || 'Your Project', liveUrl);
          break;

        case 'urlDeploymentFailEmail':
          await urlDeploymentFailEmail(to, sourceUrl);
          break;

        case 'urlDeploymentSuccessfulEmail':
          await urlDeploymentSuccessfulEmail(to, liveUrl);
          break;

        default:
          console.warn(`[Worker: email-queue] Unrecognized job name: "${job.name}". Skipped.`);
          return;
      }

      console.log(`[Job ${job.id}] Email "${job.name}" dispatched successfully to <${to}>.`);
    } catch (err) {
      console.error(`[Job ${job.id}] Failed to dispatch email "${job.name}" to <${to}>:`, err.message);
      throw err; // Allow BullMQ to handle retry attempts with exponential backoff
    }
  },
  {
    connection,
    concurrency: 5
  }
);

worker.on('ready', () => {
  console.log('[Worker: email-queue] Connected to Redis and ready for jobs.');
});

worker.on('completed', job => {
  console.log(`[Worker: email-queue] Job ${job.id} completed.`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker: email-queue] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;