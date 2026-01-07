#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Validate required environment variables
: "${INSTALLATION_TOKEN:?Missing INSTALLATION_TOKEN}"
: "${REPO_FULL_NAME:?Missing REPO_FULL_NAME}"
: "${BRANCH:?Missing BRANCH}"
: "${DEPLOY_PATH:?Missing DEPLOY_PATH}"
: "${APPS_DIR:?Missing APPS_DIR}"  # e.g., /var/www/apps

TARGET_DIR="$APPS_DIR/$DEPLOY_PATH"

echo "📦 Cloning repository..."
git clone -b "$BRANCH" \
  "https://x-access-token:${INSTALLATION_TOKEN}@github.com/${REPO_FULL_NAME}.git" \
  repo

cd repo

echo "🔧 Installing dependencies..."
npm install

# Tell Vite it’s deployed under a subpath
export VITE_BASE_PATH="/$DEPLOY_PATH/"
echo "🏗️ Building React project with base path $VITE_BASE_PATH..."
npm run build

# Ensure build exists
if [ ! -d "dist" ]; then
  echo "❌ dist directory not found"
  exit 1
fi

echo "📁 Preparing target directory: $TARGET_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "📤 Copying SPA build to target directory..."
cp -r dist/* "$TARGET_DIR/"

echo "🔄 Fixing permissions..."
chown -R node:node "$TARGET_DIR"
chmod -R 755 "$TARGET_DIR"

echo "✅ Deployment completed successfully!"