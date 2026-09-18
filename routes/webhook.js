/**
 * @file webhook.js
 * @description GitHub Webhook receiver. Listens for GitHub App installation events,
 * repository permissions changes, and code push events.
 */

const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const verifySignature = require('../middlewares/verifySignature');

/**
 * POST /webhook
 * GitHub App webhook endpoint. Verified via HMAC SHA-256 signature middleware.
 */
router.post('/', verifySignature, async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`[GitHub Webhook] Received Event: "${event}", Action: "${payload?.action}", Installation ID: "${payload?.installation?.id}"`);

  try {
    /* --------------------------------------------------------------------------
       1. INSTALLATION EVENT (Created, Deleted, Suspended, Unsuspended)
       -------------------------------------------------------------------------- */
    if (event === 'installation') {
      const { action, installation } = payload;
      const installationId = installation.id;
      const account = installation.account;

      if (action === 'created') {
        await Installation.findOneAndUpdate(
          { installationId },
          {
            installationId,
            accountLogin: account.login,
            accountType: account.type,
            repositories: [],
            suspended: false
          },
          { upsert: true, new: true }
        );
        console.log(`[GitHub Webhook] Stored new GitHub App installation: ${installationId}`);
      }

      if (action === 'deleted') {
        await Installation.deleteOne({ installationId });
        console.log(`[GitHub Webhook] Deleted GitHub App installation: ${installationId}`);
      }

      if (action === 'suspend') {
        await Installation.updateOne({ installationId }, { suspended: true });
        console.log(`[GitHub Webhook] Suspended GitHub App installation: ${installationId}`);
      }

      if (action === 'unsuspend') {
        await Installation.updateOne({ installationId }, { suspended: false });
        console.log(`[GitHub Webhook] Unsuspended GitHub App installation: ${installationId}`);
      }
    }

    /* --------------------------------------------------------------------------
       2. REPOSITORY PERMISSIONS EVENT (Repositories Added or Removed)
       -------------------------------------------------------------------------- */
    if (event === 'installation_repositories') {
      const installationId = payload.installation.id;

      // Handle newly granted repositories
      if (payload.repositories_added?.length) {
        const reposToAdd = payload.repositories_added.map(repo => ({
          repoId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          cloneUrl: `https://github.com/${repo.full_name}.git`
        }));

        await Installation.updateOne(
          { installationId },
          { $addToSet: { repositories: { $each: reposToAdd } } },
          { upsert: true }
        );
        console.log(`[GitHub Webhook] Added ${reposToAdd.length} repositories for installation: ${installationId}`);
      }

      // Handle revoked repositories
      if (payload.repositories_removed?.length) {
        const repoIdsToRemove = payload.repositories_removed.map(r => r.id);
        await Installation.updateOne(
          { installationId },
          { $pull: { repositories: { repoId: { $in: repoIdsToRemove } } } }
        );
        console.log(`[GitHub Webhook] Removed ${repoIdsToRemove.length} repositories for installation: ${installationId}`);
      }
    }

    /* --------------------------------------------------------------------------
       3. PUSH EVENT (Optional CI/CD auto-deploy trigger)
       -------------------------------------------------------------------------- */
    if (event === 'push') {
      const repoId = payload.repository?.id;
      const repoFullName = payload.repository?.full_name;

      const installationDoc = await Installation.findOne({
        'repositories.repoId': repoId,
        suspended: false
      });

      if (installationDoc) {
        console.log(`[GitHub Webhook] Push event detected on verified repository: ${repoFullName}`);
        // Future extension: trigger auto-redeploy job
      }
    }

    return res.status(200).send('Webhook processed successfully');
  } catch (err) {
    console.error('[GitHub Webhook Error]:', err);
    return res.status(500).send('Webhook handler error');
  }
});

module.exports = router;
