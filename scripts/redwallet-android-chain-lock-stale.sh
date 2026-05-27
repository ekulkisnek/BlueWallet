#!/usr/bin/env bash
# Detect or clear stale android-phone-chain mkdir locks (crashed worker left lock.d behind).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
SERIAL="${REDWALLET_ANDROID_SERIAL:-${ANDROID_SERIAL:-0A201JECB03306}}"
MAX_AGE_SEC="${REDWALLET_ANDROID_CHAIN_LOCK_MAX_AGE_SEC:-7200}"
MODE="${1:---check}"

lock_dir_for_serial() {
  local serial="$1"
  echo "${LOG_ROOT%/}/android-phone-chain-$(echo "$serial" | tr -cd 'a-zA-Z0-9').lock.d"
}

LOCK_DIR="${REDWALLET_ANDROID_CHAIN_LOCK_DIR:-$(lock_dir_for_serial "$SERIAL")}"

chain_pgrep_pattern() {
  printf 'redwallet-android-phone-chain-reserve-register|%s' "$(echo "$SERIAL" | tr -cd 'a-zA-Z0-9')"
}

lock_age_sec() {
  local now mtime
  now="$(date +%s)"
  mtime="$(stat -f '%m' "$LOCK_DIR" 2>/dev/null || stat -c '%Y' "$LOCK_DIR" 2>/dev/null || echo 0)"
  echo $((now - mtime))
}

is_stale() {
  [[ ! -d "$LOCK_DIR" ]] && return 2
  if pgrep -f "$(chain_pgrep_pattern)" >/dev/null 2>&1; then
    return 1
  fi
  local age
  age="$(lock_age_sec)"
  if (( age >= MAX_AGE_SEC )); then
    return 0
  fi
  # No live chain process but lock is young — treat as active (race with starting worker).
  return 1
}

case "$MODE" in
  --check)
    if is_stale; then
      echo "STALE lock=$LOCK_DIR age_sec=$(lock_age_sec) max_age_sec=$MAX_AGE_SEC serial=$SERIAL"
      exit 0
    fi
    rc=$?
    if [[ "$rc" == 2 ]]; then
      echo "NO_LOCK serial=$SERIAL"
      exit 2
    fi
    echo "ACTIVE lock=$LOCK_DIR age_sec=$(lock_age_sec) serial=$SERIAL"
    exit 1
    ;;
  --clear-if-stale)
    if is_stale; then
      rmdir "$LOCK_DIR" 2>/dev/null && echo "CLEARED stale lock=$LOCK_DIR" && exit 0
      echo "FAIL could not rmdir lock=$LOCK_DIR" >&2
      exit 3
    fi
    rc=$?
    if [[ "$rc" == 2 ]]; then
      exit 0
    fi
    echo "SKIP lock active lock=$LOCK_DIR"
    exit 0
    ;;
  -h | --help)
    cat <<'EOF'
Usage: redwallet-android-chain-lock-stale.sh [--check|--clear-if-stale]

Env:
  REDWALLET_ANDROID_CHAIN_LOCK_DIR   override lock path
  REDWALLET_ANDROID_CHAIN_LOCK_MAX_AGE_SEC  default 7200
  ANDROID_SERIAL / REDWALLET_ANDROID_SERIAL

Exit: 0 stale (or cleared), 1 active lock, 2 no lock (--check only)
EOF
    exit 0
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
