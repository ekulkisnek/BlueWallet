#!/usr/bin/env bash
# iOS lane: BTC command server on :6125 (dual-stack :: for USB tunnel + LAN).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
IOS_COMMAND_DIR="${REDWALLET_IOS_BTC_COMMAND_DIR:-$LOG_ROOT/ios-btc-command-server}"
LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.236}"

mkdir -p "$IOS_COMMAND_DIR"
rm -f "$IOS_COMMAND_DIR/command.json"
rm -f "$IOS_COMMAND_DIR"/served-*-command.json 2>/dev/null || true
ln -sfn "$IOS_COMMAND_DIR" "${LOG_ROOT%/}/current-ios-btc-command-server"
export REDWALLET_BTC_COMMAND_OUT_DIR="$IOS_COMMAND_DIR"

if [[ "${REDWALLET_SKIP_COMMAND_SERVER_RESTART:-0}" == 1 ]]; then
  exit 0
fi

health="$(curl -sS -m 3 http://127.0.0.1:6125/health 2>/dev/null || true)"
if { [[ "$health" == *'"ok":true'* || "$health" == ok* ]]; } && [[ "$health" != *'"commandReady":false'* ]]; then
  if lsof -tiTCP:6125 -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
  fi
fi

pkill -f 'redwallet-btc-command-server.js' 2>/dev/null || true
perl -e 'alarm 3; exec @ARGV' 3 bash -c 'lsof -tiTCP:6125 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true' || true
sleep 1

export REDWALLET_BTC_COMMAND_HOST="${REDWALLET_BTC_COMMAND_HOST:-::}"
export REDWALLET_BTC_COMMAND_OUT_DIR="$IOS_COMMAND_DIR"

nohup env REDWALLET_BTC_COMMAND_OUT_DIR="$IOS_COMMAND_DIR" \
  REDWALLET_BTC_COMMAND_HOST="$REDWALLET_BTC_COMMAND_HOST" \
  node "$ROOT_DIR/scripts/redwallet-btc-command-server.js" >>"$IOS_COMMAND_DIR/server-start.log" 2>&1 &
sleep 1

USB_HOST="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" "${REDWALLET_FORCE_LAUNCH_UDID:-}" 2>/dev/null || true)"
health=""
if [[ -n "$LAN_HOST" ]]; then
  health="$(curl -sS -m 5 "http://${LAN_HOST}:6125/health" 2>/dev/null || true)"
fi
if [[ "$health" != *'"ok":true'* && "$health" != ok* ]]; then
  health="$(curl -sS -m 5 http://127.0.0.1:6125/health 2>/dev/null || true)"
fi
if [[ -n "$USB_HOST" ]]; then
  health_usb="$(curl -g -sS -m 5 "http://[${USB_HOST}]:6125/health" 2>/dev/null || true)"
  if [[ "$health_usb" == *'"ok":true'* || "$health_usb" == ok* ]]; then
    health="$health_usb"
  fi
fi
if [[ "$health" != *'"ok":true'* && "$health" != ok* ]]; then
  echo "ensure-ios-btc-command-server: health failed (${health:-no response}) dir=$IOS_COMMAND_DIR" >&2
  exit 1
fi

exit 0
