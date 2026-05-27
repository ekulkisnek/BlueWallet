#!/usr/bin/env bash
# Fail fast when docker compose cannot reach Colima (headless agents often omit DOCKER_HOST).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=redwallet-colima-docker-env.sh
source "$ROOT_DIR/scripts/redwallet-colima-docker-env.sh"

if docker info >/dev/null 2>&1; then
  exit 0
fi

echo "redwallet-assert-colima-docker: docker info failed (set DOCKER_HOST to Colima sock or run: colima start)" >&2
exit 1
