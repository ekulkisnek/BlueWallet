#!/usr/bin/env bash
# Colima VM serves BitAssets RPC but macOS :6004 POST can hang; restart Colima and poll host JSON-RPC.
set -euo pipefail

LOG="${1:-/Volumes/T705/redwallet-logs/limafwd-fix-$(date +%Y%m%d-%H%M%S).log}"
LOCAL="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL/docker-compose.local-minimal.yml}"

exec >>"$LOG" 2>&1
echo "LIMAFWD_START $(date -Iseconds)"

colima stop || true
colima start
if [[ -x "$LOCAL/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL/scripts/ensure-colima-overcommit.sh" || true
fi
cd "$LOCAL"
docker compose -f "$COMPOSE" up -d bitassets

for i in $(seq 1 30); do
  r="$(curl -sS -m 4 -X POST http://127.0.0.1:6004/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "poll=$i $r"
  if [[ "$r" == *'"result"'* ]]; then
    echo "LIMAFWD_OK $(date -Iseconds)"
    exit 0
  fi
  sleep 3
done

echo "LIMAFWD_FAIL $(date -Iseconds)"
exit 1
