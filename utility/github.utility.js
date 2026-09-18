/**
 * @file github.utility.js
 * @description Utilities for GitHub App authentication, RS256 JWT generation,
 * and installation token acquisition for cloning private repositories.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * Resolves the GitHub App private RSA key from file or environment variable.
 * Checks GITHUB_PRIVATE_KEY_PATH, root private4.pem, or GITHUB_PRIVATE_KEY env var.
 * @returns {string} RSA private key contents in PEM format
 */
function getGitHubPrivateKey() {
  if (process.env.GITHUB_PRIVATE_KEY) {
    return process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  const customKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (customKeyPath && fs.existsSync(customKeyPath)) {
    return fs.readFileSync(path.resolve(customKeyPath), 'utf8');
  }

  // Fallback to default private key path in backend root
  const defaultKeyPath = path.resolve(__dirname, '../private4.pem');
  if (fs.existsSync(defaultKeyPath)) {
    return fs.readFileSync(defaultKeyPath, 'utf8');
  }

  throw new Error(`GitHub App Private Key missing. Expected at: ${defaultKeyPath} or GITHUB_PRIVATE_KEY env var.`);
}

/**
 * Generates an RS256 signed JSON Web Token (JWT) to authenticate as a GitHub App.
 * GitHub App JWTs have a maximum validity of 10 minutes.
 * @returns {string} RS256 signed GitHub App JWT
 */
function generateAppJWT() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error('GITHUB_APP_ID environment variable is not defined');
  }

  const privateKey = getGitHubPrivateKey();
  const nowInSeconds = Math.floor(Date.now() / 1000);

  const payload = {
    iat: nowInSeconds - 60,       // 60 seconds clock drift tolerance
    exp: nowInSeconds + 9 * 60,   // Expires in 9 minutes (max allowed by GitHub is 10 min)
    iss: appId
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Exchanges a GitHub App JWT for a temporary installation access token.
 * This token grants read/write access to repositories in the installation.
 * @param {number|string} installationId - GitHub App Installation ID
 * @param {string} [providedAppJwt] - Optional pre-generated App JWT. If omitted, generates one automatically.
 * @returns {Promise<string>} Temporary installation access token (valid for 1 hour)
 */
async function getInstallationToken(installationId, providedAppJwt = null) {
  if (!installationId) {
    throw new Error('installationId is required to fetch GitHub installation access token');
  }

  const appJwt = providedAppJwt || generateAppJWT();

  try {
    const response = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    return response.data.token;
  } catch (err) {
    const errorMessage = err.response?.data?.message || err.message;
    console.error(`[GitHub Utility] Error fetching token for installation ${installationId}:`, errorMessage);
    throw new Error(`Failed to obtain GitHub installation token: ${errorMessage}`);
  }
}

/**
 * Formats an authenticated git clone URL using an installation token.
 * @param {string} repoFullName - e.g. "owner/repo"
 * @param {string} token - GitHub installation access token
 * @returns {string} Authenticated git clone URL
 */
function formatAuthenticatedCloneUrl(repoFullName, token) {
  return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}

module.exports = {
  getGitHubPrivateKey,
  generateAppJWT,
  getInstallationToken,
  formatAuthenticatedCloneUrl
};
