#!/usr/bin/env bash
# Restart Colima + bitassets when JSON-RPC on :6004 hangs. Logs COLIMA_DONE or COLIMA_FAIL.
# Prefer ensure-bitassets-rpc-responsive.sh (bitassets-only). Skips colima stop when chains are active.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOG="${1:-/Volumes/T705/redwallet-logs/colima-recover-latest.log}"
LOCAL="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL/docker-compose.local-minimal.yml}"
RPC_HOST="${REDWALLET_COLIMA_RECOVER_RPC_URL:-http://127.0.0.1:6004}"

exec >>"$LOG" 2>&1
echo "RECOVER_START $(date -Iseconds)"

probe_host_rpc() {
  curl -sS -m 4 -X POST "${RPC_HOST%/}/" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>/dev/null
}

if r="$(probe_host_rpc)" && [[ "$r" == *'"result"'* ]]; then
  echo "RECOVER_SKIP rpc_ok"
  exit 0
fi

if redwallet_colima_stop_blocked; then
  echo "RECOVER_SKIP active_chain_or_lock"
  exit 2
fi

bash "$ROOT_DIR/scripts/redwallet-assert-colima-docker.sh" 2>/dev/null || true

colima stop || true
colima start
if [[ -x "$LOCAL/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL/scripts/ensure-colima-overcommit.sh" || true
fi
docker compose -f "$COMPOSE" up -d bitassets

for i in $(seq 1 30); do
  r="$(probe_host_rpc 2>&1 || true)"
  echo "poll=$i $r"
  if [[ "$r" == *'"result"'* ]]; then
    echo "COLIMA_DONE $(date -Iseconds)"
    exit 0
  fi
  sleep 3
done

echo "COLIMA_FAIL $(date -Iseconds)"
exit 1
