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

USB_TUNNEL_MAC="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" 2>/dev/null || true)"
if [[ -n "$USB_TUNNEL_MAC" ]]; then
  log "USB_TUNNEL_MAC=$USB_TUNNEL_MAC"
  probe ensure-servers bash -c "cd '$ROOT_DIR' && scripts/ensure-redwallet-ios-device-servers.sh" || true
fi

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
  host_only="${host_only%%/*}"
  host_only="${host_only%%:*}"
  export BITASSETS_LITE_WALLET_QUIC_URL="${host_only}:6104"
fi

probe devicectl xcrun devicectl list devices --columns '*'
probe xctrace xcrun xctrace list devices

# Support services (always probe — useful even when phones are unavailable).
probe metro-status curl -sS -m 5 "${METRO_URL:-http://100.76.117.106:8081}/status"
probe collector-health curl -sS -m 5 http://192.168.1.50:6123/health
probe collector-health-ts curl -sS -m 5 http://100.76.117.106:6123/health
if [[ -n "$USB_TUNNEL_MAC" ]]; then
  # Mac self-curl to fd26:: often times out; phone may still reach :: — do not fail the run.
  probe collector-health-usb curl -g -sS -m 5 "http://[${USB_TUNNEL_MAC}]:6123/health" || true
  probe command-health-usb curl -g -sS -m 5 "http://[${USB_TUNNEL_MAC}]:6124/health" || true
fi
probe command-health curl -sS -m 5 http://192.168.1.50:6124/health
probe bitassets-rpc-lan curl -sS -m 5 -o /dev/null -w '%{http_code}' "${BITASSETS_RPC_URL:-http://100.76.117.106:6004}/" || true
probe bitassets-rpc-ts curl -sS -m 5 -o /dev/null -w '%{http_code}' "${BITASSETS_RPC_URL:-http://100.76.117.106:6004}/" || true

resolve_command_server_dir() {
  local cmd_dir="${REDWALLET_BITASSETS_COMMAND_DIR:-}"
  if [[ -z "$cmd_dir" ]]; then
    cmd_dir="$(ls -td "$LOG_ROOT"/ios-real-device-selftest-*/command-server "$LOG_ROOT"/redwallet-bitassets-command-server-*/ 2>/dev/null | head -1 || true)"
  fi
  printf '%s' "$cmd_dir"
}

seed_bitassets_command() {
  local cmd_dir host rpc quic
  cmd_dir="$(resolve_command_server_dir)"
  [[ -n "$cmd_dir" && -d "$cmd_dir" ]] || return 0
  # Phone BitAssets proof uses Luke signet host (192.168.1.236) when reachable from device.
  host="${REDWALLET_FORCE_PHONE_HOST:-${REDWALLET_PHONE_SIGNET_HOST:-192.168.1.236}}"
  if [[ -z "${REDWALLET_FORCE_PHONE_HOST:-}" ]] &&
    grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null; then
    host="${REDWALLET_PHONE_LAN_HOST:-192.168.1.50}"
  fi
  if [[ -z "${REDWALLET_FORCE_PHONE_HOST:-}" ]] &&
    ! grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null &&
    ! grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-ts.txt" 2>/dev/null; then
    host="100.76.117.106"
  elif [[ -z "${REDWALLET_FORCE_PHONE_HOST:-}" ]] &&
    ! grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null; then
    host="100.76.117.106"
  fi
  rpc="http://${host}:6004"
  quic="${host}:6104"
  op="${REDWALLET_BITASSETS_COMMAND_OPERATION:-createWallet}"
  case "$op" in
    reserve)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"reserve","commandId":"iphone12-reserve-${STAMP}","name":"RWPROOF","feeSats":500}
EOF
      ;;
    register)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"register","commandId":"iphone12-register-${STAMP}","name":"RWPROOF","initialSupply":1000,"feeSats":500}
EOF
      ;;
    *)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"createWallet","commandId":"iphone12-proof-${STAMP}","label":"iPhone 12 BitAssets","rpcUrl":"$rpc","bitassetsLiteWalletQuicUrl":"$quic","skipSync":true}
EOF
      ;;
  esac
  log "SEEDED command.json operation=$op host=$host dir=$cmd_dir"
}

# Do not GET /command during preflight — the server is one-shot and would steal the phone payload.
CMD_DIR="$(resolve_command_server_dir)"
if [[ -n "$CMD_DIR" && -f "$CMD_DIR/command.json" ]]; then
  cp "$CMD_DIR/command.json" "$RUN_DIR/probes/command-body.txt"
  log "PROBE command-body file=ok (not fetched from server)"
else
  echo "command.json missing under $CMD_DIR" >"$RUN_DIR/probes/command-body.txt"
  log "PROBE command-body file=missing"
fi
seed_bitassets_command || true
{
  echo "metro=$(grep -q 'packager-status:running' "$RUN_DIR/probes/metro-status.txt" 2>/dev/null && echo up || echo down)"
  echo "collector=$(grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/collector-health.txt" 2>/dev/null && echo up || echo down)"
  if grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health.txt" 2>/dev/null; then
    echo "command=up"
  elif grep -qE '"operation".*createWallet' "$RUN_DIR/probes/command-body.txt" 2>/dev/null; then
    echo "command=up_legacy"
  else
    echo "command=down"
  fi
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

reinstall_redwallet_app() {
  local app="${REDWALLET_IOS_APP_PATH:-}"
  [[ -n "$app" && -d "$app" ]] || return 0
  local out="$RUN_DIR/probes/reinstall.txt"
  mkdir -p "$RUN_DIR/probes"
  set +e
  xcrun devicectl device uninstall app --device "$LAUNCH_UDID" "$BUNDLE_ID" >>"$out" 2>&1
  local uninstall_rc=$?
  perl -e 'alarm 120; exec @ARGV' 120 xcrun devicectl device install app --device "$LAUNCH_UDID" "$app" >>"$out" 2>&1
  local install_rc=$?
  set -e
  log "REINSTALL uninstall_exit=$uninstall_rc install_exit=$install_rc app=$app -> $out"
}

if [[ "${REDWALLET_IOS_FORCE_REINSTALL:-0}" == "1" ]]; then
  reinstall_redwallet_app || true
fi

# Refresh one-shot command immediately before launch so preflight probes cannot consume it.
seed_bitassets_command || true

push_usb_tunnel_host_file() {
  local usb_host tmp
  usb_host="$("$ROOT_DIR/scripts/redwallet-usb-tunnel-mac-ipv6.sh" 2>/dev/null || true)"
  [[ -n "$usb_host" ]] || return 0
  tmp="$(mktemp)"
  printf '%s\n' "$usb_host" >"$tmp"
  if perl -e 'alarm 15; exec @ARGV' 15 xcrun devicectl device copy to \
    --device "$LAUNCH_UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "$tmp" \
    --destination "Documents/redwallet-usb-tunnel-host.txt" >>"$RUN_DIR/push-usb-tunnel.log" 2>&1; then
    log "PUSHED usb tunnel host=$usb_host -> Documents/redwallet-usb-tunnel-host.txt"
  else
    log "WARN push usb tunnel host failed (see push-usb-tunnel.log)"
  fi
  rm -f "$tmp"
}
push_usb_tunnel_host_file || true

push_bitassets_selftest_command() {
  local cmd_dir tmp
  cmd_dir="$(resolve_command_server_dir)"
  [[ -n "$cmd_dir" && -f "$cmd_dir/command.json" ]] || return 0
  tmp="$(mktemp)"
  cp "$cmd_dir/command.json" "$tmp"
  if perl -e 'alarm 15; exec @ARGV' 15 xcrun devicectl device copy to \
    --device "$LAUNCH_UDID" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "$tmp" \
    --destination "Documents/redwallet-bitassets-selftest-command.json" >>"$RUN_DIR/push-selftest-command.log" 2>&1; then
    log "PUSHED command.json -> Documents/redwallet-bitassets-selftest-command.json"
  else
    log "WARN push selftest command failed (see push-selftest-command.log)"
  fi
  rm -f "$tmp"
}
push_bitassets_selftest_command || true

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
if ! grep -qE '"ok":true|^ok$' "$RUN_DIR/probes/command-health.txt" 2>/dev/null &&
  ! grep -qE '"operation".*createWallet' "$RUN_DIR/probes/command-body.txt" 2>/dev/null; then
  log "WARN BitAssets command server not healthy; run: scripts/start-redwallet-real-device-support.sh"
fi

log "MONITOR_START seconds=$MONITOR_SECONDS udid=$LAUNCH_UDID"
export REDWALLET_MONITOR_TERMINATE_EXISTING="${REDWALLET_MONITOR_TERMINATE_EXISTING:-1}"
# Mac log stream captures simulator noise; device console is required for real iPhone proof.
export REDWALLET_MONITOR_CONSOLE="${REDWALLET_MONITOR_CONSOLE:-1}"
export REDWALLET_MONITOR_SYSLOG="${REDWALLET_MONITOR_SYSLOG:-0}"
set +e
"$ROOT_DIR/scripts/monitor-redwallet-ios-real-devices.sh" "$BUNDLE_ID" "$MONITOR_SECONDS" "$LAUNCH_UDID"
monitor_rc=$?
set -e
log "MONITOR_EXIT=$monitor_rc"

# Capture monitor output before a later run overwrites current-ios-real-device-app-monitor.
MONITOR_DIR="$(readlink "${LOG_ROOT%/}/current-ios-real-device-app-monitor" 2>/dev/null || true)"
if [[ -n "$MONITOR_DIR" && -d "$MONITOR_DIR" ]]; then
  cp -R "$MONITOR_DIR" "$RUN_DIR/monitor-copy" 2>/dev/null || true
  printf '%s\n' "$MONITOR_DIR" >"$RUN_DIR/monitor-dir.txt"
  if [[ -f "$MONITOR_DIR/devices/$LAUNCH_UDID/redwallet-console-interesting.txt" ]]; then
    cp "$MONITOR_DIR/devices/$LAUNCH_UDID/redwallet-console-interesting.txt" "$RUN_DIR/"
    if grep -qi 'could not be, unlocked' "$RUN_DIR/redwallet-console-interesting.txt"; then
      log "BLOCKER device locked at launch — unlock phone and tap RedWallet icon, then re-run."
      echo "blocker=device_locked" >"$RUN_DIR/BLOCKER.txt"
      exit 2
    fi
  fi
elif [[ -d "$RUN_DIR/monitor-copy" ]]; then
  MONITOR_DIR="$RUN_DIR/monitor-copy"
fi

resolve_monitor_device_dir() {
  local base="$1"
  local udid="$2"
  if [[ -d "$base/devices/$udid" ]]; then
    printf '%s\n' "$base/devices/$udid"
    return 0
  fi
  local safe="${udid//[^A-Za-z0-9._-]/_}"
  if [[ -d "$base/devices/$safe" ]]; then
    printf '%s\n' "$base/devices/$safe"
    return 0
  fi
  return 1
}

MONITOR_DEVICE_DIR=""
if [[ -n "$MONITOR_DIR" ]]; then
  MONITOR_DEVICE_DIR="$(resolve_monitor_device_dir "$MONITOR_DIR" "$LAUNCH_UDID" 2>/dev/null || true)"
fi

if [[ -n "$MONITOR_DEVICE_DIR" && -f "$MONITOR_DEVICE_DIR/redwallet-console.log" ]]; then
  if rg -q 'Using real-device Metro bundle URL' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null; then
    log "BLOCKER phone native binary still uses Metro AppDelegate path — run scripts/finish-redwallet-ios-device-proof.sh after nosign xcodebuild"
    {
      echo "blocker=stale_native_metro_path"
      echo "hint=dylib_on_disk_may_be_new_but_installed_app_is_old_until_devicectl_install"
    } >"$RUN_DIR/BLOCKER.txt"
    exit 2
  fi
  if ! rg -q 'Using embedded JS bundle on device' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null; then
    log "WARN device console missing embedded JS AppDelegate line (see redwallet-console.log)"
  elif rg -q 'REDWALLET_EVENT' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null &&
    ! rg -q '127\.0\.0\.1:6004|127\.0\.0\.1:6104|CoreSimulator' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null; then
    log "SUCCESS phone-origin console (embedded JS + native BitAssets REDWALLET_EVENT)"
    cp "$MONITOR_DEVICE_DIR/redwallet-console.log" "$RUN_DIR/phone-origin-console.log"
    echo "status=phone_origin_console_embedded_bitassets" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
  if rg -q 'device_logger_installed|real_device_bitassets_wallet_created|real_device_bitassets_command' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null &&
    ! rg -q '127\.0\.0\.1:6004|127\.0\.0\.1:6104|CoreSimulator' "$MONITOR_DEVICE_DIR/redwallet-console.log" 2>/dev/null; then
    log "SUCCESS phone-origin devicectl console evidence"
    cp "$MONITOR_DEVICE_DIR/redwallet-console.log" "$RUN_DIR/phone-origin-console.log"
    echo "status=phone_origin_console" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
fi
if [[ -n "$MONITOR_DEVICE_DIR" && -f "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" ]]; then
  if rg -q 'REDWALLET_EVENT.*device_logger_installed|real_device_bitassets' "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" 2>/dev/null &&
    ! rg -q 'CoreSimulator|/CoreSimulator/' "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" 2>/dev/null; then
    log "SUCCESS phone-origin syslog evidence (REDWALLET_EVENT / BitAssets)"
    cp "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" "$RUN_DIR/phone-origin-syslog.txt"
    echo "status=phone_origin_syslog" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
  if rg -q 'REDWALLET_EVENT' "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" 2>/dev/null &&
    ! rg -q '127\.0\.0\.1:6004|127\.0\.0\.1:6104' "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" 2>/dev/null; then
    log "PARTIAL phone-origin syslog has REDWALLET_EVENT (see $RUN_DIR/phone-origin-syslog-partial.txt)"
    cp "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" "$RUN_DIR/phone-origin-syslog-partial.txt"
  elif rg -q '127\.0\.0\.1:6004' "$MONITOR_DEVICE_DIR/syslog-redwallet-interesting.txt" 2>/dev/null; then
    log "NOTE syslog REDWALLET_EVENT is host-simulator (127.0.0.1); rebuild embedded bundle: scripts/bundle-redwallet-ios-real-device.sh"
  fi
fi

DEVICE_EVENTS="$RUN_DIR/device-redwallet-events.ndjson"
if perl -e 'alarm 15; exec @ARGV' 15 xcrun devicectl device copy from \
  --device "$LAUNCH_UDID" \
  --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" \
  --source Documents/redwallet-device-events.ndjson \
  --destination "$DEVICE_EVENTS" >/dev/null 2>&1 && [[ -s "$DEVICE_EVENTS" ]]; then
  log "PULLED device event log -> $DEVICE_EVENTS"
  if rg -q '"platformVersion":"26\.2' "$DEVICE_EVENTS" 2>/dev/null &&
    rg -q 'real_device_bitassets_wallet_created|device_logger_installed' "$DEVICE_EVENTS" 2>/dev/null; then
    log "SUCCESS phone-origin device NDJSON (26.2.x BitAssets/logger)"
    echo "status=phone_origin_device_ndjson" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
fi

COLLECTOR_FILES=()
while IFS= read -r cf; do
  COLLECTOR_FILES+=("$cf")
done < <(ls -t "${LOG_ROOT%/}"/current-js-event-collector/events.ndjson "${LOG_ROOT%/}"/ios-real-device-selftest-*/js-event-collector/events.ndjson "${LOG_ROOT%/}"/redwallet-js-event-collector-*/events.ndjson 2>/dev/null | head -5)
phone_events=""
COLLECTOR_SINCE="${REDWALLET_COLLECTOR_SINCE:-$(date -u -v-"${REDWALLET_PHONE_COLLECTOR_LOOKBACK_MINUTES:-20}"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '20 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)}"
for cf in "${COLLECTOR_FILES[@]}"; do
  [[ -f "$cf" ]] || continue
  chunk="$(grep -v '"remote":"::ffff:127' "$cf" 2>/dev/null | grep -v '"remote":"127' | grep -v '"remoteAddress":"192.168.1.50"' | grep -v 'CoreSimulator' || true)"
  chunk="$(printf '%s\n' "$chunk" | grep -E '"remoteAddress":"(fd[0-9a-f:]+|192\.168\.1\.(165|236))"' || true)"
  if [[ -n "$COLLECTOR_SINCE" && -n "$chunk" ]]; then
    export COLLECTOR_SINCE
    chunk="$(printf '%s\n' "$chunk" | perl -ne 'if (/\"collectorTs\":\"([^\"]+)\"/ && $1 ge $ENV{COLLECTOR_SINCE}) { print }' || true)"
  fi
  if [[ -n "$chunk" ]]; then
    phone_events="${phone_events}${phone_events:+$'\n'}${chunk}"
  fi
done
log "COLLECTOR_SINCE=$COLLECTOR_SINCE files=${#COLLECTOR_FILES[@]}"
if [[ -n "$phone_events" ]]; then
  # Prefer real-device iOS 26.2.x events; ignore simulator 26.3.x noise from shared collector.
  if [[ -n "$phone_events" ]]; then
    filtered="$(printf '%s\n' "$phone_events" | grep '"platformVersion":"26.2' || true)"
    if [[ -n "$filtered" ]]; then
      phone_events="$filtered"
    elif [[ "$LAUNCH_UDID" == "$IPHONE12_UDID" ]]; then
      log "NOTE no iOS 26.2.x collector events; ignoring simulator/LAN-only noise"
      phone_events=""
    fi
  fi
  if [[ -n "$phone_events" ]]; then
    log "SUCCESS phone-origin JS events detected (real device)"
    printf '%s\n' "$phone_events" >"$RUN_DIR/phone-origin-events.ndjson"
    echo "status=phone_origin_events" >"$RUN_DIR/RESULT.txt"
    "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 >"$RUN_DIR/collect.log" 2>&1 || true
    exit 0
  fi
else
  log "NOTE scanned collector files: ${COLLECTOR_FILES[*]:-none}"
fi

CMD_DIR_HINT="$(resolve_command_server_dir)"
if [[ -n "$CMD_DIR_HINT" && -f "$CMD_DIR_HINT/command.json" ]]; then
  log "HINT command.json still on server — phone never fetched /command (USB tunnel fd26:: or Wi-Fi/Tailscale to Mac required)"
fi
log "BLOCKER no phone-origin events yet; check monitor console and ensure app foreground + unlock."
{
  echo "blocker=no_phone_origin_events"
  if ! grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-lan.txt" 2>/dev/null &&
    ! grep -qE '^[1-5][0-9]{2}$' "$RUN_DIR/probes/bitassets-rpc-ts.txt" 2>/dev/null; then
    log "BLOCKER bitassets_rpc_unreachable — start signet: cd drivechain-wallet-dev/local-dev && docker compose -f docker-compose.local-minimal.yml up -d bitassets"
    echo "blocker=bitassets_rpc_unreachable"
  fi
  if [[ -f "$RUN_DIR/phone-origin-syslog-partial.txt" ]] && rg -q 'CoreSimulator' "$RUN_DIR/phone-origin-syslog-partial.txt" 2>/dev/null; then
    log "NOTE syslog hits were Mac simulator noise; phone needs Wi-Fi/Tailscale to Mac (192.168.1.50 or 100.76.117.106) for JS collector proof."
    echo "hint=phone_wifi_or_tailscale_required"
  fi
} >"$RUN_DIR/BLOCKER.txt"
exit 2
