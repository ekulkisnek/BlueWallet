#!/usr/bin/env bash
# Restart bitassets when Colima-published :6004 accepts TCP but JSON-RPC POST hangs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
TIMEOUT_SEC="${BITASSETS_RPC_PROBE_TIMEOUT_SEC:-5}"
MAX_WAIT_HEALTH="${BITASSETS_RPC_HEALTH_WAIT_SEC:-45}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

probe_post() {
  curl -sS --max-time "$TIMEOUT_SEC" -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>/dev/null
}

if [[ -x "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" >/dev/null 2>&1 || true
fi

if result="$(probe_post)" && [[ -n "$result" && "$result" != *"curl:"* ]]; then
  log "OK rpc=$RPC_URL result=$result"
  exit 0
fi

log "WARN JSON-RPC POST hung or empty on $RPC_URL — restarting bitassets"
docker compose -f "$COMPOSE_FILE" restart bitassets >/dev/null

deadline=$((SECONDS + MAX_WAIT_HEALTH))
while (( SECONDS < deadline )); do
  status="$(docker inspect -f '{{.State.Health.Status}}' private-drivechain-local-bitassets-1 2>/dev/null || echo starting)"
  if [[ "$status" == healthy ]]; then
    if result="$(probe_post)" && [[ -n "$result" && "$result" != *"curl:"* ]]; then
      log "OK after restart rpc=$RPC_URL result=$result"
      exit 0
    fi
    break
  fi
  sleep 2
done

log "FAIL bitassets RPC still not responding on $RPC_URL"
exit 1
