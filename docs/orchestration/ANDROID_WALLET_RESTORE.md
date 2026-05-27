# Android BitAssets wallet restore (fleet)

Use after `CHAIN_GATE_FAIL` on transfer-only, or when the registering wallet is missing on device.

**Canonical transfer entrypoint (post-register PASS):** `scripts/redwallet-android-guarded-transfer-only.sh`

## Quick checklist

1. Note `walletID` from the original register run (collector `real_device_bitassets_selftest_ok` with `"operation":"register"`).
2. Remove extra BitAssets wallets on device until count matches `REDWALLET_ANDROID_EXPECT_BITASSETS_WALLET_COUNT` (usually `1`).
3. Re-import / restore the registering wallet; confirm `real_device_bitassets_smoke_wallet` with that `walletID`.
4. `scripts/ensure-bitassets-rpc-responsive.sh` — Mac LAN `192.168.1.50:6004` must return JSON `result`.
5. Open BitAssets in app until tip/balance visible (avoid bitassets docker restart mid-sync).
6. Re-run guarded transfer:

```bash
export ANDROID_SERIAL=0A201JECB03306
export REDWALLET_BITASSETS_WALLET_ID=<registering-wallet-id>
export REDWALLET_BITASSETS_TRANSFER_ASSET_ID=<on-chain-asset-hex>
scripts/redwallet-android-guarded-transfer-only.sh
```

## Verification

- Chain log: `CHAIN_GATE_OK transfer_wallet_id=…`
- Collector: `real_device_bitassets_selftest_ok` with `"operation":"transfer"`

Full fleet context: [ANDROID_DEVICE_ONBOARDING.md](./ANDROID_DEVICE_ONBOARDING.md).
