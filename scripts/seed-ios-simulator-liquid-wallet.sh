#!/usr/bin/env bash
# Seed createWallet for Liquid on an iOS simulator via simctl Documents push.
set -euo pipefail

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_SIM_LIQUID_SEED_LOG_DIR:-$LOG_ROOT/ios-sim-liquid-seed-$STAMP}"
IOS_SIM_UDID="${DETOX_IOS_SIM_UDID:-${REDWALLET_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}}"
BUNDLE_ID="${REDWALLET_IOS_SIM_BUNDLE_ID:-com.layertwolabs.bluewallet}"
POLL_SECONDS="${REDWALLET_IOS_LIQUID_SEED_POLL_SECONDS:-180}"
RPC_URL="${LIQUID_RPC_URL:-}"
ELECTRUM_URL="${LIQUID_ELECTRUM_URL:-tcp://127.0.0.1:60401}"
SKIP_SYNC="${REDWALLET_IOS_LIQUID_SKIP_SYNC:-1}"
SIM_APP_LAUNCHED=0

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-sim-liquid-seed"

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
  rm -f "$container/Documents/redwallet-liquid-selftest-command.json" 2>/dev/null || true
  cp "$local_file" "$container/Documents/redwallet-liquid-selftest-command.json"
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

log "START run_dir=$RUN_DIR udid=$IOS_SIM_UDID rpc=$RPC_URL"

container="$(sim_container)"
if [[ -n "$container" && -d "$container/Documents" ]]; then
  rm -f "$container/Documents/redwallet-liquid-selftest-result.json" 2>/dev/null || true
fi

command_id="ios-sim-liquid-create-${STAMP}"
label="${REDWALLET_IOS_LIQUID_WALLET_LABEL:-iOS Liquid sim ${STAMP}}"
command_file="$RUN_DIR/command.json"
python3 - <<PY >"$command_file"
import json
print(json.dumps({
    "operation": "createWallet",
    "commandId": "$command_id",
    "label": "$label",
    "rpcUrl": "$RPC_URL",
    "electrumUrl": "$ELECTRUM_URL",
    "walletMode": "lwk",
    "skipSync": "$SKIP_SYNC" == "1",
}))
PY

sim_push_command "$command_file" || true
sim_launch_app

address=""
wallet_id=""
result_file="$RUN_DIR/result.json"
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  container="$(sim_container)"
  doc_result_file="${container:+$container/Documents/redwallet-liquid-selftest-result.json}"
  if [[ -n "$doc_result_file" && -f "$doc_result_file" ]]; then
    cp "$doc_result_file" "$result_file" 2>/dev/null || true
    if python3 - <<'PY' "$doc_result_file" "$command_id"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
sys.exit(0 if r.get("ok") is True and r.get("commandId") == sys.argv[2] and (r.get("address") or "").strip() else 1)
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
done

if [[ -z "$address" ]]; then
  log "BLOCKER no iOS sim Liquid address"
  [[ -f "$result_file" ]] && cat "$result_file" >>"$RUN_DIR/seed.log"
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
{
  echo "export IOS_LIQUID_ADDRESS='$address'"
  echo "export REDWALLET_IOS_LIQUID_WALLET_ID='$wallet_id'"
} >"$RUN_DIR/ios-liquid-wallet.env"
cat "$RUN_DIR/ios-liquid-wallet.env"
