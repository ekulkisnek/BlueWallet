#!/usr/bin/env bash
# Android physical device: seed command, push via adb run-as, launch, short monitor.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT%/}/android-origin-retry-${STAMP}"
MONITOR_SECONDS="${REDWALLET_ANDROID_MONITOR_SECONDS:-90}"
SKIP_LAUNCH="${REDWALLET_ANDROID_SKIP_LAUNCH:-0}"
ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
ANDROID_PACKAGE="${REDWALLET_ANDROID_PACKAGE:-com.layertwolabs.bluewallet}"
MAC_RPC="${REDWALLET_BITASSETS_RPC_MAC:-http://192.168.1.50:6004}"

mkdir -p "$RUN_DIR/probes"
ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-android-origin-retry"
export ANDROID_SERIAL REDWALLET_BITASSETS_RPC_MAC="$MAC_RPC" BITASSETS_RPC_URL="$MAC_RPC"

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

probe_bitassets_rpc_light() {
  local url="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
  local r
  r="$(curl -sS -m 8 -X POST "${url%/}/" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "$r"
  [[ "$r" == *result* ]]
}

resolve_command_server_dir() {
  local cmd_dir="${REDWALLET_BITASSETS_COMMAND_DIR:-}"
  if [[ -z "$cmd_dir" ]]; then
    cmd_dir="$(ls -td "$LOG_ROOT"/android-real-device-*/command-server "$LOG_ROOT"/redwallet-bitassets-command-server-*/ 2>/dev/null | head -1 || true)"
  fi
  if [[ -z "$cmd_dir" || ! -d "$cmd_dir" ]]; then
    cmd_dir="$RUN_DIR/command-server"
    mkdir -p "$cmd_dir"
  fi
  printf '%s' "$cmd_dir"
}

seed_bitassets_command() {
  local cmd_dir rpc host_only quic op asset_name
  cmd_dir="$(resolve_command_server_dir)"
  rpc="${REDWALLET_BITASSETS_RPC_MAC:-${BITASSETS_RPC_URL:-http://192.168.1.50:6004}}"
  host_only="${rpc#http://}"
  host_only="${host_only#https://}"
  host_only="${host_only%%/*}"
  quic="${host_only%%:*}:6104"
  op="${REDWALLET_BITASSETS_COMMAND_OPERATION:-createWallet}"
  asset_name="${REDWALLET_BITASSETS_ASSET_NAME:-RWF${STAMP}}"
  case "$op" in
    reserve)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"reserve","commandId":"android-reserve-${STAMP}","name":"${asset_name}","feeSats":0,"rpcUrl":"${rpc}","bitassetsLiteWalletQuicUrl":"${quic}"}
EOF
      ;;
    register)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"register","commandId":"android-register-${STAMP}","name":"${asset_name}","initialSupply":1000,"feeSats":0,"rpcUrl":"${rpc}","bitassetsLiteWalletQuicUrl":"${quic}"}
EOF
      ;;
    transfer)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"transfer","commandId":"android-transfer-${STAMP}","assetId":"${REDWALLET_BITASSETS_TRANSFER_ASSET_ID:-}","destinationAddress":"${REDWALLET_BITASSETS_TRANSFER_DEST:-}","amount":${REDWALLET_BITASSETS_TRANSFER_AMOUNT:-1},"feeSats":0,"rpcUrl":"${rpc}","bitassetsLiteWalletQuicUrl":"${quic}"}
EOF
      ;;
    *)
      cat >"$cmd_dir/command.json" <<EOF
{"operation":"createWallet","commandId":"android-proof-${STAMP}","label":"Android BitAssets","rpcUrl":"${rpc}","bitassetsLiteWalletQuicUrl":"${quic}","skipSync":true}
EOF
      ;;
  esac
  log "SEEDED command.json operation=$op rpc=$rpc dir=$cmd_dir"
}

android_push_app_file() {
  local local_file="$1"
  local dest_name="$2"
  if adb -s "$ANDROID_SERIAL" shell "run-as $ANDROID_PACKAGE tee files/${dest_name}" <"$local_file" >>"$RUN_DIR/push-app-file.log" 2>&1; then
    log "PUSHED $dest_name via run-as tee"
    return 0
  fi
  log "WARN push $dest_name failed (see push-app-file.log)"
  return 1
}

log "START run_dir=$RUN_DIR serial=$ANDROID_SERIAL"

if ! probe adb-device adb -s "$ANDROID_SERIAL" get-state; then
  log "BLOCKER android_not_ready"
  echo "blocker=android_not_ready" >"$RUN_DIR/BLOCKER.txt"
  exit 2
fi

ENV_FILE="$(ls -t "$LOG_ROOT"/signet-endpoints-*/redwallet-signet.env 2>/dev/null | head -1 || true)"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  probe signet-endpoints perl -e 'alarm 90; exec @ARGV' bash -c "cd '$ROOT_DIR' && scripts/redwallet-signet-endpoints.sh" || true
else
  log "SKIP signet-endpoints (reuse $ENV_FILE)"
fi
if [[ "${REDWALLET_SKIP_BITASSETS_RESTART:-0}" == 1 ]]; then
  if ! probe ensure-bitassets-rpc probe_bitassets_rpc_light; then
    echo "blocker=bitassets_rpc_down" >"$RUN_DIR/BLOCKER.txt"
    exit 2
  fi
elif ! probe ensure-bitassets-rpc perl -e 'alarm 90; exec @ARGV' bash "$ROOT_DIR/scripts/ensure-bitassets-rpc-responsive.sh"; then
  echo "blocker=bitassets_rpc_down" >"$RUN_DIR/BLOCKER.txt"
  exit 2
fi
probe metro-status curl -sS -m 5 http://127.0.0.1:8081/status
probe collector-health curl -sS -m 5 http://192.168.1.50:6123/health
probe command-health curl -sS -m 5 http://192.168.1.50:6124/health

CMD_DIR="$(resolve_command_server_dir)"
export REDWALLET_BITASSETS_COMMAND_DIR="$CMD_DIR"
seed_bitassets_command || true
cp "$CMD_DIR/command.json" "$RUN_DIR/probes/command-body.txt" 2>/dev/null || true
export REDWALLET_KEEP_COMMAND_SERVER=1
android_push_app_file "$CMD_DIR/command.json" "redwallet-bitassets-selftest-command.json" || true

if [[ "$SKIP_LAUNCH" == "1" ]]; then
  log "SKIP_LAUNCH=1"
  echo "status=preflight_only" >"$RUN_DIR/RESULT.txt"
  exit 0
fi

adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
monitor_rc=0
set +e
"$ROOT_DIR/scripts/monitor-redwallet-android-real-device.sh" "$ANDROID_PACKAGE" "$MONITOR_SECONDS" "$ANDROID_SERIAL"
monitor_rc=$?
set -e
log "MONITOR_EXIT=$monitor_rc"

MONITOR_DIR="$(readlink "${LOG_ROOT%/}/current-android-real-device-app-monitor" 2>/dev/null || true)"
if [[ -n "$MONITOR_DIR" ]]; then
  cp -R "$MONITOR_DIR" "$RUN_DIR/monitor-copy" 2>/dev/null || true
fi

EVENTS_FILE="${LOG_ROOT%/}/current-js-event-collector/events.ndjson"
if [[ -f "$EVENTS_FILE" ]]; then
  rg '"platform":"android"' "$EVENTS_FILE" | rg 'real_device_bitassets' | tail -50 >"$RUN_DIR/collector-android-events.txt" 2>/dev/null || true
fi

if rg -q '"platform":"android".*real_device_bitassets_(selftest_ok|wallet_created|smoke_ok)' \
  "$RUN_DIR/monitor-copy/redwallet-events.txt" 2>/dev/null; then
  echo "status=ok" >"$RUN_DIR/RESULT.txt"
  log "RESULT ok (logcat android proof)"
  exit 0
fi
if [[ -s "$RUN_DIR/collector-android-events.txt" ]] &&
  rg -q 'real_device_bitassets_(selftest_ok|wallet_created|smoke_ok)' "$RUN_DIR/collector-android-events.txt" 2>/dev/null; then
  echo "status=ok" >"$RUN_DIR/RESULT.txt"
  log "RESULT ok (collector android proof)"
  exit 0
fi

echo "status=inconclusive" >"$RUN_DIR/RESULT.txt"
log "RESULT inconclusive — check monitor-copy and collector-android-events.txt"
exit 2
