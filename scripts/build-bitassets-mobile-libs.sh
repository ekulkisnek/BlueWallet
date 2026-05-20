#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLORESTA_DIR="${FLORESTA_DIR:-/Users/lukekensik/drivechain-wallet-dev/floresta-bitassets}"
LIB_NAME="floresta_bitassets_wallet"

if [[ ! -d "$FLORESTA_DIR" ]]; then
  echo "FLORESTA_DIR does not exist: $FLORESTA_DIR" >&2
  exit 1
fi

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=(aarch64-apple-ios aarch64-apple-ios-sim)
fi

"$FLORESTA_DIR/scripts/build-bitassets-wallet-mobile.sh" "${targets[@]}"

xcframework="$FLORESTA_DIR/target/$LIB_NAME.xcframework"
if [[ -d "$xcframework" ]]; then
  mkdir -p "$ROOT_DIR/ios/Frameworks"
  rm -rf "$ROOT_DIR/ios/Frameworks/$LIB_NAME.xcframework"
  cp -R "$xcframework" "$ROOT_DIR/ios/Frameworks/$LIB_NAME.xcframework"
  echo "Copied ios/Frameworks/$LIB_NAME.xcframework"
fi

for target in "${targets[@]}"; do
  case "$target" in
    aarch64-linux-android)
      abi="arm64-v8a"
      ;;
    armv7-linux-androideabi)
      abi="armeabi-v7a"
      ;;
    i686-linux-android)
      abi="x86"
      ;;
    x86_64-linux-android)
      abi="x86_64"
      ;;
    *)
      continue
      ;;
  esac
  lib="$FLORESTA_DIR/target/$target/release/lib$LIB_NAME.so"
  if [[ -f "$lib" ]]; then
    mkdir -p "$ROOT_DIR/android/app/src/main/jniLibs/$abi"
    cp "$lib" "$ROOT_DIR/android/app/src/main/jniLibs/$abi/lib$LIB_NAME.so"
    echo "Copied android/app/src/main/jniLibs/$abi/lib$LIB_NAME.so"
  fi
done
