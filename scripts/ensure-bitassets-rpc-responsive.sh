#!/usr/bin/env bash
# Restart bitassets when Colima-published :6004 accepts TCP but JSON-RPC POST hangs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"
bash "$ROOT_DIR/scripts/redwallet-assert-colima-docker.sh"

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.236:6004}"
TIMEOUT_SEC="${BITASSETS_RPC_PROBE_TIMEOUT_SEC:-5}"
MAX_WAIT_HEALTH="${BITASSETS_RPC_HEALTH_WAIT_SEC:-45}"
PROBE_OK_COUNT="${BITASSETS_RPC_PROBE_OK_COUNT:-1}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

probe_post() {
  curl -sS --max-time "$TIMEOUT_SEC" -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>/dev/null
}

probe_ok() {
  local result
  result="$(probe_post)"
  [[ -n "$result" && "$result" != *"curl:"* && "$result" == *'"result"'* ]]
}

consecutive_probes_ok() {
  local need="$1" i
  need="${need:-1}"
  for ((i = 1; i <= need; i++)); do
    if ! probe_ok; then
      return 1
    fi
  done
  return 0
}

if [[ -x "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" ]]; then
  bash "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" >/dev/null 2>&1 || true
fi

if consecutive_probes_ok "$PROBE_OK_COUNT"; then
  log "OK rpc=$RPC_URL probes=${PROBE_OK_COUNT}/${PROBE_OK_COUNT}"
  exit 0
fi

log "WARN JSON-RPC POST hung or empty on $RPC_URL — restarting bitassets"
docker compose -f "$COMPOSE_FILE" restart bitassets >/dev/null

deadline=$((SECONDS + MAX_WAIT_HEALTH))
while (( SECONDS < deadline )); do
  status="$(docker inspect -f '{{.State.Health.Status}}' private-drivechain-local-bitassets-1 2>/dev/null || echo starting)"
  if [[ "$status" == healthy ]]; then
    if consecutive_probes_ok "$PROBE_OK_COUNT"; then
      log "OK after restart rpc=$RPC_URL probes=${PROBE_OK_COUNT}/${PROBE_OK_COUNT}"
      exit 0
    fi
    break
  fi
  sleep 2
done

log "FAIL bitassets RPC still not responding on $RPC_URL (need ${PROBE_OK_COUNT} consecutive ok probes)"
exit 1
