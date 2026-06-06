#!/usr/bin/env bash
# Seed createWallet for BitAssets on an iOS simulator via simctl Documents push.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_SIM_BITASSETS_SEED_LOG_DIR:-$LOG_ROOT/ios-sim-bitassets-seed-$STAMP}"
IOS_SIM_UDID="${DETOX_IOS_SIM_UDID:-${REDWALLET_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}}"
BUNDLE_ID="${REDWALLET_IOS_SIM_BUNDLE_ID:-com.layertwolabs.bluewallet}"
POLL_SECONDS="${REDWALLET_IOS_BITASSETS_SEED_POLL_SECONDS:-180}"
RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"
QUIC_URL="${BITASSETS_LITE_WALLET_QUIC_URL:-}"
SIM_APP_LAUNCHED=0

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-sim-bitassets-seed"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/seed.log"
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
  log "PUSHED createWallet command to sim Documents"
}

sim_launch_app() {
  xcrun simctl boot "$IOS_SIM_UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$IOS_SIM_UDID" -b >/dev/null 2>&1 || true
  if [[ "$SIM_APP_LAUNCHED" == 1 ]]; then
    return 0
  fi
  xcrun simctl terminate "$IOS_SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local launch_args=()
  if [[ "${REDWALLET_IOS_SIM_USE_EMBEDDED_BUNDLE:-1}" == 1 ]]; then
    launch_args+=(REDWALLET_USE_EMBEDDED_BUNDLE)
  fi
  xcrun simctl launch "$IOS_SIM_UDID" "$BUNDLE_ID" "${launch_args[@]+"${launch_args[@]}"}" >>"$RUN_DIR/launch.log" 2>&1 || true
  SIM_APP_LAUNCHED=1
}

log "START run_dir=$RUN_DIR udid=$IOS_SIM_UDID bundle=$BUNDLE_ID rpc=$RPC_URL"

container="$(sim_container)"
if [[ -n "$container" && -d "$container/Documents" ]]; then
  rm -f "$container/Documents/redwallet-bitassets-selftest-result.json" 2>/dev/null || true
fi

command_id="ios-sim-bitassets-create-${STAMP}"
label="${REDWALLET_IOS_BITASSETS_WALLET_LABEL:-iOS BitAssets sim ${STAMP}}"
command_file="$RUN_DIR/command.json"
python3 - <<PY >"$command_file"
import json
command = {
    "operation": "createWallet",
    "commandId": "$command_id",
    "label": "$label",
    "rpcUrl": "$RPC_URL",
    "skipSync": True,
}
if "$QUIC_URL":
    command["bitassetsLiteWalletQuicUrl"] = "$QUIC_URL"
print(json.dumps(command))
PY
log "SEEDED command.json file=$command_file"

sim_push_command "$command_file" || true
sim_launch_app
sleep "${REDWALLET_IOS_SIM_BITASSETS_SEED_WARMUP_SEC:-8}"
sim_push_command "$command_file" || true
sim_launch_app

address=""
wallet_id=""
result_file="$RUN_DIR/result.json"
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  container="$(sim_container)"
  doc_result_file="${container:+$container/Documents/redwallet-bitassets-selftest-result.json}"
  if [[ -n "$doc_result_file" && -f "$doc_result_file" ]]; then
    cp "$doc_result_file" "$result_file" 2>/dev/null || true
    if python3 - <<'PY' "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
sys.exit(0 if r.get("ok") is True and (r.get("address") or "").strip() else 1)
PY
    then
      address="$(python3 - <<'PY' "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print((r.get("address") or "").strip())
PY
)"
      wallet_id="$(python3 - <<'PY' "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print((r.get("walletID") or "").strip())
PY
)"
      break
    fi
  fi
  sleep 2
  sim_push_command "$command_file" || true
done

if [[ -z "$address" ]]; then
  log "BLOCKER no iOS sim BitAssets address"
  [[ -f "$result_file" ]] && cat "$result_file" >>"$RUN_DIR/seed.log"
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
echo "$address" >"$RUN_DIR/ios-bitassets-address.txt"
{
  echo "export IOS_BITASSETS_ADDRESS='$address'"
  echo "export REDWALLET_IOS_BITASSETS_WALLET_ID='$wallet_id'"
} >"$RUN_DIR/ios-bitassets-wallet.env"
cat "$RUN_DIR/ios-bitassets-wallet.env"
