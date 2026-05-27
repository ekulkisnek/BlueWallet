#!/usr/bin/env bash
# Colima VM serves BitAssets RPC but macOS :6004 POST can hang; restart Colima and poll host JSON-RPC.
#
# When to use this script (heavy — colima stop/start):
#   - curl POST to http://127.0.0.1:6004/ hangs or returns empty while TCP :6004 listens
#   - Docker Desktop holds a stale :6004 proxy (com.docke listener)
#
# Prefer first (light — no Colima restart):
#   scripts/ensure-bitassets-rpc-responsive.sh
#   (docker compose restart bitassets only)
#
# Skips automatically when host JSON-RPC already returns a result. Honors redwallet_colima_stop_blocked().
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOG="${1:-/Volumes/T705/redwallet-logs/limafwd-fix-$(date +%Y%m%d-%H%M%S).log}"
LOCAL="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE="${COMPOSE_FILE:-$LOCAL/docker-compose.local-minimal.yml}"
RPC_HOST="${REDWALLET_LIMAFWD_RPC_URL:-http://127.0.0.1:6004}"
PROBE_TIMEOUT="${REDWALLET_LIMAFWD_PROBE_TIMEOUT_SEC:-4}"

exec >>"$LOG" 2>&1
echo "LIMAFWD_START $(date -Iseconds)"

probe_host_rpc() {
  curl -sS -m "$PROBE_TIMEOUT" -X POST "${RPC_HOST%/}/" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>/dev/null
}

if r="$(probe_host_rpc)" && [[ "$r" == *'"result"'* ]]; then
  echo "LIMAFWD_SKIP rpc_ok result=$r"
  exit 0
fi

if redwallet_colima_stop_blocked; then
  echo "LIMAFWD_SKIP active_chain_or_lock (avoid colima stop)"
  exit 2
fi

# shellcheck source=redwallet-assert-colima-docker.sh
bash "$ROOT_DIR/scripts/redwallet-assert-colima-docker.sh" 2>/dev/null || true

# Docker Desktop can hold :6004 with a stale proxy while Colima serves the live bitassets VM port.
if lsof -iTCP:6004 -sTCP:LISTEN 2>/dev/null | grep -q com.docke; then
  echo "LIMAFWD quitting Docker Desktop (stale :6004 listener)"
  osascript -e 'tell application "Docker" to quit' 2>/dev/null || true
  sleep 3
  pids="$(lsof -tiTCP:6004 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill -TERM $pids 2>/dev/null || true
    sleep 2
  fi
fi

colima stop || true
colima start
if [[ -x "$LOCAL/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL/scripts/ensure-colima-overcommit.sh" || true
fi
cd "$LOCAL"
docker compose -f "$COMPOSE" up -d bitassets

for i in $(seq 1 30); do
  r="$(probe_host_rpc 2>&1 || true)"
  echo "poll=$i $r"
  if [[ "$r" == *'"result"'* ]]; then
    echo "LIMAFWD_OK $(date -Iseconds)"
    exit 0
  fi
  sleep 3
done

echo "LIMAFWD_FAIL $(date -Iseconds)"
exit 1
