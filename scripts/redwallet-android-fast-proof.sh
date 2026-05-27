#!/usr/bin/env bash
# Single operator command: Android preflight (adb stable + metro prewarm) then full chain.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERIAL="${1:-${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}}"

export ANDROID_SERIAL="$SERIAL"
export REDWALLET_ANDROID_SERIAL="$SERIAL"

bash "$ROOT_DIR/scripts/preflight-redwallet-android-chain.sh"
bash "$ROOT_DIR/scripts/redwallet-android-phone-chain-reserve-register.sh" "$SERIAL"
