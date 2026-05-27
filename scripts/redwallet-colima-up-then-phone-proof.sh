#!/usr/bin/env bash
# Start Colima + bitassets, wait for host :6004 RPC, then phone retry+collect.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${1:-/Volumes/T705/redwallet-logs/colima-up-proof-$(date +%Y%m%d-%H%M%S).log}"
LOCAL="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL/docker-compose.local-minimal.yml}"

exec >>"$LOG" 2>&1
echo "COLIMA_UP_PROOF_START $(date -Iseconds)"

if ! colima status 2>/dev/null | grep -qi running || ! docker info >/dev/null 2>&1; then
  colima stop 2>/dev/null || true
  colima start
fi
if [[ -x "$LOCAL/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL/scripts/ensure-colima-overcommit.sh" || true
fi
cd "$LOCAL"
docker compose -f "$COMPOSE" up -d bitassets

for i in $(seq 1 40); do
  r="$(curl -sS -m 4 -X POST http://127.0.0.1:6004/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "rpc_poll=$i $r"
  if [[ "$r" == *result* ]]; then
    echo "HOST_RPC_OK $(date -Iseconds)"
    break
  fi
  sleep 3
done

export REDWALLET_SKIP_BITASSETS_RESTART=1
export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-00008101-000128643E28001E}"
export REDWALLET_MONITOR_CONSOLE=0
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"

"$ROOT_DIR/scripts/redwallet-phone-retry-and-collect.sh" \
  "/Volumes/T705/redwallet-logs/phone-retry-after-colima-up-$(date +%Y%m%d-%H%M%S).log"
rc=$?
echo "COLIMA_UP_PROOF_DONE exit=$rc $(date -Iseconds)"
exit "$rc"
