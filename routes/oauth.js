/**
 * @file oauth.js
 * @description GitHub OAuth 2.0 authentication flow and short-lived exchange token handler.
 */

require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const crypto = require('crypto');
const User = require('../models/User');
const { connection } = require('../redis');
const {
  generateUserToken,
  sendSuccess,
  sendError
} = require('../utility');

const router = express.Router();

// Configure Passport GitHub Strategy
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ githubId: profile.id });

        if (!user) {
          user = await User.create({
            username: profile.username || profile.displayName || `github_${profile.id}`,
            githubId: profile.id,
            authProviders: ['github']
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

/**
 * GET /auth/github
 * Initiates the GitHub OAuth authorization redirect.
 */
router.get('/', passport.authenticate('github', { scope: ['user:email'] }));

/**
 * GET /auth/github/callback
 * Handles the OAuth redirect from GitHub, generates a secure exchange code, and redirects to frontend.
 */
router.get(
  '/callback',
  passport.authenticate('github', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=oauth_failed`
  }),
  async (req, res) => {
    try {
      const code = crypto.randomUUID();
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      // Store one-time exchange code in Redis for 60 seconds
      await connection.set(`oauth:${code}`, req.user._id.toString(), 'EX', 60);

      return res.redirect(`${frontendUrl}/login?code=${code}`);
    } catch (err) {
      console.error('[OAuth Callback Error]:', err);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=server_error`);
    }
  }
);

/**
 * GET /auth/github/deploy
 * Convenience redirect for frontend deployment view.
 */
router.get('/deploy', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return res.redirect(`${frontendUrl}/deploy`);
});

/**
 * POST /auth/github/exchange
 * Exchanges a short-lived one-time code for a long-lived JWT authentication token.
 */
router.post('/exchange', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return sendError(res, 'Exchange code is required', 400);
    }

    const userId = await connection.get(`oauth:${code}`);
    if (!userId) {
      return sendError(res, 'Invalid or expired exchange code', 401);
    }

    // Immediately consume the one-time code to prevent replay attacks
    await connection.del(`oauth:${code}`);

    const token = generateUserToken({ id: userId, provider: 'github' }, '1h');

    return sendSuccess(res, 'Token exchanged successfully', { token });
  } catch (err) {
    return sendError(res, 'Failed to exchange authorization code', 500, err);
  }
});

/**
 * GET /auth/github/failure
 * Fallback route when OAuth authorization fails.
 */
router.get('/failure', (req, res) => {
  return sendError(res, 'OAuth authentication failed', 401);
});

module.exports = router;
