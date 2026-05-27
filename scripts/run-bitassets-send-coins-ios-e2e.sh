#!/usr/bin/env bash
# iOS simulator E2E: fund BitAssets wallet and send to BitWindow-style address (interop path).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${BITASSETS_SEND_COINS_E2E_LOG_DIR:-$LOG_ROOT/ios-send-coins-e2e-$STAMP}"
METRO_LOG="$RUN_DIR/metro.log"
PORT="${METRO_PORT:-8081}"

mkdir -p "$RUN_DIR"
cd "$ROOT_DIR"

port_open() {
  curl --silent --max-time 1 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1
}

start_metro_if_needed() {
  if port_open; then
    echo "metro_status=already_running" | tee -a "$RUN_DIR/run.log"
    return
  fi
  echo "metro_status=starting" | tee -a "$RUN_DIR/run.log"
  (cd "$ROOT_DIR" && npm start -- --port "$PORT" --reset-cache) >>"$METRO_LOG" 2>&1 &
  echo "$!" >"$RUN_DIR/metro.pid"
  for _ in $(seq 1 45); do
    if port_open; then
      echo "metro_status=ready" | tee -a "$RUN_DIR/run.log"
      return
    fi
    sleep 1
  done
  echo "metro_status=timeout" | tee -a "$RUN_DIR/run.log"
  tail -80 "$METRO_LOG" >>"$RUN_DIR/run.log" 2>&1 || true
  exit 1
}

export BITASSETS_E2E=1
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"
export BITASSETS_E2E_LOCAL_DEV_DIR="${BITASSETS_E2E_LOCAL_DEV_DIR:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
export BITASSETS_E2E_COMPOSE_FILE="${BITASSETS_E2E_COMPOSE_FILE:-docker-compose.local-minimal.yml}"
export BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
export BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/amd64}"

{
  echo "run_dir=$RUN_DIR"
  echo "bitassets_rpc_url=$BITASSETS_RPC_URL"
  start_metro_if_needed
  echo "detox_start=$(date -Iseconds)"
  npx detox test -c ios.debug tests/e2e/send_coins.spec.js --loglevel "${DETOX_LOGLEVEL:-info}" --reuse "$@"
  echo "detox_exit=$?"
} 2>&1 | tee -a "$RUN_DIR/run.log"

exit "${PIPESTATUS[0]}"
