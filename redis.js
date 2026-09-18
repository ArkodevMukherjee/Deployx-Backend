/**
 * @file redis.js
 * @description Redis client configuration for BullMQ queues and worker connections.
 */

const Redis = require('ioredis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// BullMQ requires maxRetriesPerRequest to be null
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  }
});

connection.on('connect', () => {
  console.log('[Redis] Connected to Redis server successfully.');
});

connection.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

module.exports = { connection };
