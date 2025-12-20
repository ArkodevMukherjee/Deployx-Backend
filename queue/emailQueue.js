const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis({
  host: '127.0.0.1', // your Redis host
  port: 6379,
  maxRetriesPerRequest: null
});

module.exports = new Queue('email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false
  }
});
