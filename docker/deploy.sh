#!/bin/sh
set -e

# Target is: /var/www/apps/repo-id/deployment-id
TARGET_DIR="$APPS_DIR/$DEPLOY_PATH"

echo "Cloning $REPO_FULL_NAME..."
git clone -b "$BRANCH" "https://x-access-token:${INSTALLATION_TOKEN}@github.com/${REPO_FULL_NAME}.git" repo
cd repo

echo "Uploading source code to GCP Cloud Storage..."
node /scripts/upload-to-gcs.js .

echo "Building..."
npm install
# Vite needs the base path to handle subfolders
export VITE_BASE_PATH="/$DEPLOY_PATH/"
npm run build

echo "Exporting to: $TARGET_DIR"
mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR"/*
cp -r dist/* "$TARGET_DIR/"

echo "Deployment Successful!"
