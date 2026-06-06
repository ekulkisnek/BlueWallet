#!/usr/bin/env bash
# Seed sendL1 on Android BTC command server, launch app, poll result.json for txid.
# Usage: send-android-btc-l1.sh <destination_address> <amount_sats> [wallet_id]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_ANDROID_BTC_SEND_LOG_DIR:-$LOG_ROOT/android-btc-send-$STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
DESTINATION="${1:?destination address required}"
AMOUNT_SATS="${2:?amount sats required}"
WALLET_ID="${3:-${REDWALLET_ANDROID_BTC_WALLET_ID:-}}"
POLL_SECONDS="${REDWALLET_ANDROID_BTC_SEND_POLL_SECONDS:-180}"
MONITOR_SECONDS="${REDWALLET_ANDROID_MONITOR_SECONDS:-120}"
FEE_RATE="${L1_E2E_FEE_RATE:-1}"
BROADCAST_URL="${REDWALLET_L1_BROADCAST_URL:-}"
CORE_RPC_URL="${REDWALLET_L1_CORE_RPC_URL:-}"
UTXOS_JSON="${REDWALLET_L1_UTXOS_JSON:-}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-android-btc-send"
export ANDROID_SERIAL REDWALLET_ANDROID_PACKAGE="$ANDROID_PACKAGE"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/send.log"
}

resolve_command_dir() {
  local cmd_dir="${REDWALLET_ANDROID_BTC_COMMAND_DIR:-}"
  if [[ -z "$cmd_dir" ]]; then
    cmd_dir="$(readlink "${LOG_ROOT%/}/current-android-btc-command-server" 2>/dev/null || true)"
  fi
  if [[ -z "$cmd_dir" || ! -d "$cmd_dir" ]]; then
    cmd_dir="${LOG_ROOT%/}/android-btc-command-server"
    mkdir -p "$cmd_dir"
  fi
  printf '%s' "$cmd_dir"
}

android_push_app_file() {
  local local_file="$1"
  local dest_name="$2"
  adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE mkdir -p files" >>"$RUN_DIR/push-app-file.log" 2>&1 || true
  if adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE tee files/${dest_name}" <"$local_file" >>"$RUN_DIR/push-app-file.log" 2>&1; then
    log "PUSHED $dest_name via run-as tee"
    return 0
  fi
  log "WARN push $dest_name failed (see push-app-file.log)"
  return 1
}

setup_android_usb_reverse() {
  adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:60101 tcp:60101 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6123 tcp:6123 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6125 tcp:6125 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6126 tcp:6126 >/dev/null 2>&1 || true
  log "adb reverse 8081/60101/6123/6125/6126"
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL dest=$DESTINATION sats=$AMOUNT_SATS"

if ! adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
  log "BLOCKER android_not_ready"
  exit 2
fi

metro_status="$(curl -sS -m 5 http://127.0.0.1:8081/status 2>/dev/null || true)"
if [[ "$metro_status" != *packager-status:running* ]]; then
  log "BLOCKER metro_not_running (need npm start on :8081)"
  exit 2
fi

bash "$ROOT_DIR/scripts/ensure-android-btc-command-server.sh" >>"$RUN_DIR/ensure-server.log" 2>&1
setup_android_usb_reverse

CMD_DIR="$(resolve_command_dir)"
export REDWALLET_ANDROID_BTC_COMMAND_DIR="$CMD_DIR"
rm -f "$CMD_DIR/result.json"
command_id="android-btc-send-${STAMP}"
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

log "warm_launch wallet load wait"
adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true
sleep "${REDWALLET_ANDROID_BTC_SEND_WARMUP_SEC:-25}"

cat >"$CMD_DIR/command.json" <<EOF
{"operation":"sendL1","commandId":"${command_id}","address":"${DESTINATION}","amountSats":${AMOUNT_SATS},"feeRate":${FEE_RATE}${wallet_id_json}${fallback_json}}
EOF
log "SEEDED command.json dir=$CMD_DIR"

android_push_app_file "$CMD_DIR/command.json" "redwallet-btc-selftest-command.json" || true
rm -f "$CMD_DIR/command.json" 2>/dev/null || true

set +e
REDWALLET_ANDROID_MONITOR_NO_RESTART=1 \
  "$ROOT_DIR/scripts/monitor-redwallet-android-real-device.sh" "$ANDROID_PACKAGE" "$MONITOR_SECONDS" "$ANDROID_SERIAL" >>"$RUN_DIR/monitor.log" 2>&1
set -e

result_path="$CMD_DIR/result.json"
txid=""
result_failed=0
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  if [[ -f "$result_path" ]]; then
    set +e
    python3 - <<'PY' "$result_path"
import json, sys
p = sys.argv[1]
with open(p) as f:
    r = json.load(f)
ok = r.get("ok") is True
txid = (r.get("txid") or "").strip()
err = (r.get("error") or "").strip()
if ok and len(txid) == 64:
    sys.exit(0)
if err and err != "wallet_not_ready":
    sys.exit(2)
sys.exit(1)
PY
    status=$?
    set -e
    if [[ "$status" -eq 0 ]]; then
      txid="$(python3 - <<PY
import json
with open("$result_path") as f:
    r = json.load(f)
print(r.get("txid", "").strip())
PY
)"
      break
    fi
    if [[ "$status" -eq 2 ]]; then
      result_failed=1
      break
    fi
  fi
  sleep 2
done

if [[ -z "$txid" ]]; then
  if [[ "$result_failed" -eq 1 ]]; then
    log "BLOCKER Android L1 send failed"
  else
    log "BLOCKER no Android L1 send txid (result.json missing or failed)"
  fi
  if [[ -f "$result_path" ]]; then
    cat "$result_path" >>"$RUN_DIR/send.log"
  fi
  exit 2
fi

log "OK txid=$txid"
echo "$txid" >"$RUN_DIR/android-l1-send-txid.txt"
echo "export ANDROID_L1_SEND_TXID='$txid'" >"$RUN_DIR/android-l1-send.env"
cat "$RUN_DIR/android-l1-send.env"
exit 0
