# DeployX Backend — Automated CI/CD & Deployment Engine

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/express-5.x-blue.svg)](https://expressjs.com/)
[![BullMQ](https://img.shields.io/badge/bullmq-5.x-orange.svg)](https://bullmq.io/)
[![MongoDB](https://img.shields.io/badge/database-mongodb-green.svg)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/queue-redis-red.svg)](https://redis.io/)
[![Docker](https://img.shields.io/badge/containers-docker-blue.svg)](https://www.docker.com/)
[![Google Cloud Storage](https://img.shields.io/badge/storage-google%20cloud%20storage-yellow.svg)](https://cloud.google.com/storage)

**DeployX** is a cloud deployment and CI/CD platform engineered to clone, build, and deploy single-page applications (React, Vite) automatically. Inspired by modern cloud infrastructure platforms like Vercel and Render, DeployX isolates user builds inside transient Docker containers, synchronizes repositories via GitHub Apps and Webhooks, archives source code snapshots to **Google Cloud Storage (GCS)**, and coordinates operations via **BullMQ** and **Redis**.

---

## 📚 Table of Contents

- [System Overview](#-system-overview)
- [Key Features](#-key-features)
- [Project Directory Structure](#-project-directory-structure)
- [Documentation Suite](#-documentation-suite)
- [Technology Stack](#-technology-stack)
- [Environment Variables](#-environment-variables)
- [Quick Start: Local Development](#-quick-start-local-development)
- [Building Docker Images](#-building-docker-images)
- [Running Workers](#-running-workers)
- [License](#-license)

---

## 🚀 System Overview

DeployX separates the high-throughput HTTP API server from the resource-intensive build workers using an asynchronous queue pattern:

```
[Web Client] ──> [DeployX API Server] ──> [Redis / BullMQ]
                        │                        │
                        ▼                        ▼
                 [MongoDB Atlas]        [Background Workers]
                                                 │
                                                 ▼
                                     [Docker Build Containers]
                                        ├── Clone Code
                                        ├── Upload to GCS Bucket
                                        ├── npm install & build
                                        └── Export to Shared Volume
```

1. **User triggers deployment** (via private GitHub repository selection or public Git URL).
2. **API creates a job in Redis** and returns HTTP `202 Accepted` immediately.
3. **Worker picks up job**, signs an asymmetric RS256 JWT for the GitHub App, and acquires an installation access token.
4. **Isolated Docker container spawns**:
   - Clones repository.
   - Compresses and streams source code snapshot to **Google Cloud Storage**.
   - Compiles production bundle with dynamically injected `VITE_BASE_PATH`.
   - Exports built assets to host volume for instant static serving.
5. **Worker updates MongoDB logs** and dispatches asynchronous completion email.

---

## ✨ Key Features

- **GitHub App & OAuth 2.0 Integration:** Full support for GitHub Apps with RS256 JWT authentication and dynamic repository permission sync via HMAC SHA-256 signed webhooks.
- **Arbitrary Git URL Deployments:** Deploy public repositories directly from any Git URL.
- **Docker Sandbox Build Isolation:** Every build runs in an isolated `node:22-alpine` container (`--rm`) preventing host pollution.
- **Cloud Storage Archiving:** Automatic source code compression and backup to Google Cloud Storage (GCS).
- **Asynchronous BullMQ Queues:** Redis-backed queues with exponential backoff retries and concurrency limits.
- **Secure Email Verification & Recovery:** 6-digit OTPs hashed with SHA-256 and stored with TTL auto-expiration.
- **Dynamic Vite Subfolder Routing:** Automatic base path injection allowing multiple deployments to be served under subpaths (`/<userId>/<deploymentId>/`).

---

## 📁 Project Directory Structure

```
Deployx-Backend/
├── app.js                          # Express application entrypoint
├── connectToDb.js                  # MongoDB connection with Mongoose
├── redis.js                        # Redis connection client for BullMQ
├── utility.js                      # Root re-export for backward compatibility
│
├── utility/                        # Enterprise modular utility layer
│   ├── index.js                    # Central barrel export
│   ├── otp.utility.js              # OTP generator, SHA-256 hasher, validator
│   ├── jwt.utility.js              # JWT session sign & verify helpers
│   ├── github.utility.js           # GitHub App RS256 JWT & installation tokens
│   ├── deploy.utility.js           # Deploy path & live URL builders
│   └── response.utility.js         # Standard HTTP success/error envelopes
│
├── routes/                         # Express API route controllers
│   ├── auth.js                     # Registration OTP, login, password recovery
│   ├── oauth.js                    # GitHub OAuth 2.0 & token exchange
│   ├── deploy.js                   # Deployment triggers & installation callbacks
│   ├── webhook.js                  # GitHub webhook receiver (HMAC verified)
│   └── user.js                     # Authenticated user dashboard endpoints
│
├── middlewares/                    # Request interception & security
│   ├── authenticateJWT.js          # Bearer JWT verification
│   ├── deployLimiter.js            # Rate limiter for deployment triggers
│   ├── otpLimiter.js               # Rate limiter for OTP requests
│   └── verifySignature.js          # GitHub webhook HMAC-SHA256 signature check
│
├── models/                         # Mongoose data schemas
│   ├── Deployments.js              # Deployment status, URLs, and build logs
│   ├── Installation.js             # GitHub App installations & granted repos
│   ├── Repository.js               # Repository subdocument definition
│   ├── TempUser.js                 # Temporary OTP registration state (TTL index)
│   └── User.js                     # Permanent user profiles and credentials
│
├── queue/                          # BullMQ queue producers
│   ├── deploymentQueue.js          # Private GitHub deployment queue
│   ├── urlDeploymentQueue.js       # Public Git URL deployment queue
│   ├── redeploymentQueue.js        # Redeployment trigger queue
│   └── emailQueue.js               # Asynchronous email delivery queue
│
├── services/                       # Business logic services
│   └── email.service.js            # Nodemailer templates & dispatchers
│
├── workers/                        # Background queue consumers
│   ├── deploymentWorker.js         # Private GitHub deployment processor
│   ├── urlDeploymentWorker.js      # Public Git URL deployment processor
│   ├── emailWorker.js              # Email notification processor
│   └── deployment.js               # Diagnostic environment inspection script
│
├── docker/                         # Build container images & scripts
│   ├── Dockerfile                  # Private repo build image
│   ├── deploy.sh                   # Private repo clone, GCS upload, & build script
│   ├── upload-to-gcs.js            # GCS source code uploader
│   └── public-react/               # Public Git URL build image
│       ├── Dockerfile
│       ├── deploy.sh
│       └── upload-to-gcs.js
│
└── docs/                           # Comprehensive technical documentation
    ├── ARCHITECTURE.md             # System design & Mermaid diagrams
    ├── API_DOCUMENTATION.md        # Full REST API specification
    ├── DEPLOYMENT_PIPELINE.md      # Docker container lifecycle & Vite base path
    ├── WORKERS_AND_QUEUES.md       # BullMQ, Redis, retries, and concurrency
    ├── GCP_STORAGE_GUIDE.md        # Google Cloud Storage bucket & IAM setup
    └── STUDENT_LEARNING_GUIDE.md   # Educational guide on enterprise patterns
```

---

## 📖 Documentation Suite

The `docs/` folder contains comprehensive guides designed for both engineering reference and educational study:

- 🏛️ [System Architecture & Data Flows](docs/ARCHITECTURE.md)
- 🔌 [REST API Specification](docs/API_DOCUMENTATION.md)
- 🐳 [Docker Deployment Pipeline Deep Dive](docs/DEPLOYMENT_PIPELINE.md)
- ⚡ [BullMQ & Redis Background Workers](docs/WORKERS_AND_QUEUES.md)
- ☁️ [Google Cloud Storage (GCS) Setup Guide](docs/GCP_STORAGE_GUIDE.md)
- 🎓 [Student Learning Guide & Enterprise Patterns](docs/STUDENT_LEARNING_GUIDE.md)

---

## 🛠️ Technology Stack

- **Runtime:** Node.js (v20+)
- **Web Framework:** Express.js (v5)
- **Database:** MongoDB (via Mongoose)
- **Caching & Queues:** Redis (via ioredis & BullMQ)
- **Containerization:** Docker (Alpine Linux)
- **Cloud Object Storage:** Google Cloud Storage (`@google-cloud/storage`)
- **Authentication:** Asymmetric RS256 JWT (GitHub App) & Symmetric HS256 JWT (User sessions)
- **Email Delivery:** Nodemailer (Gmail / SMTP)

---

## 🔑 Environment Variables

Create a `.env` file in the root directory based on the following template:

```dotenv
# Server Configuration
PORT=8000
NODE_ENV=development
SERVER_ENDPOINT="http://localhost:8000"
FRONTEND_URL="http://localhost:5173"

# MongoDB Database
MONGO_URI="mongodb+srv://<user>:<password>@cluster0.mongodb.net/?appName=Cluster0"

# Redis Cache & Queue
REDIS_URL="redis://default:<password>@<host>:<port>"

# Security Secrets
JWT_SECRET="your-super-secure-jwt-secret-key"
GITHUB_WEBHOOK_SECRET="your-github-webhook-secret"

# GitHub App Integration
GITHUB_APP_ID="1234567"
GITHUB_CLIENT_ID="your-oauth-client-id"
GITHUB_CLIENT_SECRET="your-oauth-client-secret"
GITHUB_CALLBACK_URL="http://localhost:8000/auth/github/callback"
# Path to GitHub App RSA private key (.pem)
GITHUB_PRIVATE_KEY_PATH="./private4.pem"

# Email Configuration (Nodemailer)
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-specific-password"

# Build Storage Paths
HOST_APPS_DIR="D:/DeployX/apps"
DOCKER_APPS_DIR="/var/www/apps"

# Google Cloud Storage (GCS)
GCP_BUCKET_NAME="neurastack-website-bucket-mainly"
GCP_KEY_FILE_PATH="D:/DeployX/Deployx-Backend/main-503511-ea4ca8083982.json"
GCP_UPLOAD_MODE="archive"
```

---

## 💻 Quick Start: Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Docker Container Images
Build the two deployment images required by the workers:
```bash
# Image 1: Private GitHub App Deployments
docker build -t deploy-react-private-image ./docker

# Image 2: Public Git URL Deployments
docker build -t deploy-public-react-image ./docker/public-react
```

### 3. Start the API Server
```bash
node app.js
# Or with hot-reload:
npx nodemon app.js
```

### 4. Start Background Workers
Run each worker in a separate terminal:
```bash
# Terminal 1: Private GitHub Deployment Worker
node workers/deploymentWorker.js

# Terminal 2: Public Git URL Deployment Worker
node workers/urlDeploymentWorker.js

# Terminal 3: Email Notification Worker
node workers/emailWorker.js
```

---

## 📜 License

This project is licensed under the ISC License. Created for educational and production deployment purposes.
