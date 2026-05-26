# BitWindow + Luke's Docker private signet

RedWallet phones use `BITASSETS_RPC_URL` from `scripts/redwallet-signet-endpoints.sh`.
BitWindow uses orchestratord + a **local** bitcoind that must sync the **same** private
signet as Docker without binding port `38332` (Docker/Colima owns that port).

## Root causes (2026-05-26 evidence)

Evidence bundle: `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/`

1. **RPC port conflict:** orchestratord tried to start bitcoind on `127.0.0.1:38332` while
   Docker mainchain already listens there (`Binding RPC ... failed` in `drivechain-signet-debug-tail.log`).
2. **Stale host chain:** `~/Library/Application Support/Drivechain/signet` had a different
   signet at height ~14725 with `Verification error: ReadBlock failed at 14725` — not Luke's
   Docker tip (~481).
3. **ZMQ mismatch:** pointing `bitwindow-bitcoin.conf` at Docker ZMQ `29000-29004` while
   orchestratord manages a **local** bitcoind → `bitcoind does not publish pubrawtx ZMQ`.
4. **BitcoinService timeouts:** bitwindowd calls `localhost:30400/bitcoin.../BitcoinService/*`
   which proxies orchestratord's local bitcoind; when that node is broken, sync stalls.

`local-signet` **is** supported in orchestrator (`local-signet=1` in bitcoin.conf); the failure
was configuration/port/datadir, not "unknown network".

## Fixed launch path (drivechain-wallet-dev)

```sh
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev

# Optional: quarantine corrupt host signet data
./scripts/prepare-bitwindow-local-signet-datadir.sh

# Launch (orchestratord + local bitcoind 38335 + bitwindowd + verify)
BITWINDOW_SKIP_GUI=1 ./scripts/launch-bitwindow-local-signet.sh

# Or stepwise:
./scripts/start-bitwindow-local-bitcoind.sh   # RPC 38335, syncs Docker via addnode :38333

# Preflight only
./scripts/verify-bitwindow-local-signet.sh
```

**Note:** `SwapNetwork` does not start L1 if bitcoind was not already running; the launch
script explicitly starts local `bitcoind` before `bitwindowd`.

v2 `bitcoin.conf` template (`scripts/bitwindow-local-signet-bitcoin.conf.template`):

- Local RPC **38335** (avoids Docker **38332**)
- `addnode=127.0.0.1:38333` (sync private signet from Docker P2P)
- Local ZMQ **29100-29104** (for orchestratord-managed bitcoind)
- `local-signet=1` + Luke's private `signetchallenge`

## Interop with RedWallet

| Service | Endpoint |
|---------|----------|
| Docker BitAssets RPC | `http://100.76.117.106:6004` (phones / RedWallet) |
| Docker mainchain RPC | `127.0.0.1:38332` (container cookie auth) |
| Docker enforcer | `127.0.0.1:50051` |
| BitWindow API | `127.0.0.1:30301` |
| Orchestrator | `127.0.0.1:30400` |

After BitWindow syncs, use the same signet for cross-wallet tests (txids in `STATUS.md`).

## Phone proof (separate blocker)

Phones: `docs/redwallet-phone-unlock-handoff.md` — do not poll CoreDevice while USB unplugged.
