#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/monitor-redwallet-ios-real-devices.sh [bundle-id] [seconds] [udid ...]
  scripts/monitor-redwallet-ios-real-devices.sh [seconds] [udid ...]

Launches RedWallet on real iOS devices through devicectl with --console and
stores Codex-readable evidence under:
  /Volumes/T705/redwallet-logs/current-ios-real-device-app-monitor

If no UDIDs are supplied, the current RedWallet test devices are used.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"
SECONDS_TO_CAPTURE=120

if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  SECONDS_TO_CAPTURE="$1"
  shift || true
elif [[ -n "${1:-}" ]]; then
  BUNDLE_ID="$1"
  shift || true
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    SECONDS_TO_CAPTURE="$1"
    shift || true
  fi
fi

if (($#)); then
  DEVICES=("$@")
else
  DEVICES=(
    "00008020-0011204911F3002E"
    "00008101-000128643E28001E"
  )
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/ios-real-device-app-monitor-${STAMP}"
CURRENT_LINK="${LOG_ROOT%/}/current-ios-real-device-app-monitor"
EVENTS="$RUN_DIR/events.ndjson"

mkdir -p "$RUN_DIR"/{devices,metro,host}
ln -sfn "$RUN_DIR" "$CURRENT_LINK"

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

run_capture() {
  local output="$1"
  shift
  local status=0
  {
    echo "# $*"
    "$@"
  } > "$output" 2>&1 || status=$?
  event "command" "exit:$status" "$output :: $*"
  return 0
}

event "monitor.start" "ok" "run_dir=$RUN_DIR seconds=$SECONDS_TO_CAPTURE bundle=$BUNDLE_ID devices=${DEVICES[*]}"

{
  echo "run_dir=$RUN_DIR"
  echo "current_link=$CURRENT_LINK"
  echo "repo=$ROOT_DIR"
  echo "bundle_id=$BUNDLE_ID"
  echo "seconds=$SECONDS_TO_CAPTURE"
  echo "devices=${DEVICES[*]}"
  echo "started=$(date +%Y-%m-%dT%H:%M:%S%z)"
} > "$RUN_DIR/SUMMARY.txt"

run_capture "$RUN_DIR/host/date.txt" date
run_capture "$RUN_DIR/host/devicectl-devices.txt" xcrun devicectl list devices --columns '*'
run_capture "$RUN_DIR/host/xctrace-devices.txt" xcrun xctrace list devices
run_capture "$RUN_DIR/metro/status.txt" curl -sS -m 10 http://100.76.117.106:8081/status
run_capture "$RUN_DIR/metro/bundle-head.txt" curl -sS -m 20 -I 'http://100.76.117.106:8081/index.bundle?platform=ios&dev=true&minify=false'

pids=()
for udid in "${DEVICES[@]}"; do
  safe_udid="${udid//[^A-Za-z0-9._-]/_}"
  device_dir="$RUN_DIR/devices/$safe_udid"
  mkdir -p "$device_dir"

  run_capture "$device_dir/info.txt" xcrun devicectl device info details --device "$udid"
  run_capture "$device_dir/apps-before.txt" xcrun devicectl device info apps --device "$udid"
  run_capture "$device_dir/processes-before.txt" xcrun devicectl device info processes --device "$udid"

  event "device.launch_console.start" "ok" "$udid"
  launch_extra=()
  if [[ "${REDWALLET_MONITOR_TERMINATE_EXISTING:-0}" == "1" ]]; then
    launch_extra=(--terminate-existing)
  fi
  (
    set +e
    set +u
    if ((${#launch_extra[@]})); then
      xcrun devicectl device process launch \
        --device "$udid" \
        "${launch_extra[@]}" \
        --console \
        "$BUNDLE_ID"
    else
      xcrun devicectl device process launch \
        --device "$udid" \
        --console \
        "$BUNDLE_ID"
    fi
    code=$?
    echo "DEVICE_CONSOLE_EXIT[$udid]:$code"
    exit "$code"
  ) > "$device_dir/redwallet-console.log" 2>&1 &
  pids+=("$!")
done

sleep "$SECONDS_TO_CAPTURE"

for pid in "${pids[@]}"; do
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
done

for pid in "${pids[@]}"; do
  wait "$pid" >/dev/null 2>&1 || true
done

for udid in "${DEVICES[@]}"; do
  safe_udid="${udid//[^A-Za-z0-9._-]/_}"
  device_dir="$RUN_DIR/devices/$safe_udid"
  run_capture "$device_dir/apps-after.txt" xcrun devicectl device info apps --device "$udid"
  run_capture "$device_dir/processes-after.txt" xcrun devicectl device info processes --device "$udid"
  if rg -n 'Could not load bundle|No bundle URL present|Unhandled JS Exception|Fatal|Exception|error|failed|REDWALLET_EVENT|BitAssets|Using real-device Metro' "$device_dir/redwallet-console.log" > "$device_dir/redwallet-console-interesting.txt" 2>&1; then
    event "device.console.scan" "interesting" "$device_dir/redwallet-console-interesting.txt"
  else
    event "device.console.scan" "no_matches" "$device_dir/redwallet-console.log"
  fi
done

{
  echo "finished=$(date +%Y-%m-%dT%H:%M:%S%z)"
  echo "events=$EVENTS"
  echo "console_glob=$RUN_DIR/devices/*/redwallet-console.log"
} >> "$RUN_DIR/SUMMARY.txt"

event "monitor.finish" "ok" "$RUN_DIR"
echo "run_dir=$RUN_DIR"
echo "current_link=$CURRENT_LINK"
echo "events=$EVENTS"
