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
RUN pnpm install --frozen-lockfile

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
RUN pnpm install --frozen-lockfile --prod && \
    pnpm store prune

# Production stage
FROM node:24-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S arcadia -u 1001

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
RUN chown -R arcadia:nodejs /app

# Switch to non-root user
USER arcadia

# Set environment variables
ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
ENV NODE_PATH=/app/node_modules:/app/packages

# Server configuration environment variables
ENV PORT=8102
ENV CORS_ORIGIN=http://localhost:3000,http://localhost:5173

ENV SUPABASE_URL=""
ENV SUPABASE_ANON_KEY=""
ENV SUPABASE_SERVICE_KEY=""

# Health check using curl instead of wget
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8102/health || exit 1

EXPOSE 8102

# Use a shell script to conditionally enable battle reports based on environment variables
# This allows the container to automatically enable battle reports if Supabase config is provided
CMD ["sh", "-c", "if [ -n \"$SUPABASE_URL\" ] && [ -n \"$SUPABASE_ANON_KEY\" ]; then node dist/cli.js server --port $PORT --enable-battle-reports; else node dist/cli.js server --port $PORT; fi"]
