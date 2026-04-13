#!/bin/bash
# Signs the binary with entitlements before running it.
# Used as CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER so that
# `pnpm tauri dev` launches a properly entitled binary.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
codesign -s - --entitlements "$SCRIPT_DIR/Entitlements.plist" --force "$1" 2>/dev/null
exec "$@"
