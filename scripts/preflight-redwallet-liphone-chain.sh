#!/usr/bin/env bash
# LiPhone-only chain preflight: fail fast before CHAIN_WAIT polls burn minutes.
# Exit 0 when safe to run redwallet-phone-chain-reserve-register.sh; exit 2 + BLOCKER.txt on failure.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/preflight-liphone-${STAMP}"
LIPHONE_UDID="${REDWALLET_LIPHONE_UDID:-00008020-0011204911F3002E}"
LIPHONE_HOST="${REDWALLET_LIPHONE_HOST:-192.168.1.149}"
IPHONE12_UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
MAC_RPC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"

mkdir -p "$RUN_DIR/probes"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-preflight-liphone"

export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-$LIPHONE_UDID}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-$LIPHONE_HOST}"
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
  ln -sfn "$RUN_DIR/preflight.env" "${LOG_ROOT%/}/current-preflight-liphone.env"
}

device_line() {
  local udid="$1"
  xcrun devicectl list devices --columns '*' 2>/dev/null | awk -v u="$udid" '$0 ~ u { print $0 }'
}

device_connected() {
  local line="$1"
  [[ "$line" == *connected* || "$line" == *"available (paired)"* || "$line" == *connecting* ]]
}

log "START run_dir=$RUN_DIR udid=$REDWALLET_FORCE_LAUNCH_UDID host=$REDWALLET_FORCE_PHONE_HOST rpc=$BITASSETS_RPC_URL"

if [[ "$REDWALLET_FORCE_LAUNCH_UDID" != "$LIPHONE_UDID" ]]; then
  blocker wrong_udid \
    "Set REDWALLET_FORCE_LAUNCH_UDID=$LIPHONE_UDID (LiPhone XS only in scope)"
fi

liphone_line="$(device_line "$LIPHONE_UDID" || true)"
iphone12_line="$(device_line "$IPHONE12_UDID" || true)"
probe devicectl xcrun devicectl list devices --columns '*'

if [[ -z "$liphone_line" ]]; then
  blocker liphone_not_listed \
    "Plug LiPhone XS USB; trust Mac; unlock screen" \
    "Re-run: scripts/preflight-redwallet-liphone-chain.sh"
fi
if [[ "$liphone_line" == *unavailable* ]]; then
  blocker liphone_unavailable \
    "LiPhone unavailable: $liphone_line" \
    "Re-seat USB cable; unlock phone; wait for CoreDevice"
fi
if ! device_connected "$liphone_line"; then
  blocker liphone_not_connected \
    "LiPhone not connected: $liphone_line" \
    "Unlock LiPhone; keep RedWallet reachable"
fi

if [[ -n "$iphone12_line" ]] && device_connected "$iphone12_line"; then
  blocker multi_phone_connected \
    "Unplug iPhone 12 mini ($IPHONE12_UDID) — one phone during chain" \
    "Only LiPhone $LIPHONE_UDID should be connected"
fi

cd "$ROOT_DIR"
probe signet-endpoints bash -c "cd '$ROOT_DIR' && scripts/redwallet-signet-endpoints.sh" || true
ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$RUN_DIR/redwallet-signet.env"
fi

if ! probe ensure-bitassets-rpc perl -e 'alarm 35; exec @ARGV' bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh"; then
  blocker bitassets_rpc_down \
    "Colima/bitassets RPC not responding on $MAC_RPC" \
    "Run: cd drivechain-wallet-dev/local-dev && docker compose -f docker-compose.local-minimal.yml up -d bitassets" \
    "Or: scripts/redwallet-colima-bitassets-recover.sh"
fi
if ! grep -q '"result"' "$RUN_DIR/probes/ensure-bitassets-rpc.txt" 2>/dev/null; then
  blocker bitassets_rpc_no_result \
    "JSON-RPC getblockcount missing result (see probes/ensure-bitassets-rpc.txt)" \
    "Restart bitassets container; confirm Mac LAN $MAC_RPC"
fi

if ! probe support-services bash -c "cd '$ROOT_DIR' && scripts/start-redwallet-real-device-support.sh"; then
  blocker support_services_down \
    "Metro/collector/command-server not all up" \
    "Run: scripts/start-redwallet-real-device-support.sh (each missing service in its own terminal)"
fi

USB_TUNNEL_MAC="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" "$REDWALLET_FORCE_LAUNCH_UDID" 2>/dev/null || true)"
if [[ -z "$USB_TUNNEL_MAC" ]]; then
  blocker usb_tunnel_missing \
    "No Core Device USB tunnel for $REDWALLET_FORCE_LAUNCH_UDID" \
    "Re-seat USB; unlock LiPhone; wait 30s for devicectl tunnelIPAddress" \
    "Check: xcrun devicectl device info details --device $REDWALLET_FORCE_LAUNCH_UDID | rg tunnelIPAddress"
else
  log "USB_TUNNEL_MAC=$USB_TUNNEL_MAC"
  echo "$USB_TUNNEL_MAC" >"$RUN_DIR/usb-tunnel-mac.txt"
  set +e
  curl -g -sS -m 5 "http://[${USB_TUNNEL_MAC}]:6123/health" >"$RUN_DIR/probes/collector-health-usb.txt" 2>&1
  usb_rc=$?
  set -e
  log "PROBE collector-health-usb exit=$usb_rc"
  lan_collector_ok=0
  if probe collector-health-lan curl -sS -m 5 http://192.168.1.50:6123/health &&
    grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-lan.txt" 2>/dev/null; then
    lan_collector_ok=1
  fi
  if [[ "$usb_rc" -eq 28 ]]; then
    if [[ "$lan_collector_ok" -eq 1 ]]; then
      log "USB_TUNNEL_WARN curl_28 Mac self-probe tunnel=$USB_TUNNEL_MAC (LAN collector ok; phone may use Wi-Fi)"
    else
      blocker usb_collector_timeout \
        "USB collector health timed out (curl 28) tunnel=$USB_TUNNEL_MAC and LAN collector down" \
        "Run: scripts/ensure-redwallet-ios-device-servers.sh" \
        "Re-seat USB; confirm LiPhone unlocked"
    fi
  elif ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-usb.txt" 2>/dev/null; then
    if [[ "$lan_collector_ok" -eq 0 ]]; then
      blocker usb_collector_unhealthy \
        "USB collector not ok at [$USB_TUNNEL_MAC]:6123/health and LAN collector down" \
        "Run: scripts/ensure-redwallet-ios-device-servers.sh"
    else
      log "USB_TUNNEL_WARN unhealthy Mac self-probe (LAN collector ok)"
    fi
  fi
  probe command-health-usb curl -g -sS -m 5 "http://[${USB_TUNNEL_MAC}]:6124/health" || true
fi

if [[ ! -f "$RUN_DIR/probes/collector-health-lan.txt" ]]; then
  probe collector-health-lan curl -sS -m 5 http://192.168.1.50:6123/health
fi
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-lan.txt" 2>/dev/null; then
  blocker lan_collector_down \
    "LAN collector not ok at http://192.168.1.50:6123/health" \
    "Run: node scripts/redwallet-log-collector-server.js (bind ::)"
fi

probe command-health-lan curl -sS -m 5 http://192.168.1.50:6124/health
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health-lan.txt" 2>/dev/null; then
  cmd_dir="$(ls -td "$LOG_ROOT"/ios-real-device-selftest-*/command-server 2>/dev/null | head -1 || true)"
  if [[ -z "$cmd_dir" || ! -f "$cmd_dir/command.json" ]]; then
    blocker lan_command_down \
      "LAN command server not ok at http://192.168.1.50:6124/health" \
      "Run: BITASSETS_RPC_URL='$MAC_RPC' node scripts/redwallet-bitassets-command-server.js"
  fi
fi

probe bitassets-rpc-lan curl -sS -m 5 -X POST "${MAC_RPC%/}/" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}'
if ! grep -q '"result"' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null; then
  blocker mac_rpc_unreachable \
    "Mac BitAssets RPC probe failed at $MAC_RPC" \
    "Do NOT point BITASSETS_RPC_URL at phone IP ($REDWALLET_FORCE_PHONE_HOST:6004)"
fi

write_env
log "PREFLIGHT_OK udid=$REDWALLET_FORCE_LAUNCH_UDID usb=$USB_TUNNEL_MAC rpc=$BITASSETS_RPC_URL"
echo "status=ok" >"$RUN_DIR/RESULT.txt"
echo "env_file=$RUN_DIR/preflight.env"
echo "run_dir=$RUN_DIR"
exit 0
