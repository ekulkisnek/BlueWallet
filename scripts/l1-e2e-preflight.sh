#!/usr/bin/env bash
# Shared fail-fast preflight for L1 signet iOS↔Android E2E orchestrators.
#
# Env:
#   L1_E2E_COMPOSE_FILE          docker compose file (required)
#   L1_E2E_LOG_FILE              append log target (optional)
#   REDWALLET_ELECTRUM_HOST      electrum host (default 127.0.0.1)
#   REDWALLET_ELECTRUM_PORT      electrum port (default 60101)
#   L1_E2E_REQUIRE_ADB           1 to require adb device (default 0)
#   ANDROID_SERIAL               adb serial when L1_E2E_REQUIRE_ADB=1
#   L1_E2E_ELECTRUM_LAN_HOST     optional second probe host (e.g. Mac LAN)
set -euo pipefail

COMPOSE_FILE="${L1_E2E_COMPOSE_FILE:?L1_E2E_COMPOSE_FILE required}"
ELECTRUM_HOST="${REDWALLET_ELECTRUM_HOST:-127.0.0.1}"
ELECTRUM_PORT="${REDWALLET_ELECTRUM_PORT:-60101}"
ELECTRUM_LAN_HOST="${L1_E2E_ELECTRUM_LAN_HOST:-}"
REQUIRE_ADB="${L1_E2E_REQUIRE_ADB:-0}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
LOG_FILE="${L1_E2E_LOG_FILE:-}"

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  if [[ -n "$LOG_FILE" ]]; then
    printf '%s\n' "$line" >>"$LOG_FILE"
  fi
  printf '%s\n' "$line"
}

probe_tcp() {
  local host="$1"
  local port="$2"
  python3 - <<'PY' "$host" "$port"
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
with socket.create_connection((host, port), timeout=2):
    pass
PY
}

log "preflight start compose=$COMPOSE_FILE electrum=${ELECTRUM_HOST}:${ELECTRUM_PORT}"

if ! docker info >/dev/null 2>&1; then
  log "BLOCKER docker unavailable"
  exit 2
fi

if ! docker compose -f "$COMPOSE_FILE" ps mainchain 2>/dev/null | grep -q Up; then
  log "BLOCKER mainchain container not running"
  exit 2
fi

electrum_ok=0
if probe_tcp "$ELECTRUM_HOST" "$ELECTRUM_PORT" 2>/dev/null; then
  log "electrum ok host=$ELECTRUM_HOST port=$ELECTRUM_PORT"
  electrum_ok=1
elif [[ -n "$ELECTRUM_LAN_HOST" ]] && probe_tcp "$ELECTRUM_LAN_HOST" "$ELECTRUM_PORT" 2>/dev/null; then
  log "electrum ok host=$ELECTRUM_LAN_HOST port=$ELECTRUM_PORT (lan fallback)"
  electrum_ok=1
fi

if [[ "$electrum_ok" -ne 1 ]]; then
  log "BLOCKER electrum tcp unreachable on ${ELECTRUM_HOST}:${ELECTRUM_PORT}${ELECTRUM_LAN_HOST:+ or ${ELECTRUM_LAN_HOST}:${ELECTRUM_PORT}}"
  exit 2
fi

if [[ "$REQUIRE_ADB" == 1 ]]; then
  if ! adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
    log "BLOCKER adb device $ANDROID_SERIAL not ready"
    exit 2
  fi
  log "adb ok serial=$ANDROID_SERIAL"
fi

log "preflight ok"
exit 0
