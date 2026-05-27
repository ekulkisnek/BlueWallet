#!/usr/bin/env bash
# Push reserve, poll for selftest_ok, push register, poll — one phone, app stays foreground (SKIP_LAUNCH).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
CHAIN_ASSET="RWFLEET${STAMP}"
UDID="${1:-${REDWALLET_FORCE_LAUNCH_UDID:-00008101-000128643E28001E}}"
LOCK_DIR="${LOG_ROOT}/phone-chain-$(echo "$UDID" | tr -d '-').lock.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "CHAIN_BUSY $(date -Iseconds) lock=$LOCK_DIR"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
EVENTS="${REDWALLET_COLLECTOR_EVENTS:-$LOG_ROOT/ios-real-device-selftest-20260526-174300/js-event-collector/events.ndjson}"
LOG="$LOG_ROOT/phone-chain-$(echo "$UDID" | tr -d '-')-$(date +%Y%m%d-%H%M%S).log"
POLL_SEC="${REDWALLET_CHAIN_POLL_SEC:-4}"
POLLS="${REDWALLET_CHAIN_POLLS:-20}"

exec >>"$LOG" 2>&1
EVENT_LINE_START="$(wc -l <"$EVENTS" 2>/dev/null | tr -d ' ')"
EVENT_LINE_START="${EVENT_LINE_START:-0}"
echo "CHAIN_START $(date -Iseconds) udid=$UDID event_line_start=$EVENT_LINE_START"

export STAMP
export REDWALLET_FORCE_LAUNCH_UDID="$UDID"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export REDWALLET_SKIP_BITASSETS_RESTART=1
export REDWALLET_PHONE_SKIP_LAUNCH="${REDWALLET_PHONE_SKIP_LAUNCH:-1}"
# FORCE_PHONE_HOST filters collector/command reachability only — BitAssets JSON-RPC stays on Mac LAN.
export REDWALLET_BITASSETS_RPC_MAC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"
export BITASSETS_RPC_URL="${REDWALLET_BITASSETS_RPC_MAC}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"

run_chain_preflight() {
  local preflight_rc=0 env_file preflight_script
  if [[ "$UDID" == *00008101* ]]; then
    preflight_script="$ROOT_DIR/scripts/preflight-redwallet-iphone12-chain.sh"
    env_file="${LOG_ROOT%/}/current-preflight-iphone12.env"
  else
    preflight_script="$ROOT_DIR/scripts/preflight-redwallet-liphone-chain.sh"
    env_file="${LOG_ROOT%/}/current-preflight-liphone.env"
  fi
  set +e
  bash "$preflight_script"
  preflight_rc=$?
  set -e
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
  if [[ "$preflight_rc" -ne 0 ]]; then
    echo "CHAIN_GATE_FAIL preflight exit=$preflight_rc (see ${LOG_ROOT%/}/current-preflight-iphone12/BLOCKER.txt or current-preflight-liphone/BLOCKER.txt)"
    exit 1
  fi
  echo "CHAIN_GATE_OK udid=$UDID rpc=${BITASSETS_RPC_URL:-unset}"
}

phone_ip_guess() {
  if [[ "$UDID" == *00008020* ]]; then echo '192\.168\.1\.149'; else echo '192\.168\.1\.165'; fi
}

phone_event_pat() {
  local ip_pat
  ip_pat="$(phone_ip_guess)"
  if [[ "$UDID" == *00008020* ]]; then
    printf '%s|%s' "$ip_pat" '"platformVersion":"18\.'
  else
    printf '%s|%s|%s' "$ip_pat" 'fd26:|fda1:|fdc6:' '"platformVersion":"26\.(2|5)'
  fi
}

last_chain_txid=""

pull_selftest_result_txid() {
  local op="$1"
  local tmp rc txid
  tmp="$(mktemp)"
  rc=1
  if perl -e 'alarm 12; exec @ARGV' 12 xcrun devicectl device copy from \
    --device "$UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source Documents/redwallet-bitassets-selftest-result.json \
    --destination "$tmp" >/dev/null 2>&1 && [[ -s "$tmp" ]]; then
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
  local op="$1"
  local ev_pat
  ev_pat="$(phone_event_pat)"
  if [[ "$op" != "${last_chain_txid_op:-}" ]]; then
    last_chain_txid=""
  fi
  last_chain_txid_op="$op"
  for ((i = 1; i <= POLLS; i++)); do
    local hit=""
    if [[ "$op" == "reserve" ]]; then
      hit="$(tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_ok" | rg -e "$ev_pat" | rg "\"operation\":\"$op\"" | tail -1 || true)"
      if [[ -z "$hit" ]]; then
        if tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_begin" | rg -e "$ev_pat" | rg "$CHAIN_ASSET" | rg '"operation":"reserve"' -q; then
          hit="$(tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_ok" | rg -e "$ev_pat" | rg "\"operation\":\"$op\"" | tail -1 || true)"
        fi
      fi
    else
      hit="$(tail -n +"$((EVENT_LINE_START + 1))" "$EVENTS" 2>/dev/null | rg "real_device_bitassets_selftest_ok" | rg -e "$ev_pat" | rg "\"operation\":\"$op\"" | tail -1 || true)"
    fi
    if [[ -n "$hit" ]]; then
      last_chain_txid="$(printf '%s' "$hit" | rg -o '"txid":"[a-f0-9]+"' | head -1 | sed 's/"txid":"//;s/"$//' || true)"
      echo "CHAIN_OK op=$op poll=$i txid=${last_chain_txid:-unknown} $hit"
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

chain_launch_app() {
  echo "CHAIN_LAUNCH $(date -Iseconds) udid=$UDID"
  perl -e 'alarm 18; exec @ARGV' xcrun devicectl device process launch \
    --terminate-existing --device "$UDID" "$BUNDLE_ID" || echo "CHAIN_LAUNCH_WARN"
}

cd "$ROOT_DIR"
run_chain_preflight

if [[ "${REDWALLET_CHAIN_PERSIST_ONLY:-0}" == "1" ]]; then
  chain_asset_id="${REDWALLET_BITASSETS_TRANSFER_ASSET_ID:-}"
  if [[ -z "$chain_asset_id" ]]; then
    echo "CHAIN_PERSIST_SKIP missing REDWALLET_BITASSETS_TRANSFER_ASSET_ID $(date -Iseconds)"
    exit 1
  fi
  echo "CHAIN_PERSIST_ONLY asset_id=$chain_asset_id $(date -Iseconds)"
  export REDWALLET_PHONE_SKIP_LAUNCH=0
  chain_launch_app
  sleep 8
  export REDWALLET_BITASSETS_COMMAND_OPERATION=transfer
  export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$chain_asset_id"
  bash scripts/retry-phone-origin-bitassets-proof.sh || true
  if wait_selftest_ok transfer; then
    echo "CHAIN_PERSIST_OK post-restart transfer $(date -Iseconds)"
    exit 0
  fi
  echo "CHAIN_PERSIST_WARN post-restart transfer $(date -Iseconds)"
  exit 1
fi

export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
echo "CHAIN_ASSET=$CHAIN_ASSET"
export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
bash scripts/retry-phone-origin-bitassets-proof.sh || true
wait_selftest_ok reserve || echo "CHAIN_FAIL reserve"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
mine_signet_sidechain() {
  echo "CHAIN_MINE $(date -Iseconds)"
  docker compose -f "$COMPOSE_FILE" exec -T mainchain bitcoin-cli -signet loadwallet signet-miner >/dev/null 2>&1 || true
  if [[ -x "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" ]]; then
    "$LOCAL_DEV/scripts/mine-private-signet-blocks.sh" 1 && echo "CHAIN_L1_MINE_OK" || echo "CHAIN_L1_MINE_FAIL"
  fi
  if [[ -x "$LOCAL_DEV/scripts/mine-bitassets-block.sh" ]]; then
    for mine_i in 1 2 3; do
      echo "CHAIN_MINE_ATTEMPT=$mine_i"
      if "$LOCAL_DEV/scripts/mine-bitassets-block.sh"; then
        echo "CHAIN_MINE_OK attempt=$mine_i"
        return 0
      fi
      echo "CHAIN_MINE_FAIL attempt=$mine_i"
      sleep 2
    done
  fi
  return 1
}
if [[ "${REDWALLET_SKIP_CHAIN_MINE:-0}" != "1" ]]; then
  mine_signet_sidechain || true
else
  echo "CHAIN_MINE_SKIPPED (REDWALLET_SKIP_CHAIN_MINE=1 — Signet lane mines)"
fi
sleep 3
sleep "${REDWALLET_CHAIN_REGISTER_DELAY_SEC:-15}"
export REDWALLET_BITASSETS_ASSET_NAME="$CHAIN_ASSET"
export REDWALLET_BITASSETS_COMMAND_OPERATION=register
bash scripts/retry-phone-origin-bitassets-proof.sh || true
wait_selftest_ok register || echo "CHAIN_FAIL register"

register_txid="$last_chain_txid"

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
if d:
  print(d[-1][1]); sys.exit(0)
sys.exit(1)' "$CHAIN_ASSET" 2>/dev/null || return 1
}

# Transfer uses on-chain BitAsset id (hex), never the register txid.
chain_asset_id=""
if chain_asset_id="$(resolve_chain_asset_id)"; then
  echo "CHAIN_ASSET_ID=$chain_asset_id (from bitassets list / env)"
else
  chain_asset_id=""
  echo "CHAIN_ASSET_ID=unset (docker lookup failed; will not use register_txid)"
fi
if [[ -n "$register_txid" && -n "$chain_asset_id" ]]; then
  export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$chain_asset_id"
  export REDWALLET_BITASSETS_TRANSFER_DEST="${REDWALLET_BITASSETS_TRANSFER_DEST:-cadLofSiGHqnuVEN2Q1KqZFvNWv}"
  export REDWALLET_BITASSETS_COMMAND_OPERATION='transfer'
  bash scripts/retry-phone-origin-bitassets-proof.sh || true
  wait_selftest_ok transfer || echo "CHAIN_FAIL transfer"
elif [[ -n "$register_txid" ]]; then
  echo "CHAIN_SKIP transfer (no sidechain asset id; register_txid=${register_txid} is not asset id)"
else
  echo "CHAIN_SKIP transfer (no register txid)"
fi

echo "CHAIN_RESTART_PERSIST $(date -Iseconds)"
chain_launch_app
sleep 8
if [[ -n "$chain_asset_id" ]]; then
  export REDWALLET_BITASSETS_COMMAND_OPERATION='transfer'
  export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$chain_asset_id"
  bash scripts/retry-phone-origin-bitassets-proof.sh || true
  wait_selftest_ok transfer && echo "CHAIN_PERSIST_OK post-restart transfer" || echo "CHAIN_PERSIST_WARN post-restart transfer"
else
  echo "CHAIN_PERSIST_SKIP transfer (no sidechain asset id)"
fi

bash scripts/collect-redwallet-device-logs.sh "$LOG_ROOT" 30 || true
echo "CHAIN_DONE $(date -Iseconds) asset=$CHAIN_ASSET asset_id=${chain_asset_id:-none} register_txid=${register_txid:-none}"
