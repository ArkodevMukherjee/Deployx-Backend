# DeployX REST API Specification

Welcome to the **DeployX Backend API Reference**. This documentation covers all available endpoints, required authentication headers, request bodies, success responses, and error codes.

---

## Global Standards

### Base URL
- Local Development: `http://localhost:8000`
- Production: `https://katamorphic-glennie-filthily.ngrok-free.dev` (or your domain)

### Authentication Header
Endpoints requiring authentication expect a standard HTTP Bearer token in the `Authorization` header:
```http
Authorization: Bearer <your_jwt_token>
```

### Standard Response Envelope

#### Success Response
```json
{
  "success": true,
  "message": "Human-readable status message",
  "data": { ... }
}
```

#### Error Response
```json
{
  "success": false,
  "message": "Descriptive error message"
}
```

---

## 1. Authentication Endpoints (`/auth`)

### 1.1 Send Registration OTP
Generates a 6-digit verification code and emails it to the user.

- **URL:** `POST /auth/send-otp`
- **Auth Required:** No
- **Rate Limit:** 5 requests per 10 minutes per IP (`otpLimiter`)
- **Request Body:**
  ```json
  {
    "email": "student@example.com"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "OTP sent to email successfully.",
    "email": "student@example.com"
  }
  ```
- **Error Codes:**
  - `400 Bad Request`: Email is required
  - `409 Conflict`: User already exists
  - `429 Too Many Requests`: Rate limit exceeded

---

### 1.2 Verify Registration OTP
Validates the OTP code, registers the user, and returns a session JWT.

- **URL:** `POST /auth/verify-otp`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "student@example.com",
    "otp": "491203",
    "username": "alexdev",
    "password": "SuperSecretPassword123!"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Signup successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "65f210d3f8219...",
      "username": "alexdev",
      "email": "student@example.com"
    }
  }
  ```
- **Error Codes:**
  - `400 Bad Request`: Missing fields
  - `401 Unauthorized`: Invalid or expired OTP

---

### 1.3 User Login
Authenticates an existing user via email and password.

- **URL:** `POST /auth/login`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "student@example.com",
    "password": "SuperSecretPassword123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "65f210d3f8219...",
      "username": "alexdev",
      "email": "student@example.com"
    }
  }
  ```
- **Error Codes:**
  - `401 Unauthorized`: Invalid email or password
  - `403 Forbidden`: Account created via OAuth (must log in with GitHub)

---

### 1.4 Request Password Reset OTP
Sends a recovery OTP stored in Redis with a 5-minute time-to-live (TTL).

- **URL:** `POST /auth/forgot-password-otp`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "student@example.com"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password reset OTP sent to your email."
  }
  ```
- **Error Codes:**
  - `404 Not Found`: No account with this email
  - `429 Too Many Requests`: An OTP is already active in Redis

---

### 1.5 Verify Password Reset OTP & Set New Password
- **URL:** `POST /auth/forgot-password-verify`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "student@example.com",
    "otp": "852147",
    "password": "MyNewSecurePassword999!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password has been successfully reset. You can now log in."
  }
  ```

---

## 2. GitHub OAuth Flow (`/auth/github`)

### 2.1 Initiate OAuth
Redirects the user to GitHub to authenticate and grant email permissions.

- **URL:** `GET /auth/github`
- **Query Params:** None

---

### 2.2 OAuth Callback
GitHub redirects back to this endpoint with authorization code. Generates a one-time exchange code stored in Redis (60s TTL) and redirects the user back to the frontend:
```
Location: https://frontend-url/login?code=<uuid>
```

- **URL:** `GET /auth/github/callback`

---

### 2.3 Exchange OAuth Code for JWT
Exchanges the short-lived one-time code for a JWT token.

- **URL:** `POST /auth/github/exchange`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "code": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Token exchanged successfully",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI..."
  }
  ```

---

## 3. Deployments (`/deploy`)

### 3.1 Get Repositories for GitHub Installation
Lists repositories accessible to a specific GitHub App installation.

- **URL:** `GET /deploy/repositories?installationId=12345678`
- **Auth Required:** Yes (`Bearer <token>`)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "repositories": [
      {
        "repoId": 98765432,
        "name": "my-vite-app",
        "fullName": "octocat/my-vite-app",
        "cloneUrl": "https://github.com/octocat/my-vite-app.git"
      }
    ]
  }
  ```

---

### 3.2 Trigger Deployment (Async)
Enqueues a build job for either a GitHub App repository or a public Git URL.

- **URL:** `POST /deploy`
- **Auth Required:** Yes (`Bearer <token>`)
- **Rate Limit:** 20 requests per 10 minutes (`deployLimiter`)

#### Option A: GitHub App Deployment
```json
{
  "isUrlDeployment": false,
  "installationId": 12345678,
  "repoId": 98765432,
  "fullName": "octocat/my-vite-app",
  "branchName": "main",
  "projectType": "react"
}
```

#### Option B: Public Git URL Deployment
```json
{
  "isUrlDeployment": true,
  "url": "https://github.com/vitejs/vite-plugin-react",
  "projectType": "react"
}
```

- **Response (202 Accepted):**
  ```json
  {
    "success": true,
    "message": "GitHub deployment queued successfully",
    "deploymentId": "65f2a1b9c8d7e6f5a4b3c2d1",
    "deployedUrl": "https://server.domain.com/65f210d3f8219/65f2a1b9c8d7e6f5a4b3c2d1/"
  }
  ```

---

### 3.3 GitHub App Install Callback
Handles GitHub App installation redirects, stores the installation ID in Redis (600s TTL), and redirects to the frontend with `?code=...`.

- **URL:** `GET /deploy/callback?installation_id=12345678`

---

### 3.4 Exchange Installation Code
Exchanges the callback code for the numeric installation ID.

- **URL:** `POST /deploy/exchange`
- **Request Body:**
  ```json
  {
    "code": "b4c5d6e7-f8a9-0123-bcde-fa4567890123"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Installation ID verified",
    "installation_id": 12345678
  }
  ```

---

## 4. User Dashboard (`/dashboard`)

### 4.1 Fetch User Profile & Deployments
Returns the authenticated user's profile information (password excluded) and full history of deployments sorted by latest first.

- **URL:** `GET /dashboard`
- **Auth Required:** Yes (`Bearer <token>`)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Dashboard data retrieved successfully",
    "user": {
      "_id": "65f210d3f8219...",
      "username": "alexdev",
      "email": "student@example.com",
      "authProviders": ["local"],
      "role": "user"
    },
    "deployments": [
      {
        "_id": "65f2a1b9c8d7e6f5a4b3c2d1",
        "userId": "65f210d3f8219...",
        "deploymentType": "github",
        "fullName": "octocat/my-vite-app",
        "branchName": "main",
        "status": "success",
        "deployedUrl": "https://server.domain.com/65f210d3f8219/65f2a1b9c8d7e6f5a4b3c2d1/",
        "logs": "Cloning...\nBuilding...\nDeployment Successful!",
        "createdAt": "2026-09-18T12:00:00.000Z"
      }
    ]
  }
  ```

---

## 5. Webhook Receiver (`/webhook`)

### 5.1 GitHub App Webhook Event
Receives webhooks from GitHub. Must include the header `x-hub-signature-256` matching HMAC SHA-256 of the raw body and secret.

- **URL:** `POST /webhook`
- **Headers:**
  - `x-github-event`: Event type (`installation`, `installation_repositories`, `push`)
  - `x-hub-signature-256`: `sha256=<hex_digest>`
- **Response (200 OK):** `Webhook processed successfully`
