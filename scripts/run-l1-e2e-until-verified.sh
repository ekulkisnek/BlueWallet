#!/usr/bin/env bash
# L1 E2E until verified — single entrypoint for AutoCode fleet.
# Picks ONE path under lock:
#   physical: run-l1-physical-bidirectional-e2e.sh (if devices + BitAssets RPC OK)
#   simulator: ios-sim→android + android→ios-sim (fallback when LiPhone blocked)
# On success: updates L1_VERIFIED_EVIDENCE.md with txids, detox_exit=0, verify=ok BOTH dirs.
# Enforces l1-e2e-lock.sh (no parallel).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${L1_UNTIL_VERIFIED_LOG_DIR:-$LOG_ROOT/l1-e2e-until-verified-$STAMP}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-l1-e2e-until-verified"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# shellcheck source=l1-e2e-lock.sh
source "$ROOT_DIR/scripts/l1-e2e-lock.sh"
l1_lock_maybe_acquire "$RUN_DIR" "until-verified" || {
  log "FAIL lock held by another L1 E2E orchestrator"
  exit 2
}

log "until_verified start run_dir=$RUN_DIR"

# Devices
ANDROID_SERIAL="${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}"
IOS_UDID="${REDWALLET_IOS_UDID:-00008020-0011204911F3002E}"

device_ok=0
if adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
  log "device android ok serial=$ANDROID_SERIAL"
  device_ok=$((device_ok+1))
else
  log "WARN android device $ANDROID_SERIAL not ready"
fi

if xcrun devicectl list devices 2>/dev/null | grep -q "$IOS_UDID" || \
   xcrun devicectl list devices 2>/dev/null | grep -q "LiPhone"; then
  log "device ios ok udid=$IOS_UDID (or LiPhone visible)"
  device_ok=$((device_ok+1))
else
  log "WARN ios device $IOS_UDID not visible via devicectl"
fi

# BitAssets RPC (Mac side, after fix uses .236)
bitassets_ok=0
if bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh" >>"$RUN_DIR/bitassets-preflight.log" 2>&1; then
  log "bitassets rpc ok"
  bitassets_ok=1
else
  log "WARN bitassets rpc not responsive (see bitassets-preflight.log) — will fallback"
fi

# LiPhone / iOS physical L1 channel probe (best-effort; if recent ios-btc seed failed, treat blocked)
iphone_bitassets_blocked=0
if [[ -f "${LOG_ROOT%/}/ios-btc-command-server/result.json" ]]; then
  if ! python3 -c "
import json,sys
p='${LOG_ROOT%/}/ios-btc-command-server/result.json'
try:
  r=json.load(open(p))
  if r.get('ok') and r.get('address'): sys.exit(0)
except: pass
sys.exit(1)
" 2>/dev/null; then
    iphone_bitassets_blocked=1
    log "iphone bitassets channel recent result not ok — blocked"
  fi
else
  iphone_bitassets_blocked=1
  log "iphone bitassets no recent result.json — assume blocked for LiPhone"
fi

# Decide path
USE_PHYSICAL=0
if [[ "$device_ok" -ge 2 && "$bitassets_ok" -eq 1 && "$iphone_bitassets_blocked" -eq 0 ]]; then
  USE_PHYSICAL=1
  log "preflight: physical path selected (devices+BitAssets+LiPhone OK)"
else
  log "preflight: simulator path selected (physical LiPhone BitAssets RPC blocked or devices incomplete)"
fi

ios_to_android_rc=1
android_to_ios_rc=1
DETOX_EXIT=1

if [[ "$USE_PHYSICAL" -eq 1 ]]; then
  log "running physical bidirectional"
  L1_E2E_SKIP_LOCK=1 \
    L1_PHYSICAL_E2E_LOG_DIR="$RUN_DIR/physical" \
    bash "$ROOT_DIR/scripts/run-l1-physical-bidirectional-e2e.sh" "$@" || true
  ios_to_android_rc=$(grep -o 'ios_to_android_exit=[0-9]*' "$RUN_DIR/physical/SUMMARY.txt" 2>/dev/null | cut -d= -f2 || echo 1)
  android_to_ios_rc=$(grep -o 'android_to_ios_exit=[0-9]*' "$RUN_DIR/physical/SUMMARY.txt" 2>/dev/null | cut -d= -f2 || echo 1)
  DETOX_EXIT=$(( ios_to_android_rc || android_to_ios_rc ))
else
  log "running simulator fallback: ios-sim -> android then android -> ios-sim"
  IOS_SIM_RUN="$RUN_DIR/ios-sim-to-android"
  set +e
  L1_E2E_SKIP_LOCK=1 \
    L1_IOS_SIM_ANDROID_E2E_LOG_DIR="$IOS_SIM_RUN" \
    L1_E2E_POST_FUND_RELAUNCH=1 \
    REDWALLET_SKIP_ANDROID_SEED=1 \
    ANDROID_L1_RECEIVE_ADDRESS=tb1qewdkqej3xc6hh2v5q88rnaekd2zkccf0zq6kdf \
    bash "$ROOT_DIR/scripts/run-l1-ios-simulator-to-android-phone-e2e.sh" "$@"
  ios_to_android_rc=$?
  set -e
  if [[ -f "$IOS_SIM_RUN/SUMMARY.txt" ]]; then
    s=$(grep -E '^detox_exit=' "$IOS_SIM_RUN/SUMMARY.txt" 2>/dev/null | tail -1 | cut -d= -f2 || true)
    [[ -n "$s" ]] && ios_to_android_rc="$s"
  fi
  log "ios_sim_to_android_exit=$ios_to_android_rc"

  ANDROID_SIM_RUN="$RUN_DIR/android-to-ios-sim"
  set +e
  L1_E2E_SKIP_LOCK=1 \
    L1_ANDROID_IOS_SIM_E2E_LOG_DIR="$ANDROID_SIM_RUN" \
    L1_E2E_POST_FUND_RELAUNCH=1 \
    REDWALLET_SKIP_ANDROID_SEED=1 \
    ANDROID_L1_RECEIVE_ADDRESS=tb1qewdkqej3xc6hh2v5q88rnaekd2zkccf0zq6kdf \
    bash "$ROOT_DIR/scripts/with-android-build-env.sh" "$ROOT_DIR/scripts/run-l1-android-phone-to-ios-simulator-e2e.sh" "$@"
  android_to_ios_rc=$?
  set -e
  if [[ -f "$ANDROID_SIM_RUN/SUMMARY.txt" ]]; then
    s=$(grep -E '^detox_exit=' "$ANDROID_SIM_RUN/SUMMARY.txt" 2>/dev/null | tail -1 | cut -d= -f2 || true)
    [[ -n "$s" ]] && android_to_ios_rc="$s"
  fi
  log "android_to_ios_sim_exit=$android_to_ios_rc"

  DETOX_EXIT=$(( ios_to_android_rc || android_to_ios_rc ))
fi

log "legs done ios_to_android_rc=$ios_to_android_rc android_to_ios_rc=$android_to_ios_rc detox_exit=$DETOX_EXIT"

# Collect txids and verify status from SUMMARYs / logs (best effort parse)
TXID1=""
TXID2=""
VERIFY_OK="pending"

for s in "$RUN_DIR"/**/SUMMARY.txt "$RUN_DIR"/**/*e2e-*/SUMMARY.txt; do
  [[ -f "$s" ]] || continue
  # Look for common patterns in L1 send/fund logs
  t=$(grep -oE 'txid[=:][A-Za-z0-9]{16,}' "$s" 2>/dev/null | head -1 | cut -d= -f2 || true)
  [[ -n "$t" ]] && { [[ -z "$TXID1" ]] && TXID1="$t" || TXID2="$t"; }
  if grep -qi 'verify.*ok\|verify=ok\|mainchain.*ok' "$s" 2>/dev/null; then
    VERIFY_OK="ok"
  fi
done

# Fallback: search recent send logs under run_dir for txid
if [[ -z "$TXID1" ]]; then
  TXID1=$(grep -r -oE 'send_txid[=:][A-Za-z0-9]{16,}|fund_txid[=:][A-Za-z0-9]{16,}' "$RUN_DIR" 2>/dev/null | head -1 | cut -d= -f2 || true)
fi
if [[ -z "$TXID2" ]]; then
  TXID2=$(grep -r -oE 'send_txid[=:][A-Za-z0-9]{16,}|fund_txid[=:][A-Za-z0-9]{16,}' "$RUN_DIR" 2>/dev/null | tail -1 | cut -d= -f2 || true)
fi

log "collected txid1=$TXID1 txid2=$TXID2 verify=$VERIFY_OK"

# Update evidence
EVIDENCE="/Volumes/T705/redwallet-logs/L1_VERIFIED_EVIDENCE.md"
mkdir -p "$(dirname "$EVIDENCE")"
cat >>"$EVIDENCE" <<EOM

## L1 E2E Run $(date -u +%Y-%m-%dT%H:%M:%SZ) via until-verified (path: $([[ "$USE_PHYSICAL" -eq 1 ]] && echo physical || echo simulator))

**Status:** $([[ "$DETOX_EXIT" -eq 0 && "$VERIFY_OK" == "ok" ]] && echo "VERIFIED" || echo "INCOMPLETE")

| Direction | detox_exit | txid | verify |
|-----------|------------|------|--------|
| ios→android | $ios_to_android_rc | $TXID1 | $VERIFY_OK |
| android→ios | $android_to_ios_rc | $TXID2 | $VERIFY_OK |

**run_dir:** $RUN_DIR
**evidence collected:** txids + exits + verify status appended by run-l1-e2e-until-verified.sh

EOM

if [[ "$DETOX_EXIT" -eq 0 && "$VERIFY_OK" == "ok" && -n "$TXID1" && -n "$TXID2" ]]; then
  log "SUCCESS L1 E2E verified — evidence updated"
  echo "L1_E2E_VERIFIED=1" >"$RUN_DIR/VERIFIED.flag"
  exit 0
else
  log "L1 E2E not fully verified yet (exits or txids or verify pending)"
  exit 1
fi
