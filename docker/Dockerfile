# Use Node 22 on Debian Bullseye
FROM node:22-bullseye

# Install git and certificates
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory inside container
WORKDIR /app

# Copy deploy script
COPY deploy.sh /deploy.sh
RUN chmod +x /deploy.sh

# Entrypoint runs the deployment
ENTRYPOINT ["/deploy.sh"]