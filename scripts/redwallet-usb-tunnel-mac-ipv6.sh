#!/usr/bin/env bash
# Mac-side Core Device USB tunnel address (phone uses ::1 on same /64).
set -euo pipefail
ifconfig 2>/dev/null | awk '/inet6 fd[0-9a-f:]+/ { print $2 }' | rg '^fd[0-9a-f:]+::[0-9a-f]+$' | head -1
