#!/usr/bin/env bash
# Push reserve → register → transfer on Android physical device; poll collector/logcat.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
CHAIN_ASSET="RWFLEET${STAMP}"
SERIAL="${1:-${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}}"
LOCK_DIR="${LOG_ROOT}/android-phone-chain-$(echo "$SERIAL" | tr -cd 'a-zA-Z0-9').lock.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "CHAIN_BUSY $(date -Iseconds) lock=$LOCK_DIR"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

EVENTS="${REDWALLET_COLLECTOR_EVENTS:-$LOG_ROOT/current-js-event-collector/events.ndjson}"
LOG="$LOG_ROOT/android-phone-chain-$(echo "$SERIAL" | tr -cd 'a-zA-Z0-9')-$(date +%Y%m%d-%H%M%S).log"
POLL_SEC="${REDWALLET_CHAIN_POLL_SEC:-4}"
POLLS="${REDWALLET_CHAIN_POLLS:-25}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"

exec >>"$LOG" 2>&1
EVENT_LINE_START="$(wc -l <"$EVENTS" 2>/dev/null | tr -d ' ')"
EVENT_LINE_START="${EVENT_LINE_START:-0}"
echo "CHAIN_START $(date -Iseconds) serial=$SERIAL event_line_start=$EVENT_LINE_START"

export ANDROID_SERIAL="$SERIAL"
export REDWALLET_ANDROID_SERIAL="$SERIAL"
export REDWALLET_BITASSETS_RPC_MAC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"
export BITASSETS_RPC_URL="${REDWALLET_BITASSETS_RPC_MAC}"
export REDWALLET_SKIP_BITASSETS_RESTART=1
export REDWALLET_ANDROID_SKIP_LAUNCH=1
export REDWALLET_KEEP_COMMAND_SERVER=1
export REDWALLET_ANDROID_MONITOR_SECONDS=60

run_chain_preflight() {
  local preflight_rc=0 env_file="$LOG_ROOT/current-preflight-android.env"
  set +e
  bash "$ROOT_DIR/scripts/preflight-redwallet-android-chain.sh"
  preflight_rc=$?
  set -e
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
  if [[ "$preflight_rc" -ne 0 ]]; then
    echo "CHAIN_GATE_FAIL preflight exit=$preflight_rc"
    exit 1
  fi
  echo "CHAIN_GATE_OK serial=$SERIAL rpc=${BITASSETS_RPC_URL:-unset}"
}

android_event_pat() {
  printf '"platform":"android"|192\\.168\\.1\\.'
}

last_chain_txid=""

pull_selftest_result_txid() {
  local op="$1" tmp rc txid
  tmp="$(mktemp)"
  rc=1
  if adb -s "$SERIAL" exec-out run-as "$ANDROID_PACKAGE" cat files/redwallet-bitassets-selftest-result.json >"$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    if rg -q '"ok":\s*true' "$tmp" 2>/dev/null && rg -q "\"operation\":\"$op\"" "$tmp" 2>/dev/null; then
      txid="$(rg -o '"txid":"[a-f0-9]+"' "$tmp" 2>/dev/null | head -1 | sed 's/"txid":"//;s/"$//' || true)"
      if [[ -n "$txid" ]]; then
        last_chain_txid="$txid"
        echo "CHAIN_OK op=$op source=device-result txid=$txid"
        rc=0
      fi
    fi
  fi
  rm -f "$tmp"
  return "$rc"
}

wait_selftest_ok() {
  local op="$1" ev_pat hit
  ev_pat="$(android_event_pat)"
  for ((i = 1; i <= POLLS; i++)); do
    hit="$(tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_ok" | rg -e "$ev_pat" | rg "\"operation\":\"$op\"" | tail -1 || true)"
    if [[ -n "$hit" ]]; then
      last_chain_txid="$(printf '%s' "$hit" | rg -o '"txid":"[a-f0-9]+"' | head -1 | sed 's/"txid":"//;s/"$//' || true)"
      echo "CHAIN_OK op=$op poll=$i txid=${last_chain_txid:-unknown}"
      return 0
    fi
    if pull_selftest_result_txid "$op"; then
      return 0
    fi
    echo "CHAIN_WAIT op=$op poll=$i/$POLLS"
    sleep "$POLL_SEC"
  done
  return 1
}

cd "$ROOT_DIR"
run_chain_preflight

export REDWALLET_BITASSETS_COMMAND_OPERATION=createWallet
bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
adb -s "$SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 12

echo "CHAIN_ASSET=$CHAIN_ASSET"
export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
adb -s "$SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 8
wait_selftest_ok reserve || echo "CHAIN_FAIL reserve"

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
if [[ "${REDWALLET_SKIP_CHAIN_MINE:-0}" != "1" ]]; then
  if [[ -x "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" ]]; then
    "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" 1 && echo "CHAIN_L1_MINE_OK" || echo "CHAIN_L1_MINE_FAIL"
  fi
  if [[ -x "$LOCAL_DEV/scripts/mine-bitassets-block.sh" ]]; then
    "$LOCAL_DEV/scripts/mine-bitassets-block.sh" && echo "CHAIN_MINE_OK" || echo "CHAIN_MINE_FAIL"
  fi
fi
sleep "${REDWALLET_CHAIN_REGISTER_DELAY_SEC:-15}"

export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
export REDWALLET_BITASSETS_COMMAND_OPERATION=register
bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
adb -s "$SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 8
wait_selftest_ok register || echo "CHAIN_FAIL register"
register_txid="$last_chain_txid"

chain_asset_id=""
if [[ -f "$COMPOSE_FILE" ]] && command -v docker >/dev/null 2>&1; then
  chain_asset_id="$(docker compose -f "$COMPOSE_FILE" exec -T bitassets plain_bitassets_app_cli bitassets 2>/dev/null \
    | python3 -c 'import json,sys
name=sys.argv[1]
d=json.load(sys.stdin)
for row in d:
  if isinstance(row,(list,tuple)) and len(row)>=2 and row[0]==name:
    print(row[1]); sys.exit(0)
sys.exit(1)' "$CHAIN_ASSET" 2>/dev/null || true)"
fi
if [[ -n "$chain_asset_id" ]]; then
  echo "CHAIN_ASSET_ID=$chain_asset_id"
  export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$chain_asset_id"
  export REDWALLET_BITASSETS_TRANSFER_DEST="${REDWALLET_BITASSETS_TRANSFER_DEST:-cadLofSiGHqnuVEN2Q1KqZFvNWv}"
  export REDWALLET_BITASSETS_COMMAND_OPERATION=transfer
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  adb -s "$SERIAL" shell monkey -p "$ANDROID_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  sleep 8
  wait_selftest_ok transfer || echo "CHAIN_FAIL transfer"
else
  echo "CHAIN_SKIP transfer (no asset id)"
fi

export REDWALLET_ANDROID_MONITOR_SECONDS=180
bash "$ROOT_DIR/scripts/monitor-redwallet-android-real-device.sh" "$ANDROID_PACKAGE" 180 "$SERIAL" || true
bash "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 || true
echo "CHAIN_DONE $(date -Iseconds) asset=$CHAIN_ASSET register_txid=${register_txid:-none} asset_id=${chain_asset_id:-none}"
