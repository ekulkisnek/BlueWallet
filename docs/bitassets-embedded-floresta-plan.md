# Embedded Floresta BitAssets Wallet

## Goal

Package RedWallet with a Floresta-owned BitAssets wallet instead of asking the phone app to talk to an Electrum server. React Native owns the UI. Rust owns seed persistence, script-hash sync, proof verification, transaction construction, and signing.

## Architecture

- `class/wallets/bitassets-wallet.ts` adds a RedWallet wallet type that behaves like a first-class wallet in storage and wallet lists.
- `blue_modules/BitAssetsWallet.ts` is the TypeScript client contract used by screens. It supports the embedded native module and the existing JSON-RPC path for simulator/dev fallback.
- `codegen/NativeBitAssetsWallet.ts` defines the React Native TurboModule surface.
- Android registers `BitAssetsWalletPackage` and calls Rust through JNI exports from `floresta-bitassets-wallet`.
- iOS registers `BitAssetsWalletModule` and calls the same Rust C ABI from Swift.
- The Rust crate is built from Floresta's `crates/floresta-bitassets-wallet` as `staticlib`/`cdylib`.

## Runtime Flow

1. The user creates a BitAssets wallet from RedWallet's Add Wallet screen on test networks.
2. The native module opens or creates a wallet file in the app's private data directory.
3. `getNewAddress` returns a Floresta-owned BitAssets address and RedWallet stores it as the wallet identity.
4. Balance, UTXO, transfer, reserve/register, AMM, and Dutch auction calls go through the same JSON-shaped method surface as Floresta JSON-RPC, but execute inside the embedded Rust library.
5. The embedded wallet syncs against the configured `plain-bitassets` RPC URL and keeps the JSON-RPC client as a development fallback.

## Current Configuration

The native modules read `bitassetsRpcUrl` from platform preferences and intentionally fail closed when it is missing. On a physical phone this must point at a reachable signet/plain-bitassets endpoint or a bundled/mobile-side relay strategy.

The Rust mobile library currently handles wallet persistence and explicit sync/broadcast calls. A background QUIC subscription loop is still better owned by the Rust mobile crate before a production UI exposes live updates.

## Build Assets

Build the Rust library from the Floresta repo:

```sh
cd /path/to/Floresta
./scripts/build-bitassets-wallet-mobile.sh aarch64-apple-ios-sim
```

From RedWallet, the wrapper script copies built mobile artifacts into the app tree:

```sh
FLORESTA_DIR=/path/to/Floresta ./scripts/build-bitassets-mobile-libs.sh aarch64-apple-ios aarch64-apple-ios-sim
```

or through npm:

```sh
FLORESTA_DIR=/path/to/Floresta npm run bitassets:mobile-libs -- aarch64-apple-ios aarch64-apple-ios-sim
```

For Android, install Android Rust targets and configure the NDK linker environment, then pass Android targets such as `aarch64-linux-android`. The script copies `.so` files into `android/app/src/main/jniLibs/<abi>/`.

For iOS device/simulator distribution, the Floresta build script packages the Rust static libraries and `include/floresta_bitassets_wallet.h` as `floresta_bitassets_wallet.xcframework`; the RedWallet wrapper copies it to `ios/Frameworks/`.

Generated mobile libraries are ignored by git. Production CI must run the wrapper script before native app builds.

## Pre-PR Checklist

- Rust mobile crate builds for iOS simulator and Android arm64.
- Android `BitAssetsWalletModule` loads `libfloresta_bitassets_wallet` and can create an address on emulator.
- iOS `BitAssetsWalletModule` links the XCFramework and can create an address on simulator.
- RedWallet typecheck/lint passes.
- A simulator smoke creates a BitAssets wallet, syncs, and displays the persisted address after app restart.
