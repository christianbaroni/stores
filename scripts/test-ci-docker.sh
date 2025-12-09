#!/bin/bash

# Run CI jobs in Docker via act

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "$0")/.."

if ! docker ps > /dev/null 2>&1; then
    echo -e "${RED}Docker not running${NC}"
    exit 1
fi

if ! command -v act &> /dev/null; then
    echo -e "${RED}act not installed. Install: brew install act${NC}"
    exit 1
fi

echo -e "${BLUE}Running workflow with act...${NC}\n"

act push \
    --container-architecture linux/amd64 \
    -P ubuntu-latest=catthehacker/ubuntu:act-latest \
    --artifact-server-path /tmp/act-artifacts \
    --quiet \
    "$@"

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ All jobs passed${NC}\n"
else
    echo -e "\n${RED}✗ Jobs failed${NC}\n"
    exit 1
fi
