#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_INSTALL_LOG_DIR:-$LOG_ROOT/ios-install-launch-$STAMP}"
APP="${1:-$ROOT_DIR/ios/build/PersonalDebugDerivedDataFixed/Build/Products/Debug-iphoneos/BlueWallet.app}"
BUNDLE_ID="${2:-com.lukekensik.redwallet.dev}"
WAIT_SECONDS="${REDWALLET_IOS_INSTALL_WAIT_SECONDS:-900}"
MONITOR_SECONDS="${REDWALLET_IOS_MONITOR_SECONDS:-90}"
shift 2 2>/dev/null || true
DEVICES=("$@")

if [ "${#DEVICES[@]}" -eq 0 ]; then
  DEVICES=(
    "00008020-0011204911F3002E"
    "00008101-000128643E28001E"
  )
fi

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "$LOG_ROOT/current-ios-install-launch"
cd "$ROOT_DIR"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*"
}

wait_for_signed_app() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -d "$APP" ] && [ -f "$APP/Info.plist" ] && codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
      return 0
    fi
    log "WAIT signed_app=false app=$APP"
    sleep 10
  done
  return 1
}

{
  log "START run_dir=$RUN_DIR"
  log "APP $APP"
  log "BUNDLE_ID $BUNDLE_ID"
  log "DEVICES ${DEVICES[*]}"
  xcrun devicectl list devices --columns '*' > "$RUN_DIR/devices-before.txt" 2>&1 || true

  if ! wait_for_signed_app; then
    log "ERROR signed app was not ready within ${WAIT_SECONDS}s"
    codesign --verify --deep --strict --verbose=2 "$APP" > "$RUN_DIR/codesign-failed.txt" 2>&1 || true
    exit 1
  fi

  log "SIGNED_APP_READY"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" > "$RUN_DIR/bundle-id.txt" 2>&1 || true
  codesign -dv --verbose=4 "$APP" > "$RUN_DIR/codesign-details.txt" 2>&1 || true
  codesign --verify --deep --strict --verbose=2 "$APP" > "$RUN_DIR/codesign-verify.txt" 2>&1
  log "CODESIGN_VERIFY_EXIT:$?"

  for udid in "${DEVICES[@]}"; do
    safe_udid="${udid//[^A-Za-z0-9_.-]/_}"
    device_dir="$RUN_DIR/devices/$safe_udid"
    mkdir -p "$device_dir"
    log "INSTALL_START udid=$udid"
    xcrun devicectl device install app --device "$udid" "$APP" > "$device_dir/install.log" 2>&1
    install_exit=$?
    log "DEVICE_INSTALL_EXIT[$udid]:$install_exit"
    xcrun devicectl device info apps --device "$udid" > "$device_dir/apps-after-install.txt" 2>&1 || true
    log "LAUNCH_START udid=$udid"
    xcrun devicectl device process launch --device "$udid" "$BUNDLE_ID" > "$device_dir/launch.log" 2>&1
    launch_exit=$?
    log "DEVICE_LAUNCH_EXIT[$udid]:$launch_exit"
  done

  if [[ "${REDWALLET_SKIP_IOS_MONITOR:-0}" != 1 ]] && [ -x "$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" ]; then
    log "MONITOR_START seconds=$MONITOR_SECONDS"
    REDWALLET_IOS_MONITOR_RUN_DIR="$RUN_DIR/real-device-monitor" \
      REDWALLET_MONITOR_TERMINATE_EXISTING="${REDWALLET_MONITOR_TERMINATE_EXISTING:-1}" \
      REDWALLET_MONITOR_CONSOLE="${REDWALLET_MONITOR_CONSOLE:-1}" \
      "$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" "$BUNDLE_ID" "$MONITOR_SECONDS" "${DEVICES[@]}"
    log "MONITOR_EXIT:$?"
  else
    log "MONITOR_SKIP REDWALLET_SKIP_IOS_MONITOR=${REDWALLET_SKIP_IOS_MONITOR:-0}"
  fi

  xcrun devicectl list devices --columns '*' > "$RUN_DIR/devices-after.txt" 2>&1 || true
  log "END"
} 2>&1 | tee "$RUN_DIR/install-launch.log"
