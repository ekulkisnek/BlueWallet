#!/usr/bin/env bash
# Mac-side Core Device USB tunnel address (phone ::1, Mac ::2 on same /64).
set -euo pipefail

UDID="${REDWALLET_FORCE_LAUNCH_UDID:-${1:-}}"
if [[ -n "$UDID" ]]; then
  tip="$(xcrun devicectl device info details --device "$UDID" 2>/dev/null | awk -F': ' '/tunnelIPAddress:/ { gsub(/^[[:space:]]+/, "", $2); print $2; exit }' || true)"
  if [[ -n "$tip" && "$tip" == *::1 ]]; then
    printf '%s\n' "${tip%::1}::2"
    exit 0
  fi
  # Forced UDID: never fall back to first connected Mac tunnel (wrong phone).
  exit 1
fi

# No UDID: prefer non-Tailscale Core Device ULAs (fd26/fdc6/fda1/…); never fd7a::/48 (Tailscale).
ifconfig 2>/dev/null | awk '/inet6 fd[0-9a-f:]+/ { print $2 }' | rg -v '^fd7a:' | rg '^fd[0-9a-f:]+::[0-9a-f]+$' | head -1
