#!/usr/bin/env bash
# Read-only Android fleet summary: RPC height, chain lock, latest CHAIN_OK.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
RPC_URL="${BITASSETS_RPC_URL:-${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}}"
LOCK_DIR="${LOG_ROOT}/android-phone-chain-$(echo "$SERIAL" | tr -cd 'a-zA-Z0-9').lock.d"
SAFE_SERIAL="$(echo "$SERIAL" | tr -cd 'a-zA-Z0-9')"

echo "FLEET_STATUS $(date -Iseconds) serial=$SERIAL"

rpc_body="$(curl -sS -m 6 -X POST "${RPC_URL%/}/" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
if [[ "$rpc_body" == *'"result"'* ]]; then
  height="$(printf '%s' "$rpc_body" | rg -o '"result":[0-9]+' | head -1 | sed 's/"result"://' || true)"
  echo "RPC_OK url=$RPC_URL height=${height:-unknown}"
else
  echo "RPC_FAIL url=$RPC_URL body=${rpc_body:0:120}"
fi

if [[ -d "$LOCK_DIR" ]]; then
  echo "CHAIN_LOCK busy lock=$LOCK_DIR"
else
  echo "CHAIN_LOCK free"
fi

latest_log="$(ls -t "$LOG_ROOT"/android-phone-chain-"${SAFE_SERIAL}"-*.log 2>/dev/null | head -1 || true)"
if [[ -z "$latest_log" ]]; then
  echo "CHAIN_OK none (no android-phone-chain log for serial)"
  exit 0
fi

chain_ok="$(rg '^CHAIN_OK ' "$latest_log" 2>/dev/null | tail -1 || true)"
if [[ -n "$chain_ok" ]]; then
  echo "CHAIN_OK latest_log=$latest_log line=$chain_ok"
else
  echo "CHAIN_OK none in $latest_log"
fi

preflight_link="${LOG_ROOT%/}/current-preflight-android"
if [[ -L "$preflight_link" ]]; then
  preflight_dir="$(readlink "$preflight_link" 2>/dev/null || true)"
  if [[ -f "${preflight_dir}/RESULT.txt" ]]; then
    echo "PREFLIGHT $(tr -d '\n' <"${preflight_dir}/RESULT.txt" 2>/dev/null || true) dir=$preflight_dir"
  fi
fi

exit 0
