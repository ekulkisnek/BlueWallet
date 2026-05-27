#!/usr/bin/env bash
# Restart Colima + bitassets when JSON-RPC on :6004 hangs. Logs COLIMA_DONE or COLIMA_FAIL.
set -euo pipefail

LOG="${1:-/Volumes/T705/redwallet-logs/colima-recover-latest.log}"
LOCAL="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL/docker-compose.local-minimal.yml}"

exec >>"$LOG" 2>&1
echo "RECOVER_START $(date -Iseconds)"

colima stop || true
colima start
if [[ -x "$LOCAL/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL/scripts/ensure-colima-overcommit.sh" || true
fi
docker compose -f "$COMPOSE" up -d bitassets

for i in $(seq 1 30); do
  r="$(curl -sS -m 4 -X POST http://127.0.0.1:6004/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "poll=$i $r"
  if [[ "$r" == *'"result"'* ]]; then
    echo "COLIMA_DONE $(date -Iseconds)"
    exit 0
  fi
  sleep 3
done

echo "COLIMA_FAIL $(date -Iseconds)"
exit 1
