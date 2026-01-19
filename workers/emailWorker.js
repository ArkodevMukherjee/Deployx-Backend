const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Worker } = require('bullmq');
// Added missing imports for URL-specific functions
const { 
  sendOtpEmail, 
  sendThankYouEmail, 
  githubDeploymentFailedEmail, 
  githubDeploymentSuccessfulEmail, 
  urlDeploymentFailEmail,       // Added
  urlDeploymentSuccessfulEmail  // Added
} = require('../services/email.service');
const { connection } = require("../redis");

const worker = new Worker('email-queue', async job => {
  const { to, otp, liveUrl, sourceUrl, projectName } = job.data;

  try {
    switch (job.name) {
      case "sendOtp":
        await sendOtpEmail(to, otp);
        break;

      case "thankOtp":
        await sendThankYouEmail(to);
        break;

      case "githubDeploymentFailEmail":
        // Passing projectName makes the email much more helpful
        await githubDeploymentFailedEmail(to, projectName || "Your Project");
        break;

      case "githubDeploymentSuccessfulEmail":
        await githubDeploymentSuccessfulEmail(to, projectName || "Your Project", liveUrl);
        break;

      case "urlDeploymentFailEmail":
        await urlDeploymentFailEmail(to, sourceUrl);
        break;

      case "urlDeploymentSuccessfulEmail":
        await urlDeploymentSuccessfulEmail(to, liveUrl);
        break;

      default:
        console.warn(`Unknown job name: ${job.name}`);
    }
    console.log(`Email [${job.name}] sent successfully to ${to}`);
  } catch (err) {
    console.error(`Failed to send ${job.name} to ${to}:`, err);
    throw err; // Crucial for BullMQ to handle retries
  }
}, { connection });

worker.on('completed', job => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});