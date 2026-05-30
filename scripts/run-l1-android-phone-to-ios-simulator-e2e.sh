#!/usr/bin/env bash
# L1 signet E2E: Android physical RedWallet sends native BTC to iOS simulator receive wallet.
#
# Env (optional):
#   REDWALLET_LOG_ROOT          log root (default /Volumes/T705/redwallet-logs)
#   LOCAL_DEV                   drivechain-wallet-dev/local-dev
#   COMPOSE_FILE                docker compose file under LOCAL_DEV
#   METRO_PORT                  Metro port (default 8081)
#   ANDROID_SERIAL              adb serial (default 0A201JECB03306)
#   REDWALLET_PHONE_LAN_HOST    Mac LAN IP phones use (auto-detected if unset)
#   L1_E2E_SEND_SATS            send amount (default 10000)
#   L1_E2E_FUND_SATS            fund Android wallet (default 100000)
#   REDWALLET_SKIP_IOS_SEED     1 to reuse IOS_L1_RECEIVE_ADDRESS
#   IOS_L1_RECEIVE_ADDRESS      receive address (set by iOS seed step if unset)
#   L1_E2E_ANDROID_COMMAND_SEND 1 for shell seed+fund+adb send (no Detox send UI)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${L1_ANDROID_IOS_E2E_LOG_DIR:-$LOG_ROOT/l1-android-ios-e2e-$STAMP}"
METRO_LOG="$RUN_DIR/metro.log"
METRO_PORT="${METRO_PORT:-8081}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-192.168.1.236}"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
L1_E2E_SEND_SATS="${L1_E2E_SEND_SATS:-10000}"
L1_E2E_FUND_SATS="${L1_E2E_FUND_SATS:-100000}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-l1-android-ios-e2e"
cd "$ROOT_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# shellcheck source=l1-e2e-lock.sh
source "$ROOT_DIR/scripts/l1-e2e-lock.sh"
l1_lock_maybe_acquire "$RUN_DIR" "android-phone-ios-sim" || {
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
  export REDWALLET_ELECTRUM_PORT="60101"
  export L1_E2E_ELECTRUM_LAN_HOST="${REDWALLET_PHONE_LAN_HOST:-$(detect_lan_host)}"
  bash "$ROOT_DIR/scripts/l1-e2e-preflight.sh"
}

wake_android_device() {
  adb -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" shell am force-stop com.layertwolabs.bluewallet >/dev/null 2>&1 || true
  sleep 1
  log "android_wake serial=$ANDROID_SERIAL"
}

ensure_android_build() {
  local apk="android/app/build/outputs/apk/debug/app-debug.apk"
  if [[ -f "$apk" ]]; then
    log "android_build=exists"
    return
  fi
  log "android_build=detox_build"
  npx detox build -c android.debug.device >>"$RUN_DIR/detox-build.log" 2>&1
}

ensure_ios_build() {
  local app="ios/build/Build/Products/Debug-iphonesimulator/BlueWallet.app"
  if [[ -d "$app" ]]; then
    log "ios_build=exists"
    return
  fi
  log "ios_build=detox_build"
  npx detox build -c ios.debug.nosync >>"$RUN_DIR/detox-build-ios.log" 2>&1
}

parse_ios_receive_address() {
  local log_file="$1"
  rg -o 'L1_IOS_ANDROID_E2E\] ios_receive_address=[a-zA-HJ-NP-Z0-9]+' "$log_file" 2>/dev/null | tail -1 | sed 's/.*ios_receive_address=//' || true
}

parse_detox_txid() {
  local log_file="$1"
  rg -o 'L1_ANDROID_IOS_E2E\] txid=[0-9a-f]{64}' "$log_file" 2>/dev/null | tail -1 | sed 's/.*txid=//' || true
}

seed_ios_receive_address() {
  log "ios_seed_start"
  local target_udid="FC7DDD6B-DFCB-432A-98CE-48C453E6EF48"
  if [[ "${L1_E2E_IOS_SIM_COMMAND_SEND:-1}" == 1 ]]; then
    set +e
    REDWALLET_IOS_SIM_BTC_SEED_LOG_DIR="$RUN_DIR/ios-sim-seed" \
      DETOX_IOS_SIM_UDID="$target_udid" \
      bash "$ROOT_DIR/scripts/seed-ios-simulator-btc-receive-wallet.sh" | tee "$RUN_DIR/ios-seed.log"
    local seed_rc=${PIPESTATUS[0]}
    set -e
    log "ios_sim_shell_seed_exit=$seed_rc"
    if [[ "$seed_rc" -ne 0 ]]; then
      log "BLOCKER iOS sim shell seed failed"
      exit "$seed_rc"
    fi
    # shellcheck disable=SC1090
    source "$RUN_DIR/ios-sim-seed/ios-l1-receive.env"
    IOS_L1_RECEIVE_ADDRESS="${IOS_L1_RECEIVE_ADDRESS:-}"
  else
    # Shutdown duplicate iOS sims before seed (ensures Detox + id in .detoxrc targets exactly FC7D iPhone 16e-Detox)
    for dup in $(xcrun simctl list devices 2>/dev/null | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | grep -v "$target_udid" | head -6); do xcrun simctl shutdown "$dup" 2>/dev/null || true; done
    xcrun simctl boot "$target_udid" 2>/dev/null || true
    set +e
    npx detox test -c ios.debug.nosync tests/e2e/l1_ios_simulator_seed_receive.spec.js \
      --loglevel "${DETOX_LOGLEVEL:-info}" \
      --reuse 2>&1 | tee "$RUN_DIR/ios-seed.log"
    local seed_rc=${PIPESTATUS[0]}
    set -e
    log "ios_seed_exit=$seed_rc"
    if [[ "$seed_rc" -ne 0 ]]; then
      log "BLOCKER iOS receive seed failed"
      exit "$seed_rc"
    fi
    IOS_L1_RECEIVE_ADDRESS="$(parse_ios_receive_address "$RUN_DIR/ios-seed.log")"
  fi
  if [[ -z "$IOS_L1_RECEIVE_ADDRESS" ]]; then
    log "BLOCKER could not parse ios_receive_address from seed log"
    exit 2
  fi
  export IOS_L1_RECEIVE_ADDRESS L1_RECEIVE_ADDRESS="$IOS_L1_RECEIVE_ADDRESS"
  echo "export IOS_L1_RECEIVE_ADDRESS='$IOS_L1_RECEIVE_ADDRESS'" >"$RUN_DIR/ios-l1-receive.env"
  log "ios_receive=$IOS_L1_RECEIVE_ADDRESS"
}

log "run_dir=$RUN_DIR"
refresh_signet_endpoints
run_preflight
setup_android_usb_reverse
start_metro_if_needed

if [[ "${REDWALLET_SKIP_IOS_SEED:-0}" != 1 ]]; then
  ensure_ios_build
  seed_ios_receive_address
else
  : "${IOS_L1_RECEIVE_ADDRESS:?REDWALLET_SKIP_IOS_SEED=1 requires IOS_L1_RECEIVE_ADDRESS}"
  export L1_RECEIVE_ADDRESS="${L1_RECEIVE_ADDRESS:-$IOS_L1_RECEIVE_ADDRESS}"
fi

ensure_android_build

export IOS_L1_RECEIVE_ADDRESS L1_RECEIVE_ADDRESS
export L1_E2E_ROOT_DIR="$ROOT_DIR"
export L1_E2E_LOCAL_DEV_DIR="$LOCAL_DEV"
export L1_E2E_COMPOSE_FILE="$COMPOSE_FILE"
export L1_E2E_SEND_SATS L1_E2E_FUND_SATS
export L1_E2E_BALANCE_WAIT_MS="${L1_E2E_BALANCE_WAIT_MS:-120000}"

detox_rc=1
TXID=""

if [[ "${L1_E2E_ANDROID_COMMAND_SEND:-1}" == 1 ]]; then
  log "android_command_send_path (shell seed+fund+adb send, no Detox send UI)"
  : >"$RUN_DIR/detox.log"
  set +e
  REDWALLET_ANDROID_BTC_SEED_LOG_DIR="$RUN_DIR/android-seed" \
    bash "$ROOT_DIR/scripts/seed-android-btc-receive-wallet.sh" | tee "$RUN_DIR/android-seed.log"
  seed_rc=${PIPESTATUS[0]}
  set -e
  log "android_seed_exit=$seed_rc"
  ANDROID_RECEIVE_ADDRESS=""
  if [[ "$seed_rc" -eq 0 && -f "$RUN_DIR/android-seed/android-l1-receive.env" ]]; then
    # shellcheck disable=SC1090
    source "$RUN_DIR/android-seed/android-l1-receive.env"
    ANDROID_RECEIVE_ADDRESS="${ANDROID_L1_RECEIVE_ADDRESS:-}"
  fi
  if [[ "$seed_rc" -eq 0 && -n "$ANDROID_RECEIVE_ADDRESS" ]]; then
    echo "[L1_ANDROID_IOS_E2E] android_receive_address=$ANDROID_RECEIVE_ADDRESS" >>"$RUN_DIR/detox.log"
    fund_txid="$(bash "$ROOT_DIR/scripts/fund-l1-signet-address.sh" "$ANDROID_RECEIVE_ADDRESS" "$L1_E2E_FUND_SATS" "${L1_E2E_POST_FUND_MINE_BLOCKS:-6}")"
    log "fund_txid=$fund_txid"
    node -e "
const { waitForElectrumBalance } = require('./tests/e2e/l1SignetShared');
waitForElectrumBalance(process.argv[1], Number(process.argv[2]));
" "$ANDROID_RECEIVE_ADDRESS" "$L1_E2E_SEND_SATS" >>"$RUN_DIR/balance-wait.log" 2>&1
    balance_rc=$?
    log "electrum_balance_wait_exit=$balance_rc"
    if [[ "$balance_rc" -eq 0 ]]; then
      set +e
      REDWALLET_ANDROID_BTC_SEND_LOG_DIR="$RUN_DIR/android-command-send" \
        REDWALLET_ANDROID_BTC_WALLET_ID="${REDWALLET_ANDROID_BTC_WALLET_ID:-}" \
        bash "$ROOT_DIR/scripts/send-android-btc-l1.sh" \
        "$IOS_L1_RECEIVE_ADDRESS" "$L1_E2E_SEND_SATS" "${REDWALLET_ANDROID_BTC_WALLET_ID:-}" \
        | tee "$RUN_DIR/android-command-send.log"
      send_rc=${PIPESTATUS[0]}
      set -e
      log "android_command_send_exit=$send_rc"
      if [[ "$send_rc" -eq 0 && -f "$RUN_DIR/android-command-send/android-l1-send-txid.txt" ]]; then
        TXID="$(cat "$RUN_DIR/android-command-send/android-l1-send-txid.txt")"
        echo "[L1_ANDROID_IOS_E2E] txid=$TXID" >>"$RUN_DIR/detox.log"
        detox_rc=0
      fi
    fi
  fi
  log "android_command_send_done detox_exit=$detox_rc txid=${TXID:-unset}"
else
log "detox_start android.debug.device balance_wait_ms=$L1_E2E_BALANCE_WAIT_MS detox_reuse=${L1_E2E_DETOX_REUSE:-0}"
wake_android_device
set +e
# shellcheck source=with-android-build-env.sh
source "$ROOT_DIR/scripts/with-android-build-env.sh"
if [[ "${L1_E2E_DETOX_REUSE:-0}" == 1 ]]; then
  npx detox test -c android.debug.device tests/e2e/l1_android_phone_to_ios_simulator.spec.js \
    --loglevel "${DETOX_LOGLEVEL:-info}" \
    --reuse "$@" 2>&1 | tee "$RUN_DIR/detox.log"
else
  npx detox test -c android.debug.device tests/e2e/l1_android_phone_to_ios_simulator.spec.js \
    --loglevel "${DETOX_LOGLEVEL:-info}" \
    "$@" 2>&1 | tee "$RUN_DIR/detox.log"
fi
detox_rc=${PIPESTATUS[0]}
set -e
log "detox_exit=$detox_rc"

TXID="$(parse_detox_txid "$RUN_DIR/detox.log")"
fi
echo "txid=${TXID:-unset}" >"$RUN_DIR/txid.txt"

VERIFY=skip
if [[ "$detox_rc" -eq 0 && -n "$TXID" ]]; then
  log "post_test mine + verify"
  (cd "$LOCAL_DEV" && ./scripts/mine-private-signet-blocks.sh "${L1_E2E_POST_SEND_MINE_BLOCKS:-3}") >>"$RUN_DIR/post-mine.log" 2>&1
  if node -e "
const { verifyTxPaysAddress } = require('./tests/e2e/l1SignetShared');
verifyTxPaysAddress(process.argv[1], process.argv[2], Number(process.argv[3]));
" "$TXID" "$IOS_L1_RECEIVE_ADDRESS" "$L1_E2E_SEND_SATS" >>"$RUN_DIR/verify.log" 2>&1; then
    VERIFY=ok
    echo "verify=ok" >>"$RUN_DIR/SUMMARY.txt"
  else
    VERIFY=fail
    echo "verify=fail" >>"$RUN_DIR/SUMMARY.txt"
  fi
fi

cat >>"$RUN_DIR/SUMMARY.txt" <<EOF
run_dir=$RUN_DIR
detox_exit=$detox_rc
ios_receive=$IOS_L1_RECEIVE_ADDRESS
txid=${TXID:-unset}
send_sats=$L1_E2E_SEND_SATS
fund_sats=$L1_E2E_FUND_SATS
EOF

final_rc=$detox_rc
if [[ "$VERIFY" == fail ]]; then
  final_rc=1
fi

log "done run_dir=$RUN_DIR final_exit=$final_rc"
exit "$final_rc"
