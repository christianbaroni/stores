#!/bin/bash

# Run CI jobs locally

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo_step() {
    echo -e "\n${BLUE}===================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}===================================================${NC}\n"
}

echo_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Navigate to repo root
cd "$(dirname "$0")"

echo_step "Installing dependencies"
pnpm install --frozen-lockfile
echo_success "Dependencies installed"

# Run jobs
echo_step "JOB 1: Lint"
pnpm run lint
echo_success "Lint passed"

echo_step "JOB 2: Build"
pnpm --filter stores run build
echo_success "Build passed"

echo_step "JOB 3: Test Core"
pnpm --filter stores test
echo_success "Core tests passed"

echo_step "JOB 4: Test Chrome Extension"
pnpm --filter stores/chrome-extension-example test:ci
echo_success "Chrome extension tests passed"

echo -e "\n${GREEN}===================================================${NC}"
echo -e "${GREEN}✓ All jobs passed${NC}"
echo -e "${GREEN}===================================================${NC}\n"
