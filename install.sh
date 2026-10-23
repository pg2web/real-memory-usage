#!/usr/bin/env bash
# Pack and install the extension for the current user. Needs only `gnome-extensions`.
set -euo pipefail

UUID="real-memory-usage@pg2web.github.io"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

command -v gnome-extensions >/dev/null || {
    echo "gnome-extensions not found" >&2
    exit 1
}

gnome-extensions pack --force --out-dir="$OUT_DIR" "$SRC_DIR/$UUID"
gnome-extensions install --force "$OUT_DIR/$UUID.shell-extension.zip"

echo
echo "Installed $UUID."
echo "Log out and back in (Wayland), then run: gnome-extensions enable $UUID"
