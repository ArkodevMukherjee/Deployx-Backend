const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TempUser = require('../models/TempUser');
const User = require('../models/User');
const otpLimiter = require('../middlewares/otpLimiter');
const emailQueue = require('../queue/emailQueue')

const { connection } = require("../redis")

const router = express.Router();


router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Find existing temp user
    let tempUser = await TempUser.findOne({ email });

    // If not found, create a new temp user with just email
    if (!tempUser) {
      tempUser = await TempUser.create({ email });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    tempUser.otp = crypto.createHash('sha256').update(otp).digest('hex');


    await tempUser.save();

    // Send OTP via email queue
    await emailQueue.add('sendOtp', { to: email, otp });

    res.json({ success: true, message: 'OTP sent to email.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, username, password } = req.body;

    if (!email || !otp || !username || !password) {
      return res.status(400).json({ message: 'Email, OTP, username, and password are required' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    const tempUser = await TempUser.findOne({ email, otp: otpHash });
    if (!tempUser) return res.status(401).json({ message: 'Invalid or expired OTP' });

    // Hash password from frontend
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email: tempUser.email,   // keep email from tempUser
      passwordHash,
      authProviders: ['local']
    });

    // Delete temp user
    await TempUser.deleteOne({ _id: tempUser._id });

    const token = jwt.sign({ id: user._id, provider: 'local' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    await emailQueue.add("thankOtp",{to:email});
    res.json({ message: 'Signup successful', token });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// --- Login Route ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // If user registered via OAuth only
    if (!user.authProviders.includes('local')) {
      return res.status(403).json({
        message: 'Please login using OAuth provider'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, provider: 'local' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot Password
router.post('/forgot-password-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({
      message: "Email is needed to get the forgot password otp"
    });
  }


  const user = await User.findOne({ email });
  if (!user) {
    return res.json({
      message: "User does not exist need to login first"
    })
  }

  else {
    if (await connection.get(`${email}:forgot`)) {
      return res.json({
        message: "OTP already sent to the email"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const val = await connection.set(`${email}:forgot`, hashedOtp, 'EX', 300);



    await emailQueue.add("sendOtp", { to: email, otp });

    return res.json({
      message: "Otp has been queued in the backend"
    });
  }

})

// Forgot Password Verify Route
router.post('/forgot-password-verify', async (req, res) => {
  const { email, otp, password } = req.body;

  if (!email || !otp || !password) {
    return res.status(400).json({
      message: "Missing email or otp or password"
    });
  }

  const otpRedis = await connection.get(`${email}:forgot`);
  if (!otpRedis) {
    return res.status(401).json({
      message: "Otp does not exist"
    });
  }

  const isValid = await bcrypt.compare(otp, otpRedis);

  if (!isValid) {
    return res.status(401).json({
      message: "Wrong otp try again"
    });
  }

  else {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        message: "User does not exist"
      })
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    await connection.del(`${email}:forgot`);
    return res.status(200).json({
      success: true,
      message: "Otp verfied and password set up"
    })
  }
})

module.exports = router;