# Google Cloud Storage (GCS) Source Archiving Guide

This guide provides instructions on configuring and using **Google Cloud Storage (GCS)** to automatically archive and back up cloned source code repositories during DeployX deployments.

---

## 1. Why Archive Source Code in GCS?

In modern CI/CD systems (such as GitHub Actions, GitLab CI, or Vercel):
1. **Immutable Audit Trails:** Having an exact snapshot of the source code at the moment of build ensures that developers can review previous releases even if the git branch or commit history is altered or deleted.
2. **Disaster Recovery & Reproducibility:** If a host machine is replaced or a deployment volume corrupted, the exact code bundle can be pulled directly from GCS and rebuilt.
3. **Offloading Storage:** Storing uncompressed source directories and `node_modules` on the host machine wastes disk space. Archiving to GCS keeps host storage lean.

---

## 2. Setting Up Google Cloud Storage (Step-by-Step)

### Step 1: Create a Bucket
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **Cloud Storage** > **Buckets**.
3. Click **Create Bucket**.
4. Choose a globally unique bucket name (e.g. `neurastack-website-bucket-mainly`).
5. Select a region (e.g., `us-central1` or `asia-south1`) and standard storage class.
6. Under **Access Control**, select **Uniform** access.
7. Click **Create**.

---

### Step 2: Create a Service Account & Grant Permissions
The backend and Docker containers need programmatic permissions to upload blobs:
1. Navigate to **IAM & Admin** > **Service Accounts**.
2. Click **Create Service Account**.
3. Name: `deployx-storage-uploader`.
4. In Step 2 (**Grant this service account access to project**), assign the role:
   - **Storage Object Admin** (`roles/storage.objectAdmin`) or **Storage Object Creator** (`roles/storage.objectCreator`).
5. Click **Done**.

---

### Step 3: Export Service Account JSON Key
1. In the Service Accounts list, click your newly created service account.
2. Go to the **Keys** tab > **Add Key** > **Create new key**.
3. Select **JSON** and click **Create**.
4. A `.json` file will download to your computer (e.g. `main-503511-ea4ca8083982.json`).
5. Store this file safely in your project directory (ensure it is listed in `.gitignore`!).

---

## 3. Environment Variable Configuration

Add the following variables to your `.env` file:

```dotenv
# Your GCP Storage Bucket name
GCP_BUCKET_NAME="neurastack-website-bucket-mainly"

# Option A: Full path to your service account JSON file on the host
GCP_KEY_FILE_PATH="D:/DeployX/Deployx-Backend/main-503511-ea4ca8083982.json"

# Option B: Raw JSON or Base64 string of service account key (useful in Docker/Kubernetes)
# GCP_SERVICE_ACCOUNT_KEY='{"type": "service_account", ...}'

# Upload Mode: "archive" (recommended), "raw", or "both"
GCP_UPLOAD_MODE="archive"
```

---

## 4. Upload Modes Explained

DeployX supports two upload strategies controlled by `GCP_UPLOAD_MODE`:

| Mode | Format | Cloud Path | Advantages |
| :--- | :--- | :--- | :--- |
| **`archive`** *(Recommended Default)* | Single compressed `.tar.gz` bundle | `gs://<bucket>/source/<userId>/<deploymentId>/source.tar.gz` | Fast, atomic, single HTTP request, preserves file permissions, 80%+ smaller footprint. |
| **`raw`** | Individual uncompressed files | `gs://<bucket>/source/<userId>/<deploymentId>/...` | Allows browsing individual source files directly in the GCP console. |
| **`both`** | Tarball + Individual files | Both destinations | Maximum flexibility. |

> [!TIP]
> `archive` mode automatically excludes `.git` and `node_modules` during compression, ensuring rapid uploads even for large repositories.

---

## 5. How the Container Upload Script Works (`upload-to-gcs.js`)

Immediately after `git clone` inside the Docker container (`deploy.sh`), the following command runs:

```bash
node /scripts/upload-to-gcs.js .
```

1. **Authentication:** The script initializes `@google-cloud/storage` using the mounted `/app/gcp-key.json` or `GCP_SERVICE_ACCOUNT_KEY`.
2. **Graceful Degradation:** If `GCP_BUCKET_NAME` is not set in `.env`, the script outputs an informational notice and exits gracefully (code 0), ensuring that local development without GCP still succeeds.
3. **Packaging:** Creates a `.tar.gz` archive in `/tmp` using standard Alpine Linux tools.
4. **Blob Upload:** Streams the file directly to Google Cloud Storage with `contentType: 'application/gzip'`.
5. **Cleanup:** Unlinks the temporary archive from the container to free memory.
