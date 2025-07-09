# Build stage
FROM node:24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git && \
    npm install -g pnpm

WORKDIR /app

# Copy package files for dependency installation
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
# Copy packages directory structure for package.json files
COPY packages/ ./packages/

# Install all dependencies (including dev dependencies for building)
# Use local store to avoid cache conflicts in parallel builds
RUN pnpm config set store-dir /tmp/pnpm-store && \
    pnpm install --frozen-lockfile --prefer-offline

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Dependencies stage - install production dependencies
FROM node:24-alpine AS deps

RUN apk add --no-cache git && \
    npm install -g pnpm

WORKDIR /app

# Copy package files for production dependencies
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/ ./packages/

# Install only production dependencies
# Use local store to avoid cache conflicts in parallel builds
RUN pnpm config set store-dir /tmp/pnpm-store && \
    pnpm install --frozen-lockfile --prod --prefer-offline && \
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

# Copy built application and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY --from=builder /app/locales ./locales
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
ENV CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# Database configuration
ENV SUPABASE_URL=""
ENV SUPABASE_ANON_KEY=""
ENV SUPABASE_SERVICE_KEY=""

# Cluster configuration
ENV CLUSTER_ENABLED=true
ENV CLUSTER_INSTANCE_ID=""
ENV CLUSTER_INSTANCE_HOST=""
ENV CLUSTER_INSTANCE_REGION=""
ENV CLUSTER_HEARTBEAT_INTERVAL=30000
ENV CLUSTER_HEALTH_CHECK_INTERVAL=60000
ENV CLUSTER_FAILOVER_TIMEOUT=120000

# Redis configuration
ENV REDIS_HOST=localhost
ENV REDIS_PORT=6379
ENV REDIS_PASSWORD=""
ENV REDIS_DB=0
ENV REDIS_KEY_PREFIX=arcadia:
ENV REDIS_MAX_RETRIES=3
ENV REDIS_RETRY_DELAY=100
ENV REDIS_ENABLE_READY_CHECK=true
ENV REDIS_LAZY_CONNECT=true

# Email configuration
ENV EMAIL_SMTP_HOST=""
ENV EMAIL_SMTP_PORT=587
ENV EMAIL_SMTP_SECURE=false
ENV EMAIL_SMTP_USER=""
ENV EMAIL_SMTP_PASS=""
ENV EMAIL_FROM_ADDRESS="noreply@yuuinih.com"
ENV EMAIL_FROM_NAME="Arcadia Eternity"

# Health check using curl instead of wget
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8102/health || exit 1

EXPOSE 8102

# Use a shell script to conditionally enable features based on environment variables
# This allows the container to automatically enable features if configuration is provided
CMD ["sh", "-c", "\
    ARGS=\"--port $PORT\"; \
    if [ -n \"$SUPABASE_URL\" ] && [ -n \"$SUPABASE_ANON_KEY\" ]; then \
    ARGS=\"$ARGS --enable-battle-reports\"; \
    fi; \
    node dist/cli.js server $ARGS \
    "]
