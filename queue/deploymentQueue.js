// queues/deploymentQueue.js
const { Queue } = require('bullmq');
const Redis = require("ioredis")

const connection = new Redis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null  // IMPORTANT for BullMQ
});


module.exports = new Queue('deployment-queue', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false
  }
});
