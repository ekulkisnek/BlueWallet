#!/usr/bin/env bash
# Bounded phone-origin retry then device log collect.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${1:-$LOG_ROOT/phone-retry-${STAMP}.log}"

export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export REDWALLET_BITASSETS_COMMAND_OPERATION="${REDWALLET_BITASSETS_COMMAND_OPERATION:-reserve}"
export REDWALLET_PHONE_MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-90}"
# Console attach drops CoreDevice XPC ~1s after launch; JS collector is the proof path.
export REDWALLET_MONITOR_CONSOLE="${REDWALLET_MONITOR_CONSOLE:-0}"
export REDWALLET_SKIP_BITASSETS_RESTART="${REDWALLET_SKIP_BITASSETS_RESTART:-1}"
export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-00008101-000128643E28001E}"

exec >>"$LOG" 2>&1
echo "RETRY_COLLECT_START $(date -Iseconds)"
cd "$ROOT_DIR"
set +e
perl -e 'alarm 240; exec @ARGV' bash scripts/retry-phone-origin-bitassets-proof.sh
retry_rc=$?
echo "RETRY_EXIT=$retry_rc"
perl -e 'alarm 120; exec @ARGV' bash scripts/collect-redwallet-device-logs.sh "$LOG_ROOT" 30
echo "COLLECT_DONE $(date -Iseconds)"
exit "$retry_rc"
