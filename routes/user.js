/**
 * @file user.js
 * @description User dashboard routes providing user profile and deployment history.
 */

const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middlewares/authenticateJWT');
const User = require('../models/User');
const Deployment = require('../models/Deployments');
const { sendSuccess, sendError } = require('../utility');

/**
 * GET /dashboard
 * Returns the current authenticated user profile and all associated deployments.
 */
router.get('', authenticateJWT, async (req, res) => {
  try {
    // Security: exclude sensitive password hash from user object
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    // Retrieve user's deployments ordered by latest first
    const deployments = await Deployment.find({ userId: req.user.id }).sort({ createdAt: -1 });

    return sendSuccess(res, 'Dashboard data retrieved successfully', {
      user,
      deployments
    });
  } catch (err) {
    return sendError(res, 'Failed to retrieve dashboard data', 500, err);
  }
});

module.exports = router;