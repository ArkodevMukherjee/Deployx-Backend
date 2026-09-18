/**
 * Script to upload cloned source code to Google Cloud Storage (GCS)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getStorageClient() {
  const { Storage } = require('@google-cloud/storage');
  const options = {};

  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      const rawKey = process.env.GCP_SERVICE_ACCOUNT_KEY.trim();
      if (rawKey.startsWith('{')) {
        options.credentials = JSON.parse(rawKey);
      } else {
        const decoded = Buffer.from(rawKey, 'base64').toString('utf-8');
        options.credentials = JSON.parse(decoded);
      }
      if (options.credentials.project_id) {
        options.projectId = options.credentials.project_id;
      }
    } catch (err) {
      console.error('[GCS Upload] Error parsing GCP_SERVICE_ACCOUNT_KEY JSON:', err.message);
      throw err;
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    options.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (process.env.GCP_PROJECT_ID && !options.projectId) {
    options.projectId = process.env.GCP_PROJECT_ID;
  }

  return new Storage(options);
}

async function uploadDirectory(bucket, localDir, destinationPrefix) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(localDir, entry.name);
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const destinationBlob = `${destinationPrefix}/${entry.name}`.replace(/^\/+/, '');

    if (entry.isDirectory()) {
      await uploadDirectory(bucket, fullPath, destinationBlob);
    } else if (entry.isFile()) {
      await bucket.upload(fullPath, {
        destination: destinationBlob,
        resumable: false,
      });
    }
  }
}

async function main() {
  const bucketName = process.env.GCP_BUCKET_NAME;
  if (!bucketName) {
    console.log('[GCS Upload] Notice: GCP_BUCKET_NAME not specified. Skipping GCP bucket upload.');
    return;
  }

  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  if (!fs.existsSync(targetDir)) {
    throw new Error(`[GCS Upload] Target directory does not exist: ${targetDir}`);
  }

  const deployPath = process.env.DEPLOY_PATH || 'default';
  const prefix = process.env.GCP_BLOB_PREFIX || `source/${deployPath}`;
  const uploadMode = (process.env.GCP_UPLOAD_MODE || 'archive').toLowerCase();

  console.log(`[GCS Upload] Initializing GCP bucket upload...`);
  console.log(`[GCS Upload] Bucket: ${bucketName}`);
  console.log(`[GCS Upload] Target Directory: ${targetDir}`);
  console.log(`[GCS Upload] Destination Prefix: ${prefix}`);
  console.log(`[GCS Upload] Mode: ${uploadMode}`);

  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);

  const [bucketExists] = await bucket.exists();
  if (!bucketExists) {
    throw new Error(`[GCS Upload] Bucket "${bucketName}" does not exist or credentials lack access.`);
  }

  if (uploadMode === 'archive' || uploadMode === 'both') {
    const tmpArchive = path.join('/tmp', `source-${Date.now()}.tar.gz`);
    console.log(`[GCS Upload] Compressing source directory to ${tmpArchive}...`);
    execSync(`tar --exclude='.git' --exclude='node_modules' -czf "${tmpArchive}" -C "${targetDir}" .`);

    const destinationBlob = `${prefix}/source.tar.gz`.replace(/^\/+/, '');
    console.log(`[GCS Upload] Uploading archive to gs://${bucketName}/${destinationBlob}...`);
    await bucket.upload(tmpArchive, {
      destination: destinationBlob,
      resumable: false,
      metadata: {
        contentType: 'application/gzip',
      },
    });
    fs.unlinkSync(tmpArchive);
    console.log(`[GCS Upload] Archive upload complete!`);
  }

  if (uploadMode === 'raw' || uploadMode === 'both') {
    console.log(`[GCS Upload] Uploading individual files to gs://${bucketName}/${prefix}/...`);
    await uploadDirectory(bucket, targetDir, prefix);
    console.log(`[GCS Upload] Individual files upload complete!`);
  }

  console.log(`[GCS Upload] Source code successfully uploaded to GCP Bucket: ${bucketName}`);
}

main().catch((err) => {
  console.error('[GCS Upload] Failed to upload code to GCP Bucket:', err.message);
  process.exit(1);
});
