# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src ./src

# Run as a non-root user for production safety
USER node

# Default service port
EXPOSE 3000

# Start the indexer service
CMD ["node", "src/index.js"]