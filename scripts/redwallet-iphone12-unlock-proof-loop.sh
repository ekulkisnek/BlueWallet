#!/usr/bin/env bash
# Poll iPhone 12 for unlock/launch or manual RedWallet open until BitAssets selftest_ok (physical phone).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
UDID="${REDWALLET_IPHONE12_UDID:-00008101-000128643E28001E}"
BUNDLE_ID="${REDWALLET_IOS_BUNDLE_ID:-com.lukekensik.redwallet.dev}"
EVENTS="${REDWALLET_COLLECTOR_EVENTS:-$LOG_ROOT/ios-real-device-selftest-20260526-174300/js-event-collector/events.ndjson}"
SLEEP_SEC="${REDWALLET_UNLOCK_POLL_SEC:-10}"
LOG="$LOG_ROOT/proof-iphone12-unlock-$(date +%Y%m%d-%H%M%S).log"

exec > >(tee -a "$LOG") 2>&1
echo "LOOP_START $(date -Iseconds) udid=$UDID events=$EVENTS"

iphone12_selftest_ok_line() {
  [[ -f "$EVENTS" ]] || return 1
  rg 'real_device_bitassets_selftest_ok' "$EVENTS" 2>/dev/null | rg '26\.2\.1|26\.5|::ffff:192\.168\.1\.165' | tail -1 || true
}

run_collect() {
  "$ROOT_DIR/scripts/collect-redwallet-device-logs.sh" "$LOG_ROOT" 30 || true
}

# Do not call ensure-bitassets-rpc-responsive here — it restarts bitassets and races phone submit.
probe_bitassets_rpc_ok() {
  local url="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
  local r
  r="$(curl -sS -m 4 -X POST "${url%/}/" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' 2>&1 || true)"
  echo "rpc_probe url=$url $r"
  [[ "$r" == *'"result"'* ]]
}

push_reserve_command() {
  cd "$ROOT_DIR"
  export BITASSETS_RPC_URL="${BITASSETS_RPC_URL:-http://192.168.1.50:6004}"
  perl -e 'alarm 120; exec @ARGV' env \
    REDWALLET_FORCE_LAUNCH_UDID="$UDID" \
    REDWALLET_FORCE_PHONE_HOST="${REDWALLET_FORCE_PHONE_HOST:-192.168.1.50}" \
    REDWALLET_BITASSETS_COMMAND_OPERATION=reserve \
    REDWALLET_IPHONE12_UDID="$UDID" \
    REDWALLET_PHONE_SKIP_LAUNCH=1 \
    BITASSETS_RPC_URL="$BITASSETS_RPC_URL" \
    bash scripts/retry-phone-origin-bitassets-proof.sh >>"$LOG_ROOT/push-reserve-latest.log" 2>&1 || true
}

device_has_redwallet_process() {
  local procs
  procs="$(perl -e 'alarm 12; exec @ARGV' xcrun devicectl device info processes --device "$UDID" 2>/dev/null || true)"
  echo "$procs" | rg -qi 'redwallet|lukekensik\.redwallet'
}

device_passcode_required() {
  local lock_out="$1"
  echo "$lock_out" | rg -q 'passcodeRequired: true'
}

phone_retry_or_monitor_in_flight() {
  # Match only real script processes (not agent shells whose argv mentions the script name).
  pgrep -f '/redwallet/scripts/retry-phone-origin-bitassets-proof\\.sh|/redwallet/scripts/monitor-redwallet-ios-real-devices\\.sh' >/dev/null 2>&1
}

recent_phone_collector_activity() {
  [[ -f "$EVENTS" ]] || return 1
  rg '::ffff:192\.168\.1\.165' "$EVENTS" 2>/dev/null | tail -1 | rg -q 'selftest_begin|selftest_ok|app_state_change.*active'
}

launch_with_retries() {
  local out="$1"
  local rc attempt
  for attempt in 1 2 3; do
    set +e
    perl -e 'alarm 18; exec @ARGV' xcrun devicectl device process launch \
      --terminate-existing --device "$UDID" "$BUNDLE_ID" >"$out" 2>&1
    rc=$?
    echo "launch_try inner=$attempt rc=$rc $(head -1 "$out" 2>/dev/null || true)"
    if [[ "$rc" -eq 0 ]] && ! grep -qiE 'Locked|device was not.*unlocked|CoreDeviceError error 4000' "$out"; then
      return 0
    fi
    if grep -qiE 'CoreDeviceError error (4000|1011)' "$out"; then
      echo "launch_tunnel inner=$attempt waiting for CoreDevice (4000/1011)"
      sleep 3
      continue
    fi
    if grep -qiE 'Locked|device was not.*unlocked' "$out"; then
      return 1
    fi
    return "$rc"
  done
  return "$rc"
}

attempt=0
while true; do
  set +e
  attempt=$((attempt + 1))
  if hit="$(iphone12_selftest_ok_line)" && [[ -n "$hit" ]]; then
    echo "PROOF_OK attempt=$attempt $hit"
    run_collect
    exit 0
  fi

  if phone_retry_or_monitor_in_flight; then
    echo "DEFER attempt=$attempt phone retry/monitor in flight — avoid CoreDevice contention"
    sleep "$SLEEP_SEC"
    continue
  fi

  lock_out="$(perl -e 'alarm 12; exec @ARGV' xcrun devicectl device info lockState --device "$UDID" 2>&1 || true)"
  echo "lockState attempt=$attempt $(echo "$lock_out" | rg 'passcodeRequired|unlockedSinceBoot' | tr '\n' ' ')"

  echo "step attempt=$attempt after_lockState"
  locked=false
  if device_passcode_required "$lock_out"; then
    locked=true
  fi

  if device_has_redwallet_process; then
    echo "APP_RUNNING attempt=$attempt — ensure RPC + push reserve command"
    probe_bitassets_rpc_ok || true
    push_reserve_command
    if recent_phone_collector_activity; then
      echo "RECENT_PHONE_EVENTS attempt=$attempt — run full retry (app may be foreground)"
      export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
      export REDWALLET_PHONE_MONITOR_SECONDS="${REDWALLET_PHONE_MONITOR_SECONDS:-120}"
      export REDWALLET_FORCE_PHONE_HOST=192.168.1.50
      cd "$ROOT_DIR"
      set +e
      scripts/retry-phone-origin-bitassets-proof.sh
      retry_rc=$?
      set -e
      if hit="$(iphone12_selftest_ok_line)" && [[ -n "$hit" ]]; then
        echo "PROOF_OK after_app_running_retry $hit"
        run_collect
        exit 0
      fi
      echo "RETRY_AFTER_APP_RUNNING=$retry_rc"
    fi
  else
    echo "PUSH_ONLY attempt=$attempt locked=$locked"
    probe_bitassets_rpc_ok || true
    push_reserve_command
  fi

  if [[ "$locked" == true ]]; then
    echo "SKIP_LAUNCH attempt=$attempt passcodeRequired=true"
    sleep "$SLEEP_SEC"
    continue
  fi

  echo "step attempt=$attempt before_launch"
  launch_out="$(mktemp)"
  launch_with_retries "$launch_out"
  launch_rc=$?
  echo "step attempt=$attempt after_launch rc=$launch_rc"
  if [[ "$launch_rc" -eq 0 ]] && ! grep -qiE 'Locked|device was not.*unlocked' "$launch_out"; then
    echo "LAUNCH_OK attempt=$attempt $(date -Iseconds)"
    cat "$launch_out"
    rm -f "$launch_out"
    probe_bitassets_rpc_ok || true
    export REDWALLET_BITASSETS_COMMAND_OPERATION=reserve
    export REDWALLET_PHONE_MONITOR_SECONDS=120
    export REDWALLET_FORCE_PHONE_HOST=192.168.1.50
    cd "$ROOT_DIR"
    set +e
    scripts/retry-phone-origin-bitassets-proof.sh
    retry_rc=$?
    set -e
    run_collect
    if hit="$(iphone12_selftest_ok_line)" && [[ -n "$hit" ]]; then
      echo "PROOF_OK after_retry $hit"
      exit 0
    fi
    echo "RETRY_EXIT=$retry_rc (no selftest_ok yet; unlock and open RedWallet manually)"
    exit "$retry_rc"
  fi
  echo "launch_blocked attempt=$attempt rc=$launch_rc $(head -1 "$launch_out" 2>/dev/null || true)"
  if [[ "$locked" != true ]] && grep -qiE 'Locked|device was not.*unlocked' "$launch_out" 2>/dev/null; then
    echo "SCREEN_LOCKED attempt=$attempt passcodeRequired=false but SpringBoard denied launch — wake display and open RedWallet"
  fi
  grep -i Locked "$launch_out" 2>/dev/null | head -1 || true
  rm -f "$launch_out"
  set -e
  sleep "$SLEEP_SEC"
done
