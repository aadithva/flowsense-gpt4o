# FlowSense Backend Processor - Azure Container Apps
FROM node:20-slim

# Install ffmpeg and curl for health checks
RUN apt-get update && \
    apt-get install -y ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package.json ./backend/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN npm install

# Copy source code
COPY backend ./backend
COPY packages/shared ./packages/shared

# Build shared package and backend
RUN npm run build --workspace=@interactive-flow/shared
RUN npm run build --workspace=@interactive-flow/processor

# Create temp directory for video processing
RUN mkdir -p /app/backend/temp

# Expose processor port
EXPOSE 3002

# Health check for Azure Container Apps
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Start the processor
CMD ["npm", "start", "--workspace=@interactive-flow/processor"]
