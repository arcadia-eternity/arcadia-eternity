#!/bin/bash

# Docker build script for Arcadia Eternity
# This script builds the Docker image with optimizations

set -e

# Enable Docker BuildKit for cache mount support
export DOCKER_BUILDKIT=1

IMAGE_NAME="arcadia-eternity"
TAG=${1:-final}
FULL_IMAGE_NAME="$IMAGE_NAME:$TAG"

echo "🚀 Building Docker image: $FULL_IMAGE_NAME"
echo "📦 Using BuildKit with pnpm cache optimization"

# Build the image with cache mount support
docker build \
  --target production \
  --tag "$FULL_IMAGE_NAME" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  .

echo "✅ Build completed successfully!"

# Show image size
echo "📊 Image size:"
docker images "$IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# Optional: Run a quick test
if [ "$2" = "test" ]; then
  echo "🧪 Running quick test..."
  docker run --rm -p 8102:8102 -d --name arcadia-test "$FULL_IMAGE_NAME"

  # Wait a bit for the server to start
  sleep 5

  # Test health endpoint
  if curl -f http://localhost:8102/health > /dev/null 2>&1; then
    echo "✅ Health check passed!"
  else
    echo "❌ Health check failed!"
  fi

  # Stop the test container
  docker stop arcadia-test
fi

echo "🎉 All done! You can run the image with:"
echo "   docker compose up (one in-memory server; restarting abandons all rooms)"
