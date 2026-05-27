#!/usr/bin/env bash
# Embed a fresh JS bundle into the Debug-iphoneos app (real devices prefer main.jsbundle over Metro).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/ios-bundle-real-device-${STAMP}"
APP="${REDWALLET_IOS_APP_PATH:-$ROOT_DIR/ios/build/PersonalDebugDerivedDataFixed/Build/Products/Debug-iphoneos/BlueWallet.app}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-bundle-real-device"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/bundle.log"
}

if [[ ! -d "$APP" ]]; then
  log "BLOCKER missing app dir: $APP (build Debug-iphoneos first)"
  exit 1
fi

log "START app=$APP"
cd "$ROOT_DIR"

set +e
npx react-native bundle \
  --platform ios \
  --dev false \
  --entry-file index.js \
  --bundle-output "$APP/main.jsbundle" \
  --assets-dest "$APP" \
  >"$RUN_DIR/metro-bundle.stdout" 2>"$RUN_DIR/metro-bundle.stderr"
rc=$?
set -e

log "BUNDLE_EXIT=$rc"
if [[ "$rc" -ne 0 ]]; then
  tail -40 "$RUN_DIR/metro-bundle.stderr" | tee -a "$RUN_DIR/bundle.log"
  exit "$rc"
fi

if rg -q 'device_logger_installed|real_device_bitassets' "$APP/main.jsbundle" 2>/dev/null; then
  log "OK bundle contains real-device proof markers"
else
  log "WARN bundle missing expected markers (grep device_logger_installed)"
fi

# Embedding main.jsbundle invalidates the sealed app signature.
IDENT="${REDWALLET_IOS_CODESIGN_IDENTITY:-981B5698C1C67E65D5A8FD8BA8AD0CDE63FEE77B}"
log "RESIGN identity=$IDENT"
{
  find "$APP" -depth \( -name '*.framework' -o -name '*.appex' -o -name '*.dylib' \) -print0 2>/dev/null |
    while IFS= read -r -d '' nested; do
      codesign --force --sign "$IDENT" --preserve-metadata=entitlements,flags,runtime "$nested" || true
    done
  codesign --force --sign "$IDENT" --preserve-metadata=entitlements,flags,runtime "$APP"
  codesign --verify --deep --strict "$APP"
} >>"$RUN_DIR/resign.log" 2>&1 || {
  log "BLOCKER codesign failed (see $RUN_DIR/resign.log)"
  exit 1
}
log "RESIGN_OK"

ls -la "$APP/main.jsbundle" | tee -a "$RUN_DIR/bundle.log"
log "DONE run_dir=$RUN_DIR"
echo "run_dir=$RUN_DIR"
echo "app=$APP"
