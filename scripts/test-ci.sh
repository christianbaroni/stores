#!/bin/bash

# Run CI jobs locally
# Usage: ./test-ci.sh [--export]
#   --export: Pack the core package into a tarball after successful build

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

EXPORT_PACKAGE=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --export)
            EXPORT_PACKAGE=true
            shift
            ;;
    esac
done

echo_step() {
    echo -e "\n${BLUE}===================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}===================================================${NC}\n"
}

echo_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Navigate to repo root
cd "$(dirname "$0")/.."

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

echo_step "JOB 4: Test Chrome Plugin"
pnpm --filter stores test:chrome
echo_success "Chrome plugin tests passed"

# Export package if requested
if [ "$EXPORT_PACKAGE" = true ]; then
    echo_step "Exporting package tarball"
    mkdir -p dist
    (cd packages/core && pnpm pack --pack-destination ../../dist)
    TARBALL=$(ls -1 dist/stores-*.tgz 2>/dev/null | head -1)
    echo_success "Package exported: $TARBALL"
fi

echo -e "\n${GREEN}===================================================${NC}"
echo -e "${GREEN}✓ All jobs passed${NC}"
echo -e "${GREEN}===================================================${NC}\n"
