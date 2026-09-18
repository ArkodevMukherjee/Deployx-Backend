const express = require('express');
const crypto = require('crypto');

const Installation = require('../models/Installation');
const Deployment = require('../models/Deployments');

const deployLimiter = require('../middlewares/deployLimiter');
const deploymentQueue = require('../queue/deploymentQueue');
const urlDeploymentQueueTest = require('../queue/urlDeploymentQueueTest');
const authenticateJWT = require('../middlewares/authenticateJWT');
const { connection } = require('../redis');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET /repositories
|--------------------------------------------------------------------------
| Called by frontend AFTER GitHub redirect
*/
router.get('/repositories', authenticateJWT, async (req, res) => {
  const totalStart = performance.now();

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

    const mongoStart = performance.now();

    const installation = await Installation.findOne({
      installationId
    });

    const mongoTime = performance.now() - mongoStart;

    if (!installation) {
      return res.status(404).json({
        message: 'Installation not found'
      });
    }

    const repositories = installation.repositories.map(repo => ({
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName
    }));

    const totalTime = performance.now() - totalStart;

    console.log(
      `[REPOSITORIES] MongoDB: ${mongoTime.toFixed(2)} ms | ` +
      `Total: ${totalTime.toFixed(2)} ms`
    );

    return res.status(200).json({
      repositories
    });

  } catch (err) {
    console.error('[GET /repositories]', err);

    return res.status(500).json({
      message: 'Internal server error'
    });
  }
});


/*
|--------------------------------------------------------------------------
| POST /deploy
|--------------------------------------------------------------------------
| JWT protected
| Queues async deployment job
|
| IMPORTANT:
| URL deployments use urlDeploymentQueueTest during performance testing.
| This prevents the real URL deployment worker from executing deployments.
|--------------------------------------------------------------------------
*/
router.post(
  '/',
  authenticateJWT,
  async (req, res) => {

    const totalStart = performance.now();

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


      /*
      |--------------------------------------------------------------------------
      | URL DEPLOYMENT
      |--------------------------------------------------------------------------
      */

      if (isUrlDeployment === true) {

        const validationStart = performance.now();

        if (!url) {
          return res.status(400).json({
            message: 'URL is required'
          });
        }

        const validationTime =
          performance.now() - validationStart;


        /*
        |--------------------------------------------------------------------------
        | MongoDB: Deployment.create()
        |--------------------------------------------------------------------------
        */

        const createStart = performance.now();

        const deployment = await Deployment.create({
          userId: req.user.id,
          deploymentType: 'url',
          url,
          environment,
          projectType,
          status: 'queued'
        });

        const createTime =
          performance.now() - createStart;


        /*
        |--------------------------------------------------------------------------
        | Construct deployment URL
        |--------------------------------------------------------------------------
        */

        const pathStart = performance.now();

        const deployPath =
          `${req.user.id}/${deployment._id}`;

        const finalUrl =
          `${process.env.SERVER_ENDPOINT}/${deployPath}/`;

        deployment.deployPath = deployPath;
        deployment.deployedUrl = finalUrl;

        const pathTime =
          performance.now() - pathStart;


        /*
        |--------------------------------------------------------------------------
        | MongoDB: deployment.save()
        |--------------------------------------------------------------------------
        */

        const saveStart = performance.now();

        await deployment.save();

        const saveTime =
          performance.now() - saveStart;


        /*
        |--------------------------------------------------------------------------
        | Queue: TEST queue
        |--------------------------------------------------------------------------
        |
        | IMPORTANT:
        | This is intentionally urlDeploymentQueueTest.
        |
        | The real deployment worker should NOT consume this queue.
        |
        */

        const queueStart = performance.now();

        const job = await urlDeploymentQueueTest.add(
          'url-deployment-test',
          {
            deploymentId: deployment._id,
            url,
            liveUrl: finalUrl,
            userId: req.user.id,
            deployPath,
            projectType
          }
        );

        const queueTime =
          performance.now() - queueStart;


        /*
        |--------------------------------------------------------------------------
        | TOTAL
        |--------------------------------------------------------------------------
        */

        const totalTime =
          performance.now() - totalStart;


        console.log(
          `[DEPLOY-URL] ` +
          `Validation: ${validationTime.toFixed(2)} ms | ` +
          `Mongo Create: ${createTime.toFixed(2)} ms | ` +
          `Path: ${pathTime.toFixed(2)} ms | ` +
          `Mongo Save: ${saveTime.toFixed(2)} ms | ` +
          `Queue.add: ${queueTime.toFixed(2)} ms | ` +
          `Total: ${totalTime.toFixed(2)} ms | ` +
          `Job: ${job.id}`
        );


        return res.status(202).json({
          message: 'URL deployment queued',
          deploymentId: deployment._id,
          deployedUrl: finalUrl
        });
      }


      /*
      |--------------------------------------------------------------------------
      | GITHUB DEPLOYMENT
      |--------------------------------------------------------------------------
      */

      if (isUrlDeployment === false) {

        const installationId =
          Number(rawInstallationId);

        if (!installationId || !repoId || !fullName) {
          return res.status(400).json({
            message: 'Missing GitHub fields'
          });
        }


        /*
        |--------------------------------------------------------------------------
        | MongoDB: Installation.findOne()
        |--------------------------------------------------------------------------
        */

        const installationStart =
          performance.now();

        const installation =
          await Installation.findOne({
            installationId
          });

        const installationTime =
          performance.now() - installationStart;


        if (!installation) {
          return res.status(404).json({
            message: 'Installation not found'
          });
        }


        /*
        |--------------------------------------------------------------------------
        | Repository lookup
        |--------------------------------------------------------------------------
        */

        const repoLookupStart =
          performance.now();

        const repo = installation.repositories.find(
          r => String(r.repoId) === String(repoId)
        );

        const repoLookupTime =
          performance.now() - repoLookupStart;


        if (!repo) {
          return res.status(404).json({
            message:
              'Repository not found in this installation'
          });
        }


        /*
        |--------------------------------------------------------------------------
        | Repository name
        |--------------------------------------------------------------------------
        */

        const finalRepoName =
          bodyRepoName ||
          fullName.split('/')[1] ||
          'unknown-repo';


        /*
        |--------------------------------------------------------------------------
        | MongoDB: Deployment.create()
        |--------------------------------------------------------------------------
        */

        const createStart =
          performance.now();

        const deployment =
          await Deployment.create({
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

        const createTime =
          performance.now() - createStart;


        /*
        |--------------------------------------------------------------------------
        | Construct deployment URL
        |--------------------------------------------------------------------------
        */

        const pathStart =
          performance.now();

        const deployPath =
          `${req.user.id}/${deployment._id}`;

        const deployedUrl =
          `${process.env.SERVER_ENDPOINT}/${deployPath}/`;

        deployment.deployPath = deployPath;
        deployment.deployedUrl = deployedUrl;

        const pathTime =
          performance.now() - pathStart;


        /*
        |--------------------------------------------------------------------------
        | MongoDB: deployment.save()
        |--------------------------------------------------------------------------
        */

        const saveStart =
          performance.now();

        await deployment.save();

        const saveTime =
          performance.now() - saveStart;


        /*
        |--------------------------------------------------------------------------
        | Real GitHub deployment queue
        |--------------------------------------------------------------------------
        */

        const queueStart =
          performance.now();

        const job =
          await deploymentQueue.add(
            'deployment-queue',
            {
              deploymentId: deployment._id,
              installationId,
              liveUrl: deployedUrl,
              repoId,
              fullName,
              branchName,
              deployPath,
              projectType,
              userId: req.user.id
            }
          );

        const queueTime =
          performance.now() - queueStart;


        /*
        |--------------------------------------------------------------------------
        | TOTAL
        |--------------------------------------------------------------------------
        */

        const totalTime =
          performance.now() - totalStart;


        console.log(
          `[DEPLOY-GITHUB] ` +
          `Mongo Installation: ${installationTime.toFixed(2)} ms | ` +
          `Repo Lookup: ${repoLookupTime.toFixed(2)} ms | ` +
          `Mongo Create: ${createTime.toFixed(2)} ms | ` +
          `Path: ${pathTime.toFixed(2)} ms | ` +
          `Mongo Save: ${saveTime.toFixed(2)} ms | ` +
          `Queue.add: ${queueTime.toFixed(2)} ms | ` +
          `Total: ${totalTime.toFixed(2)} ms | ` +
          `Job: ${job.id}`
        );


        return res.status(202).json({
          message: 'GitHub deployment queued',
          deploymentId: deployment._id,
          deployedUrl
        });
      }


      return res.status(400).json({
        message: 'Invalid deployment type'
      });

    } catch (err) {

      const totalTime =
        performance.now() - totalStart;

      console.error(
        `[POST /deploy] Failed after ${totalTime.toFixed(2)} ms`,
        err
      );

      return res.status(500).json({
        message: 'Server error'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GitHub App installation callback
|--------------------------------------------------------------------------
*/

router.get('/callback', async (req, res) => {

  const totalStart = performance.now();

  try {

    const { installation_id } = req.query;

    if (!installation_id) {
      return res.status(400).send(
        'Missing installation_id'
      );
    }

    const installationId =
      Number(installation_id);

    if (Number.isNaN(installationId)) {
      return res.status(400).send(
        'Invalid installation_id'
      );
    }


    const mongoStart =
      performance.now();

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

    const mongoTime =
      performance.now() - mongoStart;


    const redisStart =
      performance.now();

    const code =
      crypto.randomUUID();

    await connection.set(
      `github/installation:${code}`,
      installationId,
      'EX',
      600
    );

    const redisTime =
      performance.now() - redisStart;


    const totalTime =
      performance.now() - totalStart;


    console.log(
      `[GITHUB CALLBACK] ` +
      `MongoDB: ${mongoTime.toFixed(2)} ms | ` +
      `Redis: ${redisTime.toFixed(2)} ms | ` +
      `Total: ${totalTime.toFixed(2)} ms`
    );


    return res.redirect(
      `${process.env.FRONTEND_URL}/deploy?code=${code}`
    );

  } catch (err) {

    const totalTime =
      performance.now() - totalStart;

    console.error(
      `[GitHub Install Callback] Failed after ${totalTime.toFixed(2)} ms`,
      err
    );

    return res.status(500).send(
      'Internal server error'
    );
  }
});


/*
|--------------------------------------------------------------------------
| POST /exchange
|--------------------------------------------------------------------------
*/

router.post('/exchange', async (req, res) => {

  const totalStart = performance.now();

  try {

    const { code } = req.body;

    const redisGetStart =
      performance.now();

    const installation_id =
      await connection.get(
        `github/installation:${code}`
      );

    const redisGetTime =
      performance.now() - redisGetStart;


    if (!installation_id) {
      return res.status(401).json({
        error: 'Invalid or expired code'
      });
    }


    const redisDeleteStart =
      performance.now();

    await connection.del(
      `github/installation:${code}`
    );

    const redisDeleteTime =
      performance.now() - redisDeleteStart;


    const totalTime =
      performance.now() - totalStart;


    console.log(
      `[EXCHANGE] ` +
      `Redis GET: ${redisGetTime.toFixed(2)} ms | ` +
      `Redis DEL: ${redisDeleteTime.toFixed(2)} ms | ` +
      `Total: ${totalTime.toFixed(2)} ms`
    );


    return res.json({
      success: true,
      installation_id
    });

  } catch (err) {

    const totalTime =
      performance.now() - totalStart;

    console.error(
      `[Exchange] Failed after ${totalTime.toFixed(2)} ms`,
      err
    );

    return res.status(500).json({
      error: 'Server error'
    });
  }
});


module.exports = router;

