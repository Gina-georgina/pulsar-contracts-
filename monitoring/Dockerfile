FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Create a non-root user and switch to it
RUN addgroup -S monitoring && adduser -S monitoring -G monitoring \
    && chown -R monitoring:monitoring /app
USER monitoring

# monitor.js main() logs a startup message including the configured Horizon URL
CMD ["node", "src/monitor.js"]