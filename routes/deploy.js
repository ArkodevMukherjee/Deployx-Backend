const express = require('express');
const crypto = require('crypto'); // Ensure crypto is imported for randomUUID
const Installation = require('../models/Installation');
const Deployment = require('../models/Deployments');

const deployLimiter = require('../middlewares/deployLimiter');
const deploymentQueue = require('../queue/deploymentQueue');
const urlDeploymentQueue = require("../queue/urlDeploymentQueue");
const authenticateJWT = require('../middlewares/authenticateJWT');
const { connection } = require("../redis");

const router = express.Router();

/**
 * GET /repositories
 * Called by frontend AFTER GitHub redirect
 */
router.get('/repositories', authenticateJWT, async (req, res) => {
  try {
    const rawInstallationId = req.query.installationId || req.query.installation_id;

    if (!rawInstallationId) {
      return res.status(400).json({ message: 'installation_id is required' });
    }

    const installationId = Number(rawInstallationId);
    if (Number.isNaN(installationId)) {
      return res.status(400).json({ message: 'installation_id must be a number' });
    }

    const installation = await Installation.findOne({ installationId });

    if (!installation) {
      return res.status(404).json({ message: 'Installation not found' });
    }

    const repositories = installation.repositories.map(repo => ({
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName
    }));

    return res.status(200).json({ repositories });
  } catch (err) {
    console.error('[GET /repositories]', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /deploy
 * JWT protected
 * Queues async deployment job
 */
router.post('/', deployLimiter, authenticateJWT, async (req, res) => {
  try {
    const {
      isUrlDeployment,
      installationId: rawInstallationId,
      repoId,
      url,
      repoName: bodyRepoName, // Renamed to avoid collision
      fullName,
      branchName = 'main',
      environment = 'production',
      projectType
    } = req.body;

    /* ---------- URL DEPLOYMENT ---------- */
    if (isUrlDeployment === true) {
      if (!url) {
        return res.status(400).json({ message: 'URL is required' });
      }

      const deployment = await Deployment.create({
        userId: req.user.id,
        deploymentType: 'url',
        url,
        environment,
        projectType,
        status: 'queued',
      });

      const deployPath = `${req.user.id}/${deployment._id}`;
      const finalUrl = `${process.env.SERVER_ENDPOINT}/${deployPath}/`; // Create a local variable

      deployment.deployPath = deployPath;
      deployment.deployedUrl = finalUrl; // Match your schema naming
      await deployment.save();

      await urlDeploymentQueue.add('url-deployment-queue', {
        deploymentId: deployment._id,
        url,
        liveUrl:finalUrl,
        userId:req.user.id,
        deployPath,
        projectType
      });

      return res.status(202).json({
        message: 'URL deployment queued',
        deploymentId: deployment._id,
        deployedUrl: finalUrl // Use the variable here
      });
    }

    /* ---------- GITHUB DEPLOYMENT ---------- */
    if (isUrlDeployment === false) {
      const installationId = Number(rawInstallationId);
      if (!installationId || !repoId || !fullName) {
        return res.status(400).json({ message: 'Missing GitHub fields' });
      }

      const installation = await Installation.findOne({ installationId });
      if (!installation) {
        return res.status(404).json({ message: 'Installation not found' });
      }

      const repo = installation.repositories.find(
        r => String(r.repoId) === String(repoId)
      );

      if (!repo) {
        return res.status(404).json({ message: 'Repository not found in this installation' });
      }

      // Logic Check: Correctly derive the repoName for the URL
      const finalRepoName = bodyRepoName || fullName.split('/')[1] || 'unknown-repo';

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

      // Construction of the Deployment URL
      const deployPath = `${req.user.id}/${deployment._id}`;
      const deployedUrl = `${process.env.SERVER_ENDPOINT}/${deployPath}/`;

      deployment.deployPath = deployPath;
      deployment.deployedUrl = deployedUrl;
      await deployment.save();

      await deploymentQueue.add('deployment-queue', {
        deploymentId: deployment._id,
        installationId,
        liveUrl:deployedUrl,
        repoId,
        fullName,
        branchName,
        deployPath,
        projectType,
        userId:req.user.id
      });

      return res.status(202).json({
        message: 'GitHub deployment queued',
        deploymentId: deployment._id,
        deployedUrl
      });
    }

    return res.status(400).json({ message: 'Invalid deployment type' });

  } catch (err) {
    console.error('[POST /deploy]', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * GitHub App installation callback
 */
router.get('/callback', async (req, res) => {
  try {
    const { installation_id } = req.query;

    if (!installation_id) {
      return res.status(400).send('Missing installation_id');
    }

    const installationId = Number(installation_id);
    if (Number.isNaN(installationId)) {
      return res.status(400).send('Invalid installation_id');
    }

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
    await connection.set(`github/installation:${code}`, installationId, 'EX', 600);

    return res.redirect(`${process.env.FRONTEND_URL}/deploy?code=${code}`);
  } catch (err) {
    console.error('[GitHub Install Callback]', err);
    return res.status(500).send('Internal server error');
  }
});

router.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    const installation_id = await connection.get(`github/installation:${code}`);

    if (!installation_id) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    await connection.del(`github/installation:${code}`);

    res.json({
      success: true,
      installation_id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
