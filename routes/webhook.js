// routes/webhook.js
const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation'); // Your Installation model

// Middleware to verify GitHub webhook signature (optional)
const verifySignature = require('../middlewares/verifySignature');

router.post('/', verifySignature, async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log('Event:', event);
  console.log('Action:', payload.action);
  console.log('Installation ID:', payload.installation?.id);

  try {
    if (event === 'installation') {
      const { action, installation } = payload;
      const installationId = installation.id;
      const account = installation.account;

      if (action === 'created') {
        // New installation → store in DB
        await Installation.findOneAndUpdate(
          { installationId },
          {
            installationId,
            accountLogin: account.login,
            accountType: account.type,
            repositories: [], // will be filled via installation_repositories event
            suspended: false
          },
          { upsert: true, new: true }
        );
        console.log(`Stored new installation: ${installationId}`);
      }

      if (action === 'deleted') {
        // Installation removed → delete from DB
        await Installation.deleteOne({ installationId });
        console.log(`Deleted installation: ${installationId}`);
      }

      if (action === 'suspend') {
        await Installation.updateOne({ installationId }, { suspended: true });
        console.log(`Suspended installation: ${installationId}`);
      }

      if (action === 'unsuspend') {
        await Installation.updateOne({ installationId }, { suspended: false });
        console.log(`Unsuspended installation: ${installationId}`);
      }
    }

    if (event === 'installation_repositories') {
      const installationId = payload.installation.id;

      // Repositories added
      if (payload.repositories_added?.length) {
        const reposToAdd = payload.repositories_added.map(repo => ({
          repoId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          cloneUrl: `https://github.com/${repo.full_name}.git` // construct manually
        }));

        await Installation.updateOne(
          { installationId },
          { $addToSet: { repositories: { $each: reposToAdd } } },
          { upsert: true }
        );
        console.log(`Added repositories for installation: ${installationId}`, reposToAdd);
      }

      // Repositories removed
      if (payload.repositories_removed?.length) {
        const repoIdsToRemove = payload.repositories_removed.map(r => r.id);
        await Installation.updateOne(
          { installationId },
          { $pull: { repositories: { repoId: { $in: repoIdsToRemove } } } }
        );
        console.log(`Removed repositories for installation: ${installationId}`, repoIdsToRemove);
      }
    }

    // Optional: handle push events if you want to track deployments
    if (event === 'push') {
      const repoId = payload.repository.id;
      const repoFullName = payload.repository.full_name;

      const installationDoc = await Installation.findOne({
        'repositories.repoId': repoId,
        suspended: false
      });

      if (installationDoc) {
        console.log(`Push event received for repo ${repoFullName}`);
        // You can update Deployment collection or trigger a deploy here
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Webhook failed');
  }
});

module.exports = router;
