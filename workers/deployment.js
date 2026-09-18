/**
 * @file deployment.js
 * @description Diagnostic script for debugging environment variables, paths, and secrets.
 * Run via: node workers/deployment.js
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

console.log('=== DeployX Environment Diagnostics ===');
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);

const envPath = path.resolve(__dirname, '../.env');
console.log('Resolved .env location:', envPath);
console.log('.env file exists:', fs.existsSync(envPath));

console.log('\n=== Key Environment Checks ===');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set (defaults to development)');
console.log('PORT:', process.env.PORT || '8000');
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('REDIS_URL exists:', !!process.env.REDIS_URL);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
console.log('GITHUB_APP_ID:', process.env.GITHUB_APP_ID || 'not configured');
console.log('HOST_APPS_DIR:', process.env.HOST_APPS_DIR || 'not configured');
console.log('GCP_BUCKET_NAME:', process.env.GCP_BUCKET_NAME || 'not configured');
console.log('GCP_KEY_FILE_PATH:', process.env.GCP_KEY_FILE_PATH || 'not configured');
console.log('GCP_UPLOAD_MODE:', process.env.GCP_UPLOAD_MODE || 'archive');

const privateKeyPath = path.resolve(__dirname, '../private4.pem');
console.log('GitHub Private Key (private4.pem) exists:', fs.existsSync(privateKeyPath));

console.log('\n=== Diagnostic Complete ===');