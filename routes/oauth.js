require("dotenv").config();
const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const GitHubStrategy = require('passport-github2').Strategy;

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Find user by GitHub ID (globally unique)
        let user = await User.findOne({ githubId: profile.id });

        if (!user) {
          user = await User.create({
            username: profile.username,
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


// --- Start GitHub OAuth login ---
router.get('/', passport.authenticate('github', { scope: ['user:email'] }));

// --- GitHub callback ---
router.get('/callback',
  passport.authenticate('github', { session: false, failureRedirect: '/oauth/failure' }),
  async (req, res) => {
    try {
      // Issue JWT after successful OAuth
      const token = jwt.sign(
        { id: req.user._id, provider: 'github' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      res.json({ message: 'GitHub login successful', token });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// Optional failure route
router.get('/failure', (req, res) => res.status(401).json({ message: 'OAuth failed' }));

module.exports = router;
