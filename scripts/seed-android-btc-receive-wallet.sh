#!/usr/bin/env bash
# Seed createWallet on Android BTC command server, launch app, poll result.json for receive address.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_ANDROID_BTC_SEED_LOG_DIR:-$LOG_ROOT/android-btc-seed-$STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.50}"
POLL_SECONDS="${REDWALLET_ANDROID_BTC_SEED_POLL_SECONDS:-180}"
MONITOR_SECONDS="${REDWALLET_ANDROID_MONITOR_SECONDS:-120}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-android-btc-seed"
export ANDROID_SERIAL REDWALLET_ANDROID_PACKAGE="$ANDROID_PACKAGE"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/seed.log"
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

extract_btc_address_from_logcat() {
  local logcat_file="$1"
  [[ -f "$logcat_file" ]] || return 1
  python3 - <<'PY' "$logcat_file"
import json, re, sys
path = sys.argv[1]
last = None
with open(path, encoding='utf-8', errors='replace') as f:
    for line in f:
        if 'real_device_btc_wallet_created' not in line:
            continue
        m = re.search(r'REDWALLET_EVENT (\{.*\})\s*$', line.strip())
        if not m:
            continue
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        fields = payload.get('fields') or payload
        addr = (fields.get('address') or '').strip()
        if addr:
            last = (addr, (fields.get('walletID') or '').strip())
if last:
    print(last[0])
    print(last[1])
PY
}

read_btc_logcat_fields() {
  local logcat_file="$1"
  local out
  out="$(extract_btc_address_from_logcat "$logcat_file" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    address="$(printf '%s\n' "$out" | sed -n '1p')"
    wallet_id="$(printf '%s\n' "$out" | sed -n '2p')"
  fi
}

setup_android_usb_reverse() {
  adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:60101 tcp:60101 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6123 tcp:6123 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6125 tcp:6125 >/dev/null 2>&1 || true
  log "adb reverse 8081/60101/6123/6125"
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL"

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
command_id="android-btc-receive-${STAMP}"
label="${REDWALLET_ANDROID_BTC_WALLET_LABEL:-Android L1 receive ${STAMP}}"
cat >"$CMD_DIR/command.json" <<EOF
{"operation":"createWallet","commandId":"${command_id}","label":"${label}"}
EOF
log "SEEDED command.json dir=$CMD_DIR"

log "warm_launch wallet load wait"
adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true
sleep "${REDWALLET_ANDROID_BTC_SEED_WARMUP_SEC:-25}"

android_push_app_file "$CMD_DIR/command.json" "redwallet-btc-selftest-command.json" || true

set +e
"$ROOT_DIR/scripts/monitor-redwallet-android-real-device.sh" "$ANDROID_PACKAGE" "$MONITOR_SECONDS" "$ANDROID_SERIAL" >>"$RUN_DIR/monitor.log" 2>&1
set -e

monitor_dir="$(readlink "${LOG_ROOT%/}/current-android-real-device-app-monitor" 2>/dev/null || true)"
address=""
wallet_id=""
if [[ -n "$monitor_dir" && -f "$monitor_dir/logcat-full.txt" ]]; then
  read_btc_logcat_fields "$monitor_dir/logcat-full.txt"
  if [[ -n "$address" ]]; then
    log "OK address from logcat=$address"
  fi
fi

result_path="$CMD_DIR/result.json"
if [[ -z "$address" ]]; then
  short_poll="${REDWALLET_ANDROID_BTC_RESULT_POLL_SECONDS:-45}"
  deadline=$(( $(date +%s) + short_poll ))
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
    android_push_app_file "$CMD_DIR/command.json" "redwallet-btc-selftest-command.json" || true
    adb -s "$ANDROID_SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >>"$RUN_DIR/launch.log" 2>&1 || true
    sleep 2
  done
fi

if [[ -z "$address" && -n "$monitor_dir" && -f "$monitor_dir/logcat-full.txt" ]]; then
  read_btc_logcat_fields "$monitor_dir/logcat-full.txt"
  if [[ -n "$address" ]]; then
    log "OK address from logcat (retry)=$address"
  fi
fi

if [[ -z "$address" ]]; then
  log "BLOCKER no Android L1 receive address (result.json or logcat)"
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
echo "$address" >"$RUN_DIR/android-l1-receive-address.txt"
echo "export ANDROID_L1_RECEIVE_ADDRESS='$address'" >"$RUN_DIR/android-l1-receive.env"
echo "export L1_RECEIVE_ADDRESS='$address'" >>"$RUN_DIR/android-l1-receive.env"
echo "export REDWALLET_ANDROID_BTC_WALLET_ID='$wallet_id'" >>"$RUN_DIR/android-l1-receive.env"
cat "$RUN_DIR/android-l1-receive.env"
exit 0
