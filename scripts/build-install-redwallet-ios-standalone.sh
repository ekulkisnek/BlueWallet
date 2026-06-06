#!/usr/bin/env bash
# Build, embed JS, sign, install, and launch RedWallet on physical iPhones
# without requiring Metro at app launch.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/build-install-redwallet-ios-standalone.sh <device-udid> [device-udid ...]

Builds a legitimate locally signed iphoneos app, embeds main.jsbundle, resigns it,
then installs and launches it on the supplied physical iPhones. The installed app
does not need Metro or a computer-hosted JS bundle to open.

Required when using automatic signing:
  REDWALLET_IOS_TEAM_ID=<Apple Developer team id>

Optional:
  REDWALLET_IOS_BUNDLE_ID=com.your.local.bundle
  REDWALLET_IOS_CONFIGURATION=Debug|Release    # default: Debug + embedded JS
  REDWALLET_IOS_CODESIGN_IDENTITY="Apple Development: ..."
  REDWALLET_LOG_ROOT=/Volumes/T705/redwallet-logs
  REDWALLET_DERIVED_DATA=/tmp/redwallet-standalone-device
  REDWALLET_REQUIRE_USB_TUNNEL=1                # default: 0 for standalone

Example:
  REDWALLET_IOS_TEAM_ID=ABCDE12345 \
    scripts/build-install-redwallet-ios-standalone.sh \
    00008020-0011204911F3002E 00008101-000128643E28001E
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit $([[ $# -lt 1 ]] && echo 2 || echo 0)
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/ios-standalone-install-${STAMP}"
DERIVED="${REDWALLET_DERIVED_DATA:-/tmp/redwallet-standalone-device-${STAMP}}"
CONFIG="${REDWALLET_IOS_CONFIGURATION:-Debug}"
BUILD_DEVICE="${REDWALLET_IOS_BUILD_DEVICE:-$1}"
DEVICES=("$@")

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-ios-standalone-install"
cd "$ROOT_DIR"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/standalone.log"
}

log "START config=$CONFIG build_device=$BUILD_DEVICE devices=${DEVICES[*]}"
log "derived_data=$DERIVED"

security find-identity -v -p codesigning >"$RUN_DIR/codesigning-identities.txt" 2>&1 || true
xcrun devicectl list devices --columns '*' >"$RUN_DIR/devicectl-devices-before.txt" 2>&1 || true

args=(
  -workspace ios/BlueWallet.xcworkspace
  -scheme BlueWallet
  -configuration "$CONFIG"
  -destination "id=$BUILD_DEVICE"
  -derivedDataPath "$DERIVED"
  build
)

if [[ -n "${REDWALLET_IOS_TEAM_ID:-}" ]]; then
  args+=(
    CODE_SIGN_STYLE=Automatic
    DEVELOPMENT_TEAM="$REDWALLET_IOS_TEAM_ID"
    "DEVELOPMENT_TEAM[sdk=iphoneos*]=$REDWALLET_IOS_TEAM_ID"
    PROVISIONING_PROFILE_SPECIFIER=
    -allowProvisioningUpdates
  )
fi

if [[ -n "${REDWALLET_IOS_BUNDLE_ID:-}" ]]; then
  args+=("PRODUCT_BUNDLE_IDENTIFIER=$REDWALLET_IOS_BUNDLE_ID")
fi

set +e
xcodebuild "${args[@]}" >"$RUN_DIR/xcodebuild.log" 2>&1
build_rc=$?
set -e
log "XCODEBUILD_EXIT=$build_rc"
if [[ "$build_rc" -ne 0 ]]; then
  tail -80 "$RUN_DIR/xcodebuild.log" | tee -a "$RUN_DIR/standalone.log"
  exit "$build_rc"
fi

APP="$DERIVED/Build/Products/${CONFIG}-iphoneos/BlueWallet.app"
if [[ ! -d "$APP" ]]; then
  log "BLOCKER built app missing: $APP"
  exit 1
fi

log "BUNDLE app=$APP"
REDWALLET_IOS_APP_PATH="$APP" \
  REDWALLET_FORCE_LAUNCH_UDID="${REDWALLET_FORCE_LAUNCH_UDID:-$BUILD_DEVICE}" \
  REDWALLET_REQUIRE_USB_TUNNEL="${REDWALLET_REQUIRE_USB_TUNNEL:-0}" \
  "$ROOT_DIR/scripts/bundle-redwallet-ios-real-device.sh" >"$RUN_DIR/bundle.log" 2>&1

if [[ ! -s "$APP/main.jsbundle" ]]; then
  log "BLOCKER main.jsbundle missing after bundle step"
  exit 1
fi

BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-}"
if [[ -z "$BUNDLE_ID" ]]; then
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
fi

log "INSTALL_LAUNCH bundle_id=$BUNDLE_ID"
REDWALLET_IOS_INSTALL_LOG_DIR="$RUN_DIR/install-launch" \
  "$ROOT_DIR/scripts/install-launch-redwallet-ios-devices.sh" "$APP" "$BUNDLE_ID" "${DEVICES[@]}" \
  >"$RUN_DIR/install-launch.log" 2>&1

xcrun devicectl list devices --columns '*' >"$RUN_DIR/devicectl-devices-after.txt" 2>&1 || true
log "DONE run_dir=$RUN_DIR app=$APP"
echo "run_dir=$RUN_DIR"
echo "app=$APP"
echo "bundle_id=$BUNDLE_ID"
