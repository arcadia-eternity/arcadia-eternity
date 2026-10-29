# Build stage
FROM node:24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git && \
    npm install -g pnpm@11.21.0

WORKDIR /app

# Copy package files for dependency installation
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
# Copy packages directory structure for package.json files
COPY packages/ ./packages/
COPY packs/ ./packs/

# Install all dependencies (including dev dependencies for building)
# Use local store to avoid cache conflicts in parallel builds
RUN pnpm config set store-dir /tmp/pnpm-store && \
    pnpm install --frozen-lockfile --prefer-offline

# Copy source code
COPY . .

ARG GITHUB_SHA=""
ARG COMMIT_HASH=""
ENV GITHUB_SHA=$GITHUB_SHA
ENV COMMIT_HASH=$COMMIT_HASH

# Build the application
RUN pnpm run build:prod

# Dependencies stage - install production dependencies
FROM node:24-alpine AS deps

RUN apk add --no-cache git && \
    npm install -g pnpm@11.21.0

WORKDIR /app

# Copy package files for production dependencies
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY packs/ ./packs/

# Install only production dependencies
# Use local store to avoid cache conflicts in parallel builds
RUN pnpm config set store-dir /tmp/pnpm-store && \
    pnpm install --frozen-lockfile --prod --prefer-offline --ignore-scripts && \
    pnpm store prune

# Production stage
FROM node:24-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S joseph -u 1001

# Install minimal runtime dependencies
RUN apk add --no-cache curl && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built packages from builder stage
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/packs ./packs

# Copy built application and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/resource ./resource

# Create scripts directory (application handles missing scripts gracefully)
RUN mkdir -p ./scripts

# Copy package.json for runtime
COPY package.json ./

# Change ownership to non-root user
RUN chown -R joseph:nodejs /app

# Switch to non-root user
USER joseph

# Set environment variables
ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
ENV NODE_PATH=/app/node_modules:/app/packages

# Server configuration environment variables
ENV PORT=8102
ENV CORS_ORIGIN=

# Keep this stable across deployments; bootId changes for each process.
ENV SERVER_ID=arcadia

# Health check using curl instead of wget
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8102/health || exit 1

EXPOSE 8102

# Node receives SIGTERM directly; the server discards all rooms on shutdown.
CMD ["node", "dist/cli.js", "server"]
