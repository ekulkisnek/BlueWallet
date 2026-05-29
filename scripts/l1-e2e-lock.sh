#!/usr/bin/env bash
# Exclusive L1 E2E lock — only one physical/simulator Detox path at a time.
# Lock file: ${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}/.l1-e2e-lock
set -euo pipefail

LOG_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
LOCK_FILE="${REDWALLET_L1_E2E_LOCK:-$LOG_ROOT/.l1-e2e-lock}"

l1_lock_read() {
  [[ -f "$LOCK_FILE" ]] || return 1
  cat "$LOCK_FILE"
}

l1_lock_pid_alive() {
  local pid="${1:-0}"
  [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

l1_kill_duplicates() {
  local keep="${1:-$$}"
  local pid line
  while read -r pid _; do
    [[ "$pid" == "$keep" || "$pid" == "$PPID" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
    echo "killed duplicate l1/detox pid=$pid"
  done < <(pgrep -fl 'run-l1-|detox test' 2>/dev/null | awk '{print $1}' || true)
}

l1_lock_acquire() {
  local run_dir="${1:-unknown}"
  local holder="${2:-l1-e2e}"
  mkdir -p "$(dirname "$LOCK_FILE")"
  if [[ -f "$LOCK_FILE" ]]; then
    local old_pid
    old_pid="$(python3 -c "import json; print(json.load(open('$LOCK_FILE')).get('pid',0))" 2>/dev/null || echo 0)"
    if l1_lock_pid_alive "$old_pid"; then
      echo "L1 lock held by pid=$old_pid run_dir=$(python3 -c "import json; print(json.load(open('$LOCK_FILE')).get('run_dir','?'))" 2>/dev/null)"
      return 1
    fi
    rm -f "$LOCK_FILE"
  fi
  l1_kill_duplicates "$$"
  python3 - <<PY
import json, os, time
payload = {
    "pid": os.getpid(),
    "ppid": os.getppid(),
    "run_dir": "$run_dir",
    "holder": "$holder",
    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
with open("$LOCK_FILE", "w") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
print(f"L1 lock acquired pid={payload['pid']} run_dir=$run_dir")
PY
}

l1_lock_release() {
  if [[ -f "$LOCK_FILE" ]]; then
    rm -f "$LOCK_FILE"
    echo "L1 lock released"
  fi
}

l1_pause_autocode_competitors() {
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  if [[ -d "$HOME/autocode" ]]; then
    python3 -m autocode coord pause-l1-competitors 2>/dev/null || true
  fi
}

case "${1:-}" in
  acquire) l1_lock_acquire "${2:-}" "${3:-l1-e2e}" ;;
  release) l1_lock_release ;;
  status)
    if [[ -f "$LOCK_FILE" ]]; then l1_lock_read; else echo "no lock"; fi
    ;;
  kill-dupes) l1_kill_duplicates "${2:-$$}" ;;
  *) echo "usage: $0 {acquire|release|status|kill-dupes} [run_dir] [holder]" >&2; exit 2 ;;
esac
