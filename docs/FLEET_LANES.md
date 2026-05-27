# Fleet lanes (real-device BitAssets)

One Mac hosts a **single** BitAssets command HTTP server on port **6124** (`/command` is one-shot: the first GET consumes `command.json`). Android and LiPhone must not share the same on-disk command dir or poll concurrently.

## Lanes

| Lane | Command dir | Server bind |
|------|-------------|-------------|
| **Android** | `$REDWALLET_LOG_ROOT/android-bitassets-command-server` (symlink: `current-android-bitassets-command-server`) | `ensure-android-bitassets-command-server.sh` clears payload and restarts `:6124` before each seed |
| **LiPhone / iPhone 12** | `$REDWALLET_IOS_SELFTEST_DIR/command-server` (via `ensure-redwallet-ios-device-servers.sh`) | `::` + USB tunnel; iOS scripts clear/reseed around devicectl push |

## LIPHONE_STANDBY (required during Android chain)

While **Android** chain or `retry-android-origin-bitassets-proof.sh` runs:

1. **Force-quit RedWallet** on LiPhone XS (and iPhone 12 if connected) so the app does not poll `http://192.168.1.50:6124/command` or USB `::6124/command`.
2. Prefer **USB unplug** for LiPhone during Android work, or keep only the Android device on the fleet USB bus.
3. Do **not** run `preflight-redwallet-liphone-chain.sh`, `retry-phone-origin-bitassets-proof.sh`, or `ensure-redwallet-ios-device-servers.sh` in parallel — they restart `:6124` against the iOS command dir and can race Android.

Scripts set `REDWALLET_LIPHONE_STANDBY=1` on Android chain start as a reminder; operators enforce it on device.

After Android chain completes, restart iOS command path before LiPhone proof:

```bash
BITASSETS_RPC_URL='http://192.168.1.50:6004' scripts/ensure-redwallet-ios-device-servers.sh
```

## Android chain entrypoints

- `scripts/preflight-redwallet-android-chain.sh` — calls `ensure-android-bitassets-command-server.sh` before command health
- `scripts/retry-android-origin-bitassets-proof.sh` — dedicated dir only; ensure + seed per step
- `scripts/redwallet-android-phone-chain-reserve-register.sh` — documents `LIPHONE_STANDBY` in log

## iOS chain entrypoints

- `scripts/preflight-redwallet-liphone-chain.sh` / `scripts/preflight-redwallet-iphone12-chain.sh`
- `scripts/retry-phone-origin-bitassets-proof.sh` — never GET `/command` during preflight; USB push then optional LAN reseed
