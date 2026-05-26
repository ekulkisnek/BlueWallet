# RedWallet phone unlock / reconnect handoff

Headless signet, Floresta smoke, simulator E2E, Android E2E, and RedWallet commits are done. **FLEET_DONE** is blocked only on real-phone proof and BitWindow local-signet GUI integration.

## Current blocker (2026-05-26)

| Device | UDID | CoreDevice state | Blocker |
|--------|------|------------------|---------|
| iPhone 12 mini | `00008101-000128643E28001E` | Often `available (paired)` but launch denied | SpringBoard: device not unlocked |
| LiPhone XS | `00008020-0011204911F3002E` | `unavailable` | USB reconnect / trust |

Latest launch denial evidence:

```text
Unable to launch com.lukekensik.redwallet.dev because the device was not, or could not be, unlocked.
```

Path: `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-182121/devices/00008101-000128643E28001E/redwallet-console-interesting.txt`

`lockState.unlockedSinceBoot: true` does **not** mean the phone is foreground-unlocked.

## Signet endpoints (phones)

Source fresh env:

```sh
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
scripts/redwallet-signet-endpoints.sh
source "$(ls -t /Volumes/T705/redwallet-logs/signet-endpoints-*/redwallet-signet.env | head -1)"
echo "$BITASSETS_RPC_URL"   # e.g. http://100.76.117.106:6004
```

Never use `127.0.0.1` on physical phones.

## Exact next actions (Luke / AutoCode)

### A. iPhone 12 mini (fastest path)

1. USB connected, **unlock screen**, keep RedWallet foreground.
2. In three terminals on the Mac (or tmux panes):

```sh
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
source "$(ls -t /Volumes/T705/redwallet-logs/signet-endpoints-*/redwallet-signet.env | head -1)"
npx react-native start --host 0.0.0.0 --port 8081
```

```sh
node scripts/redwallet-log-collector-server.js
```

```sh
BITASSETS_RPC_URL="$BITASSETS_RPC_URL" node scripts/redwallet-bitassets-command-server.js
```

3. Bounded automated retry (preflight + launch + evidence):

```sh
chmod +x scripts/retry-phone-origin-bitassets-proof.sh
scripts/retry-phone-origin-bitassets-proof.sh
```

4. On success: log bundle at `current-phone-origin-retry` and `current-ios-real-device-app-monitor`. Mark checklist QUIC item with that path.

### B. LiPhone XS (alternate)

1. Reconnect USB until `xcrun devicectl list devices` shows `connected` (not `unavailable`).
2. Run `scripts/install-launch-redwallet-ios-devices.sh` for LiPhone UDID only.
3. Set BitAssets RPC to `$BITASSETS_RPC_URL` in app UI.
4. Reserve → register → transfer; record txids in `STATUS.md`.

### C. Manual launch fallback

If `devicectl` launch keeps failing but the phone is unlocked, tap **RedWallet** on the home screen while Metro + collector + command server are running. Then:

```sh
scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30
```

Inspect `current-js-event-collector/events.ndjson` for non-localhost client IPs.

## BitWindow P1 (not phone work)

Blocked without product change: `orchestratord` has no `local-signet` network; Docker owns `127.0.0.1:38332`. Evidence: `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/`. Composer documents; GUI fix is out of scope for headless Cursor.

## Master checklist

`/Volumes/T705/redwallet-logs/orchestration/PRODUCTION_MASTER_CHECKLIST.md`
