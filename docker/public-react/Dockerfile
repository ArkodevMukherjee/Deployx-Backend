# Use Node 22 Alpine
FROM node:22-alpine

# Install git, certificates, tar and gzip for packaging source
RUN apk add --no-cache \
    git \
    ca-certificates \
    tar \
    gzip

# Create the deployment root directory inside the container
RUN mkdir -p /var/www/apps && chmod 777 /var/www/apps

# Install Google Cloud Storage SDK in dedicated scripts directory
RUN mkdir -p /scripts && cd /scripts && npm init -y && npm install @google-cloud/storage

# Copy GCP upload script
COPY upload-to-gcs.js /scripts/upload-to-gcs.js
RUN sed -i 's/\r$//' /scripts/upload-to-gcs.js

# Set working directory for the build process
WORKDIR /app

# Copy deploy script
COPY deploy.sh /deploy.sh
RUN sed -i 's/\r$//' /deploy.sh && chmod +x /deploy.sh

# Entrypoint runs the deployment
ENTRYPOINT ["/deploy.sh"]