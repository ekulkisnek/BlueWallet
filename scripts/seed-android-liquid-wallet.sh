#!/usr/bin/env bash
# Seed createWallet for Liquid on Android via app Documents command.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_ANDROID_LIQUID_SEED_LOG_DIR:-$LOG_ROOT/android-liquid-seed-$STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
POLL_SECONDS="${REDWALLET_ANDROID_LIQUID_SEED_POLL_SECONDS:-180}"
RPC_URL="${LIQUID_RPC_URL:-}"
ELECTRUM_URL="${LIQUID_ELECTRUM_URL:-tcp://127.0.0.1:60401}"
SKIP_SYNC="${REDWALLET_ANDROID_LIQUID_SKIP_SYNC:-1}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-android-liquid-seed"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/seed.log"
}

android_push_app_file() {
  local local_file="$1"
  local dest_name="$2"
  adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE mkdir -p files" >>"$RUN_DIR/push-app-file.log" 2>&1 || true
  if adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE tee files/${dest_name}" <"$local_file" >>"$RUN_DIR/push-app-file.log" 2>&1; then
    log "PUSHED $dest_name via run-as tee"
    return 0
  fi
  log "WARN push $dest_name failed"
  return 1
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL rpc=${RPC_URL:-embedded}"
if ! adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
  log "BLOCKER android_not_ready"
  exit 2
fi

adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
adb -s "$ANDROID_SERIAL" reverse tcp:60401 tcp:60401 >/dev/null 2>&1 || true

command_id="android-liquid-create-${STAMP}"
label="${REDWALLET_ANDROID_LIQUID_WALLET_LABEL:-Android Liquid ${STAMP}}"
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

adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE rm -f files/redwallet-liquid-selftest-result.json files/redwallet-liquid-selftest-command.json" >>"$RUN_DIR/push-app-file.log" 2>&1 || true
android_push_app_file "$command_file" "redwallet-liquid-selftest-command.json" || true
adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true

result_file="$RUN_DIR/result.json"
deadline=$(( $(date +%s) + POLL_SECONDS ))
address=""
wallet_id=""
while [[ $(date +%s) -lt $deadline ]]; do
  if adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE cat files/redwallet-liquid-selftest-result.json" >"$result_file.tmp" 2>>"$RUN_DIR/pull-result.log"; then
    mv "$result_file.tmp" "$result_file"
    if python3 - <<'PY' "$result_file" "$command_id"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
sys.exit(0 if r.get("ok") is True and r.get("commandId") == sys.argv[2] and (r.get("address") or "").strip() else 1)
PY
    then
      address="$(python3 - <<'PY' "$result_file"
import json, sys
with open(sys.argv[1]) as f:
    print((json.load(f).get("address") or "").strip())
PY
)"
      wallet_id="$(python3 - <<'PY' "$result_file"
import json, sys
with open(sys.argv[1]) as f:
    print((json.load(f).get("walletID") or "").strip())
PY
)"
      break
    fi
  fi
  android_push_app_file "$command_file" "redwallet-liquid-selftest-command.json" || true
  adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true
  sleep 2
done

if [[ -z "$address" ]]; then
  log "BLOCKER no Android Liquid address"
  [[ -f "$result_file" ]] && cat "$result_file" >>"$RUN_DIR/seed.log"
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
{
  echo "export ANDROID_LIQUID_ADDRESS='$address'"
  echo "export REDWALLET_ANDROID_LIQUID_WALLET_ID='$wallet_id'"
} >"$RUN_DIR/android-liquid-wallet.env"
cat "$RUN_DIR/android-liquid-wallet.env"
