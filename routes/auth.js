const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TempUser = require('../models/TempUser');
const User = require('../models/User');
const otpLimiter = require('../middlewares/otpLimiter');
const { sendOtpEmail } = require('../services/email.service');
const emailQueue = require('../queue/emailQueue')

const router = express.Router();

// --- Step 1: Create temporary user ---
// router.post('/signup-temp', async (req, res) => {
//   try {
//     const { username, email, password } = req.body;
//     const passwordHash = await bcrypt.hash(password, 10);
//     await TempUser.create({ username, email, passwordHash });
//     res.json({ success:true,message: 'Temporary signup created. Request OTP next.' });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });


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
    console.log(email,otp,username,password);

    if (!email || !otp || !username || !password) {
      return res.status(400).json({ message: 'Email, OTP, username, and password are required' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    const tempUser = await TempUser.findOne({ email, otp:otpHash });
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

module.exports = router;