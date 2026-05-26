#!/usr/bin/env bash
# Exit 0 when at least one RedWallet test iPhone is launch-ready in CoreDevice.
# Exit 1 when support services are down. Exit 2 when phones are not connected.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPHONE12_UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
LIPHONE_UDID="${REDWALLET_LIPHONE_UDID:-00008020-0011204911F3002E}"

if ! "$ROOT_DIR/scripts/start-redwallet-real-device-support.sh" >/dev/null 2>&1; then
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
    echo "READY udid=$udid"
    echo "$line"
    exit 0
  fi
  echo "NOT_READY device_unknown_state udid=$udid line=$line"
done

echo "NOT_READY no_launchable_device — reconnect USB, trust Mac, unlock screen, then re-run."
exit 2
