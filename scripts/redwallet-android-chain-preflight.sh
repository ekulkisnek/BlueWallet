#!/usr/bin/env bash
# Canonical Android chain preflight: run gates once, source env for downstream scripts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
ENV_FILE="${LOG_ROOT%/}/current-preflight-android.env"

export ANDROID_SERIAL="${ANDROID_SERIAL:-${REDWALLET_ANDROID_SERIAL:-0A201JECB03306}}"
export REDWALLET_ANDROID_SERIAL="$ANDROID_SERIAL"

preflight_rc=0
set +e
bash "$ROOT_DIR/scripts/preflight-redwallet-android-chain.sh"
preflight_rc=$?
set -e

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

export REDWALLET_ANDROID_CHAIN_PREFLIGHT_DONE=1
exit "$preflight_rc"
