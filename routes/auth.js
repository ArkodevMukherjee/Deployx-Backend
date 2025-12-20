const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TempUser = require('../models/TempUser');
const User = require('../models/User');
const otpLimiter = require('../middlewares/otpLimiter');
const { sendOtpEmail } = require('../services/email.service');

const router = express.Router();

// --- Step 1: Create temporary user ---
router.post('/signup-temp', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    await TempUser.create({ username, email, passwordHash });
    res.json({ message: 'Temporary signup created. Request OTP next.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Step 2: Send OTP ---
router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const tempUser = await TempUser.findOne({ email });
    if (!tempUser) return res.status(410).json({ message: 'Signup session expired' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    tempUser.otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    await tempUser.save();

    await emailQueue.add('sendOtp', { to: email, otp });
    res.json({ message: 'OTP sent to email.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Step 3: Verify OTP & create permanent user ---
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    const tempUser = await TempUser.findOne({ email, otpHash });
    if (!tempUser) return res.status(401).json({ message: 'Invalid or expired OTP' });

    const user = await User.create({
      username: tempUser.username,
      email: tempUser.email,
      passwordHash: tempUser.passwordHash,
      authProviders: ['local']
    });

    await TempUser.deleteOne({ _id: tempUser._id });

    const token = jwt.sign({ id: user._id, provider: 'local' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Signup successful', token });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;