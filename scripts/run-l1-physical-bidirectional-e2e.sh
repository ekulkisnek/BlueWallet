#!/usr/bin/env bash
# L1 signet E2E: bidirectional native BTC between physical iPhone and physical Android.
# Runs iPhone→Android then Android→iPhone sequentially (shared Metro — do not run in parallel).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${L1_PHYSICAL_E2E_LOG_DIR:-$LOG_ROOT/l1-physical-bidirectional-e2e-$STAMP}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-l1-physical-bidirectional-e2e"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Exclusive L1 lock — kill duplicate orchestrators, pause competing autocode fleets.
# shellcheck source=l1-e2e-lock.sh
source "$ROOT_DIR/scripts/l1-e2e-lock.sh"
l1_lock_acquire "$RUN_DIR" "physical-bidirectional" || {
  log "FAIL another L1 E2E run holds the lock"
  exit 2
}
l1_pause_autocode_competitors
trap 'l1_lock_release' EXIT

log "physical_bidirectional start run_dir=$RUN_DIR"

L1_IOS_ANDROID_E2E_LOG_DIR="$RUN_DIR/ios-to-android" \
  L1_E2E_BIDIRECTIONAL=0 \
  bash "$ROOT_DIR/scripts/run-l1-ios-phone-to-android-phone-e2e.sh" "$@"
ios_rc=$?
log "ios_to_android_exit=$ios_rc"

L1_ANDROID_IOS_E2E_LOG_DIR="$RUN_DIR/android-to-ios" \
  bash "$ROOT_DIR/scripts/run-l1-android-phone-to-ios-phone-e2e.sh" "$@"
android_rc=$?
log "android_to_ios_exit=$android_rc"

{
  echo "run_dir=$RUN_DIR"
  echo "ios_to_android_exit=$ios_rc"
  echo "android_to_ios_exit=$android_rc"
  [[ -f "$RUN_DIR/ios-to-android/SUMMARY.txt" ]] && cat "$RUN_DIR/ios-to-android/SUMMARY.txt"
  [[ -f "$RUN_DIR/android-to-ios/SUMMARY.txt" ]] && cat "$RUN_DIR/android-to-ios/SUMMARY.txt"
} >"$RUN_DIR/SUMMARY.txt"

final_rc=0
if [[ "$ios_rc" -ne 0 || "$android_rc" -ne 0 ]]; then
  final_rc=1
fi

log "physical_bidirectional done final_exit=$final_rc"
exit "$final_rc"
