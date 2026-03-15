# Multi-stage build for smaller image size
FROM node:20-slim AS base

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Build stage
FROM base AS builder
WORKDIR /app

# Copy package files
COPY backend/package*.json ./
RUN npm ci

# Copy source code
COPY backend/ ./

# Build TypeScript
RUN npm run build

# Production stage
FROM base AS production
WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Install Playwright browsers
RUN npx playwright install chromium --with-deps || true

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3001

# Start the application
CMD ["node", "dist/index.js"]
