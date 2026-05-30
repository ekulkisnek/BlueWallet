#!/usr/bin/env bash
# Ensure L1 Electrum on :60101 is reachable and indexed for private signet E2E.
# Prefers mempool/electrs backed by docker mainchain (reliable scripthash balances).
# Falls back to florestad only when electrs is unavailable.
#
# Usage: ensure-l1-electrum.sh
set -euo pipefail

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
ELECTRUM_PORT="${REDWALLET_ELECTRUM_PORT:-60101}"
ELECTRS_CONTAINER="${L1_ELECTRS_CONTAINER:-l1-electrs-shim}"
DOCKER_NETWORK="${L1_DOCKER_NETWORK:-private-drivechain-local_default}"
MAINCHAIN_VOLUME="${L1_MAINCHAIN_VOLUME:-private-drivechain-local_mainchain-data}"
MAINCHAIN_HOST="${L1_MAINCHAIN_HOST:-private-drivechain-local-mainchain-1}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

probe_tcp() {
  python3 - <<'PY' "$1" "$2"
import socket, sys
with socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=3):
    pass
PY
}

mainchain_height() {
  docker compose -f "$COMPOSE_FILE" exec -T mainchain     drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount 2>/dev/null | tr -d '
' || echo 0
}

# Mainchain returns 0 while the container is still starting RPC (supervisor race).
wait_mainchain_block_height() {
  local deadline=$((SECONDS + 180))
  local mc=0
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    if docker compose -f "$COMPOSE_FILE" ps mainchain 2>/dev/null | grep -qE 'Up.*healthy'; then
      mc="$(mainchain_height)"
      if [[ "$mc" =~ ^[0-9]+$ ]] && [[ "$mc" -gt 0 ]]; then
        echo "$mc"
        return 0
      fi
      log "mainchain_warmup height=${mc:-0}"
    else
      log "mainchain_warmup waiting for healthy"
    fi
    sleep 3
  done
  echo 0
  return 1
}

electrum_height() {
  python3 - <<'PY' "$ELECTRUM_PORT"
import json, socket, sys
port = int(sys.argv[1])
payload = json.dumps({"id": 1, "method": "blockchain.headers.subscribe", "params": []}) + "\n"
with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
    s.sendall(payload.encode())
    line = s.makefile().readline()
res = json.loads(line)
result = res.get("result")
if isinstance(result, list) and result:
    print(int(result[0]))
elif isinstance(result, dict):
    print(int(result.get("height", 0) or 0))
else:
    print(0)
PY
}

stop_florestad() {
  pkill -f 'florestad.*--electrum-address 127.0.0.1:'"$ELECTRUM_PORT" 2>/dev/null || pkill florestad 2>/dev/null || true
}

start_electrs() {
  stop_florestad
  docker rm -f "$ELECTRS_CONTAINER" >/dev/null 2>&1 || true
  log "starting electrs container=$ELECTRS_CONTAINER port=$ELECTRUM_PORT"
  docker run -d --name "$ELECTRS_CONTAINER" \
    --network "$DOCKER_NETWORK" \
    -v "${MAINCHAIN_VOLUME}:/daemon-dir:ro" \
    -p "127.0.0.1:${ELECTRUM_PORT}:50001" \
    mempool/electrs \
    -vv \
    --daemon-dir=/daemon-dir \
    --daemon-rpc-addr="${MAINCHAIN_HOST}:38332" \
    --electrum-rpc-addr=0.0.0.0:50001 \
    --network=signet \
    --jsonrpc-import >>/Volumes/T705/redwallet-logs/l1-electrs-shim.log 2>&1
  for _ in $(seq 1 90); do
    if probe_tcp 127.0.0.1 "$ELECTRUM_PORT" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  log "BLOCKER electrs did not bind :$ELECTRUM_PORT"
  return 2
}

wait_electrs_caught_up() {
  local mc="$1"
  local deadline=$((SECONDS + 300))
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    local eh drift
    eh="$(electrum_height 2>/dev/null || echo 0)"
    drift=$((mc - eh))
    log "electrs_catchup mainchain=$mc electrum_headers=$eh drift=$drift"
    if [[ "$eh" -gt 0 && "$drift" -le 3 ]]; then
      return 0
    fi
    sleep 5
  done
  log "WARN electrs header drift persists; continuing (mainchain RPC fallback may apply)"
  return 0
}

log "ensure_l1_electrum port=$ELECTRUM_PORT"

if ! docker compose -f "$COMPOSE_FILE" ps mainchain 2>/dev/null | grep -q Up; then
  log "BLOCKER mainchain container not running"
  exit 2
fi

mc="$(wait_mainchain_block_height)" || mc=0
if [[ "$mc" -eq 0 ]]; then
  log "BLOCKER mainchain height 0 after warmup"
  exit 2
fi
log "mainchain_ready height=$mc"

if docker ps --format '{{.Names}}' | grep -qx "$ELECTRS_CONTAINER"; then
  eh="$(electrum_height 2>/dev/null || echo 0)"
  drift=$((mc - eh))
  log "electrs already running headers=$eh mainchain=$mc drift=$drift"
  if [[ "$eh" -gt 0 && "$drift" -le 5 ]]; then
    log "l1_electrum ok (electrs)"
    exit 0
  fi
fi

if probe_tcp 127.0.0.1 "$ELECTRUM_PORT" 2>/dev/null; then
  eh="$(electrum_height 2>/dev/null || echo 0)"
  drift=$((mc - eh))
  if [[ "$eh" -gt 0 && "$drift" -le 5 ]]; then
    log "l1_electrum ok port=$ELECTRUM_PORT headers=$eh"
    exit 0
  fi
  log "electrum port open but lagging (headers=$eh drift=$drift) — switching to electrs"
fi

start_electrs || exit 2
wait_electrs_caught_up "$mc"
log "l1_electrum ok (electrs started)"
exit 0
