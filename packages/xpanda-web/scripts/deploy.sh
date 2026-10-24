#!/usr/bin/env bash
#
# xpanda-web deploy script (local static hosting):
#   1) remove packages/xpanda-web/dist
#   2) empty /var/www/xpanda (the directory itself is kept, hidden files included)
#   3) build with vite (npm run build)
#   4) copy dist contents into /var/www/xpanda
#
# Run with sudo if /var/www/xpanda is not writable by the current user.
# @Author: jmp0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
DEST_DIR="/var/www/xpanda"

echo "==> Cleaning $DIST_DIR"
rm -rf "$DIST_DIR"

echo "==> Cleaning $DEST_DIR"
if [ -d "$DEST_DIR" ]; then
    # -mindepth 1 keeps the directory itself (owner/permissions untouched)
    find "$DEST_DIR" -mindepth 1 -delete
else
    mkdir -p "$DEST_DIR"
fi

echo "==> Building xpanda-web"
(cd "$PKG_DIR" && npm run build)

if [ ! -d "$DIST_DIR" ]; then
    echo "error: build produced no $DIST_DIR" >&2
    exit 1
fi

echo "==> Copying $DIST_DIR -> $DEST_DIR"
# "/." copies dotfiles too (e.g. .vite/ if present)
cp -R "$DIST_DIR/." "$DEST_DIR/"

echo "==> Done: $DEST_DIR"
