#!/usr/bin/env bash
set -euo pipefail

# Hoot 🦉 installer — https://github.com/DUBSOpenHub/hoot
# Usage: curl -fsSL https://raw.githubusercontent.com/DUBSOpenHub/hoot/main/install.sh | bash
# Dev:   ./install.sh --dev  (skips npm install, runs setup from local source)

DEV_MODE=false
if [ "${1:-}" = "--dev" ]; then
  DEV_MODE=true
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

info() { echo -e "${BOLD}$1${RESET}"; }
success() { echo -e "${GREEN}$1${RESET}"; }
warn() { echo -e "${YELLOW}$1${RESET}"; }
error() { echo -e "${RED}$1${RESET}" >&2; }

echo ""
info "╔══════════════════════════════════════════╗"
info "║         🦉  Hoot Installer               ║"
info "╚══════════════════════════════════════════╝"
echo ""

if [ "$DEV_MODE" = true ]; then
  warn "  ⚡ Dev mode — skipping npm install, using local build"
  echo ""
fi

# Check Node.js
if ! command -v node &>/dev/null; then
  error "✗ Node.js is required but not installed."
  echo "  Install it from https://nodejs.org (v18 or later)"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "✗ Node.js v18+ is required (found $(node -v))"
  echo "  Update from https://nodejs.org"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Node.js $(node -v)"

# Check npm
if ! command -v npm &>/dev/null; then
  error "✗ npm is required but not installed."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} npm $(npm -v)"

# Check Copilot CLI
if command -v copilot &>/dev/null; then
  echo -e "  ${GREEN}✓${RESET} Copilot CLI found"
else
  warn "  ⚠ Copilot CLI not found — you'll need it before starting Hoot"
  echo -e "    ${DIM}Install: npm install -g @github/copilot${RESET}"
fi

# Check gogcli (optional — Google services)
if command -v gog &>/dev/null; then
  echo -e "  ${GREEN}✓${RESET} gogcli found (Google services)"
else
  echo -e "  ${DIM}○ gogcli not found (optional — enables Gmail, Calendar, Drive, etc.)${RESET}"
  echo -e "    ${DIM}Install: brew install steipete/tap/gogcli${RESET}"
fi

echo ""

# Migrate ~/.max → ~/.hoot if needed
if [ -d "$HOME/.max" ] && [ ! -d "$HOME/.hoot" ]; then
  warn "  📦 Found legacy ~/.max/ config — migrating to ~/.hoot/"
  cp -a "$HOME/.max" "$HOME/.hoot"
  success "  ✓ Migrated ~/.max/ → ~/.hoot/"
elif [ -d "$HOME/.max" ] && [ -d "$HOME/.hoot" ]; then
  echo -e "  ${DIM}○ Legacy ~/.max/ found but ~/.hoot/ already exists — skipping migration${RESET}"
fi

echo ""

if [ "$DEV_MODE" = true ]; then
  info "Building from local source..."
  npm run build
  echo ""
  info "Running setup from local build..."
  echo ""
  node dist/setup.js < /dev/tty
else
  info "Installing Hoot 🦉..."
  npm install -g hoot
  echo ""
  success "✅ Hoot installed successfully!"
  echo ""
  info "Let's get Hoot configured..."
  echo ""
  hoot setup < /dev/tty
fi
