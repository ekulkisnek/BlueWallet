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
