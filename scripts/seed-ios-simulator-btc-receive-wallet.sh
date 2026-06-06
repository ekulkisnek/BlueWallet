#!/usr/bin/env bash
# Seed createWallet on iOS simulator via simctl Documents push + command server poll.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_SIM_BTC_SEED_LOG_DIR:-$LOG_ROOT/ios-sim-btc-seed-$STAMP}"
IOS_SIM_UDID="${DETOX_IOS_SIM_UDID:-${REDWALLET_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}}"
BUNDLE_ID="${REDWALLET_IOS_SIM_BUNDLE_ID:-com.layertwolabs.bluewallet}"
POLL_SECONDS="${REDWALLET_IOS_BTC_SEED_POLL_SECONDS:-180}"
SIM_APP_LAUNCHED=0

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-sim-btc-seed"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/seed.log"
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
  log "PUSHED createWallet command to sim Documents"
  return 0
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

metro_reload_bundle() {
  curl -sS -m 5 -X POST "http://127.0.0.1:8081/reload" >/dev/null 2>&1 || true
}

log "START run_dir=$RUN_DIR udid=$IOS_SIM_UDID bundle=$BUNDLE_ID"

metro_status="$(curl -sS -m 5 http://127.0.0.1:8081/status 2>/dev/null || true)"
if [[ "$metro_status" != *packager-status:running* ]]; then
  log "BLOCKER metro_not_running (need npm start on :8081)"
  exit 2
fi

bash "$ROOT_DIR/scripts/ensure-ios-btc-command-server.sh" >>"$RUN_DIR/ensure-server.log" 2>&1

CMD_DIR="$(resolve_command_dir)"
export REDWALLET_IOS_BTC_COMMAND_DIR="$CMD_DIR"
rm -f "$CMD_DIR/result.json"
doc_container="$(xcrun simctl get_app_container "$IOS_SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)"
if [[ -n "$doc_container" && -d "$doc_container/Documents" ]]; then
  rm -f "$doc_container/Documents/redwallet-btc-selftest-result.json" 2>/dev/null || true
fi
command_id="ios-sim-btc-receive-${STAMP}"
label="${REDWALLET_IOS_BTC_WALLET_LABEL:-iOS L1 sim receive ${STAMP}}"
cat >"$CMD_DIR/command.json" <<EOF
{"operation":"createWallet","commandId":"${command_id}","label":"${label}"}
EOF
log "SEEDED command.json dir=$CMD_DIR"

metro_reload_bundle
sim_launch_app
sleep "${REDWALLET_IOS_SIM_SEED_WARMUP_SEC:-8}"
sim_push_btc_command "$CMD_DIR/command.json" || true
sim_launch_app

result_path="$CMD_DIR/result.json"
address=""
wallet_id=""
deadline=$(( $(date +%s) + POLL_SECONDS ))
read_sim_documents_result() {
  local doc_container doc_result_file
  doc_container="$(xcrun simctl get_app_container "$IOS_SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)"
  doc_result_file="${doc_container:+$doc_container/Documents/redwallet-btc-selftest-result.json}"
  [[ -n "$doc_result_file" && -f "$doc_result_file" ]] || return 1
  if ! python3 - <<'PY' "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
sys.exit(0 if r.get("ok") is True and (r.get("address") or "").strip() else 1)
PY
  then
    return 1
  fi
  address="$(python3 - <<PY "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print(r.get("address", "").strip())
PY
)"
  wallet_id="$(python3 - <<PY "$doc_result_file"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
print(r.get("walletID", "").strip())
PY
)"
  cp "$doc_result_file" "$result_path" 2>/dev/null || true
  log "OK address from sim Documents=$address"
  return 0
}
while [[ $(date +%s) -lt $deadline ]]; do
  if [[ -f "$result_path" ]]; then
    if python3 - <<'PY' "$result_path"
import json, sys
p = sys.argv[1]
with open(p) as f:
    r = json.load(f)
ok = r.get("ok") is True
addr = (r.get("address") or "").strip()
sys.exit(0 if ok and addr else 1)
PY
    then
      address="$(python3 - <<PY
import json
with open("$result_path") as f:
    r = json.load(f)
print(r.get("address", "").strip())
PY
)"
      wallet_id="$(python3 - <<PY
import json
with open("$result_path") as f:
    r = json.load(f)
print(r.get("walletID", "").strip())
PY
)"
      break
    fi
  fi
  if read_sim_documents_result; then
    break
  fi
  sleep 2
  sim_push_btc_command "$CMD_DIR/command.json" || true
  sim_launch_app >/dev/null 2>&1 || true
done

if [[ -z "$address" ]]; then
  log "BLOCKER no iOS sim L1 receive address (result.json missing or failed)"
  if [[ -f "$result_path" ]]; then
    cat "$result_path" >>"$RUN_DIR/seed.log"
  fi
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
echo "$address" >"$RUN_DIR/ios-l1-receive-address.txt"
echo "export IOS_L1_RECEIVE_ADDRESS='$address'" >"$RUN_DIR/ios-l1-receive.env"
echo "export L1_RECEIVE_ADDRESS='$address'" >>"$RUN_DIR/ios-l1-receive.env"
echo "export REDWALLET_IOS_BTC_WALLET_ID='$wallet_id'" >>"$RUN_DIR/ios-l1-receive.env"
cat "$RUN_DIR/ios-l1-receive.env"
exit 0
