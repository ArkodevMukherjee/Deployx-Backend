/**
 * @file auth.js
 * @description Authentication routes handling OTP-based signup, credential login,
 * and password recovery workflows.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const TempUser = require('../models/TempUser');
const User = require('../models/User');
const otpLimiter = require('../middlewares/otpLimiter');
const emailQueue = require('../queue/emailQueue');
const { connection } = require('../redis');
const {
  generateOtp,
  hashOtp,
  generateUserToken,
  sendSuccess,
  sendError
} = require('../utility');

const router = express.Router();

/**
 * POST /auth/send-otp
 * Generates and sends a 6-digit OTP for email verification during signup.
 */
router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return sendError(res, 'Email is required', 400);
    }

    // Check if user is already registered
    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser.authProviders.includes('local')) {
      return sendError(res, 'User with this email already exists. Please log in.', 409);
    }

    // Find or create temporary user record
    let tempUser = await TempUser.findOne({ email });
    if (!tempUser) {
      tempUser = await TempUser.create({ email });
    }

    // Generate 6-digit OTP and store SHA-256 hash
    const otp = generateOtp(6);
    tempUser.otp = hashOtp(otp);
    await tempUser.save();

    // Queue OTP dispatch email via BullMQ
    await emailQueue.add(
      'sendOtp',
      { to: email, otp },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000 // 1s initial delay
        }
      }
    );

    return sendSuccess(res, 'OTP sent to email successfully.', { email });
  } catch (err) {
    return sendError(res, 'Failed to send OTP', 500, err);
  }
});

/**
 * POST /auth/verify-otp
 * Verifies the provided OTP, registers the permanent user, and returns a JWT session.
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, username, password } = req.body;

    if (!email || !otp || !username || !password) {
      return sendError(res, 'Email, OTP, username, and password are required', 400);
    }

    const otpHash = hashOtp(otp);
    const tempUser = await TempUser.findOne({ email, otp: otpHash });

    if (!tempUser) {
      return sendError(res, 'Invalid or expired OTP', 401);
    }

    // Hash user password with salt rounds = 10
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email: tempUser.email,
      passwordHash,
      authProviders: ['local']
    });

    // Clean up temporary user record
    await TempUser.deleteOne({ _id: tempUser._id });

    // Generate authenticated JWT
    const token = generateUserToken({ id: user._id, provider: 'local' }, '1h');

    // Asynchronously dispatch welcome email
    await emailQueue.add(
      'thankOtp',
      { to: email },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );

    return sendSuccess(res, 'Signup successful', { token, user: { id: user._id, username: user.username, email: user.email } }, 201);
  } catch (err) {
    return sendError(res, 'Signup verification failed', 500, err);
  }
});

/**
 * POST /auth/login
 * Validates user credentials and issues a JWT token.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 'Email and password are required', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      return sendError(res, 'Invalid email or password', 401);
    }

    // Verify if account supports local password login
    if (!user.authProviders.includes('local')) {
      return sendError(res, 'Please log in using your OAuth provider (GitHub)', 403);
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return sendError(res, 'Invalid email or password', 401);
    }

    const token = generateUserToken({ id: user._id, provider: 'local' }, '1h');

    return sendSuccess(res, 'Login successful', {
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    return sendError(res, 'Login failed', 500, err);
  }
});

/**
 * POST /auth/forgot-password-otp
 * Generates an OTP for forgotten password recovery and caches it in Redis with 5-min TTL.
 */
router.post('/forgot-password-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendError(res, 'Email is required to request a password reset OTP', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      return sendError(res, 'No account found with this email address', 404);
    }

    // Rate-limit check in Redis: prevent spamming OTPs if one is already active
    const existingOtp = await connection.get(`${email}:forgot`);
    if (existingOtp) {
      return sendError(res, 'An OTP has already been sent to this email. Please check your inbox or wait 5 minutes.', 429);
    }

    const otp = generateOtp(6);
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Cache hashed OTP in Redis for 300 seconds (5 minutes)
    await connection.set(`${email}:forgot`, hashedOtp, 'EX', 300);

    // Queue email dispatch
    await emailQueue.add(
      'sendOtp',
      { to: email, otp },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );

    return sendSuccess(res, 'Password reset OTP sent to your email.');
  } catch (err) {
    return sendError(res, 'Failed to process password reset request', 500, err);
  }
});

/**
 * POST /auth/forgot-password-verify
 * Verifies recovery OTP from Redis and updates the user's password.
 */
router.post('/forgot-password-verify', async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
      return sendError(res, 'Email, OTP, and new password are required', 400);
    }

    const storedHashedOtp = await connection.get(`${email}:forgot`);
    if (!storedHashedOtp) {
      return sendError(res, 'OTP has expired or does not exist. Please request a new one.', 401);
    }

    const isValid = await bcrypt.compare(otp, storedHashedOtp);
    if (!isValid) {
      return sendError(res, 'Invalid OTP. Please try again.', 401);
    }

    const user = await User.findOne({ email });
    if (!user) {
      return sendError(res, 'User account not found', 404);
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    if (!user.authProviders.includes('local')) {
      user.authProviders.push('local');
    }
    await user.save();

    // Invalidate Redis OTP after successful reset
    await connection.del(`${email}:forgot`);

    return sendSuccess(res, 'Password has been successfully reset. You can now log in.');
  } catch (err) {
    return sendError(res, 'Failed to reset password', 500, err);
  }
});

module.exports = router;