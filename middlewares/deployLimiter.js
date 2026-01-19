// utils/deployLimiter.js
const rateLimit = require('express-rate-limit');

const deployLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // maximum 5 requests per window per IP
  message: {
    status: 429,
    error: 'Too many deployment requests from this IP, please try again after 10 minutes.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,  // Disable the `X-RateLimit-*` headers
});

module.exports = deployLimiter;
