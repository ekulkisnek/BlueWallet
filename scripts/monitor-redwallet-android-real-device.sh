#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/monitor-redwallet-android-real-device.sh [package] [seconds] [serial]

Captures adb logcat for REDWALLET_EVENT / blocking errors while RedWallet runs.
Evidence: /Volumes/T705/redwallet-logs/current-android-real-device-app-monitor
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
SECONDS_TO_CAPTURE="${REDWALLET_ANDROID_MONITOR_SECONDS:-180}"
SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-}}"

if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  SECONDS_TO_CAPTURE="$1"
  shift || true
elif [[ -n "${1:-}" ]]; then
  PACKAGE="$1"
  shift || true
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    SECONDS_TO_CAPTURE="$1"
    shift || true
  fi
fi
if [[ -n "${1:-}" ]]; then
  SERIAL="$1"
fi
if [[ -z "$SERIAL" ]]; then
  SERIAL="$(adb devices -l | awk 'NR > 1 && $2 == "device" && $1 !~ /^emulator-/ { print $1; exit }')"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/android-real-device-app-monitor-${STAMP}"
CURRENT_LINK="${LOG_ROOT%/}/current-android-real-device-app-monitor"
mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "$CURRENT_LINK"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/monitor.log"
}

log "START serial=$SERIAL package=$PACKAGE seconds=$SECONDS_TO_CAPTURE"
adb -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am force-stop "$PACKAGE" >/dev/null 2>&1 || true
adb -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true

sleep "$SECONDS_TO_CAPTURE"

adb -s "$SERIAL" logcat -d -v time >"$RUN_DIR/logcat-full.txt" 2>&1 || true
rg 'REDWALLET_EVENT' "$RUN_DIR/logcat-full.txt" >"$RUN_DIR/redwallet-events.txt" 2>/dev/null || true
rg 'REDWALLET_EVENT.*(js_error|selftest_error|command_error|smoke_error|network_error)' "$RUN_DIR/logcat-full.txt" \
  >"$RUN_DIR/redwallet-blocking-errors.txt" 2>/dev/null || true
rg '192\.168\.1\.50:6004|127\.0\.0\.1:6004' "$RUN_DIR/logcat-full.txt" >"$RUN_DIR/redwallet-rpc-urls.txt" 2>/dev/null || true

BLOCKING_COUNT="$(wc -l <"$RUN_DIR/redwallet-blocking-errors.txt" 2>/dev/null | tr -d ' ')"
BLOCKING_COUNT="${BLOCKING_COUNT:-0}"
EVENT_COUNT="$(wc -l <"$RUN_DIR/redwallet-events.txt" 2>/dev/null | tr -d ' ')"
EVENT_COUNT="${EVENT_COUNT:-0}"

{
  echo "serial=$SERIAL"
  echo "package=$PACKAGE"
  echo "seconds=$SECONDS_TO_CAPTURE"
  echo "redwallet_event_lines=$EVENT_COUNT"
  echo "blocking_error_lines=$BLOCKING_COUNT"
} >"$RUN_DIR/SUMMARY.txt"

if [[ "$BLOCKING_COUNT" -eq 0 ]]; then
  echo "status=ok" >>"$RUN_DIR/SUMMARY.txt"
  log "MONITOR_OK events=$EVENT_COUNT blocking=0"
  exit 0
fi

echo "status=blocking_errors" >>"$RUN_DIR/SUMMARY.txt"
log "MONITOR_WARN blocking_errors=$BLOCKING_COUNT"
exit 1
