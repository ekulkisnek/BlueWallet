#!/usr/bin/env bash
# Restart collector + BitAssets command server on dual-stack (::) for USB tunnel phone proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
SELFTEST_DIR="${REDWALLET_IOS_SELFTEST_DIR:-$LOG_ROOT/ios-real-device-selftest-20260526-174300}"
COLLECTOR_DIR="${REDWALLET_LOG_COLLECTOR_DIR:-$SELFTEST_DIR/js-event-collector}"
COMMAND_DIR="${REDWALLET_BITASSETS_COMMAND_DIR:-$SELFTEST_DIR/command-server}"
USB_HOST="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" 2>/dev/null || true)"

mkdir -p "$COLLECTOR_DIR" "$COMMAND_DIR"

pkill -f 'redwallet-log-collector-server.js' 2>/dev/null || true
pkill -f 'redwallet-bitassets-command-server.js' 2>/dev/null || true
perl -e 'alarm 3; exec @ARGV' 3 bash -c 'lsof -tiTCP:6124 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true' || true
sleep 1

export REDWALLET_LOG_COLLECTOR_HOST='::'
export REDWALLET_BITASSETS_COMMAND_HOST='::'
export REDWALLET_LOG_COLLECTOR_DIR="$COLLECTOR_DIR"
export REDWALLET_BITASSETS_COMMAND_DIR="$COMMAND_DIR"

nohup node "$ROOT_DIR/scripts/redwallet-log-collector-server.js" >>"$SELFTEST_DIR/js-event-collector-restart.log" 2>&1 &
nohup env BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://100.76.117.106:6004}" \
  REDWALLET_BITASSETS_COMMAND_REPEAT="${REDWALLET_BITASSETS_COMMAND_REPEAT:-1}" \
  node "$ROOT_DIR/scripts/redwallet-bitassets-command-server.js" >>"$SELFTEST_DIR/command-server-restart.log" 2>&1 &
sleep 1

health_v4="$(curl -sS -m 3 http://127.0.0.1:6123/health 2>/dev/null || true)"
health_v6=""
if [[ -n "$USB_HOST" ]]; then
  health_v6="$(curl -g -sS -m 3 "http://[${USB_HOST}]:6123/health" 2>/dev/null || true)"
fi
printf 'usb_tunnel_mac=%s\nv4_collector=%s\nv6_collector=%s\n' "$USB_HOST" "$health_v4" "$health_v6"
