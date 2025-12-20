const mongoose = require('mongoose');

const TempUserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  otpHash: String,
  createdAt: { type: Date, default: Date.now }
});

/**
 * TTL: automatically delete after 10 minutes
 */
TempUserSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model('TempUser', TempUserSchema);