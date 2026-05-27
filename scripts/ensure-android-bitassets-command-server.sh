#!/usr/bin/env bash
# Android lane: dedicated command dir on :6124, clear one-shot payload, restart server.
# LiPhone must not poll /command during Android chain — see docs/FLEET_LANES.md (LIPHONE_STANDBY).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
ANDROID_COMMAND_DIR="${REDWALLET_ANDROID_BITASSETS_COMMAND_DIR:-$LOG_ROOT/android-bitassets-command-server}"
MAC_RPC="${REDWALLET_BITASSETS_RPC_MAC:-${BITASSETS_RPC_URL:-http://192.168.1.50:6004}}"
LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.50}"

mkdir -p "$ANDROID_COMMAND_DIR"
rm -f "$ANDROID_COMMAND_DIR/command.json"
rm -f "$ANDROID_COMMAND_DIR"/served-*-command.json 2>/dev/null || true
ln -sfn "$ANDROID_COMMAND_DIR" "${LOG_ROOT%/}/current-android-bitassets-command-server"
export REDWALLET_BITASSETS_COMMAND_DIR="$ANDROID_COMMAND_DIR"

if [[ "${REDWALLET_SKIP_COMMAND_SERVER_RESTART:-0}" == 1 ]]; then
  exit 0
fi

pkill -f 'redwallet-bitassets-command-server.js' 2>/dev/null || true
perl -e 'alarm 3; exec @ARGV' 3 bash -c 'lsof -tiTCP:6124 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true' || true
sleep 1

export REDWALLET_BITASSETS_COMMAND_HOST="${REDWALLET_BITASSETS_COMMAND_HOST:-0.0.0.0}"
export REDWALLET_BITASSETS_COMMAND_DIR="$ANDROID_COMMAND_DIR"
export BITASSETS_RPC_URL="$MAC_RPC"

nohup env BITASSETS_RPC_URL="$BITASSETS_RPC_URL" \
  REDWALLET_BITASSETS_COMMAND_DIR="$ANDROID_COMMAND_DIR" \
  REDWALLET_BITASSETS_COMMAND_HOST="$REDWALLET_BITASSETS_COMMAND_HOST" \
  node "$ROOT_DIR/scripts/redwallet-bitassets-command-server.js" >>"$ANDROID_COMMAND_DIR/server-start.log" 2>&1 &
sleep 1

health="$(curl -sS -m 5 "http://${LAN_HOST}:6124/health" 2>/dev/null || true)"
if [[ "$health" != *'"ok":true'* && "$health" != ok* ]]; then
  health="$(curl -sS -m 5 http://127.0.0.1:6124/health 2>/dev/null || true)"
fi
if [[ "$health" != *'"ok":true'* && "$health" != ok* ]]; then
  echo "ensure-android-bitassets-command-server: health failed (${health:-no response}) dir=$ANDROID_COMMAND_DIR" >&2
  exit 1
fi

exit 0
