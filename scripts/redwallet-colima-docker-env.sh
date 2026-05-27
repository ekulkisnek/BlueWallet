#!/usr/bin/env bash
# Source from RedWallet scripts when docker compose must talk to Colima (not default.sock).
# Colima sets DOCKER_HOST in interactive shells; headless agents often omit it.
_redwallet_apply_colima_docker_env() {
  local sock="${HOME}/.colima/default/docker.sock"
  if [[ -z "${DOCKER_HOST:-}" && -S "$sock" ]] && command -v docker >/dev/null 2>&1; then
    unset DOCKER_CONTEXT
    export DOCKER_HOST="unix://${sock}"
    if docker info >/dev/null 2>&1; then
      return 0
    fi
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if command -v docker >/dev/null 2>&1 && docker context inspect colima >/dev/null 2>&1; then
    unset DOCKER_HOST
    export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima}"
    if docker info >/dev/null 2>&1; then
      return 0
    fi
  fi
  if [[ -S "$sock" ]] && command -v docker >/dev/null 2>&1; then
    unset DOCKER_CONTEXT
    export DOCKER_HOST="unix://${sock}"
    docker info >/dev/null 2>&1
  fi
}
_redwallet_apply_colima_docker_env
unset -f _redwallet_apply_colima_docker_env

# Return 0 when colima stop/restart would disrupt an in-flight device chain or proof.
redwallet_colima_stop_blocked() {
  if pgrep -f 'redwallet-android-phone-chain-reserve-register|retry-android-origin-bitassets-proof|monitor-redwallet-android-real-device|redwallet-fix-lima-6004-forward|redwallet-colima-bitassets-recover' >/dev/null 2>&1; then
    return 0
  fi
  local log_root="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
  local lock
  for lock in "$log_root"/android-phone-chain-*.lock.d; do
    [[ -d "$lock" ]] || continue
    return 0
  done
  return 1
}
