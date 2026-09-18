/**
 * @file deploy.js
 * @description Deployment routes for GitHub App repositories and arbitrary Git URLs.
 * Integrates BullMQ asynchronous queues, rate limiting, and JWT authentication.
 */

const express = require('express');
const crypto = require('crypto');
const Installation = require('../models/Installation');
const Deployment = require('../models/Deployments');
const deployLimiter = require('../middlewares/deployLimiter');
const deploymentQueue = require('../queue/deploymentQueue');
const urlDeploymentQueue = require('../queue/urlDeploymentQueue');
const authenticateJWT = require('../middlewares/authenticateJWT');
const { connection } = require('../redis');
const {
  buildDeployPath,
  buildDeployedUrl,
  extractRepoName,
  sendSuccess,
  sendError
} = require('../utility');

const router = express.Router();

/**
 * GET /deploy/repositories
 * Returns the list of repositories associated with an authorized GitHub App installation.
 */
router.get('/repositories', authenticateJWT, async (req, res) => {
  try {
    const rawInstallationId = req.query.installationId || req.query.installation_id;

    if (!rawInstallationId) {
      return sendError(res, 'installation_id query parameter is required', 400);
    }

    const installationId = Number(rawInstallationId);
    if (Number.isNaN(installationId)) {
      return sendError(res, 'installation_id must be a valid number', 400);
    }

    const installation = await Installation.findOne({ installationId });
    if (!installation) {
      return sendError(res, 'GitHub installation not found', 404);
    }

    const repositories = (installation.repositories || []).map(repo => ({
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName,
      cloneUrl: repo.cloneUrl
    }));

    return res.status(200).json({
      success: true,
      repositories
    });
  } catch (err) {
    return sendError(res, 'Failed to fetch repositories for installation', 500, err);
  }
});

/**
 * POST /deploy
 * Queues an asynchronous deployment for either a GitHub App repository or a public Git URL.
 */
router.post('/', deployLimiter, authenticateJWT, async (req, res) => {
  try {
    const {
      isUrlDeployment,
      installationId: rawInstallationId,
      repoId,
      url,
      repoName: bodyRepoName,
      fullName,
      branchName = 'main',
      environment = 'production',
      projectType
    } = req.body;

    /* ==========================================================================
       CASE 1: PUBLIC / CUSTOM GIT URL DEPLOYMENT
       ========================================================================== */
    if (isUrlDeployment === true) {
      if (!url) {
        return sendError(res, 'Git repository URL is required for URL deployments', 400);
      }

      // Create initial Deployment record
      const deployment = await Deployment.create({
        userId: req.user.id,
        deploymentType: 'url',
        url: url.trim(),
        environment,
        projectType,
        status: 'queued'
      });

      const deployPath = buildDeployPath(req.user.id, deployment._id);
      const liveUrl = buildDeployedUrl(process.env.SERVER_ENDPOINT, deployPath);

      deployment.deploypath = deployPath;
      deployment.deployedUrl = liveUrl;
      await deployment.save();

      // Enqueue deployment job in BullMQ
      await urlDeploymentQueue.add(
        'url-deployment-queue',
        {
          deploymentId: deployment._id,
          url: url.trim(),
          liveUrl,
          userId: req.user.id,
          deployPath,
          projectType
        },
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 1000 // 1s
          }
        }
      );

      return res.status(202).json({
        success: true,
        message: 'URL deployment queued successfully',
        deploymentId: deployment._id,
        deployedUrl: liveUrl
      });
    }

    /* ==========================================================================
       CASE 2: GITHUB APP REPOSITORY DEPLOYMENT
       ========================================================================== */
    if (isUrlDeployment === false) {
      const installationId = Number(rawInstallationId);
      if (!installationId || !repoId || !fullName) {
        return sendError(res, 'Missing required GitHub deployment fields (installationId, repoId, fullName)', 400);
      }

      const installation = await Installation.findOne({ installationId });
      if (!installation) {
        return sendError(res, 'GitHub installation not found', 404);
      }

      const repo = installation.repositories.find(
        r => String(r.repoId) === String(repoId)
      );

      if (!repo) {
        return sendError(res, 'Repository not found in this GitHub App installation', 404);
      }

      const finalRepoName = extractRepoName(fullName, bodyRepoName);

      // Create initial Deployment record
      const deployment = await Deployment.create({
        userId: req.user.id,
        deploymentType: 'github',
        installationId,
        repoId,
        repoName: finalRepoName,
        fullName,
        branchName,
        environment,
        projectType,
        status: 'queued'
      });

      const deployPath = buildDeployPath(req.user.id, deployment._id);
      const liveUrl = buildDeployedUrl(process.env.SERVER_ENDPOINT, deployPath);

      deployment.deploypath = deployPath;
      deployment.deployedUrl = liveUrl;
      await deployment.save();

      // Enqueue GitHub deployment job in BullMQ
      await deploymentQueue.add(
        'deployment-queue',
        {
          deploymentId: deployment._id,
          installationId,
          liveUrl,
          repoId,
          fullName,
          branchName,
          deployPath,
          projectType,
          userId: req.user.id
        },
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        }
      );

      return res.status(202).json({
        success: true,
        message: 'GitHub deployment queued successfully',
        deploymentId: deployment._id,
        deployedUrl: liveUrl
      });
    }

    return sendError(res, 'Invalid or missing isUrlDeployment flag (must be boolean true or false)', 400);
  } catch (err) {
    return sendError(res, 'Failed to queue deployment', 500, err);
  }
});

/**
 * GET /deploy/callback
 * GitHub App installation callback redirect handler.
 */
router.get('/callback', async (req, res) => {
  try {
    const { installation_id } = req.query;

    if (!installation_id) {
      return sendError(res, 'Missing installation_id parameter', 400);
    }

    const installationId = Number(installation_id);
    if (Number.isNaN(installationId)) {
      return sendError(res, 'Invalid installation_id parameter', 400);
    }

    // Ensure installation record exists in database
    await Installation.updateOne(
      { installationId },
      {
        $setOnInsert: {
          installationId,
          repositories: [],
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    const code = crypto.randomUUID();
    // Cache installation token exchange code for 10 minutes (600 seconds)
    await connection.set(`github/installation:${code}`, installationId, 'EX', 600);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/deploy?code=${code}`);
  } catch (err) {
    console.error('[GitHub Install Callback Error]:', err);
    return sendError(res, 'Internal server error during GitHub callback', 500, err);
  }
});

/**
 * POST /deploy/exchange
 * Exchanges an installation callback code for the corresponding GitHub installation ID.
 */
router.post('/exchange', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return sendError(res, 'Installation code is required', 400);
    }

    const installationId = await connection.get(`github/installation:${code}`);
    if (!installationId) {
      return sendError(res, 'Invalid or expired installation code', 401);
    }

    // Consume code once
    await connection.del(`github/installation:${code}`);

    return sendSuccess(res, 'Installation ID verified', {
      installation_id: Number(installationId)
    });
  } catch (err) {
    return sendError(res, 'Failed to exchange installation code', 500, err);
  }
});

module.exports = router;
