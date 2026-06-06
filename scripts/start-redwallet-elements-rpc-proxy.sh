#!/bin/sh
set -eu

export LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"
export LISTEN_PORT="${LISTEN_PORT:-18443}"
export TARGET_HOST="${TARGET_HOST:-127.0.0.1}"
export TARGET_PORT="${TARGET_PORT:-18443}"
export WALLET_NAME="${WALLET_NAME:-redwallet-proof}"
export RPC_COOKIE_FILE="${RPC_COOKIE_FILE:-/tmp/liquid-id5-regtest/regtest/.cookie}"

exec /opt/homebrew/bin/node /Volumes/T705/code/work-on-something-to-do-with/redwallet/scripts/redwallet-elements-rpc-proxy.js
