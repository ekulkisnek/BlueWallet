# RedWallet Two-iPhone Signet Readiness

This is the pre-phone checklist for running RedWallet against Luke's local signet
on two real iPhones. Missing physical phones are not a blocker for this prep.

## Prepared Commands

Discover phone-reachable endpoints:

```sh
scripts/redwallet-signet-endpoints.sh
```

Create a Codex-friendly evidence bundle:

```sh
scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30
```

Run the full pre-device readiness sweep:

```sh
scripts/prepare-redwallet-real-device-run.sh
```

Attempt a legitimate local device build/install preparation:

```sh
scripts/run-redwallet-ios-device-install.sh 00008020-0011204911F3002E
```

Build and install a standalone app on both physical iPhones, with
`main.jsbundle` embedded so the phones do not need Metro to launch:

```sh
REDWALLET_IOS_TEAM_ID=<team id> \
REDWALLET_IOS_BUNDLE_ID=<optional local bundle id> \
scripts/build-install-redwallet-ios-standalone.sh \
  00008020-0011204911F3002E \
  00008101-000128643E28001E
```

If a development team is available locally, use:

```sh
REDWALLET_IOS_TEAM_ID=<team id> \
REDWALLET_IOS_BUNDLE_ID=<optional local bundle id> \
scripts/run-redwallet-ios-device-install.sh 00008020-0011204911F3002E
```

## Network Plan

Prefer Tailscale when both iPhones can join the tailnet. Otherwise use the same
Wi-Fi/LAN as the Mac. The app should use the generated `BITASSETS_RPC_URL`, not
`127.0.0.1`, on physical phones.

The endpoint discovery script writes:

- `BITASSETS_RPC_URL=http://<mac-or-tailscale-ip>:6004`
- `MAINCHAIN_RPC_URL=http://<mac-or-tailscale-ip>:38332`
- `METRO_URL=http://<mac-or-tailscale-ip>:8081`

## iPhone Install Plan

LiPhone on Luke's Apple account can normally be installed directly from Xcode if
the device is trusted and the signing team is available locally.

The second iPhone on another Apple account should use one of the legitimate
paths below:

- Xcode install with that device added to the selected development team.
- TestFlight/internal distribution if account/team membership makes direct
  signing inconvenient.
- A normal development provisioning profile that includes that device UDID.

Do not change code signing secrets in the repo. Use local Xcode signing settings
or Apple developer portal provisioning as needed.

The repository currently has manual iPhone signing settings pointing at the
profile `match AppStore com.layertwolabs.bluewallet`. A local dev install cannot
complete until the Mac has a valid Apple signing identity and a matching
provisioning profile, or until `REDWALLET_IOS_TEAM_ID` points at a team that can
create/use a development profile for the selected device.

## Standalone iPhone App

If a physical iPhone shows a Metro or "loading JavaScript" screen, it has an old
development install or an app without `main.jsbundle`. Delete that app from the
phone and reinstall with:

```sh
REDWALLET_IOS_TEAM_ID=<team id> \
scripts/build-install-redwallet-ios-standalone.sh \
  00008020-0011204911F3002E \
  00008101-000128643E28001E
```

That script builds the iphoneos target, embeds a production JS bundle into the
app, re-signs it, installs it, and launches it. It removes the Metro dependency
for app startup. For Luke's local signet, the phones still need network access to
the Mac-hosted chain/RPC services unless those services are moved to public or
phone-local infrastructure.

## Evidence Rules

After every meaningful action, collect a bundle:

```sh
scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30
```

Codex should be able to inspect:

- connected iOS devices from `xctrace` and `devicectl`;
- Android devices from `adb`;
- simulator BlueWallet logs, screenshots, and crash reports;
- signet Docker logs for mainchain, enforcer, and bitassets;
- repo status and latest commits;
- host network/Tailscale state.

## Phone unlock handoff

When CoreDevice reports `unavailable` or SpringBoard denies launch because the
device is locked, follow:

`docs/redwallet-phone-unlock-handoff.md`

Bounded retry script (preflight + launch + evidence):

```sh
scripts/retry-phone-origin-bitassets-proof.sh
```

Preflight only (no launch):

```sh
REDWALLET_PHONE_SKIP_LAUNCH=1 scripts/retry-phone-origin-bitassets-proof.sh
```

## Current Proof Status

Headless signet, Floresta smoke, iOS simulator E2E, and Android emulator E2E are
complete (commits `9c069a8ba`, `dc72b431f`). Real-phone BitAssets/QUIC origin
proof and BitWindow `local-signet` GUI sync remain open; see the handoff doc and
`/Volumes/T705/redwallet-logs/orchestration/PRODUCTION_MASTER_CHECKLIST.md`.

## Liquid iOS Simulator Proof

Liquid L-BTC is proved on two iOS simulators through wallet-scoped Elements
JSON-RPC URLs. The native embedded Liquid signer is not the proved send path yet;
use credentialed `/wallet/<name>` RPC URLs for production-style local signet
testing.

Start the local Liquid ID5 Elements regtest stack:

```sh
cd /Volumes/T705/code/liquid-signet-sidechain
./drivechain-liquid-sidechain/scripts/start-liquid-id5-regtest.sh
```

Create two Elements wallets, fund A, and capture the cookie password:

```sh
CLI=/Volumes/T705/code/liquid-signet-sidechain/src/elements-cli
DATADIR=/tmp/liquid-id5-regtest
COOKIE=$DATADIR/regtest/.cookie
COOKIE_PASS=$(cut -d: -f2 "$COOKIE")

$CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" createwallet redwallet-a
$CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" createwallet redwallet-b
A_MINER=$($CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" -rpcwallet=redwallet-a getnewaddress '' bech32)
$CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" generatetoaddress 101 "$A_MINER"
```

Seed the two simulators:

```sh
LIQUID_RPC_URL="http://__cookie__:${COOKIE_PASS}@127.0.0.1:18443/wallet/redwallet-b" \
DETOX_IOS_SIM_UDID=00C53DE2-9FFF-4232-9B7B-2CDBBEE9D6BB \
REDWALLET_IOS_LIQUID_WALLET_LABEL='iOS Liquid B' \
scripts/seed-ios-simulator-liquid-wallet.sh

LIQUID_RPC_URL="http://__cookie__:${COOKIE_PASS}@127.0.0.1:18443/wallet/redwallet-a" \
DETOX_IOS_SIM_UDID=B1F293FB-ED0F-46EB-8F95-07456D2AAA63 \
REDWALLET_IOS_LIQUID_WALLET_LABEL='iOS Liquid A' \
scripts/seed-ios-simulator-liquid-wallet.sh
```

Send from A to B, mine one block, and sync B:

```sh
LIQUID_RPC_URL="http://__cookie__:${COOKIE_PASS}@127.0.0.1:18443/wallet/redwallet-a" \
DETOX_IOS_SIM_UDID=B1F293FB-ED0F-46EB-8F95-07456D2AAA63 \
REDWALLET_IOS_LIQUID_WALLET_ID=<a-wallet-id> \
scripts/send-ios-simulator-liquid-command.sh transfer <b-address> 100000

MINER=$($CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" -rpcwallet=redwallet-a getnewaddress '' bech32)
$CLI -datadir="$DATADIR" -chain=regtest -rpccookiefile="$COOKIE" generatetoaddress 1 "$MINER"

LIQUID_RPC_URL="http://__cookie__:${COOKIE_PASS}@127.0.0.1:18443/wallet/redwallet-b" \
DETOX_IOS_SIM_UDID=00C53DE2-9FFF-4232-9B7B-2CDBBEE9D6BB \
REDWALLET_IOS_LIQUID_WALLET_ID=<b-wallet-id> \
scripts/send-ios-simulator-liquid-command.sh sync
```

Latest proof values:

- A wallet ID: `2fa8461a412f033b68fb6d882ad4bdb999aa1545e3ad7f97a6a2106174f4bf6c`
- B wallet ID: `2f013ef07850cf6c2ebd7adf2d2b7b33c01dd117116cf3c01d76729de47a7372`
- B address: `bcrt1qe4hcel8gtpg9rnt5njtqw2sa9c4mv7djmspus9`
- Transfer txid: `1dd62d0f2be9bc6b795d827957ca30a1c203cfd5ea623b3814fe1feb4e35436f`
- B simulator result: `{"balances":{"bitcoin":100000},"utxoCount":1}`
