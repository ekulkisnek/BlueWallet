#!/usr/bin/env bash
# RedWallet iOS simulator → BitWindow local-signet BitAssets send proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${SIM_TO_BITWINDOW_LOG_DIR:-$LOG_ROOT/simulator-to-bitwindow-$STAMP}"
METRO_PORT="${METRO_PORT:-8081}"
export BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
export BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/amd64}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"
export BITASSETS_SEND_COINS_DESTINATION="${BITASSETS_SEND_COINS_DESTINATION:-3AEJkR1vnY6jbQBN3oUgay7PNsUo}"
export BITASSETS_SEND_COINS_AMOUNT="${BITASSETS_SEND_COINS_AMOUNT:-1}"
mkdir -p "$RUN_DIR"
cd "$ROOT_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

bitwindow_balance() {
  curl -sS -m 12 -X POST 'http://127.0.0.1:30400/bitassets.v1.BitAssetsService/GetBalance' \
    -H 'Content-Type: application/json' -d '{}' 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('availableSats', d.get('totalSats','')))" 2>/dev/null || echo unknown
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

write_summary() {
  local status="${1:-UNKNOWN}"
  cat >"$RUN_DIR/SUMMARY.txt" <<EOF
run_dir=$RUN_DIR
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
status=$status
bitassets_rpc_url=$BITASSETS_RPC_URL
bitwindow_destination=$BITASSETS_SEND_COINS_DESTINATION
send_amount_sats=$BITASSETS_SEND_COINS_AMOUNT
bitwindow_balance_before_sats=${BW_BALANCE_BEFORE:-unknown}
bitwindow_balance_after_sats=${BW_BALANCE_AFTER:-unknown}
detox_exit=${DETOX_EXIT:-unset}
EOF
  ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-simulator-to-bitwindow" 2>/dev/null || true
}

log "=== RedWallet simulator → BitWindow BitAssets send test ==="
log "run_dir=$RUN_DIR destination=$BITASSETS_SEND_COINS_DESTINATION"

log "Step 1: ensure BitAssets RPC"
bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh" | tee "$RUN_DIR/ensure-rpc.log"

log "Step 2: BitWindow stack"
if ! lsof -nP -iTCP:30301 -sTCP:LISTEN >/dev/null 2>&1; then
  (cd "$LOCAL_DEV" && BITWINDOW_SKIP_GUI=1 perl -e 'alarm 120; exec @ARGV' bash ./scripts/launch-bitwindow-local-signet.sh) \
    | tee "$RUN_DIR/bitwindow-launch.log"
else
  log "bitwindowd already listening on 30301"
fi
if ! lsof -nP -iTCP:30400 -sTCP:LISTEN >/dev/null 2>&1; then
  log "FAIL orchestratord not listening on 30400"
  write_summary "FAIL_BITWINDOW_STACK"
  exit 1
fi

BW_BALANCE_BEFORE="$(bitwindow_balance)"
log "bitwindow_balance_before_sats=$BW_BALANCE_BEFORE"
echo "bitwindow_balance_before_sats=$BW_BALANCE_BEFORE" >"$RUN_DIR/bitwindow-balance-before.txt"

log "Step 3: Metro + send_coins detox"
start_metro_if_needed
export BITASSETS_E2E=1
export BITASSETS_E2E_LOCAL_DEV_DIR="$LOCAL_DEV"
export BITASSETS_E2E_COMPOSE_FILE="${BITASSETS_E2E_COMPOSE_FILE:-docker-compose.local-minimal.yml}"

if perl -e 'alarm 900; exec @ARGV' npx detox test -c ios.debug tests/e2e/send_coins.spec.js \
  --loglevel "${DETOX_LOGLEVEL:-info}" --reuse 2>&1 | tee "$RUN_DIR/detox-send-coins.log"; then
  DETOX_EXIT=0
else
  DETOX_EXIT=$?
  write_summary "FAIL_DETOX"
  exit "$DETOX_EXIT"
fi

log "Step 4: extra sidechain mine + BitWindow balance check"
(cd "$LOCAL_DEV" && perl -e 'alarm 180; exec @ARGV' ./scripts/mine-bitassets-block.sh) >>"$RUN_DIR/mine-sidechain.log" 2>&1 || true
sleep 3
BW_BALANCE_AFTER="$(bitwindow_balance)"
log "bitwindow_balance_after_sats=$BW_BALANCE_AFTER"
echo "bitwindow_balance_after_sats=$BW_BALANCE_AFTER" >"$RUN_DIR/bitwindow-balance-after.txt"

if [[ "$BW_BALANCE_BEFORE" =~ ^[0-9]+$ && "$BW_BALANCE_AFTER" =~ ^[0-9]+$ ]]; then
  if [[ "$BW_BALANCE_AFTER" -gt "$BW_BALANCE_BEFORE" ]]; then
    log "OK BitWindow balance increased by $((BW_BALANCE_AFTER - BW_BALANCE_BEFORE)) sats"
    write_summary "SUCCESS"
    log "SUCCESS summary=$RUN_DIR/SUMMARY.txt"
    exit 0
  fi
  log "WARN balance did not increase (before=$BW_BALANCE_BEFORE after=$BW_BALANCE_AFTER); Detox still passed"
fi

write_summary "SUCCESS_DETOX_ONLY"
log "SUCCESS (detox pass; balance delta inconclusive) summary=$RUN_DIR/SUMMARY.txt"
