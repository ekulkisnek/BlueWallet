#!/usr/bin/env bash
# Signet infra lane: stabilize RPC, ensure miner wallet, mine one sidechain block for reservation UTXOs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_ROOT/signet-mine-reservation-${STAMP}.log"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"

exec > >(tee -a "$LOG") 2>&1
echo "SIGNET_MINE_START $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -x "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" ]]; then
  "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" || true
fi

cd "$ROOT_DIR"
bash scripts/redwallet-signet-endpoints.sh >/dev/null || true
BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}" \
  bash scripts/ensure-bitassets-rpc-responsive.sh || true

bash "$ROOT_DIR/scripts/redwallet-ensure-signet-miner-wallet.sh"

before="$(docker compose -f "${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}" exec -T bitassets \
  plain_bitassets_app_cli get-blockcount 2>/dev/null | tr -d '\r\n' || echo 0)"
echo "sidechain_before=$before"

cd "$LOCAL_DEV"
if perl -e 'alarm 120; exec @ARGV' bash scripts/mine-bitassets-block.sh; then
  after="$(docker compose -f docker-compose.local-minimal.yml exec -T bitassets \
    plain_bitassets_app_cli get-blockcount 2>/dev/null | tr -d '\r\n' || echo 0)"
  echo "sidechain_after=$after"
  echo "SIGNET_MINE_OK log=$LOG"
  exit 0
fi

echo "SIGNET_MINE_FAIL log=$LOG"
exit 1
