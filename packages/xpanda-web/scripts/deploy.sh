#!/usr/bin/env bash
#
# xpanda-web deploy script (local static hosting):
#   1) remove packages/xpanda-web/dist
#   2) build with esbuild (yarn build)
#   3) empty /var/www/xpanda (rm -rf of non-hidden entries; the directory itself is kept)
#  -- only reached after a successful build, so a failed build never touches the live site
#   4) copy dist contents into /var/www/xpanda
#
# Run with sudo if /var/www/xpanda is not writable by the current user.
# @Author: jmp0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
DEST_DIR="/var/www/xpanda"

# A git pull refreshes the working tree but not node_modules: the workspace
# links the build resolves through (@asm-xpanda/*) come from the last `yarn install`.
# When the package set changed (e.g. the @asm-xpanda scope move) the stale links
# no longer cover every import and the build fails to resolve @asm-xpanda/core.
# Re-link in place before building so `git pull && yarn run deploy` just works.
ROOT_DIR="$(cd "$PKG_DIR/../.." && pwd)"
CORE_LINK="$ROOT_DIR/node_modules/@asm-xpanda/core"
if [ -f "$ROOT_DIR/package.json" ] && [ ! -e "$CORE_LINK" ]; then
    echo "==> Workspace link missing ($CORE_LINK), running yarn install at $ROOT_DIR"
    (cd "$ROOT_DIR" && yarn install)
fi

echo "==> Cleaning $DIST_DIR"
rm -rf "$DIST_DIR"

echo "==> Building xpanda-web"
(cd "$PKG_DIR" && yarn build)

if [ ! -d "$DIST_DIR" ]; then
    echo "error: build produced no $DIST_DIR" >&2
    exit 1
fi

echo "==> Cleaning $DEST_DIR"
rm -rf "$DEST_DIR"/*
mkdir -p "$DEST_DIR"

echo "==> Copying $DIST_DIR -> $DEST_DIR"
# "/." copies dotfiles too
cp -R "$DIST_DIR/." "$DEST_DIR/"

echo "==> Done: $DEST_DIR"
