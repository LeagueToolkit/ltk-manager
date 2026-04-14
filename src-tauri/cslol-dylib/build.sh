#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources"

build_arch() {
    local arch="$1"
    cmake -B "$SCRIPT_DIR/build-$arch" -S "$SCRIPT_DIR" \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$arch"
    cmake --build "$SCRIPT_DIR/build-$arch" --config Release
}

build_arch arm64
build_arch x86_64

lipo -create \
    "$SCRIPT_DIR/build-arm64/libcslol.dylib" \
    "$SCRIPT_DIR/build-x86_64/libcslol.dylib" \
    -output "$RESOURCES_DIR/libcslol.dylib"

echo "Done: $RESOURCES_DIR/libcslol.dylib"
file "$RESOURCES_DIR/libcslol.dylib"
