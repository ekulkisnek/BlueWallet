#!/usr/bin/env bash
# Wait for unsigned iphoneos build, then bundle/resign/install/proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
BUILD_LOG="${REDWALLET_NOSIGN_BUILD_LOG:-$LOG_ROOT/xcodebuild-nosign-20260527.log}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/wait-nosign-finish-${STAMP}"
WAIT_SECONDS="${REDWALLET_NOSIGN_WAIT_SECONDS:-3600}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-wait-nosign-finish"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/wait.log"
}

log "START build_log=$BUILD_LOG wait_seconds=$WAIT_SECONDS"

deadline=$((SECONDS + WAIT_SECONDS))
while [[ "$SECONDS" -lt "$deadline" ]]; do
  if rg -q 'BUILD SUCCEEDED' "$BUILD_LOG" 2>/dev/null; then
    log "OK build succeeded"
    break
  fi
  if rg -q 'BUILD FAILED' "$BUILD_LOG" 2>/dev/null; then
    log "BLOCKER build failed — see $BUILD_LOG"
    tail -40 "$BUILD_LOG" >"$RUN_DIR/build-tail.txt"
    exit 2
  fi
  sleep 15
done

if ! rg -q 'BUILD SUCCEEDED' "$BUILD_LOG" 2>/dev/null; then
  log "BLOCKER timeout waiting for BUILD SUCCEEDED"
  exit 2
fi

APP="${REDWALLET_IOS_APP_PATH:-$ROOT_DIR/ios/build/PersonalDebugDerivedDataFixed/Build/Products/Debug-iphoneos/BlueWallet.app}"
DYLIB="$APP/BlueWallet.debug.dylib"
if [[ -f "$DYLIB" ]]; then
  strings "$DYLIB" >"$RUN_DIR/dylib-strings.txt" 2>/dev/null || true
  if rg -q 'embedded JS bundle on device' "$RUN_DIR/dylib-strings.txt" 2>/dev/null; then
    log "OK dylib has embedded JS AppDelegate"
  else
    log "WARN dylib missing embedded JS string — see dylib-strings.txt"
  fi
fi

log "RUN finish-redwallet-ios-device-proof.sh"
"$ROOT_DIR/scripts/finish-redwallet-ios-device-proof.sh" >"$RUN_DIR/finish.log" 2>&1
rc=$?
log "FINISH_EXIT=$rc"
exit "$rc"
