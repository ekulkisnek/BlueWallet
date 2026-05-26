#!/usr/bin/env bash
# Print status of Metro/collector/command-server and exact start commands (no blocking daemons).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
METRO_URL="${METRO_URL:-http://100.76.117.106:8081}"
COLLECTOR_URL="${REDWALLET_LOG_COLLECTOR_HEALTH_URL:-http://192.168.1.50:6123/health}"
COMMAND_URL="${REDWALLET_BITASSETS_COMMAND_HEALTH_URL:-http://192.168.1.50:6124/health}"

if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  METRO_URL="${METRO_URL:-http://100.76.117.106:8081}"
fi

check() {
  local name="$1"
  local url="$2"
  local body
  body="$(curl -sS -m 3 "$url" 2>/dev/null || true)"
  if [[ "$name" == metro && "$body" == *packager-status:running* ]]; then
    echo "OK   $name $url"
    return 0
  fi
  if [[ "$name" != metro && ( "$body" == *'"ok":true'* || "$body" == ok ) ]]; then
    echo "OK   $name $url"
    return 0
  fi
  echo "DOWN $name $url (${body:-no response})"
  return 1
}

command_server_ok() {
  local base="${COMMAND_URL%/health}"
  local health body
  health="$(curl -sS -m 3 "${base}/health" 2>/dev/null || true)"
  if [[ "$health" == *'"ok":true'* || "$health" == ok ]]; then
    return 0
  fi
  body="$(curl -sS -m 3 "${base}/command" 2>/dev/null || true)"
  [[ "$body" == *'"operation"'* && "$body" == *createWallet* ]]
}

metro_ok=0
collector_ok=0
command_ok=0
check metro "${METRO_URL}/status" && metro_ok=1 || true
check collector "$COLLECTOR_URL" && collector_ok=1 || true
if command_server_ok; then
  echo "OK   command ${COMMAND_URL%/health}/command (health or legacy /command)"
  command_ok=1
else
  echo "DOWN command $COMMAND_URL (no /health and no createWallet /command)"
fi

echo ""
echo "Start missing services (run each in its own terminal or tmux pane):"
if [[ "$metro_ok" -eq 0 ]]; then
  echo "  cd '$ROOT_DIR' && npx react-native start --host 0.0.0.0 --port 8081"
fi
if [[ "$collector_ok" -eq 0 ]]; then
  echo "  node '$ROOT_DIR/scripts/redwallet-log-collector-server.js'"
fi
if [[ "$command_ok" -eq 0 ]]; then
  echo "  BITASSETS_RPC_URL='${BITASSETS_RPC_URL:-http://100.76.117.106:6004}' node '$ROOT_DIR/scripts/redwallet-bitassets-command-server.js'"
fi
echo ""
echo "Then (phone unlocked + USB connected):"
echo "  cd '$ROOT_DIR' && scripts/retry-phone-origin-bitassets-proof.sh"

if [[ "$metro_ok" -eq 1 && "$collector_ok" -eq 1 && "$command_ok" -eq 1 ]]; then
  exit 0
fi
exit 1
