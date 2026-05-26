#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${1:-/Volumes/T705/redwallet-logs/current-ios-personal-debug-fixed/build-install-fixed.log}"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_DIR="${LOG_ROOT%/}/ios-install-runtime-watch-$(date +%Y%m%d-%H%M%S)"
CURRENT_LINK="${LOG_ROOT%/}/current-ios-install-runtime-watch"
EVENTS="$WATCH_DIR/events.ndjson"

mkdir -p "$WATCH_DIR"
ln -sfn "$WATCH_DIR" "$CURRENT_LINK"

json_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

event() {
  local type="$1"
  local status="$2"
  local detail="${3:-}"
  printf '{"time":"%s","type":"%s","status":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(json_escape "$type")" \
    "$(json_escape "$status")" \
    "$(json_escape "$detail")" >> "$EVENTS"
}

{
  echo "watch_dir=$WATCH_DIR"
  echo "current_link=$CURRENT_LINK"
  echo "log_file=$LOG_FILE"
  echo "repo=$ROOT_DIR"
  echo "started=$(date +%Y-%m-%dT%H:%M:%S%z)"
} > "$WATCH_DIR/SUMMARY.txt"

event "watch.start" "ok" "$LOG_FILE"

success_seen() {
  rg -q 'DEVICE_INSTALL_EXIT\[00008020-0011204911F3002E\]:0' "$LOG_FILE" &&
  rg -q 'DEVICE_LAUNCH_EXIT\[00008020-0011204911F3002E\]:0' "$LOG_FILE" &&
  rg -q 'DEVICE_INSTALL_EXIT\[00008101-000128643E28001E\]:0' "$LOG_FILE" &&
  rg -q 'DEVICE_LAUNCH_EXIT\[00008101-000128643E28001E\]:0' "$LOG_FILE"
}

failure_seen() {
  rg -q 'BUILD FAILED|XCODEBUILD_FIXED_EXIT:[1-9]|DEVICE_INSTALL_EXIT\[[^]]+\]:[1-9]|DEVICE_LAUNCH_EXIT\[[^]]+\]:[1-9]|ERROR:|error:' "$LOG_FILE"
}

while true; do
  if [[ -f "$LOG_FILE" ]]; then
    cp "$LOG_FILE" "$WATCH_DIR/build-install-fixed.snapshot.log" 2>/dev/null || true

    if success_seen; then
      event "install.result" "success" "both devices installed and launched"
      "$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" 120 \
        > "$WATCH_DIR/real-device-app-monitor.out" 2>&1 || event "app.monitor" "failed" "$WATCH_DIR/real-device-app-monitor.out"
      "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 20 \
        > "$WATCH_DIR/collect-device-proof.out" 2>&1 || event "proof.collect" "failed" "$WATCH_DIR/collect-device-proof.out"
      event "watch.finish" "success" "$WATCH_DIR"
      echo "finished=$(date +%Y-%m-%dT%H:%M:%S%z)" >> "$WATCH_DIR/SUMMARY.txt"
      exit 0
    fi

    if failure_seen; then
      event "install.result" "failed" "$LOG_FILE"
      "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 20 \
        > "$WATCH_DIR/collect-device-proof-after-failure.out" 2>&1 || true
      echo "finished=$(date +%Y-%m-%dT%H:%M:%S%z)" >> "$WATCH_DIR/SUMMARY.txt"
      exit 1
    fi
  else
    event "watch.wait" "missing_log" "$LOG_FILE"
  fi

  sleep 10
done
