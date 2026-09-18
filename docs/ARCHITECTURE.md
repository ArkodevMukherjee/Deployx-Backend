# DeployX Backend Architecture & System Design

This document provides a comprehensive technical overview of the **DeployX Backend Architecture**. It is designed for software engineering students, architects, and developers who want to understand the design patterns, data flows, and infrastructure underlying a modern cloud deployment platform.

---

## 1. High-Level System Topology

DeployX operates as an **asynchronous, event-driven platform**. Long-running operations such as cloning code, running `npm install`, executing Vite builds, and uploading source code to Google Cloud Storage (GCS) are decoupled from the main HTTP API server using **BullMQ** and **Redis**.

```mermaid
flowchart TB
    subgraph Clients
        Browser["Web Browser (React SPA)"]
        GitHubWebhook["GitHub Events (Webhooks)"]
    end

    subgraph "API Layer (Express.js)"
        API["DeployX API Server (:8000)"]
        AuthRoute["/auth (OTP, Passwords)"]
        OAuthRoute["/auth/github (OAuth2)"]
        DeployRoute["/deploy (Deploy trigger)"]
        WebhookRoute["/webhook (GitHub Webhook)"]
        UserRoute["/dashboard (User profile)"]
    end

    subgraph "Data & Messaging"
        Mongo[("MongoDB Atlas")]
        Redis[("Redis Cluster")]
    end

    subgraph "Asynchronous Workers (BullMQ)"
        DeployWorker["Deployment Worker (Private Repos)"]
        UrlWorker["URL Deployment Worker (Public Git)"]
        EmailWorker["Email Worker (Nodemailer)"]
    end

    subgraph "Build Infrastructure (Docker Containers)"
        PrivateContainer["Docker: deploy-react-private-image"]
        PublicContainer["Docker: deploy-public-react-image"]
    end

    subgraph "Storage & Cloud Services"
        GCS[("Google Cloud Storage (GCS)")]
        HostVolume["Host Apps Volume (/var/www/apps)"]
        SMTP["Gmail / SendGrid SMTP"]
    end

    %% Client Interactions
    Browser -->|REST API & JWT| API
    GitHubWebhook -->|HMAC SHA256 Webhooks| API

    %% API Routing
    API --> AuthRoute
    API --> OAuthRoute
    API --> DeployRoute
    API --> WebhookRoute
    API --> UserRoute

    %% Data Storage
    API -->|Save state| Mongo
    API -->|Enqueue Jobs & Cache OTP/Code| Redis

    %% Queues to Workers
    Redis -.->|'deployment-queue'| DeployWorker
    Redis -.->|'url-deployment-queue'| UrlWorker
    Redis -.->|'email-queue'| EmailWorker

    %% Workers Execution
    DeployWorker -->|child_process.spawn| PrivateContainer
    UrlWorker -->|child_process.spawn| PublicContainer
    EmailWorker -->|Send Emails| SMTP

    %% Containers Output
    PrivateContainer -->|Upload source code| GCS
    PrivateContainer -->|Export build /dist| HostVolume
    PublicContainer -->|Upload source code| GCS
    PublicContainer -->|Export build /dist| HostVolume

    DeployWorker -->|Update Status & Logs| Mongo
    UrlWorker -->|Update Status & Logs| Mongo
```

---

## 2. Authentication & OTP Security Lifecycle

DeployX supports two login methods:
1. **Local Authentication**: Uses Email + 6-digit OTP verification + bcrypt password hashing.
2. **GitHub OAuth 2.0**: Uses passport-github2 with short-lived Redis authorization codes to exchange for JWTs.

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant API as DeployX API
    participant Mongo as MongoDB
    participant Redis as Redis Cache
    participant Queue as BullMQ (email-queue)
    participant Worker as Email Worker

    Note over User,Worker: Step 1: User Registration via Email OTP
    User->>API: POST /auth/send-otp { email }
    API->>API: Generate 6-digit OTP & Compute SHA-256 Hash
    API->>Mongo: Upsert TempUser { email, otp: sha256Hash, createdAt }
    API->>Queue: Add job 'sendOtp' { to: email, otp }
    API-->>User: 200 OK: "OTP sent to email"
    Queue->>Worker: Process 'sendOtp'
    Worker-->>User: Delivers OTP to User's Inbox

    Note over User,Worker: Step 2: OTP Verification & Account Creation
    User->>API: POST /auth/verify-otp { email, otp, username, password }
    API->>API: Compute SHA-256(otp)
    API->>Mongo: Find TempUser where email & otpHash match
    alt OTP Invalid or Expired
        API-->>User: 401 Unauthorized: "Invalid or expired OTP"
    else OTP Valid
        API->>API: Hash password with bcrypt(rounds=10)
        API->>Mongo: Create User { username, email, passwordHash, authProviders: ['local'] }
        API->>Mongo: Delete TempUser
        API->>API: Generate User JWT token (expires in 1h)
        API->>Queue: Add job 'thankOtp' { to: email }
        API-->>User: 201 Created: { token, user }
    end
```

---

## 3. GitHub App & Webhook Synchronization Flow

When a user links their GitHub account and installs the DeployX GitHub App, GitHub notifies the backend via Webhooks signed with HMAC SHA-256.

```mermaid
sequenceDiagram
    autonumber
    actor User as Developer
    participant GitHub as GitHub App / Webhook API
    participant API as DeployX API (/webhook)
    participant Mongo as MongoDB (Installation Collection)

    User->>GitHub: Installs GitHub App on account / repository
    GitHub->>API: POST /webhook (x-github-event: 'installation', Action: 'created')
    Note over API: verifySignature middleware calculates<br/>HMAC-SHA256(rawBody, GITHUB_WEBHOOK_SECRET)
    API->>Mongo: Upsert Installation { installationId, accountLogin, repositories: [] }
    API-->>GitHub: 200 OK

    GitHub->>API: POST /webhook (x-github-event: 'installation_repositories', Action: 'added')
    API->>Mongo: Update Installation: $addToSet repositories { repoId, name, fullName, cloneUrl }
    API-->>GitHub: 200 OK
```

---

## 4. End-to-End Deployment Execution Engine

This diagram illustrates how a deployment is requested, queued, and executed in an isolated Docker container, streaming build logs and uploading source code to Google Cloud Storage.

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant API as DeployX API (/deploy)
    participant Mongo as MongoDB (Deployment)
    participant Redis as BullMQ (deployment-queue)
    participant Worker as Deployment Worker
    participant GitHub as GitHub API
    participant Docker as Docker Container (node:22-alpine)
    participant GCS as Google Cloud Storage (GCS)
    participant Host as Host Filesystem (/var/www/apps)

    User->>API: POST /deploy { installationId, repoId, fullName, branchName }
    API->>Mongo: Create Deployment { status: 'queued', deployPath: "userId/deploymentId" }
    API->>Redis: Enqueue job { deploymentId, installationId, deployPath, ... }
    API-->>User: 202 Accepted: { deploymentId, deployedUrl }

    Note over Redis,Worker: Asynchronous Worker picks up Job
    Redis->>Worker: Process Job(deploymentId)
    Worker->>Mongo: Update Deployment { status: 'in_progress' }

    Note over Worker,GitHub: Step A: GitHub App Authentication
    Worker->>Worker: Sign RS256 App JWT using private4.pem
    Worker->>GitHub: POST /app/installations/{installationId}/access_tokens
    GitHub-->>Worker: Short-lived Installation Access Token

    Note over Worker,Docker: Step B: Docker Container Execution
    Worker->>Docker: docker run --rm -v /host/apps:/host/apps -e INSTALLATION_TOKEN ...
    Docker->>GitHub: git clone -b {branch} https://x-access-token:{token}@github.com/{repo}.git
    
    Note over Docker,GCS: Step C: Source Code Archival to GCS
    Docker->>Docker: node /scripts/upload-to-gcs.js
    Docker->>GCS: Upload source.tar.gz to gs://{bucket}/source/{userId}/{deploymentId}/source.tar.gz

    Note over Docker,Host: Step D: Build & Static Export
    Docker->>Docker: npm install
    Docker->>Docker: export VITE_BASE_PATH="/userId/deploymentId/"
    Docker->>Docker: npm run build
    Docker->>Host: cp -r dist/* /var/www/apps/userId/deploymentId/
    Docker-->>Worker: Container exits with code 0

    Note over Worker,Mongo: Step E: Finalization & Notification
    Worker->>Mongo: Update Deployment { status: 'success', logs: combinedLogs }
    Worker->>Redis: Enqueue email job 'githubDeploymentSuccessfulEmail'
```

---

## 5. Architectural Principles

### 1. Decoupling & Non-Blocking I/O
- Node.js runs on a single-threaded event loop. If git clone, `npm install`, or Vite build were run inside the HTTP route handlers, the server would freeze and fail to serve other incoming requests.
- **Solution:** By offloading builds to BullMQ workers, the API responds in under 50 milliseconds with HTTP `202 Accepted`.

### 2. Sandbox Container Isolation
- Building arbitrary user code directly on the host machine is dangerous: malicious `postinstall` npm scripts could read system files, delete directories, or compromise secrets.
- **Solution:** Every build runs inside a transient Docker container (`--rm`), restricting file system writes strictly to the mounted application target directory.

### 3. Dual Storage Strategy
- **Static Frontend Assets:** Stored locally on the host at `/var/www/apps/<userId>/<deploymentId>/` for immediate, low-latency static file serving via Nginx or Express static middleware.
- **Source Code Snapshot:** Uploaded to **Google Cloud Storage (GCS)** (`source/<userId>/<deploymentId>/source.tar.gz`), ensuring that historical source code snapshots are permanently backed up and recoverable.
