const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { sendOtpEmail } = require('../services/email.service'); // your existing Nodemailer function

const connection = new Redis({
  host: '127.0.0.1',
  port: 6379
});

const worker = new Worker('email-queue', async job => {
  const { to, otp } = job.data;
  try {
    await sendOtpEmail(to, otp);
    console.log(`OTP email sent to ${to}`);
  } catch (err) {
    console.error(`Failed to send OTP to ${to}:`, err);
    throw err; // job will retry if you configure retries
  }
}, { connection });

worker.on('completed', job => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});