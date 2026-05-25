#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/run-redwallet-ios-device-install.sh <device-udid-or-name>

Attempts a legitimate local Xcode device build for RedWallet/BlueWallet and
captures the exact signing/device error if install is blocked.

Required when using automatic signing:
  REDWALLET_IOS_TEAM_ID=<Apple Developer team id>

Optional:
  REDWALLET_IOS_BUNDLE_ID=com.your.local.bundle
  REDWALLET_LOG_ROOT=/Volumes/T705/redwallet-logs
  REDWALLET_DERIVED_DATA=/tmp/redwallet-derived-device

This script does not bypass Apple signing. It only switches to automatic signing
when a team id is explicitly supplied through the environment.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit $([[ $# -lt 1 ]] && echo 2 || echo 0)
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE="$1"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$LOG_ROOT/ios-device-install-$STAMP"
DERIVED="${REDWALLET_DERIVED_DATA:-/tmp/redwallet-derived-device-$STAMP}"

mkdir -p "$RUN_DIR"
cd "$ROOT_DIR"

{
  echo "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "device=$DEVICE"
  echo "repo=$ROOT_DIR"
  echo "derived_data=$DERIVED"
  echo "redwallet_ios_team_id=${REDWALLET_IOS_TEAM_ID:-}"
  echo "redwallet_ios_bundle_id=${REDWALLET_IOS_BUNDLE_ID:-}"
} | tee "$RUN_DIR/SUMMARY.txt"

security find-identity -v -p codesigning > "$RUN_DIR/codesigning-identities.txt" 2>&1 || true
find "$HOME/Library/MobileDevice/Provisioning Profiles" -maxdepth 1 -type f -name '*.mobileprovision' \
  > "$RUN_DIR/provisioning-profiles.txt" 2>/dev/null || true
xcrun devicectl list devices --columns '*' > "$RUN_DIR/devicectl-devices.txt" 2>&1 || true
xcodebuild -workspace ios/BlueWallet.xcworkspace -scheme BlueWallet -showdestinations \
  > "$RUN_DIR/xcode-destinations.txt" 2>&1 || true

args=(
  -workspace ios/BlueWallet.xcworkspace
  -scheme BlueWallet
  -configuration Debug
  -destination "id=$DEVICE"
  -derivedDataPath "$DERIVED"
  build
)

if [[ -n "${REDWALLET_IOS_TEAM_ID:-}" ]]; then
  args+=(
    CODE_SIGN_STYLE=Automatic
    DEVELOPMENT_TEAM="$REDWALLET_IOS_TEAM_ID"
    "DEVELOPMENT_TEAM[sdk=iphoneos*]=$REDWALLET_IOS_TEAM_ID"
    PROVISIONING_PROFILE_SPECIFIER=
    "PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]="
    -allowProvisioningUpdates
  )
fi

if [[ -n "${REDWALLET_IOS_BUNDLE_ID:-}" ]]; then
  args+=("PRODUCT_BUNDLE_IDENTIFIER=$REDWALLET_IOS_BUNDLE_ID")
fi

set +e
xcodebuild "${args[@]}" 2>&1 | tee "$RUN_DIR/xcodebuild.log"
exit_code=${PIPESTATUS[0]}
set -e

echo "XCODEBUILD_EXIT=$exit_code" | tee -a "$RUN_DIR/SUMMARY.txt"
scripts/collect-redwallet-device-logs.sh "$LOG_ROOT" 30 > "$RUN_DIR/post-attempt-log-bundle.out" 2>&1 || true
awk -F= '/^output_dir=/{print "post_attempt_bundle="$2}' "$RUN_DIR/post-attempt-log-bundle.out" | tee -a "$RUN_DIR/SUMMARY.txt" || true

echo "run_dir=$RUN_DIR"
exit "$exit_code"
