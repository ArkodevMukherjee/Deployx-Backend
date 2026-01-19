const Redis = require("ioredis")
require('dotenv').config();

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

connection.on("connect", () => {
  console.log("Redis connected");
});

connection.on("error", (err) => {
  console.error("Redis error", err);
});


module.exports = { connection }
