#!/usr/bin/env bash
# BitWindow / shared signet → RedWallet iOS simulator BitAssets receive proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${BITWINDOW_TO_SIM_LOG_DIR:-$LOG_ROOT/bitwindow-to-simulator-$STAMP}"
ADDRESS_FILE="$RUN_DIR/simulator-bitassets-address.txt"
TRANSFER_VALUE_SATS="${BITWINDOW_TRANSFER_VALUE_SATS:-500000}"
TRANSFER_FEE_SATS="${BITWINDOW_TRANSFER_FEE_SATS:-10000}"
DEPOSIT_FEE_SATS="${BITWINDOW_DEPOSIT_FEE_SATS:-50000}"
BITWINDOW_WALLET_ID="${BITWINDOW_WALLET_ID:-wallet_17EBC8D2}"
METRO_PORT="${METRO_PORT:-8081}"
export BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
export BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/amd64}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"

mkdir -p "$RUN_DIR"
cd "$ROOT_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

bitassets_cli() {
  perl -e 'alarm 60; exec @ARGV' docker compose -f "$COMPOSE" exec -T bitassets plain_bitassets_app_cli "$@"
}

port_open() {
  curl --silent --max-time 1 "http://127.0.0.1:$METRO_PORT/status" >/dev/null 2>&1
}

start_metro_if_needed() {
  if port_open; then
    log "metro=already_running"
    return
  fi
  log "metro=starting"
  (cd "$ROOT_DIR" && npm start -- --port "$METRO_PORT" --reset-cache) >>"$RUN_DIR/metro.log" 2>&1 &
  echo "$!" >"$RUN_DIR/metro.pid"
  for _ in $(seq 1 45); do
    if port_open; then
      log "metro=ready"
      return
    fi
    sleep 1
  done
  log "FAIL metro timeout"
  exit 1
}

try_bitwindow_sidechain_deposit() {
  local dest="$1"
  local out="$RUN_DIR/bitwindow-create-sidechain-deposit.json"
  local err="$RUN_DIR/bitwindow-create-sidechain-deposit.err"
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  "walletId": "$BITWINDOW_WALLET_ID",
  "slot": 4,
  "destinationAddress": "$dest",
  "valueSats": $TRANSFER_VALUE_SATS,
}))
PY
)"
  if perl -e 'alarm 12; exec @ARGV' curl -sS -m 10 -X POST \
    "http://127.0.0.1:30301/wallet.v1.WalletService/CreateSidechainDeposit" \
    -H 'Content-Type: application/json' \
    -d "$body" >"$out" 2>"$err"; then
    if grep -qE '"txid"|"depositTxid"|"transactionId"' "$out" 2>/dev/null; then
      log "OK BitWindow CreateSidechainDeposit — see $out"
      return 0
    fi
  fi
  log "WARN BitWindow CreateSidechainDeposit failed — see $out $err"
  return 1
}

fund_via_cli() {
  local dest="$1"
  local mode="$2"
  local txid=""
  if [[ "$mode" == "deposit" ]]; then
    txid="$(bitassets_cli create-deposit --value-sats "$TRANSFER_VALUE_SATS" --fee-sats "$DEPOSIT_FEE_SATS" "$dest" 2>"$RUN_DIR/create-deposit.err" | tr -d '\r\n' | tail -1)"
  else
    txid="$(bitassets_cli transfer --value-sats "$TRANSFER_VALUE_SATS" --fee-sats "$TRANSFER_FEE_SATS" "$dest" 2>"$RUN_DIR/transfer.err" | tr -d '\r\n' | tail -1)"
  fi
  if [[ ! "$txid" =~ ^[0-9a-fA-F]{64}$ ]]; then
    log "FAIL cli $mode — txid=$txid"
    return 1
  fi
  echo "$txid"
}

mine_after_send() {
  local l1_blocks="${BITWINDOW_POST_L1_BLOCKS:-2}"
  log "Mining L1 blocks=$l1_blocks"
  (cd "$LOCAL_DEV" && perl -e 'alarm 120; exec @ARGV' ./scripts/mine-private-signet-blocks.sh "$l1_blocks") >>"$RUN_DIR/mine-l1.log" 2>&1
  log "Mining sidechain block"
  (cd "$LOCAL_DEV" && perl -e 'alarm 180; exec @ARGV' ./scripts/mine-bitassets-block.sh) >>"$RUN_DIR/mine-sidechain.log" 2>&1
}

write_summary() {
  local status="${1:-UNKNOWN}"
  cat >"$RUN_DIR/SUMMARY.txt" <<EOF
run_dir=$RUN_DIR
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
status=$status
bitassets_rpc_url=$BITASSETS_RPC_URL
simulator_address=$(cat "$ADDRESS_FILE" 2>/dev/null || echo MISSING)
transfer_mode=${TRANSFER_MODE:-unset}
transfer_txid=${TRANSFER_TXID:-unset}
l1_height=$(docker compose -f "$COMPOSE" exec -T mainchain drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount 2>/dev/null | tr -d '\r\n' || echo unknown)
sidechain_height=$(bitassets_cli get-blockcount 2>/dev/null | tr -d '\r\n' || echo unknown)
detox_setup=${DETOX_SETUP_EXIT:-unset}
detox_verify=${DETOX_VERIFY_EXIT:-unset}
EOF
  ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-bitwindow-to-simulator" 2>/dev/null || true
}

log "=== BitWindow → iOS simulator BitAssets receive test ==="
log "run_dir=$RUN_DIR"

log "Step 1: ensure BitAssets RPC"
bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh" | tee "$RUN_DIR/ensure-rpc.log"

log "Step 2: BitWindow stack"
if ! lsof -nP -iTCP:30301 -sTCP:LISTEN >/dev/null 2>&1; then
  (cd "$LOCAL_DEV" && BITWINDOW_SKIP_GUI=1 perl -e 'alarm 120; exec @ARGV' bash ./scripts/launch-bitwindow-local-signet.sh) \
    | tee "$RUN_DIR/bitwindow-launch.log"
else
  log "bitwindowd already listening on 30301"
fi

log "Step 3: Metro + simulator wallet setup (detox)"
start_metro_if_needed
export BITASSETS_BITWINDOW_RECEIVE_E2E=1
export BITASSETS_BITWINDOW_RECEIVE_ADDRESS_FILE="$ADDRESS_FILE"
export BITASSETS_BITWINDOW_RECEIVE_WALLET_LABEL="BitWindow-Recv-E2E"
export BITASSETS_BITWINDOW_RECEIVE_MIN_SATS="$TRANSFER_VALUE_SATS"
if perl -e 'alarm 300; exec @ARGV' npx detox test -c ios.debug tests/e2e/bitwindow_receive.spec.js \
  --testNamePattern 'setup:' --loglevel "${DETOX_LOGLEVEL:-info}" --reuse 2>&1 | tee "$RUN_DIR/detox-setup.log"; then
  DETOX_SETUP_EXIT=0
else
  DETOX_SETUP_EXIT=$?
  write_summary "FAIL_DETOX_SETUP"
  exit "$DETOX_SETUP_EXIT"
fi

DEST="$(tr -d '\r\n' <"$ADDRESS_FILE")"
log "simulator_bitassets_address=$DEST"
echo "simulator_bitassets_address=$DEST" >"$RUN_DIR/addresses.txt"

log "Step 5–6: fund + transfer"
TRANSFER_MODE="unset"
TRANSFER_TXID=""
if try_bitwindow_sidechain_deposit "$DEST"; then
  TRANSFER_MODE="bitwindow_create_sidechain_deposit"
  TRANSFER_TXID="$(python3 -c "import json; d=json.load(open('$RUN_DIR/bitwindow-create-sidechain-deposit.json')); print(d.get('txid') or d.get('depositTxid') or '')" 2>/dev/null || true)"
else
  if txid="$(fund_via_cli "$DEST" transfer)"; then
    TRANSFER_MODE="docker_cli_transfer"
    TRANSFER_TXID="$txid"
    echo "transfer_txid=$txid" | tee "$RUN_DIR/transfer.txt"
  elif txid="$(fund_via_cli "$DEST" deposit)"; then
    TRANSFER_MODE="docker_cli_create_deposit"
    TRANSFER_TXID="$txid"
    echo "deposit_txid=$txid" | tee "$RUN_DIR/transfer.txt"
  else
    write_summary "FAIL_TRANSFER"
    exit 1
  fi
fi

log "Step 7: mine blocks"
mine_after_send

log "Step 8: verify on simulator (detox)"
export BITASSETS_BITWINDOW_RECEIVE_VERIFY=1
(cd "$LOCAL_DEV" && perl -e 'alarm 90; exec @ARGV' ./scripts/mine-bitassets-block.sh) >>"$RUN_DIR/mine-sidechain-post-verify-prep.log" 2>&1 || true
if perl -e 'alarm 420; exec @ARGV' npx detox test -c ios.debug tests/e2e/bitwindow_receive.spec.js \
  --testNamePattern 'verify:' --loglevel "${DETOX_LOGLEVEL:-info}" --reuse 2>&1 | tee "$RUN_DIR/detox-verify.log"; then
  DETOX_VERIFY_EXIT=0
else
  DETOX_VERIFY_EXIT=$?
  write_summary "FAIL_DETOX_VERIFY"
  bash "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >>"$RUN_DIR/collect.log" 2>&1 || true
  exit "$DETOX_VERIFY_EXIT"
fi

log "Step 9: collect evidence"
bash "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >>"$RUN_DIR/collect.log" 2>&1 || true

write_summary "SUCCESS"
log "SUCCESS txid=$TRANSFER_TXID mode=$TRANSFER_MODE"
echo "SUMMARY=$RUN_DIR/SUMMARY.txt"
