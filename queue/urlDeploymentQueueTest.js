// queues/deploymentQueue.js
const { Queue } = require('bullmq');
const {connection} = require("../redis");


module.exports = new Queue('url-deployment-queue-test', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false
  }
});

