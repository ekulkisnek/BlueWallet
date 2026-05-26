#!/usr/bin/env bash
# Bounded preflight + optional launch for phone-origin BitAssets/QUIC proof.
# Exits 0 only when monitor collected app evidence; otherwise documents blocker and exits 2.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/phone-origin-retry-${STAMP}"
MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-45}"
SKIP_LAUNCH="${REDWALLET_PHONE_SKIP_LAUNCH:-0}"
IPHONE12_UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
LIPHONE_UDID="${REDWALLET_LIPHONE_UDID:-00008020-0011204911F3002E}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"

mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-phone-origin-retry"

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/retry.log"
}

probe() {
  local name="$1"
  shift
  local out="$RUN_DIR/probes/${name}.txt"
  mkdir -p "$RUN_DIR/probes"
  set +e
  "$@" >"$out" 2>&1
  local rc=$?
  set -e
  log "PROBE $name exit=$rc -> $out"
  return "$rc"
}

log "START run_dir=$RUN_DIR"

# Latest phone-reachable signet endpoints (no docker ops here).
probe signet-endpoints bash -c "cd '$ROOT_DIR' && scripts/redwallet-signet-endpoints.sh" || true
ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  cp "$ENV_FILE" "$RUN_DIR/redwallet-signet.env"
  log "BITASSETS_RPC_URL=${BITASSETS_RPC_URL:-unset}"
  export BITASSETS_RPC_URL
  host_only="${BITASSETS_RPC_URL#http://}"
  host_only="${host_only#https://}"
  export BITASSETS_LITE_WALLET_QUIC_URL="${host_only%%/*}:6104"
fi

probe devicectl xcrun devicectl list devices --columns '*'
probe xctrace xcrun xctrace list devices

# Support services (always probe — useful even when phones are unavailable).
probe metro-status curl -sS -m 5 "${METRO_URL:-http://100.76.117.106:8081}/status"
probe collector-health curl -sS -m 5 http://192.168.1.50:6123/health
probe command-health curl -sS -m 5 http://192.168.1.50:6124/health
{
  echo "metro=$(grep -q 'packager-status:running' "$RUN_DIR/probes/metro-status.txt" 2>/dev/null && echo up || echo down)"
  echo "collector=$(grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health.txt" 2>/dev/null && echo up || echo down)"
  echo "command=$(grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health.txt" 2>/dev/null && echo up || echo down)"
} >"$RUN_DIR/support-services.txt"

device_state() {
  local udid="$1"
  xcrun devicectl list devices --columns '*' 2>/dev/null | awk -v u="$udid" '$0 ~ u { print $0 }'
}

pick_launch_udid() {
  local line state
  for udid in "$IPHONE12_UDID" "$LIPHONE_UDID"; do
    line="$(device_state "$udid" || true)"
    if [[ -z "$line" ]]; then
      log "DEVICE $udid not listed"
      continue
    fi
    if [[ "$line" == *unavailable* ]]; then
      log "DEVICE $udid unavailable: $line"
      continue
    fi
    if [[ "$line" == *connected* || "$line" == *available* ]]; then
      printf '%s\n' "$udid"
      return 0
    fi
    log "DEVICE $udid unknown state: $line"
  done
  return 1
}

if ! LAUNCH_UDID="$(pick_launch_udid)"; then
  log "BLOCKER no connected iPhone (both unavailable or missing). USB + trust + unlock required."
  log "NEXT: scripts/start-redwallet-real-device-support.sh then re-run this script."
  echo "blocker=no_connected_device" >"$RUN_DIR/BLOCKER.txt"
  if [[ "$SKIP_LAUNCH" == "1" ]]; then
    echo "status=preflight_blocked" >"$RUN_DIR/RESULT.txt"
  fi
  exit 2
fi

log "LAUNCH_TARGET udid=$LAUNCH_UDID"

probe device-details xcrun devicectl device info details --device "$LAUNCH_UDID"
if grep -q 'passcodeRequired: true' "$RUN_DIR/probes/device-details.txt" 2>/dev/null; then
  log "NOTE passcodeRequired=true on device; SpringBoard may still deny launch unless actively unlocked."
fi

if [[ "$SKIP_LAUNCH" == "1" ]]; then
  log "SKIP_LAUNCH=1 preflight only"
  echo "status=preflight_only" >"$RUN_DIR/RESULT.txt"
  exit 0
fi

if ! grep -q 'packager-status:running' "$RUN_DIR/probes/metro-status.txt" 2>/dev/null; then
  log "WARN Metro not running at ${METRO_URL:-http://100.76.117.106:8081}; start in another terminal:"
  log "  cd '$ROOT_DIR' && npx react-native start --host 0.0.0.0 --port 8081"
fi
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health.txt" 2>/dev/null; then
  log "WARN JS collector not healthy; run: scripts/start-redwallet-real-device-support.sh"
fi
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health.txt" 2>/dev/null; then
  log "WARN BitAssets command server not healthy; run: scripts/start-redwallet-real-device-support.sh"
fi

log "MONITOR_START seconds=$MONITOR_SECONDS udid=$LAUNCH_UDID"
set +e
"$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" "$BUNDLE_ID" "$MONITOR_SECONDS" "$LAUNCH_UDID"
monitor_rc=$?
set -e
log "MONITOR_EXIT=$monitor_rc"

MONITOR_DIR="$(readlink "${LOG_ROOT%/}/current-ios-real-device-app-monitor" 2>/dev/null || true)"
if [[ -n "$MONITOR_DIR" ]]; then
  cp -R "$MONITOR_DIR" "$RUN_DIR/monitor-copy" 2>/dev/null || true
  if [[ -f "$MONITOR_DIR/devices/$LAUNCH_UDID/redwallet-console-interesting.txt" ]]; then
    cp "$MONITOR_DIR/devices/$LAUNCH_UDID/redwallet-console-interesting.txt" "$RUN_DIR/"
    if grep -qi 'could not be, unlocked' "$RUN_DIR/redwallet-console-interesting.txt"; then
      log "BLOCKER device locked at launch — unlock phone and tap RedWallet icon, then re-run."
      echo "blocker=device_locked" >"$RUN_DIR/BLOCKER.txt"
      exit 2
    fi
  fi
fi

COLLECTOR_DIR="$(readlink "${LOG_ROOT%/}/current-js-event-collector" 2>/dev/null || true)"
if [[ -n "$COLLECTOR_DIR" && -f "$COLLECTOR_DIR/events.ndjson" ]]; then
  phone_events="$(grep -v '"remote":"::ffff:127' "$COLLECTOR_DIR/events.ndjson" 2>/dev/null | grep -v '"remote":"127' || true)"
  if [[ -n "$phone_events" ]]; then
    log "SUCCESS phone-origin JS events detected"
    printf '%s\n' "$phone_events" >"$RUN_DIR/phone-origin-events.ndjson"
    echo "status=phone_origin_events" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
fi

log "BLOCKER no phone-origin events yet; check monitor console and ensure app foreground + unlock."
echo "blocker=no_phone_origin_events" >"$RUN_DIR/BLOCKER.txt"
exit 2
