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

## Current Proof Status

Existing evidence proves substantial simulator/emulator/native-signing work, but
does not yet prove a completed real-device round trip between Android, iPhone,
desktop wallet, and Luke's signet. That final proof requires the real phones to
be connected and reachable.
