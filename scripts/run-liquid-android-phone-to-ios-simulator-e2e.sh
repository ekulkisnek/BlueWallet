#!/usr/bin/env bash
# Liquid regtest E2E: Android physical RedWallet sends native L-BTC to iOS simulator receive wallet.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT}/liquid-android-ios-e2e-${STAMP}"
ANDROID_SERIAL="${ANDROID_SERIAL:-0A201JECB03306}"
ANDROID_PACKAGE="com.layertwolabs.bluewallet"
IOS_SIM_UDID="FC7DDD6B-DFCB-432A-98CE-48C453E6EF48"
IOS_BUNDLE_ID="com.layertwolabs.bluewallet"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-liquid-android-ios-e2e"
cd "$ROOT_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

dc() {
  /Volumes/T705/code/liquid-signet-sidechain/src/elements-cli -datadir=/tmp/liquid-id5-regtest -regtest -rpcport=18443 "$@"
}

log "run_dir=$RUN_DIR"

# 1. Reverse ports for Android
adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
adb -s "$ANDROID_SERIAL" reverse tcp:60401 tcp:60401 >/dev/null 2>&1 || true
log "adb reverse 8081/60401 completed"

# 2. Reset Android App Sandbox to ensure clean wallet generation
log "clearing Android app sandbox"
adb -s "$ANDROID_SERIAL" shell pm clear "$ANDROID_PACKAGE" >/dev/null 2>&1 || true
sleep 1
log "waking Android device"
adb -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$ANDROID_SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true

# 3. Reset iOS App Sandbox to ensure clean wallet generation
log "clearing iOS simulator app sandbox"
xcrun simctl terminate "$IOS_SIM_UDID" "$IOS_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$IOS_SIM_UDID" "$IOS_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$IOS_SIM_UDID" "ios/build/Build/Products/Debug-iphonesimulator/BlueWallet.app" >/dev/null 2>&1 || true
sleep 1

# 4. Seed iOS Simulator Liquid wallet
log "seeding iOS simulator Liquid wallet"
export REDWALLET_IOS_SIM_LIQUID_SEED_LOG_DIR="$RUN_DIR/ios-seed"
export DETOX_IOS_SIM_UDID="$IOS_SIM_UDID"
export LIQUID_RPC_URL="http://127.0.0.1:6055"
export LIQUID_ELECTRUM_URL="tcp://127.0.0.1:60401"
export REDWALLET_IOS_LIQUID_SKIP_SYNC=1

bash "$ROOT_DIR/scripts/seed-ios-simulator-liquid-wallet.sh"
# shellcheck disable=SC1090
source "$RUN_DIR/ios-seed/ios-liquid-wallet.env"
log "iOS simulator address: $IOS_LIQUID_ADDRESS"
log "iOS simulator wallet ID: $REDWALLET_IOS_LIQUID_WALLET_ID"

# 5. Seed Android Liquid wallet
log "seeding Android Liquid wallet"
export REDWALLET_ANDROID_LIQUID_SEED_LOG_DIR="$RUN_DIR/android-seed"
export REDWALLET_ANDROID_SERIAL="$ANDROID_SERIAL"
export REDWALLET_ANDROID_PACKAGE="$ANDROID_PACKAGE"
export REDWALLET_ANDROID_LIQUID_SKIP_SYNC=1
export LIQUID_RPC_URL="http://192.168.1.236:6055"

bash "$ROOT_DIR/scripts/seed-android-liquid-wallet.sh"
# shellcheck disable=SC1090
source "$RUN_DIR/android-seed/android-liquid-wallet.env"
log "Android address: $ANDROID_LIQUID_ADDRESS"
log "Android wallet ID: $REDWALLET_ANDROID_LIQUID_WALLET_ID"

# 6. Fund Android Liquid wallet via peg-in deposit
log "creating BIP300 peg-in deposit for Android address $ANDROID_LIQUID_ADDRESS"
fund_txid=$(/Volumes/T705/code/drivechain-wallet-dev/liquid-simplicity/target/release/liquid_simplicity_app_cli --rpc-port 6055 create-deposit --value-sats 10000000 --fee-sats 1000000 "$ANDROID_LIQUID_ADDRESS")
log "funding txid (mainchain deposit): $fund_txid"

# 7. Mine mainchain block to confirm deposit transaction
log "mining mainchain block to confirm deposit"
dc -rpcwallet=redwallet-proof generatetoaddress 1 bcrt1qmk6vh8rzg4xfd7hvc9kdar9cu2l59w2ca6snhq >/dev/null

# Mine a sidechain block to commit the deposit
log "mining sidechain block"
/Volumes/T705/code/drivechain-wallet-dev/liquid-simplicity/target/release/liquid_simplicity_app_cli --rpc-port 6055 mine

# Mine another mainchain block to confirm the BMM sidechain block
log "mining second mainchain block to confirm BMM block"
dc -rpcwallet=redwallet-proof generatetoaddress 1 bcrt1qmk6vh8rzg4xfd7hvc9kdar9cu2l59w2ca6snhq >/dev/null
log "deposit confirmed"

# 8. Sync Android wallet so it sees the funds
log "syncing Android wallet"
export REDWALLET_ANDROID_LIQUID_COMMAND_LOG_DIR="$RUN_DIR/android-sync"
export REDWALLET_ANDROID_LIQUID_WALLET_ID="$REDWALLET_ANDROID_LIQUID_WALLET_ID"
bash "$ROOT_DIR/scripts/send-android-liquid-command.sh" sync

# 9. Send transfer from Android Liquid wallet to iOS simulator Liquid wallet address
log "sending 0.05 L-BTC (5,000,000 sats) from Android to iOS"
export REDWALLET_ANDROID_LIQUID_COMMAND_LOG_DIR="$RUN_DIR/android-transfer"
bash "$ROOT_DIR/scripts/send-android-liquid-command.sh" transfer "$IOS_LIQUID_ADDRESS" 5000000

# shellcheck disable=SC1090
source "$RUN_DIR/android-transfer/android-liquid-transfer.env"
log "transfer transaction ID: $ANDROID_LIQUID_TRANSFER_TXID"

# 10. Mine block to confirm transfer
log "mining sidechain block to commit transfer"
/Volumes/T705/code/drivechain-wallet-dev/liquid-simplicity/target/release/liquid_simplicity_app_cli --rpc-port 6055 mine

log "mining mainchain block to confirm BMM block"
dc -rpcwallet=redwallet-proof generatetoaddress 1 bcrt1qmk6vh8rzg4xfd7hvc9kdar9cu2l59w2ca6snhq >/dev/null
log "transfer confirmed"

# 11. Sync iOS Simulator wallet so it sees the transfer
log "syncing iOS simulator wallet"
export REDWALLET_IOS_SIM_LIQUID_COMMAND_LOG_DIR="$RUN_DIR/ios-sync"
export REDWALLET_IOS_LIQUID_WALLET_ID="$REDWALLET_IOS_LIQUID_WALLET_ID"
bash "$ROOT_DIR/scripts/send-ios-simulator-liquid-command.sh" sync

# 12. Read balance from iOS simulator result
ios_result_file="$RUN_DIR/ios-sync/result.json"
log "checking balance on iOS simulator"
cat "$ios_result_file"

bitcoin_balance=$(python3 -c "import json; print(json.load(open('$ios_result_file'))['balances'].get('bitcoin', 0))")
log "iOS Simulator Bitcoin balance: $bitcoin_balance sats"

if [[ "$bitcoin_balance" -eq 5000000 ]]; then
  log "SUCCESS: 5,000,000 sats successfully received by iOS simulator Liquid wallet!"
  exit 0
else
  log "FAIL: expected 5,000,000 sats, but got $bitcoin_balance"
  exit 1
fi
