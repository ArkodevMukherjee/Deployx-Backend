# DeployX Build & Deployment Engine Deep Dive

This document explains the technical inner workings of the **DeployX Deployment Engine**, detailing how Docker sandboxing, shell scripts, volume mounting, Vite base path compilation, and Google Cloud Storage uploads interact.

---

## 1. Architectural Motivation: Why Docker Containers?

When building user-submitted code in a cloud platform:
1. **Security & Sandboxing:** Users can run arbitrary code during `npm install` (via lifecycle hooks like `preinstall` or `postinstall`) or inside `npm run build`. If run on the host server, a malicious script could read `.env` secrets, delete host files, or compromise the database. Running in a transient container (`docker run --rm`) limits the process scope.
2. **Environment Reproducibility:** Every build executes in a standardized `node:22-alpine` environment with controlled versions of Git, Tar, and Node, independent of the host OS (Linux, Windows, or macOS).
3. **Resource Cleansing:** With the `--rm` flag, the container filesystem is completely destroyed after execution, preventing disk leaks from accumulated `node_modules` or intermediate build files.

---

## 2. The Docker Execution Lifecycle

```mermaid
flowchart TD
    A["BullMQ Job Triggered"] --> B["Worker Prepares GCP & Git Environment Variables"]
    B --> C["Docker run --rm spawned via Node.js child_process"]
    C --> D["Container Entrypoint: /deploy.sh starts"]
    
    subgraph "Inside Docker Container"
        D --> E["Step 1: git clone repository"]
        E --> F["Step 2: node /scripts/upload-to-gcs.js (Upload to GCP)"]
        F --> G["Step 3: npm install"]
        G --> H["Step 4: export VITE_BASE_PATH & npm run build"]
        H --> I["Step 5: Copy build dist/* to mounted /var/www/apps volume"]
    end
    
    I --> J["Container exits with Code 0 (Success) or != 0 (Failure)"]
    J --> K["Worker captures full stdout/stderr and updates MongoDB"]
    K --> L["Worker triggers Email Notification"]
```

---

## 3. Directory & Volume Mounting Strategy

The host system shares a designated folder with the Docker container using volume mounts (`-v` flag):

```
Host Filesystem (Windows/Linux)          Docker Container (/var/www/apps)
------------------------------          --------------------------------
D:/DeployX/apps/                <=====>  /var/www/apps/
  └── <userId>/                           └── <userId>/
      └── <deploymentId>/                     └── <deploymentId>/
          ├── index.html                          ├── index.html
          └── assets/                             └── assets/
```

- When the Docker container copies compiled static files into `/var/www/apps/<userId>/<deploymentId>/`, the files are immediately present on the host machine.
- Nginx or an Express static file server can immediately serve these files to web visitors.

---

## 4. Subfolder Routing: Vite Base Path Configuration

### The Subfolder Routing Problem
In Single Page Applications (SPAs) built with React and Vite:
- By default, Vite generates asset links pointing to root: `<script src="/assets/index.js">`.
- In a multi-tenant deployment platform like DeployX, each project is served from a subpath:
  `https://yourdomain.com/<userId>/<deploymentId>/`
- If asset links point to `/assets/index.js`, the browser searches the root domain and receives HTTP `404 Not Found`.

### The DeployX Solution
Before running `npm run build`, the shell script sets:
```bash
export VITE_BASE_PATH="/$DEPLOY_PATH/"
npm run build
```
In the user's `vite.config.js`:
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/', // Automatically adjusts asset URLs!
});
```
This ensures all compiled assets in `dist/index.html` link correctly to `/<userId>/<deploymentId>/assets/index-[hash].js`.

---

## 5. Step-by-Step Script Breakdown (`deploy.sh`)

Here is how `docker/deploy.sh` operates line by line:

```bash
#!/bin/sh
set -e # Exit immediately if any command encounters an error

TARGET_DIR="$APPS_DIR/$DEPLOY_PATH"

echo "Cloning $REPO_FULL_NAME..."
# 1. Clone repository using short-lived GitHub App Installation Token
git clone -b "$BRANCH" "https://x-access-token:${INSTALLATION_TOKEN}@github.com/${REPO_FULL_NAME}.git" repo
cd repo

echo "Uploading source code to GCP Cloud Storage..."
# 2. Upload cloned source code to Google Cloud Storage bucket
node /scripts/upload-to-gcs.js .

echo "Building..."
# 3. Install project dependencies
npm install

# 4. Set Vite base path and compile production bundle
export VITE_BASE_PATH="/$DEPLOY_PATH/"
npm run build

echo "Exporting to: $TARGET_DIR"
# 5. Export built assets to shared host volume
mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR"/*
cp -r dist/* "$TARGET_DIR/"

echo "Deployment Successful!"
```

---

## 6. Real-Time Log Streaming via Node.js

The worker processes spawn the Docker container using Node's `child_process.spawn`:

```javascript
const child = spawn('docker', dockerArgs);

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  combinedLogs += chunk;
  process.stdout.write(chunk); // Streams to developer terminal in real-time
});

child.stderr.on('data', (data) => {
  const chunk = data.toString();
  combinedLogs += chunk;
  process.stderr.write(chunk);
});

child.on('exit', (code) => {
  if (code === 0) {
    resolve(); // Build succeeded
  } else {
    reject(new Error(`Docker build container exited with code ${code}`));
  }
});
```

Regardless of whether the build succeeds or fails, `combinedLogs` is saved in MongoDB under `Deployment.logs`, allowing developers to inspect build failures directly on their dashboard!
