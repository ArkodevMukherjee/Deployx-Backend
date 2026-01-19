require("dotenv").config();
const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { connection } = require("../redis");
const crypto = require("crypto")

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
router.get(
  "/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: "https://deployx-frontend.vercel.app/login"
  }),
  async (req, res) => {
    try {
      const code = crypto.randomUUID();

      // Using string arguments (EX = seconds)
      await redis.set(
        `oauth:${code}`,          // key
        req.user._id.toString(),  // value
        'EX',                     // option for expiration
        60                        // expiration in seconds
      );


      res.redirect(
        `https://deployx-frontend.vercel.app/login?code=${code}`
      );
    } catch (err) {
      console.error(err);
      res.redirect("https://deployx-frontend.vercel.app/login");
    }
  }
);

router.get("/deploy",(req,res)=>{
  res.redirect("https://deployx-frontend.vercel.app/deploy");
})

/* =========================
   TOKEN EXCHANGE
========================= */
router.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    console.log(code);

    const userId = await redis.get(`oauth:${code}`);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    await redis.del(`oauth:${code}`);

    const token = jwt.sign(
      { id: userId },
      process.env.JWT_SECRET,
      { expiresIn: "1hr" }
    );

    res.json({
      success:true,
      token
    })
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Optional failure route
router.get('/failure', (req, res) => res.status(401).json({ message: 'OAuth failed' }));

module.exports = router;

