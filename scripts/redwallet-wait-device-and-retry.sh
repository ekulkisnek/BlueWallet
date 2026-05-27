#!/usr/bin/env bash
# Wait until iPhone 12 is launchable in devicectl, then run phone retry+collect.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${1:-$LOG_ROOT/wait-retry-${STAMP}.log}"
POLL_SEC="${REDWALLET_DEVICE_POLL_SEC:-5}"
MAX_WAIT="${REDWALLET_DEVICE_WAIT_SEC:-600}"

exec >>"$LOG" 2>&1
echo "WAIT_RETRY_START $(date -Iseconds) udid=$UDID max_wait=${MAX_WAIT}s"

deadline=$((SECONDS + MAX_WAIT))
while (( SECONDS < deadline )); do
  line="$(xcrun devicectl list devices --columns '*' 2>/dev/null | awk -v u="$UDID" '$0 ~ u { print $0 }' || true)"
  if [[ -n "$line" ]] && [[ "$line" != *unavailable* ]] &&
    [[ "$line" == *connected* || "$line" == *"available (paired)"* || "$line" == *connecting* ]]; then
    echo "DEVICE_READY $(date -Iseconds) $line"
    break
  fi
  echo "waiting_device $(date -Iseconds) ${line:-not_listed}"
  sleep "$POLL_SEC"
done

if (( SECONDS >= deadline )); then
  echo "DEVICE_WAIT_TIMEOUT $(date -Iseconds)"
  exit 2
fi

export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export REDWALLET_BITASSETS_COMMAND_OPERATION="${REDWALLET_BITASSETS_COMMAND_OPERATION:-reserve}"
export REDWALLET_PHONE_MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-75}"
export REDWALLET_MONITOR_CONSOLE="${REDWALLET_MONITOR_CONSOLE:-0}"

RETRY_LOG="$LOG_ROOT/phone-retry-after-wait-${STAMP}.log"
"$ROOT_DIR/scripts/redwallet-phone-retry-and-collect.sh" "$RETRY_LOG"
rc=$?
echo "WAIT_RETRY_DONE exit=$rc retry_log=$RETRY_LOG"
exit "$rc"
