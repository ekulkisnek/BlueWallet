#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUTPUT_ROOT%/}/signet-endpoints-${STAMP}"
LOCAL_DEV="${LOCAL_DEV:-/Volumes/T705/code/drivechain-wallet-dev/local-dev}"
COMPOSE_FILE="${COMPOSE_FILE:-$LOCAL_DEV/docker-compose.local-minimal.yml}"
BITASSETS_IMAGE="${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof}"
BITASSETS_PLATFORM="${BITASSETS_PLATFORM:-linux/arm64}"

mkdir -p "$OUT_DIR"

host_ipv4s() {
  ifconfig 2>/dev/null | awk '
    $1 == "inet" && $2 !~ /^127\./ && $2 !~ /^169\.254\./ { print $2 }
  ' | sort -u
}

tailscale_ipv4s() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | sort -u || true
  fi
}

docker_ps() {
  if [[ -f "$COMPOSE_FILE" ]] && command -v docker >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" ps > "$OUT_DIR/docker-compose-ps.txt" 2>&1 || true
  fi
}

probe_url() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$url" 2>/dev/null || true)"
  printf '%s=%s http_code=%s\n' "$label" "$url" "${code:-000}"
}

docker_ps

LAN_IPS="$(host_ipv4s | tr '\n' ' ')"
TAILSCALE_IPS="$(tailscale_ipv4s | tr '\n' ' ')"
PRIMARY_LAN_IP="$(host_ipv4s | head -1 || true)"
PRIMARY_TAILSCALE_IP="$(tailscale_ipv4s | head -1 || true)"
PHONE_HOST="${REDWALLET_PHONE_HOST:-${PRIMARY_TAILSCALE_IP:-${PRIMARY_LAN_IP:-127.0.0.1}}}"

cat > "$OUT_DIR/redwallet-signet.env" <<EOF
# Source this from local scripts, or copy the URL into RedWallet's BitAssets RPC field.
# Prefer Tailscale if both Mac and phones are on the same tailnet; otherwise use same Wi-Fi/LAN.
export REDWALLET_PHONE_HOST=$PHONE_HOST
export BITASSETS_RPC_URL=http://$PHONE_HOST:6004
export MAINCHAIN_RPC_URL=http://$PHONE_HOST:38332
export METRO_URL=http://$PHONE_HOST:8081
export REDWALLET_LOG_ROOT=$OUTPUT_ROOT
export LOCAL_DEV=$LOCAL_DEV
export COMPOSE_FILE=$COMPOSE_FILE
export BITASSETS_IMAGE=$BITASSETS_IMAGE
export BITASSETS_PLATFORM=$BITASSETS_PLATFORM
EOF

{
  echo "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "repo=$ROOT_DIR"
  echo "local_dev=$LOCAL_DEV"
  echo "compose_file=$COMPOSE_FILE"
  echo "lan_ipv4s=$LAN_IPS"
  echo "tailscale_ipv4s=$TAILSCALE_IPS"
  echo "chosen_phone_host=$PHONE_HOST"
  echo "bitassets_rpc_url=http://$PHONE_HOST:6004"
  echo "mainchain_rpc_url=http://$PHONE_HOST:38332"
  echo "metro_url=http://$PHONE_HOST:8081"
  echo "bitassets_image=$BITASSETS_IMAGE"
  echo "bitassets_platform=$BITASSETS_PLATFORM"
  echo
  probe_url "bitassets_host_probe" "http://127.0.0.1:6004"
  probe_url "bitassets_phone_probe" "http://$PHONE_HOST:6004"
} | tee "$OUT_DIR/SUMMARY.txt"

echo "env_file=$OUT_DIR/redwallet-signet.env"
echo "summary=$OUT_DIR/SUMMARY.txt"
