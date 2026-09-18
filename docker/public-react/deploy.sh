#!/bin/sh
set -e

# Ensure TARGET_DIR is set correctly
# Expected: /var/www/apps/repo-name/deployment-id
TARGET_DIR="$APPS_DIR/$DEPLOY_PATH"

echo "--- Step 1: Cloning Repository ---"
# Fixed: git clone [URL] [TARGET_DIRECTORY]
# We use a subdirectory 'repo' inside the container to build
git clone "$URL" repo
cd repo

echo "--- Step 1.5: Uploading Source Code to GCP Bucket ---"
node /scripts/upload-to-gcs.js .

echo "--- Step 2: Building Project ---"
npm install

# Vite needs the 'base' config set to this path to serve from a subfolder
# e.g., domain.com/my-repo/123/
export VITE_BASE_PATH="/$DEPLOY_PATH/"
npm run build

echo "--- Step 3: Exporting to Shared Volume ---"
# Create target directory on the host's shared volume
mkdir -p "$TARGET_DIR"

# Clean existing files in the target directory safely
# We use find to avoid 'Argument list too long' or accidental root deletions
find "$TARGET_DIR" -mindepth 1 -delete

# Copy build artifacts (check for 'dist' or 'build')
if [ -d "dist" ]; then
    cp -r dist/* "$TARGET_DIR/"
elif [ -d "build" ]; then
    cp -r build/* "$TARGET_DIR/"
else
    echo "Error: No build directory found (dist or build)."
    exit 1
fi

echo "Deployment Successful!"