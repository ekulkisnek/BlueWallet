#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/collect-redwallet-device-logs.sh [output-root] [minutes]

Collect a Codex-friendly RedWallet evidence bundle before, during, or after a
real-device/simulator signet run. It is safe to run even when phones are not
connected; missing sources are recorded instead of failing the bundle.

Examples:
  scripts/collect-redwallet-device-logs.sh
  scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${1:-${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}}"
MINUTES="${2:-20}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUTPUT_ROOT%/}/redwallet-device-bundle-${STAMP}"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"

mkdir -p "$OUT_DIR"/{ios,android,simulators,signet,host,repo}

run_capture() {
  local output="$1"
  shift
  {
    echo "# $*"
    "$@"
  } > "$output" 2>&1 || true
}

run_capture "$OUT_DIR/repo/git-status.txt" git -C "$ROOT_DIR" status --short
run_capture "$OUT_DIR/repo/git-head.txt" git -C "$ROOT_DIR" log --oneline -12
run_capture "$OUT_DIR/host/date.txt" date
run_capture "$OUT_DIR/host/ifconfig.txt" ifconfig
run_capture "$OUT_DIR/host/tailscale-ip.txt" tailscale ip -4
run_capture "$OUT_DIR/ios/xctrace-devices.txt" xcrun xctrace list devices
run_capture "$OUT_DIR/ios/devicectl-devices.txt" xcrun devicectl list devices
run_capture "$OUT_DIR/simulators/simctl-list.txt" xcrun simctl list devices
run_capture "$OUT_DIR/android/adb-devices.txt" adb devices -l

if [[ -f "$COMPOSE_FILE" ]] && command -v docker >/dev/null 2>&1; then
  run_capture "$OUT_DIR/signet/docker-compose-ps.txt" docker compose -f "$COMPOSE_FILE" ps
  run_capture "$OUT_DIR/signet/mainchain-height.txt" docker exec private-drivechain-local-mainchain-1 drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount
  run_capture "$OUT_DIR/signet/bitassets-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color bitassets
  run_capture "$OUT_DIR/signet/enforcer-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color enforcer
  run_capture "$OUT_DIR/signet/mainchain-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color mainchain
fi

while read -r udid; do
  [[ -z "$udid" ]] && continue
  safe_udid="${udid//[^A-Za-z0-9._-]/_}"
  mkdir -p "$OUT_DIR/simulators/$safe_udid"
  run_capture "$OUT_DIR/simulators/$safe_udid/bluewallet.log" \
    xcrun simctl spawn "$udid" log show --style compact --last "${MINUTES}m" --predicate 'process == "BlueWallet"'
  run_capture "$OUT_DIR/simulators/$safe_udid/errors.log" \
    xcrun simctl spawn "$udid" log show --style compact --last "${MINUTES}m" --predicate 'eventType == logEvent AND (messageType == fault OR messageType == error)'
  xcrun simctl io "$udid" screenshot "$OUT_DIR/simulators/$safe_udid/screenshot.png" >/dev/null 2>&1 || true
done < <(xcrun simctl list devices booted 2>/dev/null | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p')

while read -r serial state rest; do
  [[ -z "$serial" || "$serial" == "List" || "$state" != "device" ]] && continue
  safe_serial="${serial//[^A-Za-z0-9._-]/_}"
  mkdir -p "$OUT_DIR/android/$safe_serial"
  run_capture "$OUT_DIR/android/$safe_serial/logcat.txt" adb -s "$serial" logcat -d -v time
  run_capture "$OUT_DIR/android/$safe_serial/bugreport.txt" adb -s "$serial" shell dumpsys activity top
done < <(adb devices -l 2>/dev/null || true)

cat > "$OUT_DIR/README.md" <<EOF
# RedWallet Device Evidence Bundle

- Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Minutes captured: $MINUTES
- Repo: $ROOT_DIR
- Local signet compose: $COMPOSE_FILE

Start with:
- \`ios/xctrace-devices.txt\`
- \`ios/devicectl-devices.txt\`
- \`android/adb-devices.txt\`
- \`signet/docker-compose-ps.txt\`
- \`signet/bitassets-logs.txt\`
- \`repo/git-status.txt\`

This bundle intentionally records missing phones/simulators as command output
instead of failing, so Codex can compare before/after phone attachment.
EOF

{
  echo "output_dir=$OUT_DIR"
  echo "minutes=$MINUTES"
  echo "repo=$ROOT_DIR"
  echo "compose_file=$COMPOSE_FILE"
  echo "ios_devices=$OUT_DIR/ios/xctrace-devices.txt"
  echo "devicectl_devices=$OUT_DIR/ios/devicectl-devices.txt"
  echo "android_devices=$OUT_DIR/android/adb-devices.txt"
  echo "signet_logs=$OUT_DIR/signet"
} | tee "$OUT_DIR/SUMMARY.txt"
