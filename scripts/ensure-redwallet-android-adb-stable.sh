#!/usr/bin/env bash
# Fail fast when target serial is not adb-ready or offline emulators clutter adb.
set -euo pipefail

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_PROBE_RUN_DIR:-${LOG_ROOT%/}/adb-stable-${STAMP}}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
RECONNECT_WAIT_SEC="${REDWALLET_ADB_RECONNECT_WAIT_SEC:-8}"

if [[ -z "${REDWALLET_PROBE_RUN_DIR:-}" ]]; then
  mkdir -p "$RUN_DIR/probes"
  ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-adb-stable"
else
  mkdir -p "$RUN_DIR/probes"
fi

export ANDROID_SERIAL
export REDWALLET_ANDROID_SERIAL="$ANDROID_SERIAL"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/adb-stable.log"
}

blocker() {
  local code="$1"
  shift
  log "BLOCKER $code $*"
  {
    echo "blocker=$code"
    echo "serial=$ANDROID_SERIAL"
    echo
    echo "Human checklist:"
    for line in "$@"; do
      echo "  - $line"
    done
  } >"$RUN_DIR/BLOCKER.txt"
  echo "status=blocked" >"$RUN_DIR/RESULT.txt"
  echo "run_dir=$RUN_DIR"
  exit 2
}

refresh_adb_devices() {
  adb devices -l >"$RUN_DIR/probes/adb-devices.txt" 2>&1
}

serial_is_device() {
  refresh_adb_devices
  awk -v serial="$ANDROID_SERIAL" '$1 == serial && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }' \
    "$RUN_DIR/probes/adb-devices.txt"
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL"

if ! command -v adb >/dev/null 2>&1; then
  blocker adb_missing "Install Android platform-tools (adb)"
fi

refresh_adb_devices
if awk '/^emulator-/ && $2 == "offline" { print; found = 1 } END { exit found ? 0 : 1 }' \
  "$RUN_DIR/probes/adb-devices.txt"; then
  awk '/^emulator-/ && $2 == "offline" { print }' "$RUN_DIR/probes/adb-devices.txt" >"$RUN_DIR/probes/offline-emulators.txt" || true
  blocker stale_offline_emulator \
    "Offline emulator(s) in adb devices (see probes/offline-emulators.txt)" \
    "Run: adb disconnect emulator-5554 (or stop the AVD)" \
    "Physical-device scripts require only Pixel $ANDROID_SERIAL attached"
fi

if serial_is_device; then
  log "ADB_OK serial=$ANDROID_SERIAL (already device)"
  echo "status=ok" >"$RUN_DIR/RESULT.txt"
  echo "run_dir=$RUN_DIR"
  exit 0
fi

log "ADB_RECONNECT serial=$ANDROID_SERIAL"
set +e
adb reconnect >>"$RUN_DIR/probes/adb-reconnect.log" 2>&1
adb -s "$ANDROID_SERIAL" reconnect >>"$RUN_DIR/probes/adb-reconnect.log" 2>&1
set -e

deadline=$((SECONDS + RECONNECT_WAIT_SEC))
while (( SECONDS < deadline )); do
  if serial_is_device; then
    log "ADB_OK serial=$ANDROID_SERIAL after reconnect"
    echo "status=ok" >"$RUN_DIR/RESULT.txt"
    echo "run_dir=$RUN_DIR"
    exit 0
  fi
  sleep 1
done

serial_line="$(awk -v serial="$ANDROID_SERIAL" '$1 == serial { print $0 }' "$RUN_DIR/probes/adb-devices.txt" 2>/dev/null || true)"
if [[ "$serial_line" == *unauthorized* ]]; then
  blocker android_not_authorized \
    "Enable USB debugging on Pixel; authorize this Mac when prompted" \
    "Run: adb devices -l (expect $ANDROID_SERIAL device)"
fi

blocker android_not_ready \
  "Target serial not in device state: ${serial_line:-not listed}" \
  "Re-seat USB cable; unlock phone; confirm ANDROID_SERIAL=$ANDROID_SERIAL" \
  "Run: adb devices -l"
