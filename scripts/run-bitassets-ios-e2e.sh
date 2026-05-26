#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${BITASSETS_IOS_E2E_LOG_DIR:-$LOG_ROOT/ios-bitassets-e2e-$STAMP}"
METRO_LOG="$RUN_DIR/metro.log"
PORT="${METRO_PORT:-8081}"

mkdir -p "$RUN_DIR"
cd "$ROOT_DIR"

port_open() {
  curl --silent --max-time 1 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1
}

start_metro_if_needed() {
  if port_open; then
    echo "metro_status=already_running"
    return
  fi

  echo "metro_status=starting"
  (
    cd "$ROOT_DIR"
    npm start -- --port "$PORT" --reset-cache
  ) > "$METRO_LOG" 2>&1 &
  echo "$!" > "$RUN_DIR/metro.pid"

  for _ in $(seq 1 60); do
    if port_open; then
      echo "metro_status=ready"
      return
    fi
    sleep 1
  done

  echo "metro_status=timeout"
  tail -120 "$METRO_LOG" || true
  return 1
}

prewarm_ios_bundle() {
  local bundle_url="http://127.0.0.1:$PORT/index.bundle?platform=ios&dev=true&minify=false"
  echo "ios_bundle_status=prewarming"
  for _ in $(seq 1 3); do
    if curl --fail --silent --show-error --max-time 180 "$bundle_url" -o /dev/null; then
      echo "ios_bundle_status=ready"
      return 0
    fi
    sleep 2
  done

  echo "ios_bundle_status=timeout"
  tail -120 "$METRO_LOG" || true
  return 1
}

export BITASSETS_E2E="${BITASSETS_E2E:-1}"
export BITASSETS_E2E_FULL="${BITASSETS_E2E_FULL:-0}"
export BITASSETS_E2E_PROVE_MOBILE_FLOW="${BITASSETS_E2E_PROVE_MOBILE_FLOW:-0}"
export BITASSETS_E2E_REQUIRE_RPC="${BITASSETS_E2E_REQUIRE_RPC:-0}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://127.0.0.1:6004}"
export BITASSETS_E2E_LOCAL_DEV_DIR="${BITASSETS_E2E_LOCAL_DEV_DIR:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
export BITASSETS_E2E_COMPOSE_FILE="${BITASSETS_E2E_COMPOSE_FILE:-docker-compose.local-minimal.yml}"
export BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
export BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/amd64}"

start_metro_if_needed
prewarm_ios_bundle

echo "run_dir=$RUN_DIR"
echo "metro_log=$METRO_LOG"
echo "bitassets_rpc_url=$BITASSETS_RPC_URL"
echo "bitassets_image=$BITASSETS_IMAGE"
echo "bitassets_platform=$BITASSETS_PLATFORM"

npx detox test -c ios.debug tests/e2e/bitassets.spec.js --loglevel "${DETOX_LOGLEVEL:-info}" --reuse "$@"
