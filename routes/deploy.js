// routes/repositories.js
const express = require('express');
const Installation = require('../models/Installation');
const Deployment = require('../models/Deployments');

const deployLimiter = require('../middlewares/deployLimiter');
const deploymentQueue = require('../queue/deploymentQueue');
const authenticateJWT = require("../middlewares/authenticateJWT");

const router = express.Router();

/**
 * GET repositories for an installation
 */
router.get('/:installationId', async (req, res) => {
  try {
    const { installationId } = req.params;

    const installation = await Installation.findOne({ installationId });
    if (!installation) {
      return res.status(404).json({ message: 'Installation not found' });
    }

    const repositories = installation.repositories.map(repo => ({
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName
    }));

    res.json({ repositories });

  } catch (err) {
    console.error('Error fetching repositories:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /deploy
 * Queues a deployment job (NO heavy work here)
 */
router.post('/', deployLimiter,authenticateJWT, async (req, res) => {
  try {
    const {
      installationId,
      repoId,
      repoName,
      fullName,
      branchName = 'main',
      environment = 'production'
    } = req.body;

    let userId = req.user.id;

    // 1. Validate installation
    const installation = await Installation.findOne({ installationId });
    if (!installation) {
      return res.status(404).json({ message: 'Installation not found' });
    }

    console.log(req.user);

    // 2. Validate repository
    const repo = installation.repositories.find(r => r.repoId === repoId);
    if (!repo) {
      return res
        .status(404)
        .json({ message: 'Repository not found in this installation' });
    }

    // 3. Generate deploy path
    const deployPath = `installation-${installationId}/repo-${repoId}/deploy-${Date.now()}`;
    const deployedUrl = `${process.env.AZURE_WEB_ENDPOINT}/${deployPath}/`;

    // 4. Create deployment record
    const deployment = await Deployment.create({
      installationId,
      userId,
      repoId,
      repoName,
      fullName,
      branchName,
      environment,
      status: 'queued',
      deployPath,
      deployedUrl
    });

    // 5. Push job to BullMQ
    await deploymentQueue.add('deploy', {
      deploymentId: deployment._id,
      installationId,
      repoId,
      fullName,
      branchName,
      deployPath
    });

    // 6. Respond immediately
    res.status(202).json({
      message: 'Deployment queued successfully',
      deploymentId: deployment._id,
      deployedUrl
    });

  } catch (err) {
    console.error('Deployment API error:', err);
    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
});

module.exports = router;