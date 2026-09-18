/**
 * @file deploy.utility.js
 * @description Path generation, URL resolution, and naming helpers for the DeployX deployment engine.
 */

/**
 * Constructs the unique deployment storage path used on the host and inside containers.
 * Standard format: "<userId>/<deploymentId>"
 * @param {string} userId - User ID who triggered the deployment
 * @param {string} deploymentId - MongoDB Deployment Document ID
 * @returns {string} Deployment subpath
 */
function buildDeployPath(userId, deploymentId) {
  if (!userId || !deploymentId) {
    throw new Error('Both userId and deploymentId are required to build a deploy path');
  }
  return `${userId}/${deploymentId}`;
}

/**
 * Constructs the public live URL where the deployed web application is served.
 * Standard format: "<SERVER_ENDPOINT>/<deployPath>/"
 * @param {string} serverEndpoint - Base server URL (e.g., https://yourdomain.com)
 * @param {string} deployPath - Deployment subpath (e.g., "65f1a2.../65f2b3...")
 * @returns {string} Fully qualified live site URL with trailing slash
 */
function buildDeployedUrl(serverEndpoint, deployPath) {
  const base = (serverEndpoint || process.env.SERVER_ENDPOINT || 'http://localhost:8000').replace(/\/+$/, '');
  const cleanPath = String(deployPath).replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${cleanPath}/`;
}

/**
 * Safely extracts repository name from full GitHub repository identifier ("owner/repo").
 * @param {string} fullName - Full repository name (e.g., "facebook/react")
 * @param {string} [fallback] - Fallback name if fullName is invalid
 * @returns {string} Repository name
 */
function extractRepoName(fullName, fallback = 'unknown-repo') {
  if (!fullName || typeof fullName !== 'string') {
    return fallback;
  }
  const parts = fullName.split('/');
  return parts.length > 1 ? parts[1].trim() : parts[0].trim() || fallback;
}

/**
 * Sanitizes an arbitrary git URL (e.g. from public URL deployments)
 * @param {string} url - Target git repository URL
 * @returns {string} Sanitized URL
 */
function sanitizeGitUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/+$/, '');
}

module.exports = {
  buildDeployPath,
  buildDeployedUrl,
  extractRepoName,
  sanitizeGitUrl
};
