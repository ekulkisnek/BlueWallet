#!/usr/bin/env bash
# iPhone 12-only chain preflight (no LiPhone, no Docker restarts).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/preflight-iphone12-${STAMP}"
IPHONE12_UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
IPHONE12_HOST="${REDWALLET_IPHONE12_HOST:-192.168.1.50}"
LIPHONE_UDID="${REDWALLET_LIPHONE_UDID:-00008020-0011204911F3002E}"
MAC_RPC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"

mkdir -p "$RUN_DIR/probes"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-preflight-iphone12"

export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-$IPHONE12_UDID}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-$IPHONE12_HOST}"
export REDWALLET_BITASSETS_RPC_MAC="$MAC_RPC"
export BITASSETS_RPC_URL="$MAC_RPC"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/preflight.log"
}

blocker() {
  local code="$1"
  shift
  log "BLOCKER $code $*"
  {
    echo "blocker=$code"
    echo "udid=$REDWALLET_FORCE_LAUNCH_UDID"
    echo "host=$REDWALLET_FORCE_PHONE_HOST"
    echo "rpc=$BITASSETS_RPC_URL"
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

probe() {
  local name="$1"
  shift
  local out="$RUN_DIR/probes/${name}.txt"
  set +e
  "$@" >"$out" 2>&1
  local rc=$?
  set -e
  log "PROBE $name exit=$rc -> $out"
  return "$rc"
}

write_env() {
  cat >"$RUN_DIR/preflight.env" <<EOF
export REDWALLET_FORCE_LAUNCH_UDID='$REDWALLET_FORCE_LAUNCH_UDID'
export REDWALLET_FORCE_PHONE_HOST='$REDWALLET_FORCE_PHONE_HOST'
export REDWALLET_BITASSETS_RPC_MAC='$REDWALLET_BITASSETS_RPC_MAC'
export BITASSETS_RPC_URL='$BITASSETS_RPC_URL'
EOF
  ln -sfn "$RUN_DIR/preflight.env" "${LOG_ROOT%/}/current-preflight-iphone12.env"
}

iphone12_devicectl_line() {
  xcrun devicectl list devices 2>/dev/null | awk '/iPhone 12 mini/ { print $0; exit }'
}

device_connected() {
  local line="$1"
  [[ "$line" == *connected* || "$line" == *"available (paired)"* || "$line" == *connecting* ]]
}

liphone_line() {
  xcrun devicectl list devices 2>/dev/null | awk -v u="$LIPHONE_UDID" '$0 ~ u { print $0; exit }'
}

log "START run_dir=$RUN_DIR udid=$REDWALLET_FORCE_LAUNCH_UDID host=$REDWALLET_FORCE_PHONE_HOST rpc=$BITASSETS_RPC_URL"

if [[ "$REDWALLET_FORCE_LAUNCH_UDID" != "$IPHONE12_UDID" ]]; then
  blocker wrong_udid \
    "Set REDWALLET_FORCE_LAUNCH_UDID=$IPHONE12_UDID (iPhone 12 mini only in this lane)"
fi

iphone12_line="$(iphone12_devicectl_line || true)"
probe devicectl xcrun devicectl list devices

if [[ -z "$iphone12_line" ]]; then
  blocker iphone12_not_listed \
    "Plug iPhone 12 mini USB; trust Mac; unlock screen"
fi
if [[ "$iphone12_line" == *unavailable* ]]; then
  blocker iphone12_unavailable \
    "iPhone 12 unavailable: $iphone12_line" \
    "Re-seat USB; unlock phone; wait for CoreDevice connected"
fi
if ! device_connected "$iphone12_line"; then
  blocker iphone12_not_connected \
    "iPhone 12 not connected: $iphone12_line"
fi

lip_line="$(liphone_line || true)"
if [[ -n "$lip_line" ]] && device_connected "$lip_line"; then
  blocker multi_phone_connected \
    "Unplug LiPhone XS ($LIPHONE_UDID) — iPhone 12 lane only" \
    "Only iPhone 12 $IPHONE12_UDID should be connected"
fi

if ! probe support-services bash -c "cd '$ROOT_DIR' && scripts/start-redwallet-real-device-support.sh"; then
  blocker support_services_down \
    "Metro/collector/command-server not all up" \
    "Run: scripts/start-redwallet-real-device-support.sh"
fi

USB_TUNNEL_MAC="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" "$REDWALLET_FORCE_LAUNCH_UDID" 2>/dev/null || true)"
if [[ -z "$USB_TUNNEL_MAC" ]]; then
  blocker usb_tunnel_missing \
    "No Core Device USB tunnel for $REDWALLET_FORCE_LAUNCH_UDID" \
    "Re-seat USB; unlock iPhone 12"
else
  log "USB_TUNNEL_MAC=$USB_TUNNEL_MAC"
  echo "$USB_TUNNEL_MAC" >"$RUN_DIR/usb-tunnel-mac.txt"
  set +e
  curl -g -sS -m 5 "http://[${USB_TUNNEL_MAC}]:6123/health" >"$RUN_DIR/probes/collector-health-usb.txt" 2>&1
  usb_rc=$?
  set -e
  log "PROBE collector-health-usb exit=$usb_rc"
  lan_collector_ok=0
  if probe collector-health-lan curl -sS -m 5 "http://${IPHONE12_HOST}:6123/health" &&
    grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-lan.txt" 2>/dev/null; then
    lan_collector_ok=1
  fi
  if [[ "$usb_rc" -eq 28 && "$lan_collector_ok" -eq 0 ]]; then
    blocker usb_collector_timeout \
      "USB collector curl 28 and LAN collector down (tunnel=$USB_TUNNEL_MAC)"
  fi
fi

probe collector-health-lan curl -sS -m 5 "http://${IPHONE12_HOST}:6123/health"
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-lan.txt" 2>/dev/null; then
  blocker lan_collector_down \
    "LAN collector not ok at http://${IPHONE12_HOST}:6123/health"
fi

probe command-health-lan curl -sS -m 5 "http://${IPHONE12_HOST}:6124/health"
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health-lan.txt" 2>/dev/null; then
  cmd_dir="$(ls -td "$LOG_ROOT"/ios-real-device-selftest-*/command-server 2>/dev/null | head -1 || true)"
  if [[ -z "$cmd_dir" || ! -f "$cmd_dir/command.json" ]]; then
    blocker lan_command_down \
      "LAN command server not ok at http://${IPHONE12_HOST}:6124/health"
  fi
fi

probe bitassets-rpc-lan curl -sS -m 5 -X POST "${MAC_RPC%/}/" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}'
if ! grep -q '"result"' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null; then
  blocker mac_rpc_unreachable \
    "Mac BitAssets RPC probe failed at $MAC_RPC (Signet lane; no Docker from iPhone12 lane)"
fi

write_env
log "PREFLIGHT_OK udid=$REDWALLET_FORCE_LAUNCH_UDID usb=$USB_TUNNEL_MAC rpc=$BITASSETS_RPC_URL"
echo "status=ok" >"$RUN_DIR/RESULT.txt"
echo "env_file=$RUN_DIR/preflight.env"
echo "run_dir=$RUN_DIR"
exit 0
