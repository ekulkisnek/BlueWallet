#!/bin/sh

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$ROOT/node_modules/react-native-capture-protection"

if [ ! -d "$PACKAGE_DIR" ]; then
  exit 0
fi

if [ -f "$PACKAGE_DIR/lib/commonjs/index.js" ] && [ -f "$PACKAGE_DIR/lib/module/index.js" ]; then
  exit 0
fi

echo "Building react-native-capture-protection JS outputs for Metro..."
(
  cd "$PACKAGE_DIR"
  npx --yes react-native-builder-bob build --target commonjs
  npx --yes react-native-builder-bob build --target module
)
