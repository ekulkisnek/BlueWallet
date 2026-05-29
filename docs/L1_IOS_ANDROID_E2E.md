# L1 iOS simulator ↔ Android phone E2E

Native signet L1 BTC sends between RedWallet on the **iOS simulator** and **physical Android** (bidirectional).

## Prerequisites

- Colima/Docker: `local-dev/docker-compose.local-minimal.yml` mainchain up
- Electrum reachable at `127.0.0.1:60101` (Floresta in mainchain stack; phones also use `adb reverse tcp:60101`)
- Mac LAN IP auto-detected via `en0`/`en1` (currently **`192.168.1.236`**) — set `REDWALLET_PHONE_LAN_HOST` to override
- Physical Android on USB with Metro via `adb reverse` (debug APK)
- `adb` device: default serial `0A201JECB03306`

## iOS simulator → Android phone

```bash
chmod +x scripts/run-l1-ios-simulator-to-android-phone-e2e.sh scripts/l1-e2e-preflight.sh scripts/*.sh
./scripts/run-l1-ios-simulator-to-android-phone-e2e.sh
```

Logs: `/Volumes/T705/redwallet-logs/l1-ios-android-e2e-<stamp>/`

| Script | Role |
|--------|------|
| `ensure-android-btc-command-server.sh` | BTC command server on `:6125` |
| `seed-android-btc-receive-wallet.sh` | `createWallet` on Android → `ANDROID_L1_RECEIVE_ADDRESS` |
| `fund-l1-signet-address.sh` | `sendtoaddress` + mine L1 blocks |
| `l1-e2e-preflight.sh` | Fail-fast docker/mainchain/electrum/adb gates |
| `tests/e2e/l1_ios_simulator_to_android.spec.js` | Detox send flow |
| `run-l1-ios-simulator-to-android-phone-e2e.sh` | Orchestrator |

Set `ANDROID_L1_RECEIVE_ADDRESS` and `REDWALLET_SKIP_ANDROID_SEED=1` to skip Android wallet creation.

Detox only:

```bash
export ANDROID_L1_RECEIVE_ADDRESS=bc1q...
npx detox test -c ios.debug tests/e2e/l1_ios_simulator_to_android.spec.js --reuse
```

## Android phone → iOS simulator

```bash
./scripts/run-l1-android-phone-to-ios-simulator-e2e.sh
```

Logs: `/Volumes/T705/redwallet-logs/l1-android-ios-e2e-<stamp>/`

| Script | Role |
|--------|------|
| `tests/e2e/l1_ios_simulator_seed_receive.spec.js` | iOS seed: create wallet, log receive address |
| `tests/e2e/l1_android_phone_to_ios_simulator.spec.js` | Android Detox send flow |
| `run-l1-android-phone-to-ios-simulator-e2e.sh` | Orchestrator |

Set `IOS_L1_RECEIVE_ADDRESS` and `REDWALLET_SKIP_IOS_SEED=1` to skip iOS seed.

Detox only (after seed):

```bash
export IOS_L1_RECEIVE_ADDRESS=bc1q...
npx detox test -c android.debug.device tests/e2e/l1_android_phone_to_ios_simulator.spec.js --reuse
```

## Coordination

Do **not** run both orchestrators concurrently — they share Metro, simulator, and Android device. Check `current-l1-ios-android-e2e` / `current-l1-android-ios-e2e` symlinks under `/Volumes/T705/redwallet-logs/` before starting.

## Env

See headers of the orchestrator scripts. Common overrides: `REDWALLET_PHONE_LAN_HOST`, `L1_E2E_SEND_SATS`, `L1_E2E_FUND_SATS`, `DETOX_LOGLEVEL`.
