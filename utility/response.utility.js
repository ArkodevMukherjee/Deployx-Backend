/**
 * @file response.utility.js
 * @description Standardized HTTP JSON response utility for consistent API contracts.
 */

/**
 * Sends a standardized success JSON response.
 * @param {object} res - Express response object
 * @param {string} message - Human-readable success message
 * @param {object} [data] - Response payload data
 * @param {number} [statusCode=200] - HTTP status code
 */
function sendSuccess(res, message, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    ...data
  });
}

/**
 * Sends a standardized error JSON response.
 * @param {object} res - Express response object
 * @param {string} message - Human-readable error message
 * @param {number} [statusCode=500] - HTTP status code
 * @param {any} [error] - Error details (stack or specific reason, logged on server)
 */
function sendError(res, message, statusCode = 500, error = null) {
  if (error && statusCode >= 500) {
    console.error(`[API Error ${statusCode}] ${message}:`, error);
  }
  return res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && error ? { error: error.message || error } : {})
  });
}

module.exports = {
  sendSuccess,
  sendError
};
