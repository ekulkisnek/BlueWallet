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

LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.50}"
TS_HOST="$(command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true)"

health_loopback="$(curl -sS -m 3 http://127.0.0.1:6123/health 2>/dev/null || true)"
health_lan=""
health_tailscale=""
health_usb=""
if [[ -n "$LAN_HOST" ]]; then
  health_lan="$(curl -sS -m 3 "http://${LAN_HOST}:6123/health" 2>/dev/null || true)"
fi
if [[ -n "$TS_HOST" ]]; then
  health_tailscale="$(curl -sS -m 3 "http://${TS_HOST}:6123/health" 2>/dev/null || true)"
fi
if [[ -n "$USB_HOST" ]]; then
  health_usb="$(curl -g -sS -m 3 "http://[${USB_HOST}]:6123/health" 2>/dev/null || true)"
fi

command_health_loopback="$(curl -sS -m 3 http://127.0.0.1:6124/health 2>/dev/null || true)"
command_health_lan=""
if [[ -n "$LAN_HOST" ]]; then
  command_health_lan="$(curl -sS -m 3 "http://${LAN_HOST}:6124/health" 2>/dev/null || true)"
fi

printf 'usb_tunnel_mac=%s\n' "$USB_HOST"
printf 'collector_loopback=%s\n' "$health_loopback"
printf 'collector_lan_%s=%s\n' "$LAN_HOST" "$health_lan"
printf 'collector_tailscale_%s=%s\n' "${TS_HOST:-none}" "$health_tailscale"
printf 'collector_usb=%s\n' "$health_usb"
printf 'command_loopback=%s\n' "$command_health_loopback"
printf 'command_lan_%s=%s\n' "$LAN_HOST" "$command_health_lan"

lan_ok=0
if [[ "$health_lan" == ok* || "$health_lan" == *'"ok":true'* ]]; then
  lan_ok=1
fi
if [[ "$lan_ok" -eq 0 && ( "$health_loopback" != ok* && "$health_loopback" != *'"ok":true'* ) ]]; then
  echo "WARN collector not healthy on loopback or LAN; phones need ${LAN_HOST}:6123 reachable" >&2
  exit 1
fi
