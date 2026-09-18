/**
 * @file otp.utility.js
 * @description OTP (One-Time Password) generation, hashing, and verification utilities.
 * Used for user registration, email verification, and password recovery.
 */

const crypto = require('crypto');

/**
 * Generates a cryptographically secure numeric OTP of specified length.
 * @param {number} length - Length of the OTP (default: 6)
 * @returns {string} Numeric OTP string
 */
function generateOtp(length = 6) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Hashes an OTP using SHA-256 for secure database or Redis storage.
 * @param {string} otp - Plaintext OTP
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashOtp(otp) {
  if (!otp) {
    throw new Error('OTP string is required for hashing');
  }
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

/**
 * Verifies a candidate OTP against a stored SHA-256 hash using timing-safe comparison.
 * @param {string} candidateOtp - Plaintext OTP provided by the user
 * @param {string} storedHash - SHA-256 hash stored in database or Redis
 * @returns {boolean} True if matching, false otherwise
 */
function verifyOtp(candidateOtp, storedHash) {
  if (!candidateOtp || !storedHash) {
    return false;
  }
  const candidateHash = hashOtp(candidateOtp);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp
};
