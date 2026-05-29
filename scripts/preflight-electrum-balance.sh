#!/usr/bin/env bash
# Poll Electrum scripthash balance until sender has send+fees before L1 Detox send step.
#
# Usage:
#   preflight-electrum-balance.sh <address> <min_sats> [timeout_sec]
#
# Env:
#   REDWALLET_ELECTRUM_HOST   default 127.0.0.1
#   REDWALLET_ELECTRUM_PORT   default 60101
#   L1_E2E_FEE_BUFFER_SATS    extra sats above min (default 2000)
set -euo pipefail

ADDRESS="${1:?address required}"
MIN_SATS="${2:?min_sats required}"
TIMEOUT_SEC="${3:-${L1_E2E_BALANCE_PREFLIGHT_TIMEOUT:-120}}"
HOST="${REDWALLET_ELECTRUM_HOST:-127.0.0.1}"
PORT="${REDWALLET_ELECTRUM_PORT:-60101}"
FEE_BUFFER="${L1_E2E_FEE_BUFFER_SATS:-2000}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED=$((MIN_SATS + FEE_BUFFER))

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

get_balance_sats() {
  node - "$ADDRESS" "$HOST" "$PORT" <<'NODE'
const bitcoin = require('bitcoinjs-lib');
const crypto = require('crypto');
const net = require('net');

const [address, host, port] = process.argv.slice(2);
const network = bitcoin.networks.testnet;
const script = bitcoin.address.toOutputScript(address, network);
const hash = crypto.createHash('sha256').update(script).digest();
const scripthash = Buffer.from(hash).reverse().toString('hex');

const payload = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'blockchain.scripthash.get_balance',
  params: [scripthash],
});

const client = net.createConnection({ host, port: Number(port) }, () => {
  client.write(payload + '\n');
});

let buf = '';
client.on('data', chunk => {
  buf += chunk.toString();
  const line = buf.split('\n').find(l => l.trim());
  if (!line) return;
  try {
    const res = JSON.parse(line);
    const result = res.result || {};
    const confirmed = Number(result.confirmed ?? 0) || 0;
    const unconfirmed = Number(result.unconfirmed ?? 0) || 0;
    process.stdout.write(String(confirmed + unconfirmed));
  } catch (e) {
    process.stdout.write('0');
  }
  client.end();
});
client.on('error', () => {
  process.stdout.write('0');
  process.exit(0);
});
client.setTimeout(5000, () => {
  client.destroy();
  process.stdout.write('0');
  process.exit(0);
});
NODE
}

log "electrum_balance_preflight address=$ADDRESS required_sats=$REQUIRED timeout=${TIMEOUT_SEC}s host=${HOST}:${PORT}"

deadline=$((SECONDS + TIMEOUT_SEC))
while [[ "$SECONDS" -lt "$deadline" ]]; do
  bal="$(get_balance_sats 2>/dev/null || echo 0)"
  if [[ "$bal" =~ ^[0-9]+$ ]] && [[ "$bal" -ge "$REQUIRED" ]]; then
    log "electrum_balance_ok balance_sats=$bal required=$REQUIRED"
    exit 0
  fi
  log "electrum_balance_wait balance_sats=${bal:-0} required=$REQUIRED"
  sleep 3
done

log "BLOCKER electrum balance ${bal:-0} < $REQUIRED after ${TIMEOUT_SEC}s"
exit 2
