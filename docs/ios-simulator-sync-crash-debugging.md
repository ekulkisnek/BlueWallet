# iOS Simulator Sync Crash Debugging

Use this workflow when the BitAssets `Sync wallet` path appears to terminate the iOS simulator app. It collects enough evidence to distinguish a real app crash from a Detox runner failure, a relaunch, or a UI synchronization timeout.

## Focused Repro

Start Metro with the same flags used by the BitAssets proof flow:

```bash
BITASSETS_E2E=1 npx react-native start --reset-cache --port 8081
```

Run only the sync smoke test against the signet-backed BitAssets RPC:

```bash
BITASSETS_E2E=1 \
BITASSETS_E2E_REQUIRE_RPC=1 \
BITASSETS_RPC_URL=http://127.0.0.1:6004 \
npx detox test -c ios.debug.nosync tests/e2e/bitassets.spec.js \
  --loglevel verbose \
  --reuse \
  --no-build \
  -t "creates a native wallet, syncs"
```

For live native logs during reproduction:

```bash
xcrun simctl spawn <SIM_UDID> log stream --level debug --style compact --predicate 'process == "BlueWallet"'
xcrun simctl spawn <SIM_UDID> log stream --level debug --style compact --predicate 'eventMessage CONTAINS[c] "crash" OR eventMessage CONTAINS[c] "exception" OR messageType == 16 OR messageType == 17'
```

After the run, collect the evidence bundle:

```bash
scripts/collect-ios-simulator-crash-logs.sh <SIM_UDID> /Volumes/T705/redwallet-logs 15
```

The bundle contains:

- `bluewallet.log`: native app logs, including `[BitAssetsWallet] sync begin` and `sync ok/error`.
- `simulator-errors.log`: recent simulator error/fault messages.
- `DiagnosticReports/simulator/`: simulator `.ips` and `.crash` files.
- `DiagnosticReports/host/`: host `BlueWallet` crash reports when macOS writes them outside the simulator data directory.
- `screenshot.png`: current simulator screen.
- `SUMMARY.txt`: exact paths and diagnostic report counts.

## Interpreting Results

A real sync crash should have at least one of:

- non-zero `diagnostic_report_count` in `SUMMARY.txt`;
- BlueWallet process termination in the Detox log that is not followed by a successful relaunch and test pass;
- native `fatal`, `panic`, or crash text around `[BitAssetsWallet] sync begin`;
- a missing `[BitAssetsWallet] sync ok` or safe `[BitAssetsWallet] sync error` after sync starts.

A Detox runner or harness issue may show:

- Detox status schema errors;
- `found nothing to terminate` while relaunching;
- synchronization timeout or busy-resource output;
- `DETOX_EXIT:0` and a passing sync test.

## Current Evidence

Focused run:

- Simulator: `iPhone 17`, UDID `1040BAF7-9A21-4824-A188-8935E8F20B3D`.
- Detox log: `/Volumes/T705/redwallet-logs/ios-sync-crash-repro-20260524-200545/detox.log`.
- Evidence bundle: `/Volumes/T705/redwallet-logs/ios-sync-crash-repro-20260524-200545/ios-crash-20260524-200706`.
- Result: `DETOX_EXIT:0`, `1 passed`, `0 failed`, `diagnostic_report_count=0`.
- Native sequence: `[BitAssetsWallet] sync begin`, `[BitAssetsWallet] sync ok`, `walletInfo ok`, and `listUtxos ok`.

That run did not reproduce an iOS simulator app crash on the normal `Sync wallet` path. The observed failure class in that run was Detox harness noise before relaunch, not a native sync termination.

## Production Guard

The Rust mobile FFI boundary in `floresta-bitassets-wallet` catches Rust panics and converts them to normal FFI error results. This prevents a native panic inside sync or wallet operations from unwinding across the C ABI into Swift/JNI and aborting the app process. RedWallet then surfaces the returned error through the existing BitAssets user-facing error path.

Regression command:

```bash
cd /Volumes/T705/code/drivechain-wallet-dev/floresta-bitassets
cargo test -p floresta-bitassets-wallet ffi_result_converts_panic_to_error_result
```
