#!/usr/bin/env bash
# Build the macOS injection host and stage it as a bundled resource.
#
# Produces a universal (arm64 + x86_64) binary when both Rust targets are
# installed; otherwise falls back to the host architecture only. The result is
# copied to src-tauri/resources/ltk_patcher_host, where both `tauri dev` and
# `tauri build` pick it up.
set -euo pipefail

cd "$(dirname "$0")/.."

PKG=ltk-patcher-macos
BIN=ltk_patcher_host
OUT=src-tauri/resources/$BIN

profile=release
profile_flag=--release
if [[ "${1:-}" == "--debug" ]]; then
  profile=debug
  profile_flag=""
fi

have_target() { rustup target list --installed 2>/dev/null | grep -qx "$1"; }

built=()
for triple in aarch64-apple-darwin x86_64-apple-darwin; do
  if have_target "$triple"; then
    echo "Building $BIN for $triple ($profile)…"
    cargo build -p "$PKG" $profile_flag --target "$triple"
    built+=("target/$triple/$profile/$BIN")
  fi
done

if [[ ${#built[@]} -eq 0 ]]; then
  echo "No apple-darwin Rust targets installed; building for the host arch."
  cargo build -p "$PKG" $profile_flag
  cp "target/$profile/$BIN" "$OUT"
elif [[ ${#built[@]} -eq 1 ]]; then
  cp "${built[0]}" "$OUT"
else
  echo "Creating universal binary…"
  lipo -create -output "$OUT" "${built[@]}"
fi

chmod +x "$OUT"
echo "Staged $OUT:"
file "$OUT"
