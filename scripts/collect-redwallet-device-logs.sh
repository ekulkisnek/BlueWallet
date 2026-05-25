#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/collect-redwallet-device-logs.sh [output-root] [minutes]

Collect a Codex-friendly RedWallet evidence bundle before, during, or after a
real-device/simulator signet run. It is safe to run even when phones are not
connected; missing sources are recorded instead of failing the bundle.

The bundle includes raw command output plus `events.ndjson`, a stable structured
index that future Codex turns can scan without guessing which commands ran.

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
CURRENT_LINK="${OUTPUT_ROOT%/}/current-device-proof"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
EVENTS="$OUT_DIR/events.ndjson"

mkdir -p "$OUT_DIR"/{ios,android,simulators,signet,host,repo,metro,xcode,desktop}

json_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

event() {
  local type="$1"
  local status="$2"
  local detail="${3:-}"
  printf '{"time":"%s","type":"%s","status":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(json_escape "$type")" \
    "$(json_escape "$status")" \
    "$(json_escape "$detail")" >> "$EVENTS"
}

event "bundle.start" "ok" "$OUT_DIR"

run_capture() {
  local output="$1"
  shift
  local status=0
  {
    echo "# $*"
    "$@"
  } > "$output" 2>&1 || status=$?
  event "command" "exit:$status" "$output :: $*"
  return 0
}

run_capture "$OUT_DIR/repo/git-status.txt" git -C "$ROOT_DIR" status --short
run_capture "$OUT_DIR/repo/git-head.txt" git -C "$ROOT_DIR" log --oneline -12
run_capture "$OUT_DIR/repo/git-remotes.txt" git -C "$ROOT_DIR" remote -v
run_capture "$OUT_DIR/repo/package-version.txt" node -e 'const p=require("./package.json"); console.log(JSON.stringify({name:p.name,version:p.version}, null, 2))'
run_capture "$OUT_DIR/host/date.txt" date
run_capture "$OUT_DIR/host/ifconfig.txt" ifconfig
run_capture "$OUT_DIR/host/tailscale-ip.txt" tailscale ip -4
run_capture "$OUT_DIR/host/listening-ports.txt" lsof -nP -iTCP -sTCP:LISTEN
run_capture "$OUT_DIR/host/redwallet-signet-endpoints.txt" "$ROOT_DIR/scripts/redwallet-signet-endpoints.sh" "$OUT_DIR/host"
run_capture "$OUT_DIR/ios/xctrace-devices.txt" xcrun xctrace list devices
run_capture "$OUT_DIR/ios/devicectl-devices.txt" xcrun devicectl list devices
run_capture "$OUT_DIR/ios/devicectl-devices-all-columns.txt" xcrun devicectl list devices --columns '*'
run_capture "$OUT_DIR/ios/devicectl-json.txt" xcrun devicectl list devices --json-output -
run_capture "$OUT_DIR/ios/usb-devices-iphone.txt" sh -c "system_profiler SPUSBDataType 2>/dev/null | rg -i -C 3 'iphone|apple mobile|coredevice|00008020|LiPhone' || true"
run_capture "$OUT_DIR/simulators/simctl-list.txt" xcrun simctl list devices
run_capture "$OUT_DIR/android/adb-devices.txt" adb devices -l
run_capture "$OUT_DIR/metro/metro-processes.txt" pgrep -af "react-native|metro|node.*8081"
run_capture "$OUT_DIR/xcode/xcode-version.txt" xcodebuild -version
run_capture "$OUT_DIR/xcode/build-settings.txt" xcodebuild -workspace "$ROOT_DIR/ios/BlueWallet.xcworkspace" -scheme BlueWallet -showBuildSettings
run_capture "$OUT_DIR/host/recent-diagnostic-reports.txt" find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f -mtime -2

if [[ -f "$COMPOSE_FILE" ]] && command -v docker >/dev/null 2>&1; then
  run_capture "$OUT_DIR/signet/docker-compose-ps.txt" docker compose -f "$COMPOSE_FILE" ps
  run_capture "$OUT_DIR/signet/mainchain-height.txt" docker exec private-drivechain-local-mainchain-1 drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockcount
  run_capture "$OUT_DIR/signet/mainchain-chaininfo.txt" docker exec private-drivechain-local-mainchain-1 drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getblockchaininfo
  run_capture "$OUT_DIR/signet/bitassets-state.txt" docker compose -f "$COMPOSE_FILE" exec -T bitassets plain_bitassets_app_cli bitassets
  run_capture "$OUT_DIR/signet/bitassets-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color bitassets
  run_capture "$OUT_DIR/signet/enforcer-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color enforcer
  run_capture "$OUT_DIR/signet/mainchain-logs.txt" docker compose -f "$COMPOSE_FILE" logs --since "${MINUTES}m" --no-color mainchain
fi

while read -r udid; do
  [[ -z "$udid" ]] && continue
  safe_udid="${udid//[^A-Za-z0-9._-]/_}"
  mkdir -p "$OUT_DIR/simulators/$safe_udid"
  run_capture "$OUT_DIR/simulators/$safe_udid/bluewallet.log" \
    xcrun simctl spawn "$udid" log show --style compact --last "${MINUTES}m" --predicate 'process == "BlueWallet" OR eventMessage CONTAINS "REDWALLET_EVENT" OR eventMessage CONTAINS "[BitAssetsWallet]"'
  run_capture "$OUT_DIR/simulators/$safe_udid/errors.log" \
    xcrun simctl spawn "$udid" log show --style compact --last "${MINUTES}m" --predicate 'eventType == logEvent AND (messageType == fault OR messageType == error)'
  run_capture "$OUT_DIR/simulators/$safe_udid/crashes.txt" \
    find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f -name '*BlueWallet*' -mtime -2
  xcrun simctl io "$udid" screenshot "$OUT_DIR/simulators/$safe_udid/screenshot.png" >/dev/null 2>&1 || true
done < <(xcrun simctl list devices booted 2>/dev/null | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p')

if command -v xcrun >/dev/null 2>&1; then
  # Best-effort physical iOS diagnostics. Missing/locked/untrusted devices are
  # captured as output; this script must remain non-blocking for unattended runs.
  xcrun devicectl list devices --json-output - > "$OUT_DIR/ios/devicectl-devices.raw.json" 2>/dev/null || true
  python3 - "$OUT_DIR/ios/devicectl-devices.raw.json" > "$OUT_DIR/ios/coredevice-hostname-reachability.txt" <<'PY' || true
import json, subprocess, sys

def timed_getaddrinfo(name, seconds=3):
    try:
        result = subprocess.run(
            ["dscacheutil", "-q", "host", "-a", "name", name],
            capture_output=True,
            text=True,
            timeout=seconds,
        )
    except subprocess.TimeoutExpired:
        return f"resolve_timeout after {seconds}s"
    output = result.stdout.strip()
    if output:
        lines = " ".join(line.strip() for line in output.splitlines() if line.strip())
        return f"resolves {lines}"
    return f"resolve_failed exit:{result.returncode} {result.stderr.strip()}"

try:
    data = json.load(open(sys.argv[1]))
except Exception as exc:
    print(f"devicectl_json_unreadable: {type(exc).__name__}: {exc}")
    sys.exit(0)

for device in data.get("result", {}).get("devices", []):
    name = device.get("deviceProperties", {}).get("name") or device.get("name") or "unknown"
    identifier = device.get("identifier", "")
    state = device.get("state", "")
    connection = device.get("connectionProperties", {})
    tunnel = connection.get("tunnelState", "")
    pairing = connection.get("pairingState", "")
    print(f"device={name} identifier={identifier} state={state} pairingState={pairing} tunnelState={tunnel}")
    for host in connection.get("potentialHostnames", []):
        print(f"{host}: {timed_getaddrinfo(host)}")
PY
  while read -r device_id; do
    [[ -z "$device_id" ]] && continue
    safe_device="${device_id//[^A-Za-z0-9._-]/_}"
    mkdir -p "$OUT_DIR/ios/$safe_device"
    run_capture "$OUT_DIR/ios/$safe_device/info.txt" xcrun devicectl device info details --device "$device_id"
    run_capture "$OUT_DIR/ios/$safe_device/installed-apps.txt" xcrun devicectl device info apps --device "$device_id"
    run_capture "$OUT_DIR/ios/$safe_device/processes.txt" xcrun devicectl device info processes --device "$device_id"
    run_capture "$OUT_DIR/ios/$safe_device/syslog-hint.txt" printf '%s\n' "For deeper logs: open Console.app, select device $device_id, filter REDWALLET_EVENT OR BitAssetsWallet OR BlueWallet, then rerun this collector after saving the log."
  done < <(python3 - "$OUT_DIR/ios/devicectl-devices.raw.json" <<'PY'
import json, sys
try:
    data=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for device in data.get("result", {}).get("devices", []):
    props=device.get("properties", device)
    hw=props.get("hardwareProperties", {})
    connection=props.get("connectionProperties", {})
    if hw.get("platform") == "iOS" and connection.get("transportType") != "localNetwork":
        identifier=device.get("identifier") or props.get("identifier")
        availability=str(props.get("availability", device.get("state", ""))).lower()
        tunnel=str(connection.get("tunnelState", "")).lower()
        if identifier and (("available" in availability and "unavailable" not in availability) or tunnel == "available"):
            print(identifier)
PY
)
fi

while read -r serial state rest; do
  [[ -z "$serial" || "$serial" == "List" || "$state" != "device" ]] && continue
  safe_serial="${serial//[^A-Za-z0-9._-]/_}"
  mkdir -p "$OUT_DIR/android/$safe_serial"
  run_capture "$OUT_DIR/android/$safe_serial/logcat.txt" adb -s "$serial" logcat -d -v time
  run_capture "$OUT_DIR/android/$safe_serial/bugreport.txt" adb -s "$serial" shell dumpsys activity top
  run_capture "$OUT_DIR/android/$safe_serial/package.txt" adb -s "$serial" shell dumpsys package com.layertwolabs.bluewallet
done < <(adb devices -l 2>/dev/null || true)

if [[ -d /Volumes/T705/redwallet-logs ]]; then
  run_capture "$OUT_DIR/desktop/recent-proof-logs.txt" find /Volumes/T705/redwallet-logs -maxdepth 2 -type f -mtime -3
fi

cat > "$OUT_DIR/README.md" <<EOF
# RedWallet Device Evidence Bundle

- Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Minutes captured: $MINUTES
- Repo: $ROOT_DIR
- Local signet compose: $COMPOSE_FILE
- Structured event index: events.ndjson

Start with:
- \`events.ndjson\`
- \`ios/xctrace-devices.txt\`
- \`ios/devicectl-devices.txt\`
- \`android/adb-devices.txt\`
- \`signet/docker-compose-ps.txt\`
- \`signet/bitassets-logs.txt\`
- \`repo/git-status.txt\`

This bundle intentionally records missing phones/simulators as command output
instead of failing, so Codex can compare before/after phone attachment.

Real-device iOS logging notes:
- App/native logs use the \`REDWALLET_EVENT\` and \`[BitAssetsWallet]\` markers.
- If devicectl cannot pull live logs on this Xcode version, use Console.app with
  the physical device selected and filter those markers, then save the log into
  this bundle or rerun this collector after the app action.
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
  echo "events=$EVENTS"
  echo "current_link=$CURRENT_LINK"
} | tee "$OUT_DIR/SUMMARY.txt"

ln -sfn "$OUT_DIR" "$CURRENT_LINK"
event "bundle.finish" "ok" "$OUT_DIR"
