#!/usr/bin/env bash
# Seed sendL1 on iOS simulator: push command.json via simctl get_app_container, launch app, poll result.json.
# Usage: send-ios-simulator-btc-l1.sh <destination_address> <amount_sats> [wallet_id]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_SIM_BTC_SEND_LOG_DIR:-$LOG_ROOT/ios-sim-btc-send-$STAMP}"
IOS_SIM_UDID="${DETOX_IOS_SIM_UDID:-${REDWALLET_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}}"
BUNDLE_ID="${REDWALLET_IOS_SIM_BUNDLE_ID:-com.layertwolabs.bluewallet}"
DESTINATION="${1:?destination address required}"
AMOUNT_SATS="${2:?amount sats required}"
WALLET_ID="${3:-${REDWALLET_IOS_BTC_WALLET_ID:-}}"
POLL_SECONDS="${REDWALLET_IOS_BTC_SEND_POLL_SECONDS:-180}"
FEE_RATE="${L1_E2E_FEE_RATE:-1}"
BROADCAST_URL="${REDWALLET_L1_BROADCAST_URL:-}"
CORE_RPC_URL="${REDWALLET_L1_CORE_RPC_URL:-}"
UTXOS_JSON="${REDWALLET_L1_UTXOS_JSON:-}"
SIM_APP_LAUNCHED=0

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-sim-btc-send"

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

sim_push_btc_command() {
  local local_file="$1"
  local container
  container="$(xcrun simctl get_app_container "$IOS_SIM_UDID" "$BUNDLE_ID" data 2>>"$RUN_DIR/push-app-file.log" || true)"
  if [[ -z "$container" || ! -d "$container" ]]; then
    log "WARN get_app_container failed udid=$IOS_SIM_UDID bundle=$BUNDLE_ID"
    return 1
  fi
  mkdir -p "$container/Documents"
  rm -f "$container/Documents/redwallet-btc-selftest-command.json" 2>/dev/null || true
  cp "$local_file" "$container/Documents/redwallet-btc-selftest-command.json"
  log "PUSHED redwallet-btc-selftest-command.json via simctl container=$container"
  return 0
}

sim_launch_app() {
  xcrun simctl boot "$IOS_SIM_UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$IOS_SIM_UDID" -b >/dev/null 2>&1 || true
  if [[ "$SIM_APP_LAUNCHED" == 1 ]]; then
    return 0
  fi
  local launch_args=()
  if [[ "${REDWALLET_IOS_SIM_USE_EMBEDDED_BUNDLE:-1}" == 1 ]]; then
    launch_args+=(REDWALLET_USE_EMBEDDED_BUNDLE)
  fi
  xcrun simctl launch "$IOS_SIM_UDID" "$BUNDLE_ID" "${launch_args[@]+"${launch_args[@]}"}" >>"$RUN_DIR/launch.log" 2>&1 || true
  log "sim_launch bundle=$BUNDLE_ID udid=$IOS_SIM_UDID"
  SIM_APP_LAUNCHED=1
}

log "START run_dir=$RUN_DIR udid=$IOS_SIM_UDID dest=$DESTINATION sats=$AMOUNT_SATS"

metro_status="$(curl -sS -m 5 http://127.0.0.1:8081/status 2>/dev/null || true)"
if [[ "$metro_status" != *packager-status:running* ]]; then
  log "BLOCKER metro_not_running (need npm start on :8081)"
  exit 2
fi

bash "$ROOT_DIR/scripts/ensure-ios-btc-command-server.sh" >>"$RUN_DIR/ensure-server.log" 2>&1

CMD_DIR="$(resolve_command_dir)"
export REDWALLET_IOS_BTC_COMMAND_DIR="$CMD_DIR"
rm -f "$CMD_DIR/result.json"
command_id="ios-sim-btc-send-${STAMP}"
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

sim_push_btc_command "$CMD_DIR/command.json" || true
# Simulator sends are driven by the Documents command file. Clear the shared
# HTTP command so the app cannot process the same send twice after local push.
rm -f "$CMD_DIR/command.json" 2>/dev/null || true
sim_launch_app
sleep "${REDWALLET_IOS_SIM_SEND_WARMUP_SEC:-8}"
sim_launch_app

result_path="$CMD_DIR/result.json"
txid=""
deadline=$(( $(date +%s) + POLL_SECONDS ))
read_sim_documents_send_result() {
  local doc_container doc_result_file
  doc_container="$(xcrun simctl get_app_container "$IOS_SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)"
  doc_result_file="${doc_container:+$doc_container/Documents/redwallet-btc-selftest-result.json}"
  [[ -n "$doc_result_file" && -f "$doc_result_file" ]] || return 1
  if ! python3 - <<'PY' "$doc_result_file" "$command_id"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
if r.get("operation") != "sendL1":
    sys.exit(1)
if r.get("commandId") != sys.argv[2]:
    sys.exit(1)
ok = r.get("ok") is True
txid = (r.get("txid") or "").strip()
sys.exit(0 if ok and len(txid) == 64 else 1)
PY
  then
    return 1
  fi
  txid="$(python3 - <<PY "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print(r.get("txid", "").strip())
PY
)"
  cp "$doc_result_file" "$result_path" 2>/dev/null || true
  cp "$doc_result_file" "$RUN_DIR/result-latest.json" 2>/dev/null || true
  log "OK txid from sim Documents=$txid"
  return 0
}
while [[ $(date +%s) -lt $deadline ]]; do
  if [[ -f "$result_path" ]]; then
    cp "$result_path" "$RUN_DIR/result-latest.json" 2>/dev/null || true
    if python3 - <<'PY' "$result_path" "$command_id"
import json, sys
p = sys.argv[1]
expected_command_id = sys.argv[2]
with open(p) as f:
    r = json.load(f)
if r.get("operation") != "sendL1":
    sys.exit(1)
if r.get("commandId") != expected_command_id:
    sys.exit(1)
ok = r.get("ok") is True
txid = (r.get("txid") or "").strip()
err = (r.get("error") or "").strip()
if ok and len(txid) == 64:
    sys.exit(0)
if err and err not in ("wallet_not_ready", ""):
    sys.exit(2)
sys.exit(1)
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
  if read_sim_documents_send_result; then
    break
  fi
  sleep 2
  # Nudge app to poll command file / HTTP server.
  sim_launch_app >/dev/null 2>&1 || true
done

if [[ -z "$txid" ]]; then
  log "BLOCKER no iOS sim L1 send txid (result.json missing or failed)"
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
