#!/usr/bin/env bash
# Android physical device chain preflight — fail fast before CHAIN_WAIT polls.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/preflight-android-${STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
MAC_RPC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"

mkdir -p "$RUN_DIR/probes"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-preflight-android"

export ANDROID_SERIAL
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
    echo "serial=$ANDROID_SERIAL"
    echo "package=$ANDROID_PACKAGE"
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
export ANDROID_SERIAL='$ANDROID_SERIAL'
export REDWALLET_ANDROID_SERIAL='$ANDROID_SERIAL'
export REDWALLET_BITASSETS_RPC_MAC='$REDWALLET_BITASSETS_RPC_MAC'
export BITASSETS_RPC_URL='$BITASSETS_RPC_URL'
EOF
  ln -sfn "$RUN_DIR/preflight.env" "${LOG_ROOT%/}/current-preflight-android.env"
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL rpc=$BITASSETS_RPC_URL"

if ! REDWALLET_PROBE_RUN_DIR="$RUN_DIR" bash "$ROOT_DIR/scripts/ensure-redwallet-android-adb-stable.sh"; then
  log "BLOCKER adb stable gate failed (see BLOCKER.txt)"
  echo "status=blocked" >"$RUN_DIR/RESULT.txt"
  echo "run_dir=$RUN_DIR"
  exit 2
fi

probe android-wifi-ip adb -s "$ANDROID_SERIAL" shell ip -4 route get 1.1.1.1
ANDROID_WIFI_IP="$(rg -o 'src ([0-9.]+)' "$RUN_DIR/probes/android-wifi-ip.txt" 2>/dev/null | head -1 | awk '{print $2}' || true)"
if [[ -n "$ANDROID_WIFI_IP" ]]; then
  log "ANDROID_WIFI_IP=$ANDROID_WIFI_IP"
  echo "$ANDROID_WIFI_IP" >"$RUN_DIR/android-wifi-ip.txt"
fi

cd "$ROOT_DIR"
ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  probe signet-endpoints perl -e 'alarm 90; exec @ARGV' bash -c "cd '$ROOT_DIR' && scripts/redwallet-signet-endpoints.sh" || true
  ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
else
  log "SKIP signet-endpoints (reuse $ENV_FILE)"
fi
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$RUN_DIR/redwallet-signet.env"
fi

if ! probe ensure-bitassets-rpc perl -e 'alarm 90; exec @ARGV' bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh"; then
  blocker bitassets_rpc_down \
    "BitAssets RPC not responding on $MAC_RPC" \
    "Run: scripts/ensure-bitassets-rpc-responsive.sh"
fi
if ! grep -qE '"result"|OK rpc=' "$RUN_DIR/probes/ensure-bitassets-rpc.txt" 2>/dev/null; then
  blocker bitassets_rpc_no_result \
    "JSON-RPC getblockcount missing result" \
    "Restart bitassets; confirm Mac LAN $MAC_RPC"
fi

if ! probe support-services bash -c "cd '$ROOT_DIR' && scripts/start-redwallet-real-device-support.sh"; then
  blocker support_services_down \
    "Metro/collector/command-server not all up" \
    "Run: scripts/start-redwallet-real-device-support.sh"
fi

if ! probe ensure-android-command-server bash "$ROOT_DIR/scripts/ensure-android-bitassets-command-server.sh"; then
  blocker android_command_server_down \
    "Android BitAssets command server failed to bind :6124" \
    "LiPhone must be standby (force-quit RedWallet) — see docs/FLEET_LANES.md" \
    "Run: scripts/ensure-android-bitassets-command-server.sh"
fi

probe collector-health-lan curl -sS -m 5 http://192.168.1.50:6123/health
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health-lan.txt" 2>/dev/null; then
  blocker lan_collector_down \
    "LAN collector not ok at http://192.168.1.50:6123/health" \
    "Run: node scripts/redwallet-log-collector-server.js"
fi

probe command-health-lan curl -sS -m 5 http://192.168.1.50:6124/health
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health-lan.txt" 2>/dev/null; then
  cmd_dir="$(readlink "${LOG_ROOT%/}/current-android-bitassets-command-server" 2>/dev/null || true)"
  [[ -z "$cmd_dir" ]] && cmd_dir="$(ls -td "$LOG_ROOT"/android-bitassets-command-server "$LOG_ROOT"/android-origin-retry-*/command-server "$LOG_ROOT"/android-real-device-*/command-server 2>/dev/null | head -1 || true)"
  if [[ -z "$cmd_dir" || ! -f "$cmd_dir/command.json" ]]; then
    blocker lan_command_down \
      "LAN command server not ok at http://192.168.1.50:6124/health" \
      "Run: scripts/ensure-android-bitassets-command-server.sh (LiPhone standby — docs/FLEET_LANES.md)"
  fi
fi

if ! grep -qE '"result"|OK rpc=' "$RUN_DIR/probes/ensure-bitassets-rpc.txt" 2>/dev/null; then
  probe bitassets-rpc-lan curl -sS -m 15 -X POST "${MAC_RPC%/}/" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}'
  if ! grep -q '"result"' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null; then
    blocker mac_rpc_unreachable \
      "Mac BitAssets RPC probe failed at $MAC_RPC" \
      "Physical device must use Mac LAN RPC — never 127.0.0.1 on device"
  fi
fi

probe metro-reverse adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081
probe metro-status curl -sS -m 5 http://127.0.0.1:8081/status

if ! REDWALLET_PROBE_RUN_DIR="$RUN_DIR" bash "$ROOT_DIR/scripts/prewarm-redwallet-android-metro.sh"; then
  log "BLOCKER metro prewarm failed (see BLOCKER.txt)"
  echo "status=blocked" >"$RUN_DIR/RESULT.txt"
  echo "run_dir=$RUN_DIR"
  exit 2
fi

write_env
log "PREFLIGHT_OK serial=$ANDROID_SERIAL wifi=${ANDROID_WIFI_IP:-unknown} rpc=$BITASSETS_RPC_URL"
echo "status=ok" >"$RUN_DIR/RESULT.txt"
echo "env_file=$RUN_DIR/preflight.env"
echo "run_dir=$RUN_DIR"
exit 0
