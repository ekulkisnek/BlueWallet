#!/usr/bin/env bash
# Wait for host :6004 JSON-RPC, then run phone retry+collect.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
LOG="${1:-$LOG_ROOT/wait-rpc-retry-$(date +%Y%m%d-%H%M%S).log}"
MAX_WAIT="${REDWALLET_RPC_WAIT_SEC:-180}"
POLL_SEC="${REDWALLET_RPC_POLL_SEC:-3}"

exec >>"$LOG" 2>&1
echo "WAIT_RPC_RETRY_START $(date -Iseconds)"

deadline=$((SECONDS + MAX_WAIT))
while (( SECONDS < deadline )); do
  r="$(curl -sS -m 4 -X POST http://127.0.0.1:6004/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "rpc_poll $r"
  if [[ "$r" == *'"result"'* ]]; then
    echo "RPC_OK $(date -Iseconds)"
    break
  fi
  sleep "$POLL_SEC"
done

if [[ "$r" != *'"result"'* ]]; then
  echo "RPC_WAIT_TIMEOUT $(date -Iseconds)"
  exit 2
fi

export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-00008101-000128643E28001E}"
export REDWALLET_MONITOR_CONSOLE="${REDWALLET_MONITOR_CONSOLE:-0}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
export REDWALLET_PHONE_MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-90}"
export REDWALLET_BITASSETS_COMMAND_OPERATION="${REDWALLET_BITASSETS_COMMAND_OPERATION:-reserve}"

"$ROOT_DIR/scripts/redwallet-phone-retry-and-collect.sh" "$LOG_ROOT/phone-retry-after-rpc-$(date +%Y%m%d-%H%M%S).log"
rc=$?
echo "WAIT_RPC_RETRY_DONE exit=$rc"
exit "$rc"
