#!/usr/bin/env bash
# Push a Liquid sync/transfer command to Android and poll for the app result.
set -euo pipefail

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_ANDROID_LIQUID_COMMAND_LOG_DIR:-$LOG_ROOT/android-liquid-command-$STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
OPERATION="${1:?operation required}"
POLL_SECONDS="${REDWALLET_ANDROID_LIQUID_COMMAND_POLL_SECONDS:-180}"
DESTINATION=""
AMOUNT=""
WALLET_ID="${REDWALLET_ANDROID_LIQUID_WALLET_ID:-}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-android-liquid-command"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/command.log"
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

case "$OPERATION" in
  sync)
    WALLET_ID="${2:-$WALLET_ID}"
    ;;
  transfer)
    DESTINATION="${2:?destination address required}"
    AMOUNT="${3:?amount sats required}"
    WALLET_ID="${4:-$WALLET_ID}"
    ;;
  *)
    echo "Unsupported operation: $OPERATION" >&2
    exit 2
    ;;
esac

if ! adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
  log "BLOCKER android_not_ready"
  exit 2
fi
adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
adb -s "$ANDROID_SERIAL" reverse tcp:60401 tcp:60401 >/dev/null 2>&1 || true

command_id="android-liquid-${OPERATION}-${STAMP}"
command_file="$RUN_DIR/command.json"
python3 - <<PY >"$command_file"
import json
command = {
    "operation": "$OPERATION",
    "commandId": "$command_id",
}
if "$WALLET_ID":
    command["walletID"] = "$WALLET_ID"
if "$OPERATION" == "transfer":
    command["destinationAddress"] = "$DESTINATION"
    command["amount"] = int("$AMOUNT")
print(json.dumps(command))
PY

adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE rm -f files/redwallet-liquid-selftest-result.json files/redwallet-liquid-selftest-command.json" >>"$RUN_DIR/push-app-file.log" 2>&1 || true
android_push_app_file "$command_file" "redwallet-liquid-selftest-command.json" || true
adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true

result_file="$RUN_DIR/result.json"
txid=""
matched_result=0
deadline=$(( $(date +%s) + POLL_SECONDS ))
while [[ $(date +%s) -lt $deadline ]]; do
  if adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE cat files/redwallet-liquid-selftest-result.json" >"$result_file.tmp" 2>>"$RUN_DIR/pull-result.log"; then
    mv "$result_file.tmp" "$result_file"
    if python3 - <<'PY' "$result_file" "$OPERATION" "$command_id"
import json, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
expected = sys.argv[2]
if r.get("ok") is not True or r.get("operation") != expected or r.get("commandId") != sys.argv[3]:
    sys.exit(1)
if expected == "transfer" and len((r.get("txid") or "").strip()) != 64:
    sys.exit(1)
sys.exit(0)
PY
    then
      txid="$(python3 - <<'PY' "$result_file"
import json, sys
with open(sys.argv[1]) as f:
    print((json.load(f).get("txid") or "").strip())
PY
)"
      matched_result=1
      break
    fi
  fi
  sleep 2
done

if [[ "$matched_result" != 1 ]]; then
  log "BLOCKER no matching Android Liquid result for operation=$OPERATION command_id=$command_id"
  [[ -f "$result_file" ]] && cat "$result_file" >>"$RUN_DIR/command.log"
  exit 2
fi

log "OK operation=$OPERATION txid=${txid:-}"
op_upper="$(printf '%s' "$OPERATION" | tr '[:lower:]' '[:upper:]')"
echo "export ANDROID_LIQUID_${op_upper}_TXID='$txid'" >"$RUN_DIR/android-liquid-${OPERATION}.env"
cat "$RUN_DIR/android-liquid-${OPERATION}.env"
