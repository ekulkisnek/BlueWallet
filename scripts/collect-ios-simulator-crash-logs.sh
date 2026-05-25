#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/collect-ios-simulator-crash-logs.sh <simulator-udid> [output-dir] [minutes]

Collects a compact iOS simulator failure evidence bundle for RedWallet/BlueWallet:
- BlueWallet process logs
- simulator error/fault logs
- recent simulator and host DiagnosticReports crash/ips files
- current simulator screenshot

Example:
  scripts/collect-ios-simulator-crash-logs.sh 1040BAF7-9A21-4824-A188-8935E8F20B3D /Volumes/T705/redwallet-logs 15
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit $([[ $# -lt 1 ]] && echo 2 || echo 0)
fi

SIM_UDID="$1"
OUTPUT_ROOT="${2:-/tmp/redwallet-ios-crash-logs}"
MINUTES="${3:-10}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUTPUT_ROOT%/}/ios-crash-${STAMP}"
SIM_DIAGNOSTIC_DIR="$HOME/Library/Developer/CoreSimulator/Devices/${SIM_UDID}/data/Library/Logs/DiagnosticReports"
HOST_DIAGNOSTIC_DIR="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$OUT_DIR"

xcrun simctl spawn "$SIM_UDID" log show \
  --style compact \
  --last "${MINUTES}m" \
  --predicate 'process == "BlueWallet"' \
  > "$OUT_DIR/bluewallet.log" 2>&1 || true

xcrun simctl spawn "$SIM_UDID" log show \
  --style compact \
  --last "${MINUTES}m" \
  --predicate 'eventType == logEvent AND (messageType == fault OR messageType == error)' \
  > "$OUT_DIR/simulator-errors.log" 2>&1 || true

xcrun simctl io "$SIM_UDID" screenshot "$OUT_DIR/screenshot.png" >/dev/null 2>&1 || true

mkdir -p "$OUT_DIR/DiagnosticReports/simulator" "$OUT_DIR/DiagnosticReports/host"
if [[ -d "$SIM_DIAGNOSTIC_DIR" ]]; then
  find "$SIM_DIAGNOSTIC_DIR" -type f -mtime -1 \( -name '*.ips' -o -name '*.crash' \) -print0 \
    | xargs -0 -I{} cp "{}" "$OUT_DIR/DiagnosticReports/simulator/" 2>/dev/null || true
fi
if [[ -d "$HOST_DIAGNOSTIC_DIR" ]]; then
  find "$HOST_DIAGNOSTIC_DIR" -type f -mtime -1 \
    \( -name 'BlueWallet*.ips' -o -name 'BlueWallet*.crash' -o -name 'BlueWallet*.diag' \) -print0 \
    | xargs -0 -I{} cp "{}" "$OUT_DIR/DiagnosticReports/host/" 2>/dev/null || true
fi

SIM_DIAGNOSTIC_COUNT="$(find "$OUT_DIR/DiagnosticReports/simulator" -type f 2>/dev/null | wc -l | tr -d ' ')"
HOST_DIAGNOSTIC_COUNT="$(find "$OUT_DIR/DiagnosticReports/host" -type f 2>/dev/null | wc -l | tr -d ' ')"

{
  echo "simulator_udid=$SIM_UDID"
  echo "minutes=$MINUTES"
  echo "output_dir=$OUT_DIR"
  echo "simulator_diagnostic_report_count=$SIM_DIAGNOSTIC_COUNT"
  echo "host_bluewallet_diagnostic_report_count=$HOST_DIAGNOSTIC_COUNT"
  echo "diagnostic_report_count=$((SIM_DIAGNOSTIC_COUNT + HOST_DIAGNOSTIC_COUNT))"
  echo "bluewallet_log=$OUT_DIR/bluewallet.log"
  echo "simulator_errors_log=$OUT_DIR/simulator-errors.log"
  echo "screenshot=$OUT_DIR/screenshot.png"
} | tee "$OUT_DIR/SUMMARY.txt"
