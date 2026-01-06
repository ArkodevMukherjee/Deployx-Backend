require("dotenv").config();
const { Worker } = require("bullmq");
const Redis = require("ioredis");
const mongoose = require("mongoose");
const { spawn } = require("child_process");
const Deployment = require("../models/Deployments");

const connection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
});

mongoose.connect("mongodb://127.0.0.1:27017/github-app")
  .then(() => console.log("✅ MongoDB connected (URL Worker)"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

new Worker(
  "url-deployment-queue",
  async job => {
    const { deploymentId, url: publicGitUrl, branchName = "main", deployPath, projectType } = job.data;

    await Deployment.findByIdAndUpdate(deploymentId, { status: "in_progress" });

    try {
      console.log(`🚀 Deploying ${publicGitUrl} to ${deployPath}`);

      const dockerArgs = [
        "run",
        "--rm",
        "--cpus=1",
        "--memory=1g",
        "--pids-limit=100",
        "--network=bridge",
        "-e", `PUBLIC_GIT_URL=${publicGitUrl}`,
        "-e", `BRANCH=${branchName}`,
        "-e", `DEPLOY_PATH=${deployPath}`,
        "-e", `PROJECT_TYPE=${projectType}`,
        "-e", `AZURE_ACCOUNT=${process.env.AZURE_ACCOUNT}`,
        "-e", `AZURE_STORAGE_KEY=${process.env.AZURE_STORAGE_KEY}`,
        "deploy-public"
      ];

      await new Promise((resolve, reject) => {
        const child = spawn("docker", dockerArgs, { stdio: "inherit" });
        child.on("exit", code =>
          code === 0 ? resolve() : reject(new Error(`Docker exited with code ${code}`))
        );
      });

      await Deployment.findByIdAndUpdate(deploymentId, { status: "success" });
      console.log(`✅ Deployment successful for ${publicGitUrl}`);

    } catch (err) {
      await Deployment.findByIdAndUpdate(deploymentId, { status: "failed", logs: err.toString() });
      console.error(`❌ Deployment failed for ${publicGitUrl}`, err);
      throw err;
    }
  },
  { connection }
);