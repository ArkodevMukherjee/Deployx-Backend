#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Validate env vars
: "${INSTALLATION_TOKEN:?Missing INSTALLATION_TOKEN}"
: "${REPO_FULL_NAME:?Missing REPO_FULL_NAME}"
: "${BRANCH:?Missing BRANCH}"
: "${AZURE_ACCOUNT:?Missing AZURE_ACCOUNT}"
: "${AZURE_STORAGE_KEY:?Missing AZURE_STORAGE_KEY}"
: "${DEPLOY_PATH:?Missing DEPLOY_PATH}"

echo "📦 Cloning repository..."
git clone -b "$BRANCH" \
  "https://x-access-token:${INSTALLATION_TOKEN}@github.com/${REPO_FULL_NAME}.git" \
  repo

cd repo

echo "🔧 Installing dependencies..."
npm install

# 🔑 Tell Vite it is deployed in a subfolder
export VITE_BASE_PATH="/$DEPLOY_PATH/"

echo "🏗️ Building project..."
npm run build

# Safety check
if [ ! -d "dist" ]; then
  echo "❌ dist directory not found"
  exit 1
fi

echo "☁️ Uploading to Azure Blob Storage..."
az storage blob upload-batch \
  --account-name "$AZURE_ACCOUNT" \
  --account-key "$AZURE_STORAGE_KEY" \
  --destination "\$web/$DEPLOY_PATH" \
  --source dist \
  --overwrite

echo "✅ Deployment completed successfully!"