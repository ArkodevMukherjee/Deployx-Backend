// redis.js
const IORedis = require('ioredis');

module.exports = new IORedis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null
});