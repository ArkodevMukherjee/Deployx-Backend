const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { spawn } = require('child_process');

const connection = new Redis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null  // IMPORTANT for BullMQ
});


const worker = new Worker('redeploymentQueue', async job => {
  const { deployPath, repoUrl, branch } = job.data;

  return new Promise((resolve, reject) => {
    const cmd = './redeploy.sh';
    const args = [deployPath, repoUrl, branch];

    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });

    child.on('close', code => {
      if (code === 0) {
        console.log(`Redeployment completed successfully for ${deployPath}`);
        resolve(`Redeployment successful: ${deployPath}`);
      } else {
        reject(new Error(`Redeployment failed with exit code ${code}`));
      }
    });

    child.on('error', err => {
      reject(err);
    });
  });
}, { connection });

worker.on('completed', job => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});