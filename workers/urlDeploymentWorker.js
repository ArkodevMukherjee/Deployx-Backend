const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Worker } = require('bullmq');
const Deployment = require('../models/Deployments');
const { connectToDb } = require("../connectToDb");
const User = require("../models/User");
const emailQueue = require("../queue/emailQueue");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { spawn } = require('child_process');
const { connection } = require("../redis");



// const HOST_APPS_DIR = '/var/www/apps';
const HOST_APPS_DIR = process.env.DOCKER_APPS_DIR;

// MongoDB Connection
(async () => {
    await connectToDb();
})();



/**
 * BullMQ Worker
 */
const worker = new Worker(
    'url-deployment-queue',
    async job => {

        // Data input to the worker from routes
        const { deploymentId, url, deployPath, projectType, userId , liveUrl } = job.data;


        // Updating the deployment model data to the status inp progress to notify the user that the deployment process has been started in the server
        await Deployment.findByIdAndUpdate(deploymentId, { status: 'in_progress' });

        let combinedLogs = "";

        try {

            // Starting the docker container
            console.log(`   [${job.id}] Starting Docker container...`);

            // These are the docker arguments
            const dockerArgs = [
                'run', '--rm',
                '-v', `${HOST_APPS_DIR}:${process.env.DOCKER_APPS_DIR}`,
                '-e', `URL=${url}`,
                '-e', `DEPLOY_PATH=${deployPath}`,
                '-e', `APPS_DIR=${process.env.DOCKER_APPS_DIR}`,
                'deploy-public-react-image'
            ];

            await new Promise((resolve, reject) => {
                // Using 'pipe' to capture output for MongoDB storage
                const child = spawn('docker', dockerArgs, { shell: true });

                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    combinedLogs += chunk;
                    process.stdout.write(chunk); // Stream to terminal
                });

                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    combinedLogs += chunk;
                    process.stderr.write(chunk); // Stream to terminal
                });

                child.on('error', (err) => {
                    combinedLogs += `\nSpawn Error: ${err.message}`;
                    reject(err);
                });

                child.on('exit', (code) => {
                    if (code === 0) {
                        console.log(`\n   [${job.id}] Docker finished successfully.`);
                        resolve();
                    } else {
                        console.error(`\n   [${job.id}] Docker failed with Exit Code: ${code}`);
                        reject(new Error(`Docker Exit ${code}`));
                    }
                });
            });

            console.log("Id",userId)

            let user = await User.findById(userId);
            console.log("User",user);
            let email = user.email;
            console.log("User",email);


            if (email) {
                await emailQueue.add("urlDeploymentSuccessfulEmail", { to: email, liveUrl:liveUrl });
            }

            // Update success status and save logs
            await Deployment.findByIdAndUpdate(deploymentId, {
                status: 'success',
                logs: combinedLogs
            });
            console.log(`[Job ${job.id}] Deployment Complete!`);

        } catch (error) {

            let user = await User.findById(userId);
            let email = user.email;


            if (email) {
                await emailQueue.add("urlDeploymentFailEmail", { to: email , sourceUrl:url });
            }
            console.error(`[Job ${job.id}] Critical Failure:`, error.message);

            // Save logs even on failure so you can debug the npm/git errors
            await Deployment.findByIdAndUpdate(deploymentId, {
                status: 'failed',
                logs: combinedLogs + `\nError: ${error.message}`
            });
            throw error;
        }
    },
    {
        connection,
        concurrency: 1
    }
);

console.log("Worker is active and listening for jobs...");
