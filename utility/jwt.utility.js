/**
 * @file jwt.utility.js
 * @description JSON Web Token (JWT) signing and verification helpers for user authentication.
 */

const jwt = require('jsonwebtoken');

/**
 * Generates a signed JWT for an authenticated user session.
 * @param {object} payload - Data to embed in the token (e.g. { id, provider })
 * @param {string|number} expiresIn - Token expiration (default: '1h')
 * @returns {string} Signed JWT token
 */
function generateUserToken(payload, expiresIn = '1h') {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not defined');
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

/**
 * Verifies a JWT token asynchronously.
 * @param {string} token - JWT token string
 * @returns {Promise<object>} Decoded token payload
 */
function verifyUserToken(token) {
  return new Promise((resolve, reject) => {
    if (!process.env.JWT_SECRET) {
      return reject(new Error('JWT_SECRET environment variable is not defined'));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

/**
 * Decodes a JWT token without verifying signature.
 * @param {string} token - JWT token string
 * @returns {object|null} Decoded token or null
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  generateUserToken,
  verifyUserToken,
  decodeToken
};
