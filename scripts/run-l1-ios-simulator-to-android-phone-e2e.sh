#!/usr/bin/env bash
# L1 signet E2E: iOS simulator RedWallet sends native BTC to Android physical receive wallet.
#
# Env (optional):
#   REDWALLET_LOG_ROOT          log root (default /Volumes/T705/redwallet-logs)
#   LOCAL_DEV                   drivechain-wallet-dev/local-dev
#   COMPOSE_FILE                docker compose file under LOCAL_DEV
#   METRO_PORT                  Metro port (default 8081)
#   ANDROID_SERIAL              adb serial (default 0A201JECB03306)
#   REDWALLET_ANDROID_PACKAGE   default com.layertwolabs.bluewallet
#   REDWALLET_PHONE_LAN_HOST    Mac LAN IP phones use (auto-detected if unset)
#   L1_E2E_BIDIRECTIONAL        1 to also run Android→iOS after iOS→Android (default 1)
#   L1_E2E_ANDROID_SEND_SATS    Android→iOS amount (default 10000)
#   L1_E2E_SEND_SATS            iOS→Android amount (default 10000)
#   L1_E2E_FUND_SATS            fund iOS wallet (default 100000)
#   DETOX_LOGLEVEL              detox log level
#   REDWALLET_SKIP_ANDROID_SEED 1 to reuse ANDROID_L1_RECEIVE_ADDRESS
#   ANDROID_L1_RECEIVE_ADDRESS  receive address (set by seed script if unset)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${L1_IOS_ANDROID_E2E_LOG_DIR:-$LOG_ROOT/l1-ios-android-e2e-$STAMP}"
METRO_LOG="$RUN_DIR/metro.log"
METRO_PORT="${METRO_PORT:-8081}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.236}"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
ELECTRUM_HOST="${REDWALLET_ELECTRUM_HOST:-$LAN_HOST}"
ELECTRUM_PORT="${REDWALLET_ELECTRUM_PORT:-60101}"
L1_E2E_SEND_SATS="${L1_E2E_SEND_SATS:-10000}"
L1_E2E_FUND_SATS="${L1_E2E_FUND_SATS:-100000}"
L1_E2E_BIDIRECTIONAL="${L1_E2E_BIDIRECTIONAL:-1}"
L1_E2E_ANDROID_SEND_SATS="${L1_E2E_ANDROID_SEND_SATS:-10000}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-l1-ios-android-e2e"
cd "$ROOT_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# shellcheck source=l1-e2e-lock.sh
source "$ROOT_DIR/scripts/l1-e2e-lock.sh"
l1_lock_maybe_acquire "$RUN_DIR" "ios-sim-android-phone" || {
  log "FAIL another L1 E2E run holds the lock"
  exit 2
}

detect_lan_host() {
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -n "$ip" ]]; then
    printf '%s' "$ip"
    return
  fi
  printf '%s' "$LAN_HOST"
}

refresh_signet_endpoints() {
  local detected
  detected="$(detect_lan_host)"
  export REDWALLET_PHONE_LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-$detected}"
  export REDWALLET_PHONE_HOST="$REDWALLET_PHONE_LAN_HOST"
  export REDWALLET_BITASSETS_RPC_MAC="http://${REDWALLET_PHONE_LAN_HOST}:6004"
  log "signet_endpoints refresh host=$REDWALLET_PHONE_LAN_HOST"
  bash "$ROOT_DIR/scripts/generate-redwallet-signet-endpoints-ts.sh" >>"$RUN_DIR/signet-endpoints.log" 2>&1 || \
    log "WARN signet endpoints refresh failed (see signet-endpoints.log)"
}

setup_android_usb_reverse() {
  adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:60101 tcp:60101 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6123 tcp:6123 >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" reverse tcp:6125 tcp:6125 >/dev/null 2>&1 || true
  log "adb reverse 8081/60101/6123/6125"
}

port_open() {
  curl --silent --max-time 1 "http://127.0.0.1:$METRO_PORT/status" >/dev/null 2>&1
}

start_metro_if_needed() {
  if port_open; then
    log "metro=already_running"
    return
  fi
  log "metro=starting"
  (cd "$ROOT_DIR" && npx react-native start --host 0.0.0.0 --port "$METRO_PORT" --reset-cache) >>"$METRO_LOG" 2>&1 &
  echo "$!" >"$RUN_DIR/metro.pid"
  for _ in $(seq 1 45); do
    if port_open; then
      log "metro=ready"
      return
    fi
    sleep 1
  done
  log "FAIL metro timeout"
  exit 1
}

run_preflight() {
  export L1_E2E_COMPOSE_FILE="$COMPOSE_FILE"
  export L1_E2E_LOG_FILE="$RUN_DIR/preflight.log"
  export L1_E2E_REQUIRE_ADB=1
  export ANDROID_SERIAL
  export REDWALLET_ELECTRUM_HOST="127.0.0.1"
  export REDWALLET_ELECTRUM_PORT="$ELECTRUM_PORT"
  export L1_E2E_ELECTRUM_LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-$(detect_lan_host)}"
  bash "$ROOT_DIR/scripts/l1-e2e-preflight.sh"
}

ensure_ios_build() {
  local app="ios/build/Build/Products/Debug-iphonesimulator/BlueWallet.app"
  if [[ -d "$app" ]]; then
    log "ios_build=exists"
    return
  fi
  log "ios_build=detox_build"
  npx detox build -c ios.debug >>"$RUN_DIR/detox-build.log" 2>&1
}

ensure_detox_simulator_booted() {
  local udid="${DETOX_IOS_SIM_UDID:-FC7DDD6B-DFCB-432A-98CE-48C453E6EF48}"
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  log "detox_simulator udid=$udid"
}

parse_detox_txid() {
  local log_file="$1"
  rg -o 'L1_IOS_ANDROID_E2E\] txid=[0-9a-f]{64}' "$log_file" 2>/dev/null | tail -1 | sed 's/.*txid=//' || true
}

parse_ios_receive_address() {
  local log_file="$1"
  rg -o 'L1_IOS_ANDROID_E2E\] ios_receive_address=[a-zA-HJ-NP-Z0-9]+' "$log_file" 2>/dev/null | tail -1 | sed 's/.*ios_receive_address=//' || true
}

log "run_dir=$RUN_DIR"
refresh_signet_endpoints
run_preflight
setup_android_usb_reverse
start_metro_if_needed

if [[ "${REDWALLET_SKIP_ANDROID_SEED:-0}" != 1 ]]; then
  REDWALLET_ANDROID_BTC_SEED_LOG_DIR="$RUN_DIR/android-seed" \
    ANDROID_SERIAL="$ANDROID_SERIAL" \
    bash "$ROOT_DIR/scripts/seed-android-btc-receive-wallet.sh" | tee "$RUN_DIR/android-seed.log"
  # shellcheck disable=SC1090
  source "$RUN_DIR/android-seed/android-l1-receive.env"
else
  : "${ANDROID_L1_RECEIVE_ADDRESS:?REDWALLET_SKIP_ANDROID_SEED=1 requires ANDROID_L1_RECEIVE_ADDRESS}"
  export L1_RECEIVE_ADDRESS="${L1_RECEIVE_ADDRESS:-$ANDROID_L1_RECEIVE_ADDRESS}"
fi

ensure_ios_build
ensure_detox_simulator_booted

export ANDROID_L1_RECEIVE_ADDRESS L1_RECEIVE_ADDRESS
export L1_E2E_ROOT_DIR="$ROOT_DIR"
export L1_E2E_LOCAL_DEV_DIR="$LOCAL_DEV"
export L1_E2E_COMPOSE_FILE="$COMPOSE_FILE"
export L1_E2E_SEND_SATS L1_E2E_FUND_SATS

log "detox_start"
set +e
npx detox test -c ios.debug tests/e2e/l1_ios_simulator_to_android.spec.js \
  --loglevel "${DETOX_LOGLEVEL:-info}" \
  --reuse "$@" 2>&1 | tee "$RUN_DIR/detox.log"
detox_rc=${PIPESTATUS[0]}
set -e
log "detox_exit=$detox_rc"

TXID="$(parse_detox_txid "$RUN_DIR/detox.log")"
IOS_RECEIVE_ADDRESS="$(parse_ios_receive_address "$RUN_DIR/detox.log")"
echo "txid=${TXID:-unset}" >"$RUN_DIR/txid.txt"
echo "ios_receive_address=${IOS_RECEIVE_ADDRESS:-unset}" >"$RUN_DIR/ios-receive-address.txt"

IOS_TO_ANDROID_VERIFY=skip
ANDROID_TO_IOS_VERIFY=skip
ANDROID_SEND_TXID=""

if [[ "$detox_rc" -eq 0 && -n "$TXID" ]]; then
  log "ios_to_android mine + verify"
  (cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "${L1_E2E_POST_SEND_MINE_BLOCKS:-3}") >>"$RUN_DIR/post-mine.log" 2>&1
  if node -e "
const { verifyTxPaysAddress } = require('./tests/e2e/l1SignetShared');
verifyTxPaysAddress(process.argv[1], process.argv[2], Number(process.argv[3]));
" "$TXID" "$ANDROID_L1_RECEIVE_ADDRESS" "$L1_E2E_SEND_SATS" >>"$RUN_DIR/verify-ios-to-android.log" 2>&1; then
    IOS_TO_ANDROID_VERIFY=ok
    echo "ios_to_android_verify=ok" >>"$RUN_DIR/SUMMARY.txt"
  else
    IOS_TO_ANDROID_VERIFY=fail
    echo "ios_to_android_verify=fail" >>"$RUN_DIR/SUMMARY.txt"
  fi
fi

if [[ "$L1_E2E_BIDIRECTIONAL" == 1 && "$detox_rc" -eq 0 && -n "$IOS_RECEIVE_ADDRESS" ]]; then
  log "android_to_ios start dest=$IOS_RECEIVE_ADDRESS sats=$L1_E2E_ANDROID_SEND_SATS"
  (cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "${L1_E2E_ANDROID_FUND_MINE_BLOCKS:-3}") >>"$RUN_DIR/android-fund-mine.log" 2>&1 || true
  sleep "${L1_E2E_ANDROID_BALANCE_WAIT_SEC:-15}"
  set +e
  REDWALLET_ANDROID_BTC_SEND_LOG_DIR="$RUN_DIR/android-send" \
    ANDROID_SERIAL="$ANDROID_SERIAL" \
    bash "$ROOT_DIR/scripts/send-android-btc-l1.sh" \
    "$IOS_RECEIVE_ADDRESS" "$L1_E2E_ANDROID_SEND_SATS" "${REDWALLET_ANDROID_BTC_WALLET_ID:-}" \
    | tee "$RUN_DIR/android-send.log"
  android_send_rc=${PIPESTATUS[0]}
  set -e
  log "android_send_exit=$android_send_rc"
  if [[ "$android_send_rc" -eq 0 && -f "$RUN_DIR/android-send/android-l1-send-txid.txt" ]]; then
    ANDROID_SEND_TXID="$(cat "$RUN_DIR/android-send/android-l1-send-txid.txt")"
    log "android_to_ios mine + verify txid=$ANDROID_SEND_TXID"
    (cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "${L1_E2E_POST_ANDROID_SEND_MINE_BLOCKS:-3}") >>"$RUN_DIR/post-android-send-mine.log" 2>&1
    if node -e "
const { verifyTxPaysAddress } = require('./tests/e2e/l1SignetShared');
verifyTxPaysAddress(process.argv[1], process.argv[2], Number(process.argv[3]));
" "$ANDROID_SEND_TXID" "$IOS_RECEIVE_ADDRESS" "$L1_E2E_ANDROID_SEND_SATS" >>"$RUN_DIR/verify-android-to-ios.log" 2>&1; then
      ANDROID_TO_IOS_VERIFY=ok
      echo "android_to_ios_verify=ok" >>"$RUN_DIR/SUMMARY.txt"
    else
      ANDROID_TO_IOS_VERIFY=fail
      echo "android_to_ios_verify=fail" >>"$RUN_DIR/SUMMARY.txt"
    fi
  else
    ANDROID_TO_IOS_VERIFY=fail
    echo "android_to_ios_verify=fail" >>"$RUN_DIR/SUMMARY.txt"
  fi
fi

COLLECTOR="${LOG_ROOT%/}/current-js-event-collector/events.ndjson"
if [[ -f "$COLLECTOR" ]]; then
  rg 'real_device_btc_wallet_created' "$COLLECTOR" | tail -20 >"$RUN_DIR/collector-btc-wallet-created.txt" 2>/dev/null || true
fi

cat >>"$RUN_DIR/SUMMARY.txt" <<EOF
run_dir=$RUN_DIR
detox_exit=$detox_rc
android_receive=$ANDROID_L1_RECEIVE_ADDRESS
ios_receive=${IOS_RECEIVE_ADDRESS:-unset}
ios_to_android_txid=${TXID:-unset}
ios_to_android_sats=$L1_E2E_SEND_SATS
ios_to_android_verify=$IOS_TO_ANDROID_VERIFY
android_to_ios_txid=${ANDROID_SEND_TXID:-unset}
android_to_ios_sats=$L1_E2E_ANDROID_SEND_SATS
android_to_ios_verify=$ANDROID_TO_IOS_VERIFY
fund_sats=$L1_E2E_FUND_SATS
EOF

final_rc=$detox_rc
if [[ "$IOS_TO_ANDROID_VERIFY" == fail || "$ANDROID_TO_IOS_VERIFY" == fail ]]; then
  final_rc=1
fi
if [[ "$L1_E2E_BIDIRECTIONAL" == 1 ]]; then
  if [[ "$IOS_TO_ANDROID_VERIFY" != ok || "$ANDROID_TO_IOS_VERIFY" != ok ]]; then
    final_rc=1
  fi
fi

log "done run_dir=$RUN_DIR final_exit=$final_rc"
exit "$final_rc"
