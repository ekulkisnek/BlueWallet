#!/usr/bin/env bash
# Seed createWallet on iOS BTC command server, push via devicectl, launch app, poll result.json.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_IOS_BTC_SEED_LOG_DIR:-$LOG_ROOT/ios-btc-seed-$STAMP}"
IOS_UDID="${REDWALLET_IOS_UDID:-${REDWALLET_FORCE_LAUNCH_UDID:-00008020-0011204911F3002E}}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"
POLL_SECONDS="${REDWALLET_IOS_BTC_SEED_POLL_SECONDS:-180}"
MONITOR_SECONDS="${REDWALLET_IOS_MONITOR_SECONDS:-120}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-btc-seed"
export REDWALLET_FORCE_LAUNCH_UDID="$IOS_UDID"

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

extract_btc_address_from_events() {
  local events_file="$1"
  [[ -f "$events_file" ]] || return 1
  python3 - <<'PY' "$events_file"
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

push_usb_tunnel_host_file() {
  local usb_host
  usb_host="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" "$IOS_UDID" 2>/dev/null || true)"
  [[ -n "$usb_host" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$usb_host" >"$tmp"
  if perl -e 'alarm 15; exec @ARGV' 15 xcrun devicectl device copy to \
    --device "$IOS_UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "$tmp" \
    --destination "Documents/redwallet-usb-tunnel-host.txt" >>"$RUN_DIR/push-usb-tunnel.log" 2>&1; then
    log "PUSHED usb tunnel host=$usb_host"
  fi
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

log "START run_dir=$RUN_DIR udid=$IOS_UDID"

metro_status="$(curl -sS -m 5 http://127.0.0.1:8081/status 2>/dev/null || true)"
if [[ "$metro_status" != *packager-status:running* ]]; then
  log "BLOCKER metro_not_running (need npm start on :8081)"
  exit 2
fi

bash "$ROOT_DIR/scripts/ensure-ios-btc-command-server.sh" >>"$RUN_DIR/ensure-server.log" 2>&1
bash "$ROOT_DIR/scripts/ensure-redwallet-ios-device-servers.sh" >>"$RUN_DIR/ensure-ios-servers.log" 2>&1 || true

CMD_DIR="$(resolve_command_dir)"
export REDWALLET_IOS_BTC_COMMAND_DIR="$CMD_DIR"
rm -f "$CMD_DIR/result.json"
command_id="ios-btc-receive-${STAMP}"
label="${REDWALLET_IOS_BTC_WALLET_LABEL:-iOS L1 receive ${STAMP}}"
cat >"$CMD_DIR/command.json" <<EOF
{"operation":"createWallet","commandId":"${command_id}","label":"${label}"}
EOF
log "SEEDED command.json dir=$CMD_DIR"

push_usb_tunnel_host_file || true
ios_push_btc_command "$CMD_DIR/command.json" || true

set +e
REDWALLET_IOS_MONITOR_RUN_DIR="$RUN_DIR/monitor" \
  REDWALLET_MONITOR_TERMINATE_EXISTING=1 \
  REDWALLET_MONITOR_CONSOLE=1 \
  "$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" "$BUNDLE_ID" "$MONITOR_SECONDS" "$IOS_UDID" >>"$RUN_DIR/monitor.log" 2>&1
set -e

monitor_dir="$(readlink "${LOG_ROOT%/}/current-ios-real-device-app-monitor" 2>/dev/null || true)"
address=""
wallet_id=""
if [[ -n "$monitor_dir" ]]; then
  for f in "$monitor_dir"/devices/*/redwallet-console-interesting.txt "$monitor_dir"/events.ndjson; do
    [[ -f "$f" ]] || continue
    out="$(extract_btc_address_from_events "$f" 2>/dev/null || true)"
    if [[ -n "$out" ]]; then
      address="$(printf '%s\n' "$out" | sed -n '1p')"
      wallet_id="$(printf '%s\n' "$out" | sed -n '2p')"
      log "OK address from events=$address"
      break
    fi
  done
fi

result_path="$CMD_DIR/result.json"
if [[ -z "$address" ]]; then
  deadline=$(( $(date +%s) + POLL_SECONDS ))
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
    sleep 2
  done
fi

if [[ -z "$address" ]]; then
  log "BLOCKER no iOS L1 receive address (result.json or console events)"
  exit 2
fi

log "OK address=$address walletID=$wallet_id"
echo "$address" >"$RUN_DIR/ios-l1-receive-address.txt"
echo "export IOS_L1_RECEIVE_ADDRESS='$address'" >"$RUN_DIR/ios-l1-receive.env"
echo "export L1_RECEIVE_ADDRESS='$address'" >>"$RUN_DIR/ios-l1-receive.env"
echo "export REDWALLET_IOS_BTC_WALLET_ID='$wallet_id'" >>"$RUN_DIR/ios-l1-receive.env"
cat "$RUN_DIR/ios-l1-receive.env"
exit 0
