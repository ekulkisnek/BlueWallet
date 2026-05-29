#!/usr/bin/env bash
# Push reserve command to device, then poll JS collector for selftest_ok (no devicectl launch).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
EVENTS="${REDWALLET_COLLECTOR_EVENTS:-$LOG_ROOT/ios-real-device-selftest-20260526-174300/js-event-collector/events.ndjson}"
UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"
LOG="${1:-$LOG_ROOT/push-poll-$(date +%Y%m%d-%H%M%S).log}"
POLLS="${REDWALLET_PUSH_POLL_COUNT:-20}"
SLEEP_SEC="${REDWALLET_PUSH_POLL_SEC:-3}"

exec >>"$LOG" 2>&1
echo "PUSH_POLL_START $(date -Iseconds)"

export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-$UDID}"
export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
export REDWALLET_PHONE_SKIP_LAUNCH=1
export REDWALLET_SKIP_BITASSETS_RESTART="${REDWALLET_SKIP_BITASSETS_RESTART:-1}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"

cd "$ROOT_DIR"
bash scripts/retry-phone-origin-bitassets-proof.sh || true

echo "PUSH_DONE — force-quit and reopen RedWallet on phone if no new selftest events"
for ((i = 1; i <= POLLS; i++)); do
  if [[ -f "$EVENTS" ]]; then
    hit="$(rg 'real_device_bitassets_selftest_ok' "$EVENTS" 2>/dev/null | rg '192\.168\.1\.165|26\.2|26\.5' | tail -1 || true)"
    if [[ -n "$hit" ]]; then
      echo "PROOF_OK poll=$i $hit"
      exit 0
    fi
    begin="$(rg 'real_device_bitassets_selftest_begin' "$EVENTS" 2>/dev/null | rg '192\.168\.1\.165' | tail -1 || true)"
    err="$(rg 'real_device_bitassets_selftest_error' "$EVENTS" 2>/dev/null | rg '192\.168\.1\.165' | tail -1 || true)"
    echo "poll=$i begin=$( [[ -n "$begin" ]] && echo yes || echo no ) err=$( [[ -n "$err" ]] && echo yes || echo no )"
  fi
  sleep "$SLEEP_SEC"
done
echo "PUSH_POLL_TIMEOUT $(date -Iseconds)"
exit 2
