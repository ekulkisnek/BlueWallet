#!/usr/bin/env bash
# Fund a signet L1 address from signet-miner (sendtoaddress + mine blocks).
# Usage: fund-l1-signet-address.sh <address> <amount_btc|sats> [l1_blocks]
set -euo pipefail

ADDRESS="${1:?address required}"
AMOUNT="${2:?amount required (btc decimal or integer sats)}"
L1_BLOCKS="${3:-${L1_MINE_BLOCKS:-3}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"

"$ROOT_DIR/scripts/redwallet-ensure-signet-miner-wallet.sh" >&2

dc() {
  docker compose -f "$COMPOSE_FILE" exec -T mainchain \
    drivechain-cli -signet -rpccookiefile=/data/signet/.cookie "$@"
}

wait_for_signet_miner_ready() {
  local scanning
  for _ in $(seq 1 90); do
    scanning="$(dc -rpcwallet=signet-miner getwalletinfo 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('scanning', False))" 2>/dev/null || echo true)"
    if [[ "$scanning" == "False" || "$scanning" == "false" ]]; then
      return 0
    fi
    sleep 2
  done
  dc -rpcwallet=signet-miner abortscan >/dev/null 2>&1 || true
  sleep 2
}

wait_for_signet_miner_ready

if [[ "$AMOUNT" =~ ^[0-9]+$ ]]; then
  BTC_AMOUNT="$(python3 - <<PY
print(f"{int('${AMOUNT}') / 1e8:.8f}")
PY
)"
else
  BTC_AMOUNT="$AMOUNT"
fi

txid="$(dc -rpcwallet=signet-miner sendtoaddress "$ADDRESS" "$BTC_AMOUNT" | tr -d '\r\n')"
if [[ ! "$txid" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "fund-l1-signet-address: unexpected sendtoaddress output: $txid" >&2
  exit 1
fi

printf '%s\n' "$txid"
(cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "$L1_BLOCKS") >&2
