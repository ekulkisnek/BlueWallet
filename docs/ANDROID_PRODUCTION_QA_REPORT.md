# Android Production QA Report

**Date:** 2026-05-27  
**Device:** Pixel 4a 5G `0A201JECB03306` (USB, Wi‑Fi `192.168.1.132`)  
**LiPhone:** standby (unplugged)  
**Asset:** `RWFLEET20260527-142300`  
**Asset id:** `7c4834625bda03918b8d3459602da9f81cd2a4e7ab9c65d97f8624fd9783e338` (from `plain_bitassets_app_cli bitassets` index 3 — not register txid)  
**Register txid:** `77b14ee8bb50dee8a174d954b7452ef862c8acd742e90ce798d347c2b85a4edb`  
**Transfer txid:** `aeb3dce5aef60a0c227d514e4ed75fccfbeeb2089f08d6d7cf1545e69d78d5fa`  
**Overall:** **PASS** (guarded reserve → register → transfer on wallet `30c1101a…`)

## Summary

Colima/Docker was recovered (`DOCKER_HOST=unix:///Users/lukekensik/.colima/default/docker.sock`; avoid broken `DOCKER_CONTEXT=colima`). Bitassets RPC on `http://192.168.1.50:6004` stabilized. Full guarded path for `RWFLEET20260527-142300` on Android wallet `30c1101a873f6053e4b47ab9ef32bc059908f9c944803bf0b2c5a49a738bcee7`: re-reserve, mine, register, resolve asset id via CLI list tail, transfer with `REDWALLET_BITASSETS_TRANSFER_DEST` and `walletID` in command seed. Earlier `RWFLEET20260527-130941` transfer-only attempts failed (wrong wallet / stale `031f96…` asset id / missing dest).

## Checklist

1. [x] `ANDROID_SERIAL=0A201JECB03306` — adb device confirmed  
2. [x] `ensure-android-bitassets-command-server.sh` — `:6124` health ok on `192.168.1.50`  
3. [x] Preflight + Metro prewarm — `preflight-android-20260527-152051` PASS  
4. [x] Force-stop / relaunch / sync wait — register retry until wallet UTXO matched reservation  
5. [x] **Transfer** — PASS (`aeb3dce5…`, collector `real_device_bitassets_selftest_ok`)  
6. [x] `resolve_chain_asset_id` — CLI `bitassets` list last row / index 3; never register txid  
7. [x] LAN endpoints — Android uses `192.168.1.50:6123/6124`, not USB `fd13::`  
8. [x] 180s logcat — `MONITOR_OK blocking=0` on transfer retry `android-real-device-app-monitor-20260527-153542`  
9. [x] FIX commits on branch (see below)

## Evidence paths

- Guarded summary: `/Volumes/T705/redwallet-logs/android-phone-chain-0A201JECB03306-20260527-152051-guarded-summary.log`  
- Transfer retry: `/Volumes/T705/redwallet-logs/android-real-device-app-monitor-20260527-153542`  
- Register OK (collector): `events.ndjson` @ `2026-05-27T20:17:30Z`  
- Transfer OK (collector): `events.ndjson` @ `2026-05-27T20:32:26Z`  
- Preflight: `/Volumes/T705/redwallet-logs/preflight-android-20260527-152051`

## Commits (FIX)

| Commit | Message |
|--------|---------|
| `ef98456b6` | FIX: Android fleet transfer wallet gates and command seeding |
| `7c9a7dc45` | FIX: Android guarded transfer sync retries and wallet ID resolution |
| `09e2e61f6` | FIX: Android production QA report for Pixel transfer-only run |
| `0358b1bbe` | FIX: Android transfer asset id, LAN command order, snapshot resync |
| `5e8c2cc2c` | FIX: resolve Android chain transfer asset id via plain_bitassets_app_cli |
| `1e154fe4c` | FIX: Android physical devices use Mac LAN for command/collector |

## Notes (130941 / 142300 history)

- `RWFLEET20260527-130941`: register `7103eccf…`, asset `031f96…` — transfer blocked without wallet `1608e006…` on device.  
- `RWFLEET20260527-142300`: reserve `cb8aca12…` then register `77b14ee8…`; transfer requires asset id `7c483462…` and `REDWALLET_BITASSETS_TRANSFER_DEST`.
