FROM node:20-slim

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
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

# Build
RUN npm run build --workspace=@interactive-flow/shared
RUN npm run build --workspace=@interactive-flow/processor

# Create temp directory
RUN mkdir -p /app/backend/temp

EXPOSE 3001

CMD ["npm", "start", "--workspace=@interactive-flow/processor"]
