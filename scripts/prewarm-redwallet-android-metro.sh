#!/usr/bin/env bash
# Prewarm Metro Android bundle before proof/Detox — fail fast if packager down.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${REDWALLET_PROBE_RUN_DIR:-${LOG_ROOT%/}/metro-prewarm-android-${STAMP}}"
PORT="${METRO_PORT:-8081}"
TIMEOUT_SEC="${REDWALLET_METRO_PREWARM_SEC:-180}"
BUNDLE_URL="http://127.0.0.1:${PORT}/index.bundle?platform=android&dev=true&minify=false"
STATUS_URL="http://127.0.0.1:${PORT}/status"

mkdir -p "$RUN_DIR/probes"
if [[ -z "${REDWALLET_PROBE_RUN_DIR:-}" ]]; then
  ln -sfn "$RUN_DIR" "${LOG_ROOT%/}/current-metro-prewarm-android"
fi

log() {
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$RUN_DIR/prewarm.log"
}

blocker() {
  local code="$1"
  shift
  log "BLOCKER $code $*"
  {
    echo "blocker=$code"
    echo "metro_port=$PORT"
    echo "bundle_url=$BUNDLE_URL"
    echo
    echo "Human checklist:"
    for line in "$@"; do
      echo "  - $line"
    done
  } >"$RUN_DIR/BLOCKER.txt"
  echo "status=blocked" >"$RUN_DIR/RESULT.txt"
  echo "run_dir=$RUN_DIR"
  exit 2
}

log "START run_dir=$RUN_DIR port=$PORT timeout=${TIMEOUT_SEC}s"

set +e
curl -sS -m 5 "$STATUS_URL" >"$RUN_DIR/probes/metro-status.txt" 2>&1
status_rc=$?
set -e
log "PROBE metro-status exit=$status_rc"

if [[ "$status_rc" -ne 0 ]] || ! grep -q 'packager-status:running' "$RUN_DIR/probes/metro-status.txt" 2>/dev/null; then
  blocker metro_down \
    "Metro not running on :$PORT (curl status failed or not packager-status:running)" \
    "Run: cd '$ROOT_DIR' && npx react-native start --host 0.0.0.0 --port $PORT" \
    "Or: scripts/start-redwallet-real-device-support.sh"
fi

started_at="$SECONDS"
set +e
curl --fail -sS -m "$TIMEOUT_SEC" "$BUNDLE_URL" -o "$RUN_DIR/probes/index.bundle.android"
bundle_rc=$?
set -e
elapsed=$((SECONDS - started_at))
bundle_bytes=0
if [[ -f "$RUN_DIR/probes/index.bundle.android" ]]; then
  bundle_bytes="$(wc -c <"$RUN_DIR/probes/index.bundle.android" | tr -d ' ')"
fi
log "PROBE metro-bundle exit=$bundle_rc bytes=$bundle_bytes elapsed=${elapsed}s"

if [[ "$bundle_rc" -ne 0 || "$bundle_bytes" -lt 1000 ]]; then
  blocker metro_bundle_failed \
    "Android index.bundle prewarm failed after ${elapsed}s (exit=$bundle_rc bytes=$bundle_bytes)" \
    "Confirm Metro :$PORT is healthy; check $RUN_DIR/probes/metro-status.txt" \
    "Cold bundle can take ~120–140s; raise REDWALLET_METRO_PREWARM_SEC if needed"
fi

log "PREWARM_OK elapsed=${elapsed}s bytes=$bundle_bytes"
echo "status=ok" >"$RUN_DIR/RESULT.txt"
echo "elapsed_sec=$elapsed" >>"$RUN_DIR/RESULT.txt"
echo "run_dir=$RUN_DIR"
exit 0
