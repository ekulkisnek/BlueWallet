#!/usr/bin/env bash
# Push reserve → register → transfer on Android physical device; poll collector/logcat.
#
# Post-register PASS (transfer-only): scripts/redwallet-android-guarded-transfer-only.sh
# Wallet restore / CHAIN_GATE_FAIL: docs/orchestration/ANDROID_WALLET_RESTORE.md
# Preflight (once per chain): scripts/redwallet-android-chain-preflight.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
CHAIN_ASSET="${REDWALLET_CHAIN_ASSET:-RWFLEET${STAMP}}"
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
echo "LIPHONE_STANDBY=1 force-quit RedWallet on LiPhone; do not run iOS chain scripts (docs/FLEET_LANES.md)"

export ANDROID_SERIAL="$SERIAL"
export REDWALLET_LIPHONE_STANDBY=1
export REDWALLET_ANDROID_SERIAL="$SERIAL"
export REDWALLET_BITASSETS_RPC_MAC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"
export BITASSETS_RPC_URL="${REDWALLET_BITASSETS_RPC_MAC}"
export REDWALLET_SKIP_BITASSETS_RESTART=1
export REDWALLET_ANDROID_SKIP_LAUNCH=1
export REDWALLET_KEEP_COMMAND_SERVER=1
export REDWALLET_ANDROID_MONITOR_SECONDS=60

if [[ -n "${REDWALLET_BITASSETS_WALLET_ID:-}" ]]; then
  export REDWALLET_BITASSETS_WALLET_ID
fi
if [[ -n "${REDWALLET_ANDROID_MONITOR_NO_RESTART:-}" ]]; then
  export REDWALLET_ANDROID_MONITOR_NO_RESTART
fi

android_transfer_wallet_gate() {
  if [[ "${REDWALLET_CHAIN_TRANSFER_ONLY:-0}" != "1" ]]; then
    return 0
  fi
  if [[ "${REDWALLET_ANDROID_REQUIRE_WALLET_ID:-0}" == "1" && -z "${REDWALLET_BITASSETS_WALLET_ID:-}" ]]; then
    echo "CHAIN_GATE_FAIL transfer-only requires REDWALLET_BITASSETS_WALLET_ID (REDWALLET_ANDROID_REQUIRE_WALLET_ID=1)"
    exit 1
  fi
  local expected_count="${REDWALLET_ANDROID_EXPECT_BITASSETS_WALLET_COUNT:-1}"
  local wallet_id="${REDWALLET_BITASSETS_WALLET_ID:-}"
  if [[ -z "$wallet_id" ]]; then
    echo "CHAIN_GATE_WARN transfer-only without REDWALLET_BITASSETS_WALLET_ID (ambiguous wallet selection)"
    return 0
  fi
  local ev_pat count_line wallet_count available_line
  ev_pat="$(android_event_pat)"
  count_line="$(tail -n 800 "$EVENTS" 2>/dev/null | rg "real_device_bitassets_smoke_done" | rg -e "$ev_pat" | tail -1 || true)"
  if [[ -z "$count_line" ]]; then
    count_line="$(tail -n 800 "$EVENTS" 2>/dev/null | rg "real_device_bitassets_smoke_begin" | rg -e "$ev_pat" | tail -1 || true)"
  fi
  if [[ -n "$count_line" ]]; then
    wallet_count="$(printf '%s' "$count_line" | rg -o '"walletCount":[0-9]+' | head -1 | sed 's/"walletCount"://' || true)"
    if [[ -n "${wallet_count:-}" && "$wallet_count" != "$expected_count" ]]; then
      echo "CHAIN_GATE_FAIL bitassets_wallet_count=$wallet_count expected=$expected_count serial=$SERIAL"
      echo "CHAIN_GATE_HINT restore registering wallet $wallet_id — docs/orchestration/ANDROID_DEVICE_ONBOARDING.md"
      exit 1
    fi
  fi
  if ! tail -n 1200 "$EVENTS" 2>/dev/null | rg "real_device_bitassets_smoke_wallet" | rg -e "$ev_pat" | rg -F "\"walletID\":\"${wallet_id}\"" -q 2>/dev/null; then
    available_line="$(tail -n 400 "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_wallet_missing" | rg -e "$ev_pat" | tail -1 || true)"
    echo "CHAIN_GATE_FAIL registering wallet_id=$wallet_id not loaded on device"
    [[ -n "$available_line" ]] && echo "CHAIN_GATE_DETAIL $available_line"
    exit 1
  fi
  echo "CHAIN_GATE_OK transfer_wallet_id=$wallet_id wallet_count=${wallet_count:-unknown}"
}

run_chain_preflight() {
  local preflight_rc=0
  set +e
  bash "$ROOT_DIR/scripts/redwallet-android-chain-preflight.sh"
  preflight_rc=$?
  set -e
  if [[ "$preflight_rc" -ne 0 ]]; then
    echo "CHAIN_GATE_FAIL preflight exit=$preflight_rc"
    exit 1
  fi
  echo "CHAIN_GATE_OK serial=$SERIAL rpc=${BITASSETS_RPC_URL:-unset}"
}

android_event_pat() {
  printf '"platform":"android"'
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

wait_wallet_created() {
  local ev_pat hit
  ev_pat="$(android_event_pat)"
  for ((i = 1; i <= POLLS; i++)); do
    hit="$(tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_wallet_created" | rg -e "$ev_pat" | tail -1 || true)"
    if [[ -n "$hit" ]]; then
      echo "CHAIN_OK op=createWallet poll=$i wallet_created=1"
      return 0
    fi
    echo "CHAIN_WAIT op=createWallet poll=$i/$POLLS"
    sleep "$POLL_SEC"
  done
  return 1
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

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"

resolve_chain_asset_id() {
  if [[ -n "${REDWALLET_BITASSETS_TRANSFER_ASSET_ID:-}" ]]; then
    printf '%s\n' "$REDWALLET_BITASSETS_TRANSFER_ASSET_ID"
    return 0
  fi
  if [[ "${REDWALLET_SKIP_DOCKER_LOOKUP:-0}" == "1" || ! -f "$COMPOSE_FILE" ]] || ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  docker compose -f "$COMPOSE_FILE" exec -T bitassets plain_bitassets_app_cli bitassets 2>/dev/null \
    | python3 -c 'import json,sys
name=sys.argv[1]
d=json.load(sys.stdin)
for row in d:
  if isinstance(row,(list,tuple)) and len(row)>=2 and row[0]==name:
    print(row[1]); sys.exit(0)
sys.exit(1)' "$CHAIN_ASSET" 2>/dev/null || return 1
}

cd "$ROOT_DIR"
run_chain_preflight

register_txid="${REDWALLET_CHAIN_REGISTER_TXID:-}"
transfer_txid=""

if [[ "${REDWALLET_CHAIN_TRANSFER_ONLY:-0}" != "1" && "${REDWALLET_CHAIN_FROM_REGISTER:-0}" != "1" ]]; then
  export REDWALLET_BITASSETS_COMMAND_OPERATION=createWallet
  export REDWALLET_ANDROID_SKIP_LAUNCH=0
  export REDWALLET_ANDROID_MONITOR_SECONDS=90
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=1
  export REDWALLET_ANDROID_MONITOR_SECONDS=60
  wait_wallet_created || echo "CHAIN_WARN createWallet (see collector)"
  sleep 5

  echo "CHAIN_ASSET=$CHAIN_ASSET"
  export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
  export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
  export REDWALLET_ANDROID_SKIP_LAUNCH=0
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=1
  sleep 8
  wait_selftest_ok reserve || echo "CHAIN_FAIL reserve"

  if [[ "${REDWALLET_SKIP_CHAIN_MINE:-0}" != "1" ]]; then
    if [[ -x "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" ]]; then
      "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" 1 && echo "CHAIN_L1_MINE_OK" || echo "CHAIN_L1_MINE_FAIL"
    fi
    if [[ -x "$LOCAL_DEV/scripts/mine-bitassets-block.sh" ]]; then
      "$LOCAL_DEV/scripts/mine-bitassets-block.sh" && echo "CHAIN_MINE_OK" || echo "CHAIN_MINE_FAIL"
    fi
  fi
  sleep "${REDWALLET_CHAIN_REGISTER_DELAY_SEC:-15}"
  bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh" "${BITASSETS_RPC_URL:-http://192.168.1.50:6004}" || echo "CHAIN_WARN rpc check before register failed"

  export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
  export REDWALLET_BITASSETS_COMMAND_OPERATION=register
  export REDWALLET_ANDROID_SKIP_LAUNCH=0
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=1
  sleep 8
  last_chain_txid=""
  if wait_selftest_ok register; then
    register_txid="$last_chain_txid"
  else
    echo "CHAIN_FAIL register"
  fi
elif [[ "${REDWALLET_CHAIN_FROM_REGISTER:-0}" == "1" ]]; then
  echo "CHAIN_FROM_REGISTER asset=$CHAIN_ASSET"
  export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
  export REDWALLET_BITASSETS_COMMAND_OPERATION=register
  export REDWALLET_ANDROID_SKIP_LAUNCH=0
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=1
  sleep 8
  last_chain_txid=""
  if wait_selftest_ok register; then
    register_txid="$last_chain_txid"
  else
    echo "CHAIN_FAIL register"
  fi
  if [[ "${REDWALLET_SKIP_CHAIN_MINE:-0}" != "1" ]]; then
    if [[ -x "$LOCAL_DEV/scripts/mine-bitassets-block.sh" ]]; then
      "$LOCAL_DEV/scripts/mine-bitassets-block.sh" && echo "CHAIN_MINE_OK post-register" || echo "CHAIN_MINE_FAIL post-register"
    fi
  fi
  sleep "${REDWALLET_CHAIN_TRANSFER_DELAY_SEC:-10}"
else
  echo "CHAIN_TRANSFER_ONLY asset=$CHAIN_ASSET register_txid=${register_txid:-none} wallet_id=${REDWALLET_BITASSETS_WALLET_ID:-unset}"
  android_transfer_wallet_gate
  if [[ "${REDWALLET_SKIP_CHAIN_MINE:-0}" != "1" ]]; then
    if [[ -x "$LOCAL_DEV/scripts/mine-bitassets-block.sh" ]]; then
      "$LOCAL_DEV/scripts/mine-bitassets-block.sh" && echo "CHAIN_MINE_OK pre-transfer" || echo "CHAIN_MINE_FAIL pre-transfer"
    fi
  fi
  sleep "${REDWALLET_CHAIN_TRANSFER_DELAY_SEC:-10}"
fi

# Transfer uses on-chain BitAsset id (hex), never the register txid.
chain_asset_id=""
if chain_asset_id="$(resolve_chain_asset_id)"; then
  echo "CHAIN_ASSET_ID=$chain_asset_id (from bitassets list / env)"
else
  chain_asset_id=""
  echo "CHAIN_ASSET_ID=unset (docker lookup failed; will not use register_txid)"
fi
if [[ -n "$register_txid" && -n "$chain_asset_id" ]] || [[ "${REDWALLET_CHAIN_TRANSFER_ONLY:-0}" == "1" && -n "$chain_asset_id" ]]; then
  export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$chain_asset_id"
  export REDWALLET_BITASSETS_TRANSFER_DEST="${REDWALLET_BITASSETS_TRANSFER_DEST:-cadLofSiGHqnuVEN2Q1KqZFvNWv}"
  export REDWALLET_BITASSETS_COMMAND_OPERATION=transfer
  adb -s "$SERIAL" shell am force-stop "$ANDROID_PACKAGE" >/dev/null 2>&1 || true
  adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=0
  bash "$ROOT_DIR/scripts/retry-android-origin-bitassets-proof.sh" || true
  export REDWALLET_ANDROID_SKIP_LAUNCH=1
  if wait_selftest_ok transfer; then
    transfer_txid="$last_chain_txid"
  else
    echo "CHAIN_FAIL transfer"
  fi
elif [[ -n "$register_txid" ]]; then
  echo "CHAIN_SKIP transfer (no sidechain asset id; register_txid=${register_txid} is not asset id)"
else
  echo "CHAIN_SKIP transfer (no register txid)"
fi

export REDWALLET_ANDROID_MONITOR_SECONDS=180
bash "$ROOT_DIR/scripts/monitor-redwallet-android-real-device.sh" "$ANDROID_PACKAGE" 180 "$SERIAL" || true
bash "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 || true
echo "CHAIN_DONE $(date -Iseconds) asset=$CHAIN_ASSET register_txid=${register_txid:-none} transfer_txid=${transfer_txid:-none} asset_id=${chain_asset_id:-none}"
