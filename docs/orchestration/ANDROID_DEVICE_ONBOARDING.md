# Android device onboarding (fleet)

Physical Pixel proof runs on a **single Mac lane** with LiPhone in standby. See [FLEET_LANES.md](../FLEET_LANES.md) before any chain.

## Prerequisites

1. USB device authorized: `adb -s <serial> get-state` → `device`
2. Mac LAN services: BitAssets RPC `:6004`, collector `:6123`, Android command server `:6124`
3. LiPhone: force-quit RedWallet (do not poll `:6124` during Android work)
4. Metro + prewarm: `scripts/preflight-redwallet-android-chain.sh`

## Entrypoints

| Script | Purpose |
|--------|---------|
| `preflight-redwallet-android-chain.sh` | Fail-fast gates before chain |
| `retry-android-origin-bitassets-proof.sh` | Seed `command.json`, `adb run-as` push, monitor |
| `redwallet-android-phone-chain-reserve-register.sh` | Full reserve → register → transfer chain |
| `redwallet-android-guarded-transfer-only.sh` | Transfer-only after prior register (canonical post-PASS path) |
| `redwallet-android-chain-preflight.sh` | Preflight once; sets `REDWALLET_ANDROID_CHAIN_PREFLIGHT_DONE` |
| `redwallet-fleet-status.sh` | Read-only RPC height, lock, latest `CHAIN_OK` |

## Environment (transfer-only)

| Variable | Default | Meaning |
|----------|---------|---------|
| `REDWALLET_BITASSETS_WALLET_ID` | _(required for guarded transfer)_ | BitAssets wallet that performed register (must be loaded on device) |
| `REDWALLET_ANDROID_REQUIRE_WALLET_ID` | `0` (`1` in guarded script) | Exit before chain if wallet ID unset |
| `REDWALLET_ANDROID_EXPECT_BITASSETS_WALLET_COUNT` | `1` | Fail if collector `smoke_done` walletCount differs |
| `REDWALLET_ANDROID_MONITOR_NO_RESTART` | `0` | `1` = push command without force-stop (app stays foreground) |
| `REDWALLET_ANDROID_SKIP_LAUNCH` | `1` in chain | `0` = relaunch app for monitor window |
| `REDWALLET_CHAIN_TRANSFER_ONLY` | `0` | `1` = skip create/reserve/register; transfer only |
| `REDWALLET_BITASSETS_TRANSFER_ASSET_ID` | docker lookup | On-chain asset id (hex), not register txid |

Example guarded transfer (no full chain):

```bash
export ANDROID_SERIAL=0A201JECB03306
export REDWALLET_CHAIN_ASSET=RWFLEET20260527-130941
export REDWALLET_BITASSETS_WALLET_ID=1608e006e3fc6953f45ee7361a28ae9790c34124e4ef64f3d5d6438240d5bf1e
export REDWALLET_BITASSETS_TRANSFER_ASSET_ID=031f96aec2507050d099980354ae66434da0dda949297dedef49750c23a07b99
scripts/redwallet-android-guarded-transfer-only.sh
```

## Wallet-mismatch recovery

See [ANDROID_WALLET_RESTORE.md](./ANDROID_WALLET_RESTORE.md) for the focused restore checklist.

Transfer-only fails fast when the **registering wallet is not on device** or the **BitAssets wallet count is wrong** (see `CHAIN_GATE_FAIL` in chain log).

### Symptoms

- `CHAIN_GATE_FAIL registering wallet_id=… not loaded on device`
- `CHAIN_GATE_FAIL bitassets_wallet_count=1 expected=1` with wrong `walletID` in collector `availableWalletIDs`
- `real_device_bitassets_selftest_wallet_missing` / `not enough native wallet BitAsset funds` in logcat
- `from_block_hash … is not known` after bitassets container restart (stale QUIC snapshot)

### Recovery steps

1. **Identify the registering wallet** from the original register run (collector `real_device_bitassets_selftest_ok` with `operation":"register"` or QA notes). Note `walletID` and backup/mnemonic if available.
2. **Remove stray BitAssets wallets** on device if more than one exists (Settings → delete extra BitAssets wallet) so `walletCount` matches `REDWALLET_ANDROID_EXPECT_BITASSETS_WALLET_COUNT` (usually `1`).
3. **Re-import or restore** the registering wallet (`1608e006…` in the 20260527-130941 fleet run). Confirm collector shows `real_device_bitassets_smoke_wallet` with that `walletID`.
4. **Stabilize RPC** — `scripts/ensure-bitassets-rpc-responsive.sh` until `getblockcount` returns JSON `result` on Mac LAN (`192.168.1.50:6004`).
5. **Wait for QUIC sync** — open BitAssets wallet in app until tip/balance visible; avoid bitassets docker restart mid-sync.
6. **Re-run transfer-only** with explicit wallet ID and no cold restart:

```bash
export REDWALLET_ANDROID_REQUIRE_WALLET_ID=1
export REDWALLET_BITASSETS_WALLET_ID=<registering-wallet-id>
export REDWALLET_ANDROID_MONITOR_NO_RESTART=1
export REDWALLET_CHAIN_TRANSFER_ONLY=1
export REDWALLET_BITASSETS_TRANSFER_ASSET_ID=<on-chain-asset-hex>
scripts/redwallet-android-phone-chain-reserve-register.sh "$ANDROID_SERIAL"
```

Or use `redwallet-android-guarded-transfer-only.sh` (sets `REQUIRE_WALLET_ID=1` and `MONITOR_NO_RESTART=1` by default).

### Verification

- Chain log: `CHAIN_GATE_OK transfer_wallet_id=…`
- Collector: `real_device_bitassets_selftest_ok` with `"operation":"transfer"` and txid
- No `CHAIN_GATE_FAIL` before transfer push

See also [ANDROID_PRODUCTION_QA_REPORT.md](../ANDROID_PRODUCTION_QA_REPORT.md) for a failed transfer-only example.
