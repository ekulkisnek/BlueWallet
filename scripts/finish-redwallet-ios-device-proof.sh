#!/usr/bin/env bash
# After unsigned/signed iphoneos build: verify embedded-bundle AppDelegate, resign, install, proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/finish-ios-device-proof-${STAMP}"
APP="${REDWALLET_IOS_APP_PATH:-$ROOT_DIR/ios/build/PersonalDebugDerivedDataFixed/Build/Products/Debug-iphoneos/BlueWallet.app}"
DYLIB="$APP/BlueWallet.debug.dylib"
UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-finish-ios-device-proof"

LOCK_DIR="${LOG_ROOT%/}/.finish-ios-device-proof.lockdir"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s BLOCKER another finish-ios-device-proof run in progress (lock=%s)\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$LOCK_DIR" | tee -a "$RUN_DIR/finish.log"
  exit 3
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/finish.log"
}

log "START run_dir=$RUN_DIR app=$APP udid=$UDID"

if [[ ! -d "$APP" ]]; then
  log "BLOCKER missing app: $APP"
  exit 2
fi

if [[ -f "$DYLIB" ]]; then
  strings "$DYLIB" >"$RUN_DIR/dylib-strings.txt" 2>/dev/null || true
  if rg -q 'embedded JS bundle on device' "$RUN_DIR/dylib-strings.txt" 2>/dev/null; then
    log "OK dylib has embedded JS bundle AppDelegate"
  elif rg -q 'Using real-device Metro bundle URL' "$RUN_DIR/dylib-strings.txt" 2>/dev/null; then
    log "WARN dylib still uses Metro URL path — phone needs Tailscale/Wi-Fi to Mac Metro or rebuild"
    echo "dylib=metro_fallback" >"$RUN_DIR/native-bundle-mode.txt"
  else
    log "NOTE dylib string scan inconclusive (see dylib-strings.txt)"
  fi
fi

"$ROOT_DIR/scripts/start-redwallet-real-device-support.sh" >"$RUN_DIR/support.txt" 2>&1 || true
"$ROOT_DIR/scripts/ensure-redwallet-ios-device-servers.sh" >"$RUN_DIR/ensure-servers.txt" 2>&1 || true
"$ROOT_DIR/scripts/bundle-redwallet-ios-real-device.sh" >"$RUN_DIR/bundle.log" 2>&1

log "INSTALL_START"
perl -e 'alarm 120; exec @ARGV' 120 "$ROOT_DIR/scripts/install-launch-redwallet-ios-devices.sh" "$APP" "$BUNDLE_ID" "$UDID" \
  >"$RUN_DIR/install-launch.log" 2>&1

export REDWALLET_PHONE_MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-90}"
set +e
"$ROOT_DIR/scripts/retry-phone-origin-bitassets-proof.sh" >"$RUN_DIR/retry.log" 2>&1
retry_rc=$?
set -e
log "RETRY_EXIT=$retry_rc"

"$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true

if [[ -f "${LOG_ROOT%/}/current-phone-origin-retry/RESULT.txt" ]]; then
  cp "${LOG_ROOT%/}/current-phone-origin-retry/RESULT.txt" "$RUN_DIR/RESULT.txt"
fi

log "DONE run_dir=$RUN_DIR"
exit "$retry_rc"
