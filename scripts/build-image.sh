#!/bin/bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/$(git remote get-url origin | sed 's/.*://; s/\.git$//' | cut -d'/' -f1)/opencode-router}"
VERSION=$(node -p "require('./packages/router/package.json').version")
SHA_SHORT=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TAG="${VERSION}-${BRANCH}.${SHA_SHORT}"

echo "Building ${IMAGE_NAME}:${TAG}"

docker build -t "${IMAGE_NAME}:${TAG}" -t "${IMAGE_NAME}:latest" .

echo ""
echo "Built: ${IMAGE_NAME}:${TAG}"
echo "Also tagged: ${IMAGE_NAME}:latest"
