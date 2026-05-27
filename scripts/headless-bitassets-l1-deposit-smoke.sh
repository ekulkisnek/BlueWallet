#!/usr/bin/env bash
# Headless L1→BitAssets deposit on Luke's local signet (shared RedWallet/BitWindow stack).
# Records txid for interop evidence without phones or GUI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT/scripts/redwallet-colima-docker-env.sh"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
export BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
export BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/amd64}"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/headless-bitassets-deposit-${STAMP}"
VALUE_SATS="${DEPOSIT_VALUE_SATS:-5000000}"
FEE_SATS="${DEPOSIT_FEE_SATS:-50000}"

mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

cli() {
  perl -e 'alarm 25; exec @ARGV' docker compose -f "$COMPOSE" exec -T bitassets plain_bitassets_app_cli "$@"
}

echo "=== headless BitAssets L1 deposit smoke ==="
perl -e 'alarm 25; exec @ARGV' docker compose -f "$COMPOSE" up -d mainchain enforcer bitassets >/dev/null
for _ in $(seq 1 15); do
  if docker compose -f "$COMPOSE" exec -T bitassets plain_bitassets_app_cli get-blockcount >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

ADDR="$(cli get-new-address 2>"$RUN_DIR/get-address.err" | tr -d '\r\n' | tail -1)"
if [[ -z "$ADDR" ]]; then
  echo "FAIL get-new-address — see $RUN_DIR/get-address.err" >&2
  exit 1
fi
echo "deposit_address=$ADDR" | tee "$RUN_DIR/deposit.txt"

TXID="$(cli create-deposit --value-sats "$VALUE_SATS" --fee-sats "$FEE_SATS" "$ADDR" 2>"$RUN_DIR/create-deposit.err" | tr -d '\r\n' | tail -1)"
if [[ -z "$TXID" || "$TXID" == *"error"* ]]; then
  echo "FAIL create-deposit — see $RUN_DIR/create-deposit.err" >&2
  exit 1
fi
echo "deposit_txid=$TXID" | tee -a "$RUN_DIR/deposit.txt"

L1_BLOCKS="${L1_MINE_BLOCKS:-3}"
echo "Mining L1 ($L1_BLOCKS) + sidechain blocks..."
(cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "$L1_BLOCKS" && ./scripts/mine-bitassets-block.sh)

SC="$(cli get-blockcount 2>/dev/null | tr -d '\r\n')"
L1="$(perl -e 'alarm 20; exec @ARGV' docker compose -f "$COMPOSE" exec -T mainchain \
  drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount 2>/dev/null | tr -d '\r\n')"

cat >"$RUN_DIR/SUMMARY.txt" <<EOF
deposit_address=$ADDR
deposit_txid=$TXID
value_sats=$VALUE_SATS
l1_blockcount=$L1
bitassets_blockcount=$SC
EOF

ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-headless-bitassets-deposit" 2>/dev/null || true
echo "OK headless deposit txid=$TXID l1=$L1 sc=$SC"
echo "SUMMARY=$RUN_DIR/SUMMARY.txt"
