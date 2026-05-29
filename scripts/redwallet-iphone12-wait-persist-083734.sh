#!/usr/bin/env bash
# iPhone 12 lane: wait for USB, then post-restart transfer for RWFLEET20260527-083734 (no Docker).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${REDWALLET_WAIT_PERSIST_LOG:-$LOG_ROOT/iphone12-wait-persist-${STAMP}.log}"
POLL_SEC="${REDWALLET_DEVICE_POLL_SEC:-5}"
MAX_WAIT="${REDWALLET_DEVICE_WAIT_SEC:-7200}"
# On-chain id for RWFLEET20260527-083734 (register txid 94e41751… is not the asset id).
ASSET_ID="${REDWALLET_BITASSETS_TRANSFER_ASSET_ID:-78bc56110e80899198568cff06edc2b4b25c319d3edfe61cc34a52943dd79ce8}"

exec >>"$LOG" 2>&1
echo "IPHONE12_WAIT_PERSIST_START $(date -Iseconds) udid=$UDID asset_id=$ASSET_ID max_wait=${MAX_WAIT}s"

iphone12_devicectl_line() {
  xcrun devicectl list devices 2>/dev/null | awk '/iPhone 12 mini/ { print $0; exit }'
}

liphone_connected_warn() {
  local lip
  lip="$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone XS/ && /connected/ { print $0; exit }')"
  if [[ -n "$lip" ]]; then
    echo "WARN_LIPHONE_CONNECTED unplug LiPhone before iPhone12 chain $(date -Iseconds) $lip"
  fi
}

deadline=$((SECONDS + MAX_WAIT))
wait_poll=0
while (( SECONDS < deadline )); do
  wait_poll=$((wait_poll + 1))
  if (( wait_poll == 1 || wait_poll % 12 == 0 )); then
    liphone_connected_warn
  fi
  line="$(iphone12_devicectl_line || true)"
  if [[ -n "$line" ]] && [[ "$line" != *unavailable* ]] &&
    [[ "$line" == *connected* || "$line" == *"available (paired)"* || "$line" == *connecting* ]]; then
    echo "DEVICE_READY $(date -Iseconds) $line"
    break
  fi
  echo "waiting_device $(date -Iseconds) ${line:-iphone12_not_listed}"
  sleep "$POLL_SEC"
done

if (( SECONDS >= deadline )); then
  echo "DEVICE_WAIT_TIMEOUT $(date -Iseconds)"
  exit 2
fi

export REDWALLET_FORCE_LAUNCH_UDID="$UDID"
export REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}"
export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
export REDWALLET_BITASSETS_RPC_MAC="$BITASSETS_RPC_URL"
export REDWALLET_CHAIN_PERSIST_ONLY=1
export REDWALLET_BITASSETS_TRANSFER_ASSET_ID="$ASSET_ID"
export REDWALLET_SKIP_DOCKER_LOOKUP=1
export REDWALLET_SKIP_CHAIN_MINE=1
export REDWALLET_PHONE_SKIP_LAUNCH=0
export REDWALLET_SKIP_BITASSETS_RESTART=1

cd "$ROOT_DIR"
perl -e 'alarm 600; exec @ARGV' bash scripts/redwallet-phone-chain-reserve-register.sh "$UDID"
rc=$?
echo "IPHONE12_WAIT_PERSIST_DONE exit=$rc log=$LOG"
exit "$rc"
