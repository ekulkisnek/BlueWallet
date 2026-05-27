#!/usr/bin/env bash
# Load signet-miner on mainchain before BMM/L1 mining (avoids createwallet "already exists" race).
set -euo pipefail

LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"

dc() {
  docker compose -f "$COMPOSE_FILE" exec -T mainchain \
    drivechain-cli -signet -rpccookiefile=/data/signet/.cookie "$@"
}

if dc listwallets | jq -e '.[] | select(. == "signet-miner")' >/dev/null 2>&1; then
  echo "signet-miner already loaded"
  exit 0
fi

if dc loadwallet signet-miner >/dev/null 2>&1; then
  echo "signet-miner loaded"
  exit 0
fi

if dc createwallet signet-miner >/dev/null 2>&1; then
  echo "signet-miner created"
  exit 0
fi

dc loadwallet signet-miner >/dev/null
echo "signet-miner loaded after create race"
