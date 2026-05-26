#!/usr/bin/env bash
# Exit 0 when at least one RedWallet test iPhone is launch-ready in CoreDevice.
# Exit 1 when support services are down. Exit 2 when phones are not connected.
# REDWALLET_JSON=1 prints one JSON line for AutoCode parsers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPHONE12_UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
LIPHONE_UDID="${REDWALLET_LIPHONE_UDID:-00008020-0011204911F3002E}"
JSON_MODE="${REDWALLET_JSON:-0}"

json_out() {
  [[ "$JSON_MODE" == "1" ]] || return 0
  printf '%s\n' "$1"
}

if ! "$ROOT_DIR/scripts/start-redwallet-real-device-support.sh" >/dev/null 2>&1; then
  json_out '{"ready":false,"exit":1,"reason":"support_services_down"}'
  echo "NOT_READY support_services_down — run: scripts/start-redwallet-real-device-support.sh"
  exit 1
fi

device_line() {
  local udid="$1"
  xcrun devicectl list devices --columns '*' 2>/dev/null | awk -v u="$udid" '$0 ~ u { print $0 }'
}

for udid in "$IPHONE12_UDID" "$LIPHONE_UDID"; do
  line="$(device_line "$udid" || true)"
  if [[ -z "$line" ]]; then
    continue
  fi
  if [[ "$line" == *unavailable* ]]; then
    echo "NOT_READY device_unavailable udid=$udid"
    continue
  fi
  if [[ "$line" == *connected* || "$line" == *available* ]]; then
    json_out "{\"ready\":true,\"exit\":0,\"udid\":\"$udid\"}"
    echo "READY udid=$udid"
    echo "$line"
    exit 0
  fi
  echo "NOT_READY device_unknown_state udid=$udid line=$line"
done

json_out '{"ready":false,"exit":2,"reason":"no_launchable_device"}'
echo "NOT_READY no_launchable_device — reconnect USB, trust Mac, unlock screen, then re-run."
exit 2
