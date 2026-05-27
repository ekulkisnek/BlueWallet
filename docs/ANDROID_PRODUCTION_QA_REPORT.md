# Android Production QA Report

**Date:** 2026-05-27  
**Device:** Pixel 4a 5G `0A201JECB03306` (USB, Wi‑Fi `192.168.1.132`)  
**LiPhone:** standby (unplugged)  
**Asset:** `RWFLEET20260527-130941`  
**Asset id:** `031f96aec2507050d099980354ae66434da0dda949297dedef49750c23a07b99`  
**Register txid:** `7103eccf39637e5ebbfae2f0d5edf054bf26c2b87ce18f2d2ec3a2be2d0de689`  
**Transfer txid:** _none_  
**Overall:** **FAIL** (transfer not confirmed on-chain)

## Summary

Preflight, command server, Metro prewarm, and LAN collector/command paths passed on `0A201JECB03306`. Register for `RWFLEET20260527-130941` succeeded earlier on wallet `1608e006…` (`BFvhC26h…`). Transfer-only retries failed: the registering wallet is no longer present on device (only `30c1101a…` / `2PwPDUrn…` remains), and sync reported `from_block_hash … not known` before `not enough native wallet BitAsset funds`.

## Checklist

1. [x] `ANDROID_SERIAL=0A201JECB03306` — adb device confirmed  
2. [x] `ensure-android-bitassets-command-server.sh` — `:6124` health ok on `192.168.1.50`  
3. [x] Preflight + Metro prewarm — `preflight-android-20260527-135344` PASS  
4. [x] Force-stop / relaunch / sync wait — smoke ok observed; sync tip often null after bitassets restarts  
5. [ ] **Transfer-only** — FAIL (see blockers)  
6. [x] `resolve_chain_asset_id` — uses `REDWALLET_BITASSETS_TRANSFER_ASSET_ID` / docker list  
7. [x] LAN endpoints — Android uses `192.168.1.50:6123/6124`, not USB `fd13::`  
8. [x] 180s logcat — latest no-restart monitor: `blocking_error_lines=1` (JSON parse on empty command; no fd13 selftest noise)  
9. [x] FIX commits on branch (see below)

## Blockers

| Issue | Detail |
|-------|--------|
| Wrong wallet | Register wallet `1608e006e3fc6953f45ee7361a28ae9790c34124e4ef64f3d5d6438240d5bf1e` holds asset; device now has 1 BitAssets wallet `30c1101a…` without balance |
| Stale sync | `from_block_hash … is not known` after bitassets container restarts; native snapshot resync added in `0358b1bbe` |
| Monitor timing | Cold Metro load ~3 min; 180s monitor that force-stops app often captures boot, not transfer |
| RPC flaps | `:6004` JSON-RPC hung/empty several times; recovered via `ensure-bitassets-rpc-responsive.sh` |

## Evidence paths

- Preflight: `/Volumes/T705/redwallet-logs/preflight-android-20260527-135344`  
- Chain log: `/Volumes/T705/redwallet-logs/android-phone-chain-0A201JECB03306-20260527-135901.log`  
- Transfer retry: `/Volumes/T705/redwallet-logs/android-origin-retry-20260527-141407`  
- Monitor (no restart): `/Volumes/T705/redwallet-logs/android-real-device-app-monitor-20260527-145809`  
- Collector: `/Volumes/T705/redwallet-logs/current-js-event-collector/events.ndjson`

## Commits (FIX)

| Commit | Message |
|--------|---------|
| `1e154fe4c` | FIX: Android physical devices use Mac LAN for command/collector |
| `5e8c2cc2c` | FIX: resolve Android chain transfer asset id via plain_bitassets_app_cli |
| `0358b1bbe` | FIX: Android transfer asset id, LAN command order, snapshot resync |

## Next step to PASS transfer

Restore or re-import BitAssets wallet `1608e006…` (registering key), wait for QUIC sync to chain tip with RPC stable, then re-run transfer-only with `REDWALLET_BITASSETS_WALLET_ID=1608e006…` and `REDWALLET_ANDROID_SKIP_LAUNCH=1` / `REDWALLET_ANDROID_MONITOR_NO_RESTART=1`.
