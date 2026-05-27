#!/usr/bin/env bash
# Headless: RedWallet (BitAssets) + BitWindow share Luke's Docker private signet stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/redwallet-bitwindow-interop-${STAMP}"
mkdir -p "$RUN_DIR"

log() { echo "$(date +%Y-%m-%dT%H:%M:%S) $*" | tee -a "$RUN_DIR/verify.log"; }
FAIL=0
ok() { log "OK $*"; }
fail() { log "FAIL $*"; FAIL=$((FAIL + 1)); }

log "START shared signet interop -> $RUN_DIR"

if [[ -x "$ROOT/scripts/redwallet-signet-endpoints.sh" ]]; then
  REDWALLET_LOG_ROOT="$LOG_ROOT" "$ROOT/scripts/redwallet-signet-endpoints.sh" >"$RUN_DIR/endpoints.log" 2>&1 || true
  ENV_FILE="$(ls -td "${LOG_ROOT%/}"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
  if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    cp "$ENV_FILE" "$RUN_DIR/redwallet-signet.env"
    # shellcheck disable=SC1090
    source "$RUN_DIR/redwallet-signet.env"
    ok "RedWallet phone RPC env BITASSETS_RPC_URL=${BITASSETS_RPC_URL:-unset}"
  else
    fail "could not generate redwallet-signet.env"
  fi
else
  fail "missing scripts/redwallet-signet-endpoints.sh"
fi

if [[ -x "$LOCAL_DEV/scripts/verify-bitwindow-local-signet-headless.sh" ]]; then
  if BITWINDOW_LOCAL_BITCOIND_MODE=bridge REDWALLET_LOG_ROOT="$LOG_ROOT" \
    "$LOCAL_DEV/scripts/verify-bitwindow-local-signet-headless.sh" >"$RUN_DIR/bitwindow-headless.log" 2>&1; then
    ok "BitWindow local-signet headless verify"
  else
    fail "BitWindow headless verify — see $RUN_DIR/bitwindow-headless.log"
  fi
else
  fail "missing $LOCAL_DEV/scripts/verify-bitwindow-local-signet-headless.sh"
fi

L1_DOCKER=$(perl -e 'alarm 20; exec @ARGV' docker compose -f "$COMPOSE" exec -T mainchain \
  drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount 2>/dev/null | tr -d '\r\n' || echo err)
L1_BW=$(curl -sS -m 10 -X POST "http://127.0.0.1:30301/bitwindowd.v1.BitwindowdService/GetNetworkStats" \
  -H "Content-Type: application/json" -d "{}" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('blockHeight',''))" 2>/dev/null || true)
if [[ ! "$L1_BW" =~ ^[0-9]+$ ]]; then
  _RPC_AUTH="${BITCOIN_RPC_AUTH:-}"
  if [[ -z "$_RPC_AUTH" && -r "${LOCAL_DEV}/data/signet/.cookie" ]]; then
    _RPC_AUTH="$(cat "${LOCAL_DEV}/data/signet/.cookie")"
  fi
  L1_BW=$(curl -sS -m 12 ${_RPC_AUTH:+--user "$_RPC_AUTH"} \
    -d '{"jsonrpc":"1.0","id":"t","method":"getblockcount","params":[]}' \
    -H "content-type: application/json" http://127.0.0.1:38335/ 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null || echo err)
fi
SC=$(docker compose -f "$COMPOSE" exec -T bitassets plain_bitassets_app_cli get-blockcount 2>/dev/null | tr -d '\r\n' || echo err)

echo "l1_docker=$L1_DOCKER" >"$RUN_DIR/chain-heights.txt"
echo "l1_bitwindow=$L1_BW" >>"$RUN_DIR/chain-heights.txt"
echo "bitassets_sidechain=$SC" >>"$RUN_DIR/chain-heights.txt"

if [[ "$L1_DOCKER" =~ ^[0-9]+$ && "$L1_BW" =~ ^[0-9]+$ ]]; then
  delta=$((L1_DOCKER > L1_BW ? L1_DOCKER - L1_BW : L1_BW - L1_DOCKER))
  if [[ "$delta" -le 5 ]]; then
    ok "L1 tip aligned docker=$L1_DOCKER bitwindow=$L1_BW (delta=$delta)"
  else
    fail "L1 tip mismatch docker=$L1_DOCKER bitwindow=$L1_BW delta=$delta"
  fi
else
  fail "L1 tip unreadable docker=$L1_DOCKER bitwindow=$L1_BW"
fi

if [[ "$SC" =~ ^[0-9]+$ && "$SC" -gt 0 ]]; then
  ok "BitAssets sidechain blockcount=$SC (docker CLI)"
else
  fail "BitAssets sidechain blockcount=$SC"
fi

# Host :6004 often hangs under Colima; phones use same published port on LAN/Tailscale.
BA_CODE=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:6004/" 2>/dev/null || echo 000)
echo "bitassets_host_http_code=$BA_CODE" >>"$RUN_DIR/chain-heights.txt"
if [[ "$BA_CODE" == "000" ]]; then
  log "WARN host BitAssets HTTP on :6004 timed out (Colima); RedWallet phones use $BITASSETS_RPC_URL — use docker CLI for headless"
fi

cat >"$RUN_DIR/SUMMARY.txt" <<EOF
failures=$FAIL
l1_docker=$L1_DOCKER
l1_bitwindow=$L1_BW
bitassets_sidechain=$SC
bitassets_rpc_url=${BITASSETS_RPC_URL:-unset}
bitwindow_api=http://127.0.0.1:30301
orchestrator=http://127.0.0.1:30400
EOF

DEPOSIT_SUMMARY="$(ls -td "${LOG_ROOT%/}"/headless-bitassets-deposit-*/SUMMARY.txt 2>/dev/null | head -1 || true)"
if [[ -n "$DEPOSIT_SUMMARY" && -f "$DEPOSIT_SUMMARY" ]]; then
  cp "$DEPOSIT_SUMMARY" "$RUN_DIR/latest-l1-deposit.txt"
  TXID=$(grep '^deposit_txid=' "$DEPOSIT_SUMMARY" | cut -d= -f2-)
  ok "latest headless L1 deposit txid=$TXID ($DEPOSIT_SUMMARY)"
fi

ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-redwallet-bitwindow-interop" 2>/dev/null || true
log "END failures=$FAIL summary=$RUN_DIR/SUMMARY.txt"
exit "$FAIL"
