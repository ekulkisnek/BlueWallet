#!/usr/bin/env bash
# Push a BitAssets selftest command to an iOS simulator and poll for the txid.
# Usage:
#   send-ios-simulator-bitassets-command.sh reserve <name> [wallet_id]
#   send-ios-simulator-bitassets-command.sh register <name> <initial_supply> [wallet_id]
#   send-ios-simulator-bitassets-command.sh transfer <destination_address> <asset_id> <amount> [wallet_id]
#   send-ios-simulator-bitassets-command.sh sync [wallet_id]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_SIM_BITASSETS_COMMAND_LOG_DIR:-$LOG_ROOT/ios-sim-bitassets-command-$STAMP}"
IOS_SIM_UDID="${DETOX_IOS_SIM_UDID:-${REDWALLET_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}}"
BUNDLE_ID="${REDWALLET_IOS_SIM_BUNDLE_ID:-com.layertwolabs.bluewallet}"
OPERATION="${1:?operation required}"
POLL_SECONDS="${REDWALLET_IOS_BITASSETS_COMMAND_POLL_SECONDS:-240}"
RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"
QUIC_URL="${BITASSETS_LITE_WALLET_QUIC_URL:-}"
SIM_APP_LAUNCHED=0
NAME=""
INITIAL_SUPPLY=""
DESTINATION=""
ASSET_ID=""
AMOUNT=""
WALLET_ID="${REDWALLET_IOS_BITASSETS_WALLET_ID:-}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-sim-bitassets-command"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/command.log"
}

sim_container() {
  xcrun simctl get_app_container "$IOS_SIM_UDID" "$BUNDLE_ID" data 2>>"$RUN_DIR/push-app-file.log" || true
}

sim_push_command() {
  local local_file="$1"
  local container
  container="$(sim_container)"
  if [[ -z "$container" || ! -d "$container" ]]; then
    log "WARN get_app_container failed udid=$IOS_SIM_UDID bundle=$BUNDLE_ID"
    return 1
  fi
  mkdir -p "$container/Documents"
  rm -f "$container/Documents/redwallet-bitassets-selftest-command.json" 2>/dev/null || true
  cp "$local_file" "$container/Documents/redwallet-bitassets-selftest-command.json"
  log "PUSHED operation=$OPERATION command to sim Documents"
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
  SIM_APP_LAUNCHED=1
}

wallet_id_arg=""
case "$OPERATION" in
  reserve)
    NAME="${2:?name required}"
    WALLET_ID="${3:-$WALLET_ID}"
    ;;
  register)
    NAME="${2:?name required}"
    INITIAL_SUPPLY="${3:?initial supply required}"
    WALLET_ID="${4:-$WALLET_ID}"
    ;;
  transfer)
    DESTINATION="${2:?destination address required}"
    ASSET_ID="${3:?asset id required}"
    AMOUNT="${4:?amount required}"
    WALLET_ID="${5:-$WALLET_ID}"
    ;;
  sync)
    WALLET_ID="${2:-$WALLET_ID}"
    ;;
  *)
    echo "Unsupported operation: $OPERATION" >&2
    exit 2
    ;;
esac

[[ -n "${WALLET_ID:-}" ]] && wallet_id_arg="$WALLET_ID"

command_id="ios-sim-bitassets-${OPERATION}-${STAMP}"
command_file="$RUN_DIR/command.json"
python3 - <<PY >"$command_file"
import json
op = "$OPERATION"
command = {
    "operation": op,
    "commandId": "$command_id",
    "rpcUrl": "$RPC_URL",
    "feeSats": 0,
}
if "$QUIC_URL":
    command["bitassetsLiteWalletQuicUrl"] = "$QUIC_URL"
if "$wallet_id_arg":
    command["walletID"] = "$wallet_id_arg"
if op == "reserve":
    command["name"] = "$NAME"
elif op == "register":
    command["name"] = "$NAME"
    command["initialSupply"] = int("$INITIAL_SUPPLY")
    command["bitassetData"] = {}
elif op == "transfer":
    command["destinationAddress"] = "$DESTINATION"
    command["assetId"] = "$ASSET_ID"
    command["amount"] = int("$AMOUNT")
print(json.dumps(command))
PY

log "START run_dir=$RUN_DIR udid=$IOS_SIM_UDID operation=$OPERATION"
container="$(sim_container)"
if [[ -n "$container" && -d "$container/Documents" ]]; then
  rm -f "$container/Documents/redwallet-bitassets-selftest-result.json" 2>/dev/null || true
fi

sim_push_command "$command_file" || true
sim_launch_app
sleep "${REDWALLET_IOS_SIM_BITASSETS_COMMAND_WARMUP_SEC:-4}"
sim_launch_app

result_file="$RUN_DIR/result.json"
txid=""
matched_result=0
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  container="$(sim_container)"
  doc_result_file="${container:+$container/Documents/redwallet-bitassets-selftest-result.json}"
  if [[ -n "$doc_result_file" && -f "$doc_result_file" ]]; then
    cp "$doc_result_file" "$result_file" 2>/dev/null || true
    if python3 - <<'PY' "$doc_result_file" "$OPERATION" "$command_id"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
expected = sys.argv[2]
expected_command_id = sys.argv[3]
op = r.get("operation")
ok = r.get("ok") is True
txid = (r.get("txid") or "").strip()
if r.get("commandId") != expected_command_id:
    sys.exit(1)
if expected == "sync":
    sys.exit(0 if ok and op == "sync" else 1)
sys.exit(0 if ok and op in (expected, "register") and len(txid) == 64 else 1)
PY
    then
      txid="$(python3 - <<'PY' "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print((r.get("txid") or "").strip())
PY
)"
      matched_result=1
      break
    fi
  fi
  sleep 2
done

if [[ "$matched_result" != 1 ]]; then
  log "BLOCKER no matching BitAssets result for operation=$OPERATION command_id=$command_id"
  [[ -f "$result_file" ]] && cat "$result_file" >>"$RUN_DIR/command.log"
  exit 2
fi

log "OK operation=$OPERATION txid=${txid:-}"
[[ -n "$txid" ]] && echo "$txid" >"$RUN_DIR/ios-bitassets-${OPERATION}-txid.txt"
op_upper="$(printf '%s' "$OPERATION" | tr '[:lower:]' '[:upper:]')"
echo "export IOS_BITASSETS_${op_upper}_TXID='$txid'" >"$RUN_DIR/ios-bitassets-${OPERATION}.env"
cat "$RUN_DIR/ios-bitassets-${OPERATION}.env"
