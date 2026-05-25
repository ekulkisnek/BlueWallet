#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRO_PORT="${METRO_PORT:-8081}"
METRO_LOG="${METRO_LOG:-${TMPDIR:-/tmp}/redwallet-bitassets-android-metro.log}"

cd "$ROOT_DIR"

metro_started=0
reverse_loop_pid=""

cleanup() {
  if [[ -n "$reverse_loop_pid" ]]; then
    kill "$reverse_loop_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$metro_started" == "1" ]]; then
    kill "$metro_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  ./scripts/build-capture-protection-lib.sh
  npx react-native start --port "$METRO_PORT" >"$METRO_LOG" 2>&1 &
  metro_pid=$!
  metro_started=1
  for _ in {1..60}; do
    if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Metro did not start on port $METRO_PORT. Log: $METRO_LOG" >&2
  exit 1
fi

(
  while true; do
    adb devices | awk 'NR > 1 && $2 == "device" { print $1 }' | while read -r serial; do
      [[ -z "$serial" ]] && continue
      adb -s "$serial" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" >/dev/null 2>&1 || true
    done
    sleep 2
  done
) &
reverse_loop_pid=$!

./scripts/with-android-build-env.sh env BITASSETS_E2E=1 npx detox test -c android.debug tests/e2e/bitassets.spec.js --loglevel info --reuse --no-build
