#!/usr/bin/env bash
# Seed sendL1 on iOS BTC command server, push via devicectl, launch app, poll result.json for txid.
# Usage: send-ios-btc-l1.sh <destination_address> <amount_sats> [wallet_id]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_BTC_SEND_LOG_DIR:-$LOG_ROOT/ios-btc-send-$STAMP}"
IOS_UDID="${REDWALLET_IOS_UDID:-${REDWALLET_FORCE_LAUNCH_UDID:-00008020-0011204911F3002E}}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"
DESTINATION="${1:?destination address required}"
AMOUNT_SATS="${2:?amount sats required}"
WALLET_ID="${3:-${REDWALLET_IOS_BTC_WALLET_ID:-}}"
POLL_SECONDS="${REDWALLET_IOS_BTC_SEND_POLL_SECONDS:-180}"
MONITOR_SECONDS="${REDWALLET_IOS_MONITOR_SECONDS:-120}"
FEE_RATE="${L1_E2E_FEE_RATE:-1}"
BROADCAST_URL="${REDWALLET_L1_BROADCAST_URL:-}"
CORE_RPC_URL="${REDWALLET_L1_CORE_RPC_URL:-}"
UTXOS_JSON="${REDWALLET_L1_UTXOS_JSON:-}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-btc-send"
export REDWALLET_FORCE_LAUNCH_UDID="$IOS_UDID"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/send.log"
}

resolve_command_dir() {
  local cmd_dir="${REDWALLET_IOS_BTC_COMMAND_DIR:-}"
  if [[ -z "$cmd_dir" ]]; then
    cmd_dir="$(readlink "${LOG_ROOT%/}/current-ios-btc-command-server" 2>/dev/null || true)"
  fi
  if [[ -z "$cmd_dir" || ! -d "$cmd_dir" ]]; then
    cmd_dir="${LOG_ROOT%/}/ios-btc-command-server"
    mkdir -p "$cmd_dir"
  fi
  printf '%s' "$cmd_dir"
}

push_usb_tunnel_host_file() {
  local usb_host
  usb_host="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" "$IOS_UDID" 2>/dev/null || true)"
  [[ -n "$usb_host" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$usb_host" >"$tmp"
  perl -e 'alarm 15; exec @ARGV' 15 xcrun devicectl device copy to \
    --device "$IOS_UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "$tmp" \
    --destination "Documents/redwallet-usb-tunnel-host.txt" >>"$RUN_DIR/push-usb-tunnel.log" 2>&1 || true
  rm -f "$tmp"
}

ios_push_btc_command() {
  local local_file="$1"
  local tmp
  tmp="$(mktemp)"
  cp "$local_file" "$tmp"
  if perl -e 'alarm 20; exec @ARGV' 20 xcrun devicectl device copy to \
    --device "$IOS_UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "$tmp" \
    --destination "Documents/redwallet-btc-selftest-command.json" >>"$RUN_DIR/push-app-file.log" 2>&1; then
    log "PUSHED redwallet-btc-selftest-command.json via devicectl"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  log "WARN push btc command failed (see push-app-file.log)"
  return 1
}

log "START run_dir=$RUN_DIR udid=$IOS_UDID dest=$DESTINATION sats=$AMOUNT_SATS"

metro_status="$(curl -sS -m 5 http://127.0.0.1:8081/status 2>/dev/null || true)"
if [[ "$metro_status" != *packager-status:running* ]]; then
  log "BLOCKER metro_not_running (need npm start on :8081)"
  exit 2
fi

bash "$ROOT_DIR/scripts/ensure-ios-btc-command-server.sh" >>"$RUN_DIR/ensure-server.log" 2>&1

CMD_DIR="$(resolve_command_dir)"
export REDWALLET_IOS_BTC_COMMAND_DIR="$CMD_DIR"
rm -f "$CMD_DIR/result.json"
command_id="ios-btc-send-${STAMP}"
wallet_id_json=""
if [[ -n "$WALLET_ID" ]]; then
  wallet_id_json=",\"walletID\":\"${WALLET_ID}\""
fi
fallback_json=""
if [[ -n "$BROADCAST_URL" ]]; then
  fallback_json="${fallback_json},\"broadcastUrl\":\"${BROADCAST_URL}\""
fi
if [[ -n "$CORE_RPC_URL" ]]; then
  fallback_json="${fallback_json},\"coreRpcUrl\":\"${CORE_RPC_URL}\""
fi
if [[ -n "$UTXOS_JSON" ]]; then
  fallback_json="${fallback_json},\"utxos\":${UTXOS_JSON}"
fi
cat >"$CMD_DIR/command.json" <<EOF
{"operation":"sendL1","commandId":"${command_id}","address":"${DESTINATION}","amountSats":${AMOUNT_SATS},"feeRate":${FEE_RATE}${wallet_id_json}${fallback_json}}
EOF
log "SEEDED command.json dir=$CMD_DIR"

set +e
REDWALLET_IOS_MONITOR_RUN_DIR="$RUN_DIR/monitor" \
  REDWALLET_MONITOR_TERMINATE_EXISTING=1 \
  REDWALLET_MONITOR_CONSOLE=1 \
  "$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" "$BUNDLE_ID" "$MONITOR_SECONDS" "$IOS_UDID" >>"$RUN_DIR/monitor.log" 2>&1 &
monitor_pid=$!
set -e

sleep "${REDWALLET_IOS_BTC_SEND_PRE_PUSH_WAIT_SEC:-8}"
push_usb_tunnel_host_file || true
ios_push_btc_command "$CMD_DIR/command.json" || true

result_path="$CMD_DIR/result.json"
txid=""
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  if [[ -f "$result_path" ]]; then
    cp "$result_path" "$RUN_DIR/result-latest.json" 2>/dev/null || true
    if python3 - <<'PY' "$result_path"
import json, sys
p = sys.argv[1]
with open(p) as f:
    r = json.load(f)
if r.get("operation") != "sendL1":
    sys.exit(1)
ok = r.get("ok") is True
txid = (r.get("txid") or "").strip()
sys.exit(0 if ok and len(txid) == 64 else 1)
PY
    then
      txid="$(python3 - <<PY
import json
with open("$result_path") as f:
    r = json.load(f)
print(r.get("txid", "").strip())
PY
)"
      break
    fi
  fi
  sleep 2
done

if kill -0 "$monitor_pid" >/dev/null 2>&1; then
  kill "$monitor_pid" >/dev/null 2>&1 || true
  wait "$monitor_pid" >/dev/null 2>&1 || true
fi

if [[ -z "$txid" ]]; then
  log "BLOCKER no iOS L1 send txid (result.json missing or failed)"
  if [[ -f "$RUN_DIR/result-latest.json" ]]; then
    cat "$RUN_DIR/result-latest.json" >>"$RUN_DIR/send.log"
  elif [[ -f "$result_path" ]]; then
    cat "$result_path" >>"$RUN_DIR/send.log"
  fi
  exit 2
fi

log "OK txid=$txid"
echo "$txid" >"$RUN_DIR/ios-l1-send-txid.txt"
echo "export IOS_L1_SEND_TXID='$txid'" >"$RUN_DIR/ios-l1-send.env"
cat "$RUN_DIR/ios-l1-send.env"
exit 0
