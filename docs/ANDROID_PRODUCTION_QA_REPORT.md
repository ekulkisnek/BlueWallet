# RedWallet Production QA Report (Android Physical)

**Generated:** 2026-05-27T21:15Z  
**Device:** Pixel 4a 5G `0A201JECB03306` (USB `bramble`, Wi‑Fi `192.168.1.132`)  
**Package:** `com.layertwolabs.bluewallet`  
**RPC:** `http://192.168.1.50:6004`

---

## Overall: **PASS**

| Area | Grade | Result |
|------|-------|--------|
| LiPhone STANDBY | **A** | Enforced for Android lane |
| Preflight + prewarm | **A** | **PASS** |
| RPC `192.168.1.50:6004` | **A** | `ensure-bitassets-rpc-responsive.sh` OK |
| Full chain `RWFLEET20260527-155139` | **A** | reserve → register → transfer on wallet `30c1101a…` |
| 180s logcat monitor | **A** | **PASS** — `MONITOR_OK blocking=0` |
| §5 checklist | **A** | All txids on collector |

---

## Chain txids (`RWFLEET20260527-155139`)

| Step | Txid | Evidence |
|------|------|----------|
| reserve | `e9c8159e73b3601829577459cd6eacd1f53119ab555fd70b801a8d2d6d97c2e7` | collector + chain log |
| register | `d98e749a6483db7e7c550f806578dc8755999ac8c1cae49b64437880beb50aa4` | collector + chain log |
| transfer | `a155cab59851205dff4f355bdd263782c3cc45fe800077681e1d67b49466a876` | collector `real_device_bitassets_selftest_ok` @21:07–21:13Z |

**On-chain BitAsset id:** `a49cbbb407d284b652b8a103cc95840d72cc05743b2afdf485f2078456b6ed11` (`plain_bitassets_app_cli bitassets` index 7)

**Wallet:** `30c1101a873f6053e4b47ab9ef32bc059908f9c944803bf0b2c5a49a738bcee7`

---

## §5 Production Master Checklist

Physical Android device: full reserve→register→transfer chain

- [x] Preflight PASS
- [x] LiPhone STANDBY enforced
- [x] Reserve txid on device collector
- [x] Register txid on device collector
- [x] Transfer txid on device collector (`a155cab5…`)
- [x] 180s logcat 0 blocking BitAssets selftest errors
- [x] Transfer uses on-chain asset id `a49cbbb4…`, not register txid

---

## Evidence paths

| Artifact | Path |
|----------|------|
| Chain log | `/Volumes/T705/redwallet-logs/android-phone-chain-0A201JECB03306-20260527-160724.log` |
| Collector | `/Volumes/T705/redwallet-logs/current-js-event-collector/events.ndjson` |
| Transfer retry | `/Volumes/T705/redwallet-logs/android-origin-retry-20260527-160534/` |
| 180s monitor | `/Volumes/T705/redwallet-logs/orchestration/android-monitor-180s-20260527-160744.log` |

---

## Verdict: **PASS**
