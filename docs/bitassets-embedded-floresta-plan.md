# Embedded Floresta BitAssets Wallet

## Goal

Package RedWallet with a Floresta-owned BitAssets wallet instead of asking the phone app to talk to an Electrum server. React Native owns the UI. Rust owns seed persistence, script-hash sync, proof verification, transaction construction, and signing.

## Architecture

- `class/wallets/bitassets-wallet.ts` adds a RedWallet wallet type that behaves like a first-class wallet in storage and wallet lists.
- `blue_modules/BitAssetsWallet.ts` is the TypeScript client contract used by screens. It supports the embedded native module and the existing JSON-RPC path for simulator/dev fallback.
- `codegen/NativeBitAssetsWallet.ts` defines the React Native TurboModule surface.
- Android registers `BitAssetsWalletPackage` and calls Rust through JNI exports from `floresta-bitassets-wallet`.
- iOS registers `BitAssetsWalletModule` and calls the same Rust C ABI from Swift.
- `screen/wallets/BitAssetsWallet.tsx` is the dedicated BitAssets wallet operation screen. BitAssets wallet cards route directly to it instead of the generic Bitcoin transaction screen.
- The Rust crate is built from Floresta's `crates/floresta-bitassets-wallet` as `staticlib`/`cdylib`.

## Runtime Flow

1. The user creates a BitAssets wallet from RedWallet's Add Wallet screen on test networks.
2. The user provides a reachable BitAssets RPC URL. RedWallet passes it to the native module through `configure`.
3. The native module validates and stores the RPC URL in platform preferences, then opens or creates a wallet file in the app's private data directory.
4. `getNewAddress` returns a Floresta-owned BitAssets address and RedWallet stores it as the wallet identity.
5. Balance, UTXO, transfer, reserve/register, AMM, and Dutch auction calls go through the same JSON-shaped method surface as Floresta JSON-RPC, but execute inside the embedded Rust library.
6. The embedded wallet syncs against the configured `plain-bitassets` RPC URL and keeps the JSON-RPC client as a development fallback.

## Current Configuration

The native modules read `bitassetsRpcUrl` from platform preferences and intentionally fail closed when it is missing. RedWallet's BitAssets wallet creation flow sets it through the native module before the wallet is opened. On a physical phone this must point at a reachable signet/plain-bitassets endpoint or a bundled/mobile-side relay strategy.

The Rust mobile library currently handles wallet persistence and explicit sync/broadcast calls. A background QUIC subscription loop is still better owned by the Rust mobile crate before a production UI exposes live updates.

Seed material is passed to Rust only at wallet-open time. On Android it is encrypted in app private preferences with Android Keystore. On iOS devices it is stored in Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Unsigned iOS simulator builds cannot always access Keychain entitlements, so simulator-only builds use a private `seed.simulator` sidecar under the app's BitAssets support directory; the persisted Rust wallet state still keeps `seed_hex` empty.

Android receives the native Rust wallet handle as an unsigned 64-bit decimal string and passes the same bit pattern back through JNI as a signed `Long`. This avoids creation failures when the opaque Rust handle is above Java's signed `Long.MAX_VALUE`.

## Simulator Validation

The current local pass used:

```sh
npx jest tests/unit/bitassets-wallet.test.ts --runInBand
npm run lint
xcodebuild -workspace ios/BlueWallet.xcworkspace -scheme BlueWallet -configuration Debug -sdk iphonesimulator -destination 'id=ED79C743-1B0D-4485-8B9C-425230F70BD4' -derivedDataPath /tmp/redwallet-derived-ios-signed BUGSNAG_API_KEY=dummy build
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Volumes/T705/code/android-commandlinetools ANDROID_SDK_ROOT=/Volumes/T705/code/android-commandlinetools ./android/gradlew -p android assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Volumes/T705/code/android-commandlinetools ANDROID_SDK_ROOT=/Volumes/T705/code/android-commandlinetools ./android/gradlew -p android bundleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
```

The iOS simulator smoke created a BitAssets wallet through the embedded native module, opened the dedicated BitAssets wallet screen, and verified the app-private Rust wallet file persisted addresses while keeping `seed_hex` empty. Android emulator validation installed and launched the arm64 debug APK, created a BitAssets wallet with `http://10.0.2.2:6004`, opened the dedicated BitAssets wallet operation screen, and verified the app-private Rust wallet file keeps `seed_hex` empty while the encrypted seed ciphertext stays in Android private preferences.

The iOS Release simulator build should be run active-arch on Apple Silicon because the current Rust XCFramework contains `arm64` simulator artifacts only:

```sh
HERMES_CLI_PATH="$PWD/node_modules/hermes-compiler/hermesc/osx-bin/hermesc" \
xcodebuild -workspace ios/BlueWallet.xcworkspace -scheme BlueWallet -configuration Release -sdk iphonesimulator \
  -destination 'id=ED79C743-1B0D-4485-8B9C-425230F70BD4' \
  -derivedDataPath /tmp/redwallet-derived-ios-release-sim-active \
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES BUGSNAG_API_KEY=<real-key> build
```

After moving the checkout, run `pod install` or pass `HERMES_CLI_PATH` as above if generated CocoaPods xcconfigs still point at the previous repo path. In this local pass, Release simulator compile/link/bundling succeeded with the correct Hermes path, then stopped at Bugsnag source-map upload because `BUGSNAG_API_KEY=dummy` is not accepted by Bugsnag.

Docker-backed live signet mobile sync/broadcast remains blocked on Docker Desktop availability in this local environment. Once Docker is running, use the existing signet stack and point iOS at `http://127.0.0.1:6004`; Android emulator should use `http://10.0.2.2:6004`.

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
- Release packaging still requires normal project signing credentials for iOS archive and Android release/AAB signing.

## Current Closure Status

- **Detox carousel reliability fix**: `components/WalletsCarousel.tsx` now exposes a stable `WalletCard-${label}` test ID and `accessibilityLabel` for each wallet card. `tests/e2e/bitassets.spec.js` now tries that card ID before falling back to the legacy label match or selected-card tap. This targets the iOS post-create failure where the BitAssets card exists but the clipped carousel label is not reliably matchable.

- **Native BitAssets bridge status**: The TS contract, TurboModule boundary, native Rust bridge, wallet screen, typed constructor forms, simulator RPC defaults, and storage fallback are wired in RedWallet. Android basic BitAssets simulator smoke has previously passed against Docker signet. The next verification target is iOS Detox after the stable-card selector, followed by `BITASSETS_E2E_FULL=1` with funded constructor inputs.

- **Safe verification executed in this pass**:
  - `git apply --check --reverse redwallet-ios-detox-carousel-fix.patch` verified the handoff patch is already applied.
  - `npx eslint components/WalletsCarousel.tsx tests/e2e/bitassets.spec.js` passed.
  - `npx jest tests/unit/bitassets-wallet.test.ts --runInBand` passed.

- **Remaining before closure**: run iOS Detox with the stable card selector, run the full funded constructor UI smoke where signet funds/assets are available, and commit/push this carousel/doc cleanup after a GUI E2E pass or after accepting the non-GUI validation boundary.

## Production Readiness: Native Signer Wallet Persistence (Fleet YOLO pass)

**Write/sandbox issues resolved:**
- Removed `setAttributes` for `FileProtectionType.completeUntilFirstUserAuthentication` on the `bitassets/` directory in iOS `BitAssetsWalletModule` (ios/Components/BitAssetsWallet.swift:144). This attr could block or race with Rust FFI `std::fs`/fopen writes to `wallet.json` under app-sandbox, data-protection, or Catalyst conditions. The `wallet.json` holds only public metadata (no seed, because `"persist_seed": false`); seed is exclusively in Keychain/Keystore. Dir creation remains; default FS protection suffices.
- Made RPC URL persistence consistent with app-group sandbox on iOS (now uses `UserDefaults(suiteName: "group.com.layertwolabs.bluewallet")` in both configure + openWallet paths, matching Android's `"group.com.layertwolabs.bluewallet"` SharedPreferences and the rest of RedWallet's widget/shared data). Prevents config loss in sandboxed/Catalyst/production launch contexts.

**Signer lifecycle hardening (no intended orphan seeds):**
- Added full `clear()` purge API end-to-end:
  - TurboModule spec (`codegen/NativeBitAssetsWallet.ts`)
  - iOS protocol + extern + impl (`ios/NativeBitAssetsWalletSpec.h`, `ios/Components/BitAssetsWallet.mm`, `ios/Components/BitAssetsWallet.swift`) — deletes `~/Library/Application Support/bitassets/`, Keychain seed item, simulator sidecar, and group RPC entry; frees handle.
  - Android impl (`android/app/src/main/java/.../BitAssetsWalletModule.kt`) — `deleteRecursively` on noBackupFilesDir/bitassets, removes seed ciphertext + RPC from group pref.
- Wired `BitAssetsWallet.clearNativeSigner()` (class/wallets/bitassets-wallet.ts) that calls native clear.
- Hooked into `BlueApp.deleteWallet()` (class/blue-app.ts) so that deleting the last BitAssets wallet from the list automatically purges its native signer state (fire-and-forget, non-fatal).
- JsonRpc fallback path is no-op (embedded-only feature).

This closes the code-level native signer persistence lifecycle for this milestone: create via UI, persist in sandbox secure stores, survive restarts, and purge native wallet files/seed material when the final BitAssets wallet is removed. It is verified by TypeScript, focused lint, BitAssets unit coverage, Android Kotlin compile, and iOS release simulator build. Funded constructor Detox remains the final UI/system evidence before calling the mobile wallet production-ready.

**Commands verified in this pass:** `npx tsc --noEmit --pretty false`, focused `npx eslint ...`, `npx jest tests/unit/bitassets-wallet.test.ts --runInBand`, and iOS release simulator `xcodebuild`. Android `./gradlew :app:compileDebugKotlin` remains blocked on this host until a Java runtime is installed.
