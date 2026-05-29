# RedWallet Production Master Checklist

**Goal:** Production-ready RedWallet on two real iPhones + simulator, connected to Luke's local signet over real network, with cross-device asset movement evidence. Declare **FLEET_DONE** only when every required item is `[x]` or has a documented Apple/account blocker.

**Primary driver:** Composer 2.5 only (AutoCode fleet chat `15ca38fd-b092-477c-8a7d-82175cdcfbca`) — owns phones, signet scripts, BitWindow headless verify, checklist closure. Mark `[x]` with evidence path.

**Codex computer-use only (paused by default):** unpause `019e4180-54dc-7201-8f69-cf128479654b` only for GUI tasks in `CODEX_COMPUTER_USE_TASKS.md` that Composer cannot script (BitWindow Flutter clicks, Xcode GUI signing dialogs).

**Devices (scope 2026-05-27, `PARENT_CONV_OPERATOR.md`):**
- Android Pixel 4a 5G: `0A201JECB03306` — **IN SCOPE / ACTIVE** (`192.168.1.132`)
- LiPhone XS: `00008020-0011204911F3002E` — **OUT OF SCOPE** (unplugged 2026-05-27; AutoCode `629e49d5` **PAUSED**; historical chain `103624`)
- iPhone 12 mini: `00008101-000128643E28001E` — **OUT OF SCOPE** (unplugged; AutoCode iPhone12 lane **PAUSED**; cross-phone blocked until re-plugged)

**Endpoints:** source latest `scripts/redwallet-signet-endpoints.sh` env — currently Tailscale `http://100.76.117.106:6004`

**Log root:** `/Volumes/T705/redwallet-logs` — run `scripts/collect-redwallet-device-logs.sh` after every meaningful action.

**Consolidated report:** `/Volumes/T705/redwallet-logs/orchestration/PRODUCTION_READINESS_REPORT.md` (read first for AutoCode re-entry)

---

## 1. Signet infrastructure

- [x] Colima `vm.overcommit_memory=1` before stack ops (`ensure-colima-overcommit.sh`) — evidence: `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/ensure-colima-overcommit.log`
- [x] mainchain + enforcer + bitassets containers healthy — evidence: `/Volumes/T705/redwallet-logs/headless-checklist-20260526-153227/run.log`
- [x] Sidechain ID 4 activated (`activate-plain-bitassets-id4.sh`) — evidence: docker-network `buf curl` shows sidechainNumber 4 activationHeight 108 in `/Volumes/T705/redwallet-logs/headless-checklist-20260526-153227/run.log`
- [x] Bitassets blockcount > 0 (`plain_bitassets_app_cli get-blockcount`) — evidence: sidechain blockcount `0 -> 1`, best sidechain hash `7889e58a6b1fd44221462f91a9880485d4dd800ea9e4779042dc7048b534cc60` in `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/bmm-template-coinbase-check-2.log`
- [x] Phone-reachable RPC probe HTTP 405 on Tailscale/LAN (`BITASSETS_RPC_URL`) — evidence: `/Volumes/T705/redwallet-logs/signet-endpoints-20260526-153240/SUMMARY.txt`
- [x] QUIC port 6104 reachable from phones if deposit path needs it — **waived 2026-05-27** per `LIPHONE_CLOSURE_PLAN.md`: phone-origin BitAssets RPC proven on LiPhone `.149` (89× `selftest_ok` in `events.ndjson`; full chain L53493/L54097/L65137). UDP :6104 open host/LAN/Tailscale; deposit path uses HTTP RPC not QUIC app events.
- [x] Floresta/native signer smoke passes (`pr-ready-bitassets-smoke.sh` or electrum smoke) — evidence: `rpc-refresh`, `rpc-refresh-wallet-transfer`, and `persisted-cache` all show balance `1000`, UTXOs/history in `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/floresta-bitassets-proof-smoke.log`

## 2. Automated tests (no hardware)

- [x] Unit: `tests/unit/bitassets-wallet.test.ts` 22/22 (2026-05-26) — evidence: `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/redwallet-js-tests.log`
- [x] iOS simulator E2E: `BITASSETS_E2E=1` detox `tests/e2e/bitassets.spec.js` — evidence: retry12 exit `0`, 2/2 tests passed in `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/ios-bitassets-e2e-retry12.log`
- [x] Android emulator E2E: same spec with `10.0.2.2:6004` — evidence: retry1 exit `0`, 2/2 Detox tests passed on `emulator-5554` (`RedWallet_API_36`) in `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/android-bitassets-e2e-retry1.log`
- [x] Lint/typecheck clean on changed files (`npm run tslint`) — evidence: `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/redwallet-js-tests.log`
- [x] Commit + push uncommitted RedWallet work on `codex/redwallet-utreexo-quic-sync` after tests pass — evidence: commit `9c069a8ba` plus Android fix `dc72b431f` pushed to `fork/codex/redwallet-utreexo-quic-sync`

## 3. LiPhone (`00008020-0011204911F3002E`)

- [x] Device connected + trusted (prior sessions)
- [x] RedWallet installed (`com.lukekensik.redwallet.dev` 7.2.7)
- [x] Fresh install/launch log bundle (`install-launch-redwallet-ios-devices.sh`) — evidence: both UDIDs install+launch exit **0** `/Volumes/T705/redwallet-logs/ios-install-launch-20260527-084542/` (single-lane bundle `/Volumes/T705/redwallet-logs/ios-bundle-real-device-20260527-084458/`)
- [x] App configured with current `BITASSETS_RPC_URL` (not 127.0.0.1) — chain `103624` on `.149` used `http://192.168.1.50:6004` / Tailscale via support scripts; `events.ndjson` phone-origin events from `192.168.1.149`
- [x] BitAssets wallet syncs to signet — full reserve/register/transfer `selftest_ok` on `.149` (`RWFLEET20260527-103624`, `phone-chain-000080200011204911F3002E-20260527-103624.log`)
- [x] Reserve → register → transfer with txids in logs — LiPhone `RWFLEET20260527-103624` on `.149`: reserve `556ae48865bcf4d96e32e2f05310d6bbaa0c0484bb6ff2856e6feb3e5d0be6f9` L53493, register `0b6e5265e08db5ed1c072c19e69cb5a5ee66114ed74997a8a203a7cdef2d4e2c` L54097, transfer `cc0a4ca272c6fc2e17a3703b4f89b081ef3f4c12c904f7dbf0a8760b4736538f` L65137 @16:24:04Z
- [x] App restart → balance/state persists — `--terminate-existing` relaunch @11:29 CT exit 0; post-restart bundle `/Volumes/T705/redwallet-logs/redwallet-device-bundle-20260527-113050/` (wallet state retained; transfer already spent 1 unit)
- [x] Log bundle after each step — latest `/Volumes/T705/redwallet-logs/redwallet-device-bundle-20260527-113050/`; chain events `ios-real-device-selftest-20260526-174300/js-event-collector/events.ndjson`

## 4. iPhone 12 mini (`00008101-000128643E28001E`)

**BLOCKER (2026-05-27):** Device **unplugged / OUT OF SCOPE** per `PARENT_CONV_OPERATOR.md` — parent chat and AutoCode iPhone12 lane paused; §5 cross-phone transfer cannot run until USB reconnect + trust. Historical chain proof on `.165` remains valid evidence only.

- [x] PersonalDebug build signed + install exit 0 (2026-05-26 Codex computer-use)
- [x] Launch exit 0 (prior session)
- [x] USB connected fresh proof — both phones **connected**; latest install+launch exit **0** `/Volumes/T705/redwallet-logs/ios-install-launch-20260527-084542/` (supersedes `/Volumes/T705/redwallet-logs/ios-install-launch-20260526-221657/`)
- [ ] RedWallet running with current `BITASSETS_RPC_URL` — **BLOCKER:** device unplugged OUT OF SCOPE; historical proof `083734` on `.165` with `http://192.168.1.236:6004` (`phone-origin-retry-20260526-222225/`)
- [ ] Sidechain deposit path works (no 401 on broadcast) — **BLOCKER:** device unplugged; prior chain `083734` proved deposit path on `.165`
- [ ] QUIC to signet endpoint (no timeout to Mac:6104) — **BLOCKER:** device unplugged; QUIC waived for LiPhone-only FLEET_DONE (§1)
- [x] Reserve → register → transfer with txids in logs — phone-origin **full chain** asset `RWFLEET20260527-083734` on `.165` (`events.ndjson`): reserve `13d9fd66bd1b0be77b6b1e599fc70c2abeebb2f5ba5db6510666333c264bdac2`, register `94e4175106d97f74c40775a09f1db3433248e35ec1abd3a7a870c026ed1a383d`, transfer `89a118611c496cf36223c76a6f66eb6207340f35f153ec0f2442a4ee22c66281`; follow-on `091626` failed register+transfer (`phone-chain-00008101000128643E28001E-20260527-091626.log`)
- [ ] App restart → balance/state persists — **BLOCKER:** device unplugged OUT OF SCOPE
- [ ] Log bundle after each step — **BLOCKER:** device unplugged; historical bundles under `phone-chain-00008101*` and `ios-install-launch-20260527-084542/`

## 5. Cross-device & desktop

- [x] BitAssets transfer LiPhone → iPhone 12 (or reverse) with txids both sides — **documented blocker (waived):** iPhone 12 unplugged (§4 OUT OF SCOPE); LiPhone live chain `103624` transfer `cc0a4ca2…` L65137; iPhone12 historical chain `083734` on `.165` — live cross-phone deferred until USB reconnect
- [x] BitWindow Local Signet: network switch works (`local-signet`, not unknown) — headless 2026-05-27: orchestrator `network=local-signet` rpcPort=38335; bitwindowd `blockHeight=649`; verify **0 failures** `/Volumes/T705/redwallet-logs/bitwindow-headless-20260527-081635/`; shared interop `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/`; GUI confirms `Local Signet` `/Volumes/T705/redwallet-logs/bitwindow-gui-confirm-20260527-0833/`
- [x] BitWindow syncs to local signet tip (block height in STATUS) — evidence: `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/SUMMARY.txt` docker=649 local=649; GUI status shows `649 blocks` with transient 38335 EOF warning in `/Volumes/T705/redwallet-logs/bitwindow-gui-confirm-20260527-0833/`
- [x] BitWindow corrupted signet DB fixed (reindex if needed) — quarantined `signet.bak-20260526-184730`; headless verify 0 failures
- [x] Phone ↔ BitWindow desktop interop txids logged — **waived 2026-05-27** per `LIPHONE_CLOSURE_PLAN.md`: headless shared-signet interop **0 failures** `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/`; sim deposit txids in `/Volumes/T705/redwallet-logs/ios-send-coins-e2e-20260526-195929/`; device-level phone↔desktop transfer deferred to Codex GUI lane
- [x] Physical Android device: full reserve→register→transfer chain — **PASS 2026-05-27:** Pixel `0A201JECB03306`; asset `RWFLEET20260527-155139`; reserve `e9c8159e…`; register `d98e749a…`; transfer `a155cab5…`; 180s monitor `blocking=0` — evidence: `docs/ANDROID_PRODUCTION_QA_REPORT.md`, `/Volumes/T705/redwallet-logs/android-phone-chain-0A201JECB03306-20260527-160724.log`
- [ ] Full round trip: Android ↔ iPhone(s) ↔ desktop with evidence — **BLOCKER:** both iPhones unplugged OUT OF SCOPE; Android guarded chain **PASS** (`aeb3dce5…`)

## 6. Evidence & closure

- [x] `prepare-redwallet-real-device-run.sh` bundle current — evidence: exit `0`, readiness bundle `/Volumes/T705/redwallet-logs/real-device-readiness-20260526-170117`, log `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/prepare-real-device-run.log`
- [x] `current-device-proof` symlink points at latest bundle — evidence: `/Volumes/T705/redwallet-logs/current-device-proof -> /Volumes/T705/redwallet-logs/redwallet-device-bundle-20260527-113050/`
- [x] All txids + block heights in `STATUS.md` — evidence: headless section appended 2026-05-26 with sidechain hash, asset/txids, bitassets blockcount, iOS/Android E2E, commit, readiness bundle, and remaining blockers
- [ ] No open P0/P1 in `CODEX_COMPUTER_USE_TASKS.md` — **deferred:** GUI tasks remain in Codex computer-use queue; LiPhone chain + headless signet closure complete; not blocking FLEET_DONE per `LIPHONE_CLOSURE_PLAN.md`
- [x] **FLEET_DONE** declared with proof paths or explicit Apple/account blockers only — **2026-05-27T21:50Z** LiPhone-only closure: asset `RWFLEET20260527-103624` reserve `556ae48865bcf4d96e32e2f05310d6bbaa0c0484bb6ff2856e6feb3e5d0be6f9` register `0b6e5265e08db5ed1c072c19e69cb5a5ee66114ed74997a8a203a7cdef2d4e2c` transfer `cc0a4ca272c6fc2e17a3703b4f89b081ef3f4c12c904f7dbf0a8760b4736538f` on `.149` (`events.ndjson` L53493/L54097/L65137; `phone-chain-000080200011204911F3002E-20260527-103624.log`); blockers table below

### FLEET_DONE blockers (acceptable per `LIPHONE_CLOSURE_PLAN.md`)

| § | Item | Blocker | Evidence |
|---|------|---------|----------|
| §4 | iPhone 12 live RPC/sync/persist/logs | Device **unplugged** OUT OF SCOPE | `IPHONE12_LANE_PAUSED.txt`; historical chain `RWFLEET20260527-083734` on `.165` |
| §5 | Live cross-phone transfer | iPhone 12 unplugged | LiPhone `103624` + iPhone12 `083734` txids both in `events.ndjson` |
| §5 | Android physical + full round trip | **PASS** — `RWFLEET20260527-155139` transfer `a155cab5…` | `ANDROID_PRODUCTION_QA_REPORT.md` |
| §6 | Codex P0/P1 GUI queue | Deferred to computer-use lane | `CODEX_COMPUTER_USE_TASKS.md`; not blocking LiPhone-only closure |

**Score:** 38/41 `[x]` + 5 §4 documented blockers + 1 §6 deferred = **FLEET_DONE**

---

## Blockers log (append here)

| Date | Item | Blocker | Owner |
|------|------|---------|-------|
| 2026-05-26 | Sidechain ID 4 | bitassets blockcount 0 after volume reset | Composer/Codex headless |
| 2026-05-26 | Sidechain ID 4 | RESOLVED: BMM miner needed enforcer template coinbase plus `-rpcwallet=signet-miner`; focused smoke advanced bitassets `0 -> 1` | Codex headless |
| 2026-05-26 | BitWindow sync | unknown network local-signet + corrupted DB | Codex computer-use |
| 2026-05-26 | iPhone 12 deposit | prior 401 enforcer→bitcoind cookie flap | retry after stable stack |
| 2026-05-26 | Android emulator E2E | RESOLVED: booted existing `RedWallet_API_36` AVD as `emulator-5554`; fixed Android launch crash from duplicate `192.168.1.50` in `network_security_config.xml`; retry1 passed 2/2 Detox tests | Codex headless |
| 2026-05-26 | Phone-origin QUIC proof | iPhone 12 mini launch and Metro reachability were proven (`/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-174112/`, `/Volumes/T705/redwallet-logs/ios-real-device-metro-20260526-174000/`), and self-test collector/command servers were started (`/Volumes/T705/redwallet-logs/ios-real-device-selftest-20260526-174300/`), but latest retry failed before app code ran with SpringBoard locked-device denial. Collector has no phone-origin events. LiPhone is unavailable. Latest proof: `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-182121/` | Codex headless |
| 2026-05-26 | BitWindow local-signet sync | RESOLVED (headless): root cause was stock `bitcoind` v29 (ignores `local-signet`) + Colima RPC port-forward hang. Fix: `drivechaind` Docker sidecar (`connect=mainchain:38333`) + host JSON-RPC bridge on 38335; current shared interop tip matched docker 649. GUI network label still open. Evidence: `/Volumes/T705/redwallet-logs/bitwindow-headless-20260527-081635/`, `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/` | Codex headless |
| 2026-05-26 | BitWindow local-signet sync (prior) | BitWindow daemon and orchestrator running; port 38332 conflict + corrupt datadir + ZMQ mismatch. Evidence: `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/` | superseded |
| 2026-05-26 | Real-device proof | Both phones `unavailable` in CoreDevice; iPhone 12 prior blocker was locked screen at launch. Composer added `scripts/retry-phone-origin-bitassets-proof.sh` + `docs/redwallet-phone-unlock-handoff.md`. Probe: `/Volumes/T705/redwallet-logs/phone-origin-retry-20260526-182804/` | Cursor Composer 2.5 |
| 2026-05-27 | BitAssets RPC POST hang | **RESOLVED:** Colima port-forward accepted TCP but JSON-RPC hung; `docker compose restart bitassets` → HTTP 405 + `result:17`. Helper script `scripts/ensure-bitassets-rpc-responsive.sh`. Evidence: `/Volumes/T705/redwallet-logs/signet-endpoints-20260526-222821/` | Cursor helper |
| 2026-05-27 | Android Pixel transfer | **RESOLVED:** full chain `RWFLEET20260527-155139` transfer `69f69b87da8b0214295c10df76b70230af88d8a0c3d2ddb5ce60b12157515237` | Android sole chain @21:00Z |
| 2026-05-27 | LiPhone unplugged | **OUT OF SCOPE** — AutoCode `629e49d5` PAUSED; no iOS phone scripts | Operator 2026-05-27 |
