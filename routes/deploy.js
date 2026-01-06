const express = require('express');
const Installation = require('../models/Installation');
const Deployment = require('../models/Deployments');

const deployLimiter = require('../middlewares/deployLimiter');
const deploymentQueue = require('../queue/deploymentQueue');
const urlDeploymentQueue = require("../queue/urlDeploymentQueue");
const authenticateJWT = require('../middlewares/authenticateJWT');
const { redis } = require("../redis")

const router = express.Router();

/**
 * GET /repositories
 * Called by frontend AFTER GitHub redirect
 */
router.get('/repositories', authenticateJWT, async (req, res) => {
  try {
    const rawInstallationId =
      req.query.installationId || req.query.installation_id;

    if (!rawInstallationId) {
      return res.status(400).json({
        message: 'installation_id is required'
      });
    }

    const installationId = Number(rawInstallationId);
    if (Number.isNaN(installationId)) {
      return res.status(400).json({
        message: 'installation_id must be a number'
      });
    }

    const installation = await Installation.findOne({ installationId });

    if (!installation) {
      return res.status(404).json({
        message: 'Installation not found'
      });
    }

    /**
     * Lazy binding:
     * First authenticated access binds user → installation
     */
    // if (!installation.userId) {
    //   installation.userId = req.user.id;
    //   await installation.save();
    // }

    /**
     * Multi-tenant safety
     */
    // if (String(installation.userId) !== String(req.user.id)) {
    //   return res.status(403).json({
    //     message: 'Unauthorized access to this installation'
    //   });
    // }

    const repositories = installation.repositories.map(repo => ({
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName
    }));

    return res.status(200).json({ repositories });

  } catch (err) {
    console.error('[GET /repositories]', err);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
});

/**
 * POST /deploy
 * JWT protected
 * Queues async deployment job
 */
router.post(
  '/',
  deployLimiter,
  authenticateJWT,
  async (req, res) => {
    try {
      const {
        isUrlDeployment,
        installationId: rawInstallationId,
        repoId,
        url,
        repoName,
        fullName,
        branchName = 'main',
        environment = 'production',
        projectType
      } = req.body;

      console.log(typeof(isUrlDeployment),url);

      /* ---------- URL DEPLOYMENT ---------- */
      if (isUrlDeployment === true) {
        if (!url) {
          return res.status(400).json({ message: 'URL is required' });
        }

        const deployPath = `url-deploy/${req.user.id}/${Date.now()}`;
        const deployedUrl = `${process.env.AZURE_WEB_ENDPOINT}/${deployPath}/`;

        const deployment = await Deployment.create({
          userId: req.user.id,
          deploymentType: 'url',
          url,
          environment,
          projectType,
          status: 'queued',
          deployPath,
          deployedUrl
        });

        await urlDeploymentQueue.add('url-deployment-queue', {
          deploymentId: deployment._id,
          url,
          deployPath,
          projectType
        });

        return res.status(202).json({
          message: 'URL deployment queued',
          deploymentId: deployment._id,
          deployedUrl
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
          return res.status(404).json({
            message: 'Repository not found in this installation'
          });
        }

        const deployPath = `installation-${installationId}/repo-${repoId}/deploy-${Date.now()}`;
        const deployedUrl = `${process.env.AZURE_WEB_ENDPOINT}/${deployPath}/`;

        const deployment = await Deployment.create({
          userId: req.user.id,
          deploymentType: 'github',
          installationId,
          repoId,
          repoName,
          fullName,
          branchName,
          environment,
          projectType,
          status: 'queued',
          deployPath,
          deployedUrl
        });

        await deploymentQueue.add('deployment-queue', {
          deploymentId: deployment._id,
          installationId,
          repoId,
          fullName,
          branchName,
          deployPath,
          projectType
        });

        return res.status(202).json({
          message: 'GitHub deployment queued',
          deploymentId: deployment._id,
          deployedUrl
        });
      }

      /* ---------- SAFETY ---------- */
      return res.status(400).json({
        message: 'Invalid deployment type'
      });

    } catch (err) {
      console.error('[POST /deploy]', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }
);


/**
 * GitHub App installation callback
 * This endpoint is PUBLIC by design
 * GitHub redirects here after install/update
 */
router.get('/callback', async (req, res) => {
  try {
    const { installation_id, setup_action } = req.query;

    if (!installation_id) {
      return res.status(400).send('Missing installation_id');
    }

    const installationId = Number(installation_id);
    if (Number.isNaN(installationId)) {
      return res.status(400).send('Invalid installation_id');
    }

    /**
     * Idempotent upsert
     * No user binding here (identity not available)
     */
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
    await redis.set(
      `github/installation:${code}`,
      installationId,
      'EX',
      60*10
    );




    /**
     * Redirect to frontend
     * JWT exists only there
     */
    return res.redirect(
      `${process.env.FRONTEND_URL}/deploy?code=${code}`
    );

  } catch (err) {
    console.error('[GitHub Install Callback]', err);
    return res.status(500).send('Internal server error');
  }
});

router.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    console.log(code);

    const installation_id = await redis.get(`github/installation:${code}`);
    if (!installation_id) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    await redis.del(`github/installation:${code}`);


    res.json({
      success: true,
      installation_id
    })
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;