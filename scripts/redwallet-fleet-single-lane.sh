#!/usr/bin/env bash
# One Composer lane: RPC probe, bundle (optional), iPhone12 then LiPhone chain, collect logs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_ROOT/fleet-single-lane-${STAMP}.log"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"

exec >>"$LOG" 2>&1
echo "FLEET_LANE_START $(date -Iseconds)"

# Stop overlapping fleet wrappers (chain scripts exit on flock).
pkill -f 'fleet-v[0-9]-' 2>/dev/null || true
pkill -f 'fleet-single-lane-' 2>/dev/null || true
sleep 1
rmdir "$LOG_ROOT/phone-chain.lock.d" 2>/dev/null || true

if [[ -x "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" ]]; then
  "$LOCAL_DEV/scripts/ensure-colima-overcommit.sh" || true
fi

cd "$ROOT_DIR"
scripts/redwallet-signet-endpoints.sh "$LOG_ROOT" >/dev/null 2>&1 || true
ENV="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
[[ -f "$ENV" ]] && source "$ENV"
probe_bitassets_rpc() {
  local url="$1"
  curl -sS -m 4 -X POST "${url%/}/" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true
}

export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
LAN_RPC="http://192.168.1.50:6004"
rpc_ok=""
for i in $(seq 1 5); do
  r="$(probe_bitassets_rpc "$LAN_RPC")"
  echo "rpc_poll_lan=$i $r"
  if [[ "$r" == *'"result"'* ]]; then
    export BITASSETS_RPC_URL="$LAN_RPC"
    rpc_ok=1
    break
  fi
  sleep 2
done
if [[ -z "$rpc_ok" ]]; then
  echo "RPC_RECOVER_START $(date -Iseconds)"
  bash "$ROOT_DIR/scripts/redwallet-colima-bitassets-recover.sh" "$LOG_ROOT/colima-recover-${STAMP}.log" || true
fi
for i in $(seq 1 20); do
  r="$(probe_bitassets_rpc "${BITASSETS_RPC_URL}")"
  echo "rpc_poll=$i url=$BITASSETS_RPC_URL $r"
  if [[ "$r" == *'"result"'* ]]; then
    rpc_ok=1
    break
  fi
  if [[ "$i" -eq 10 && -z "$rpc_ok" ]]; then
    r2="$(probe_bitassets_rpc "$LAN_RPC")"
    echo "rpc_poll_lan_retry=$i $r2"
    if [[ "$r2" == *'"result"'* ]]; then
      export BITASSETS_RPC_URL="$LAN_RPC"
      rpc_ok=1
      break
    fi
  fi
  [[ "$i" -eq 20 && -z "$rpc_ok" ]] && echo "FLEET_LANE_RPC_FAIL" && exit 2
  sleep 2
done
echo "RPC_OK url=$BITASSETS_RPC_URL"

perl -e 'alarm 25; exec @ARGV' bash scripts/start-redwallet-real-device-support.sh || true

if [[ "${REDWALLET_FLEET_SKIP_BUNDLE:-0}" != 1 ]]; then
  perl -e 'alarm 120; exec @ARGV' bash scripts/bundle-redwallet-ios-real-device.sh || echo "BUNDLE_WARN"
  REDWALLET_SKIP_IOS_MONITOR=1 perl -e 'alarm 180; exec @ARGV' bash scripts/install-launch-redwallet-ios-devices.sh \
    ios/build/PersonalDebugDerivedDataFixed/Build/Products/Debug-iphoneos/BlueWallet.app \
    com.lukekensik.redwallet.dev || echo "INSTALL_WARN"
fi

export REDWALLET_PHONE_SKIP_LAUNCH=1 REDWALLET_SKIP_BITASSETS_RESTART=1
export REDWALLET_CHAIN_POLLS=55 REDWALLET_CHAIN_POLL_SEC=6

REDWALLET_FORCE_LAUNCH_UDID=00008101-000128643E28001E bash scripts/redwallet-phone-chain-reserve-register.sh || true
REDWALLET_FORCE_LAUNCH_UDID=00008020-0011204911F3002E bash scripts/redwallet-phone-chain-reserve-register.sh || true

perl -e 'alarm 90; exec @ARGV' bash scripts/collect-redwallet-device-logs.sh "$LOG_ROOT" 5 || true
echo "FLEET_LANE_DONE $(date -Iseconds) log=$LOG"
