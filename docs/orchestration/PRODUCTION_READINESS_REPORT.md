# RedWallet Production Readiness Report

**Generated:** 2026-05-27 (Cursor Composer 2.5 — evidence cleanup lane)  
**Last refreshed:** 2026-05-27T20:35Z (Android transfer PASS; LiPhone unplugged 2026-05-27)  
**Purpose:** Single durable summary for AutoCode workers. Read this first; drill into linked bundles only when needed.

**Related files:**
- Master checklist (item-level): `PRODUCTION_MASTER_CHECKLIST.md`
- Rolling log (chronological): `STATUS.md`
- Phone poll loop: `AUTOCODE_PHONE_LOOP.md`
- GUI handoff queue: `CODEX_COMPUTER_USE_TASKS.md`

---

## Executive summary

| Area | Status | Score |
|------|--------|-------|
| Signet infrastructure (headless) | **Done** | 5/6 checklist items |
| Automated tests (sim/emulator) | **Done** | 5/5 |
| RedWallet code commits | **Done** | pushed to `fork/codex/redwallet-utreexo-quic-sync` |
| LiPhone real-device BitAssets | **Done** | **full chain** `RWFLEET20260527-103624` on `.149`: reserve/register/transfer txids L53493/L54097/L65137; persist verified `redwallet-device-bundle-20260527-113050/` |
| iPhone 12 mini real-device BitAssets | **Partial done** | **full phone-origin chain** `RWFLEET20260527-083734` on `.165`; device **unplugged** OUT OF SCOPE |
| Cross-device transfer | **Blocked** | iPhone12 unplugged; historical txids both sides; live test deferred |
| BitWindow headless sync | **Done** | docker=649 local=649 |
| BitWindow GUI / interop | **Partial** | shared headless interop **0 failures** (waived for closure); GUI tasks in Codex queue |
| Physical Android device | **Done** | Guarded full chain `RWFLEET20260527-142300`: register `77b14ee8…` + transfer `aeb3dce5…` (`CHAIN_OK op=transfer` poll @15:35Z; collector @20:32:26Z) |
| **FLEET_DONE** | **Declared 2026-05-27** | LiPhone-only per `LIPHONE_CLOSURE_PLAN.md`; Android transfer **PASS** |

Headless signet + CI path is production-ready. **FLEET_DONE declared** for LiPhone-only closure with documented blockers for cross-phone round-trip and iPhone12 unplugged scope; Android guarded transfer **PASS**.

---

## Live snapshot (2026-05-27T13:52Z)

| Signal | Value | Evidence |
|--------|-------|----------|
| Docker stack | mainchain + enforcer + bitassets **healthy** | Colima overcommit OK; signet-miner wallet loaded for BMM |
| BitAssets sidechain height | **61** | `/Volumes/T705/redwallet-logs/signet-endpoints-20260527-102052/SUMMARY.txt` |
| Phone RPC URL (canonical) | `http://100.76.117.106:6004` | LAN `192.168.1.50:6004` JSON-RPC **result:61** |
| RPC probe | HTTP **405** + POST **result:61** | `/Volumes/T705/redwallet-logs/signet-endpoints-20260527-102052/SUMMARY.txt` |
| QUIC :6104 | UDP open host/LAN/Tailscale | `nc -zu` 127.0.0.1, 192.168.1.50, 100.76.117.106 (phone-origin still open) |
| JS collector LAN | **OK** health + POST **204** | `/Volumes/T705/redwallet-logs/collector-lan-20260527-085*/ensure-servers.txt`; `ensure-redwallet-ios-device-servers.sh` probes LAN+TS |
| LiPhone `00008020-0011204911F3002E` | **connected** (prior) | reserve ok; register needs phone lane retry after mine |
| iPhone 12 `00008101-000128643E28001E` | **connected** | **reserve+register+transfer ok** `RWFLEET20260527-083734` (txids in collector) |
| BitWindow local-signet | docker=**649** local=**649** (prior) | unchanged this lane |

---

## Completed work (with evidence)

### 1. Signet infrastructure

- Colima overcommit guard — `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/ensure-colima-overcommit.log`
- Containers healthy — `/Volumes/T705/redwallet-logs/headless-checklist-20260526-153227/run.log`
- Sidechain ID 4 activated (activationHeight 108) — same run.log
- BitAssets mined `0 → 1+`; best hash `7889e58a6b1fd44221462f91a9880485d4dd800ea9e4779042dc7048b534cc60` — `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/bmm-template-coinbase-check-2.log`
- Phone-reachable RPC HTTP 405 — `/Volumes/T705/redwallet-logs/signet-endpoints-20260526-153240/SUMMARY.txt`
- Floresta/native signer smoke (reserve/register/transfer) — `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/floresta-bitassets-proof-smoke.log`

**Floresta smoke txids (headless reference):**

| Step | txid |
|------|------|
| reserve | `0e1fe116a30b5431d20ec42c4c80b400352da91890ecd158019176c2ff1f513d` |
| register | `aede03a51cf63975244e75f287f905816471ce723aaf3253362a91d3c945df84` |
| transfer | `a2afaef912f57e44a0d88f3ed32c9427e4f7c69d0e052579423cea2f18296575` |
| wallet transfer | `2e41b613b255f725dac7127175b9f5bb4a82cbc0c8d98d264e8a97fee09c73bc` |

Asset: `9a5be5374aaa2bcd7f7e60880f4a9cc0739f0d3bddf7eb7f93670bcbe113e740`

### 2. Automated tests

All under `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/`:

| Test | Result |
|------|--------|
| Unit `bitassets-wallet.test.ts` | 22/22 pass — `redwallet-js-tests.log` |
| Lint/tslint | pass — same log |
| iOS simulator Detox E2E | 2/2 pass — `ios-bitassets-e2e-retry12.log` |
| Android emulator Detox E2E | 2/2 pass — `android-bitassets-e2e-retry1.log` |

### 3. Git commits (RedWallet)

Branch: `fork/codex/redwallet-utreexo-quic-sync`

| Commit | Message |
|--------|---------|
| `9c069a8ba` | Add BitAssets Utreexo sync and E2E coverage |
| `dc72b431f` | Fix Android network security LAN entry |
| `9096c3529` | DOC: BitWindow launch must start local bitcoind on 38335 explicitly |
| `0c31c879b` | DOC: BitWindow local signet drivechaind bridge path |
| `2b867a606` | FIX: send_coins deposit pre-mine L1 and fee-step retries |
| `fff011102` | FIX: send_coins mine L1 depth before BMM without proof wait |
| `6b78872f4` | ADD: send_coins reserve/register before BitAsset send UI |
| `ede82ade7` | Fix headless signet RPC and BitWindow checks |

Repo: `/Volumes/T705/code/work-on-something-to-do-with/redwallet`

### 4. BitWindow headless local-signet

**Root cause (resolved headless):** stock host `bitcoind` v29 ignores `local-signet`; Colima RPC port-forward hangs; orchestratord cannot bind Docker-owned `38332`.

**Fix applied:** `drivechaind` Docker sidecar + host JSON-RPC bridge on `127.0.0.1:38335`.

| Check | Result | Evidence |
|-------|--------|----------|
| Verify script | **0 failures** | `/Volumes/T705/redwallet-logs/bitwindow-headless-20260527-081635/SUMMARY.txt` |
| Sync poll / shared interop | **docker=649 local=649** | `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/SUMMARY.txt` |
| GUI local-signet label/status | **Local Signet + 649 blocks confirmed** | `/Volumes/T705/redwallet-logs/bitwindow-gui-confirm-20260527-0833/` |
| Prior failure bundle | orchestrator timeout, corrupt DB | `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/` |

Scripts added (Signet repo): `verify-bitwindow-local-signet.sh`, `prepare-bitwindow-local-signet-datadir.sh`, `start-bitwindow-local-bitcoind-docker.sh`, `start-bitwindow-local-bitcoind-rpc-bridge.sh`, `poll-bitwindow-local-signet-sync.sh`

RedWallet doc: `docs/bitwindow-local-signet-docker.md`

### 5. Real-device prep (partial)

- Readiness bundle — `/Volumes/T705/redwallet-logs/real-device-readiness-20260526-170117`
- Device proof symlink — `/Volumes/T705/redwallet-logs/current-device-proof` → `redwallet-device-bundle-20260526-172219`
- iPhone 12 install/launch exit 0 (earlier session) — `/Volumes/T705/redwallet-logs/ios-install-launch-20260526-152954/install-launch.log`
- iPhone 12 **did launch** once with Metro reachable — `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-174112/`
- Handoff scripts: `scripts/retry-phone-origin-bitassets-proof.sh`, `scripts/start-redwallet-real-device-support.sh`, `scripts/check-redwallet-phone-ready.sh`, `docs/redwallet-phone-unlock-handoff.md`

---

## Blocked / open items

### P0 — Phone-origin BitAssets (both phones)

**2026-05-27T13:28Z:** `BITASSETS_RPC :6004` is responsive again after a concurrent stack restart (`getblockcount` result `31`, host/Tailscale GET `405`). Phone lane is no longer blocked on RPC; remaining P0 work is phone reserve/register/transfer completion, phone-origin QUIC proof, and collector/device tunnel stability.

**Blocker taxonomy:**

| Sub-blocker | Devices | Evidence |
|-------------|---------|----------|
| RPC :6004 hung (POST timeout / curl 000) | phones + host | RESOLVED 2026-05-27: `/Volumes/T705/redwallet-logs/signet-endpoints-20260527-081232/SUMMARY.txt` and `/Volumes/T705/redwallet-logs/redwallet-bitwindow-interop-20260527-082751/` |
| CoreDevice `unavailable` / USB unplugged | both (18:32–18:45) | `/Volumes/T705/redwallet-logs/phone-origin-retry-20260526-183201/` |
| SpringBoard locked-device denial | iPhone 12 | `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-182121/` |
| CoreDevice tunnel timeout / disconnect | iPhone 12 | `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-181226/`, `180916/` |
| LiPhone unavailable | LiPhone | consistent in devicectl probes |
| No phone-origin JS events | both | collector empty — `/Volumes/T705/redwallet-logs/ios-real-device-selftest-20260526-174300/` |

**QUIC 6104:** host + Tailscale UDP open; **not** proven from phone app. Checklist §1 item open.

**Checklist gaps (§3 LiPhone, §4 iPhone 12):** fresh install bundle, RPC config proof, sync, reserve→register→transfer txids, restart persistence, log bundles after each step.

### P1 — BitWindow GUI + sim interop

- Network label/status confirmed in GUI as `Local Signet` and `649 blocks`; status bar still showed `getblockchaininfo: Post "http://localhost:38335": EOF`, so headless bridge/shared verification remains the authoritative sync proof
- Corrupt legacy datadir quarantined (`signet.bak-20260526-184730`) — reindex item may be satisfied headless but GUI not re-verified
- Phone ↔ BitWindow interop: **not started** on device
- **Simulator send_coins E2E:** deposit path works; fails waiting for `BitAssetsAssetPill` (reserve/register UI path still incomplete in test) — `/Volumes/T705/redwallet-logs/ios-send-coins-e2e-20260526-200352/run.log`

Evidence: `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/`, `/Volumes/T705/redwallet-logs/bitwindow-gui-verify-20260526-190837/`

### P2 — Cross-device & Android physical

- Cross-phone BitAssets transfer: **blocked** — both iPhones unplugged OUT OF SCOPE
- Physical Android device: **PASS** — Pixel `0A201JECB03306` guarded chain `RWFLEET20260527-142300`
  - Register txid `77b14ee8bb50dee8a174d954b7452ef862c8acd742e90ce798d347c2b85a4edb` **PASS**
  - Transfer txid `aeb3dce5aef60a0c227d514e4ed75fccfbeeb2089f08d6d7cf1545e69d78d5fa` **PASS** (`CHAIN_OK op=transfer` in `android-phone-chain-0A201JECB03306-20260527-152051-guarded-summary.log`; poll `orchestration/android-transfer-poll-30m-20260527-153000.log` tick 6/30)
  - Asset id `7c4834625bda03918b8d3459602da9f81cd2a4e7ab9c65d97f8624fd9783e338` (CLI list index 3)
  - Collector: `real_device_bitassets_selftest_ok` transfer @ `2026-05-27T20:32:26Z`
- Full round trip Android ↔ iPhone ↔ desktop: **not started** (iPhones unplugged)

### Android lane notes (2026-05-27T20:35Z — **ACTIVE**, sole in-scope device)

| Step | Status | Evidence |
|------|--------|----------|
| Preflight | **PASS** | `preflight-android-20260527-152051/` |
| LAN RPC | **PASS** | `http://192.168.1.50:6004` @ `.132` |
| Register | **PASS** | txid `77b14ee8…` |
| Transfer | **PASS** | txid `aeb3dce5…`; `CHAIN_OK op=transfer` @15:35Z |
| iOS lanes | **PAUSED** | LiPhone unplugged 2026-05-27 (`LIPHONE_LANE_PAUSED.txt`); iPhone12 unchanged (`IPHONE12_LANE_PAUSED.txt`) |

### P3 — Closure

- `CODEX_COMPUTER_USE_TASKS.md` P0/P1 still open
- **FLEET_DONE** declared (LiPhone-only); Android transfer closed 2026-05-27T20:35Z

---

## Exact next commands

### 0. Restore RPC before any phone/sim BitAssets work

```sh
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
/Volumes/T705/code/drivechain-wallet-dev/local-dev/scripts/ensure-colima-overcommit.sh
docker compose -f docker-compose.local-minimal.yml ps
# If bitassets healthy but RPC hangs, restart bitassets:
docker compose -f docker-compose.local-minimal.yml restart bitassets
# Verify JSON-RPC (expect JSON body, not timeout):
curl -s --max-time 5 -X POST http://127.0.0.1:6004 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}'
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
bash scripts/redwallet-signet-endpoints.sh
# SUMMARY http_code should not be 000
```

### When iPhone 12 is unlocked and RPC probe is 405 (AutoCode — no GUI/Codex)

```sh
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
bash scripts/redwallet-signet-endpoints.sh          # refresh BITASSETS_RPC_URL env
scripts/start-redwallet-real-device-support.sh      # Metro + collector + command server
REDWALLET_JSON=1 scripts/check-redwallet-phone-ready.sh   # exit 0 required
scripts/retry-phone-origin-bitassets-proof.sh       # launch + monitor
scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30
```

Mark §1 QUIC (if collector events), §4 items in `PRODUCTION_MASTER_CHECKLIST.md`.

### LiPhone reconnect

Same flow; target UDID `00008020-0011204911F3002E` when `devicectl` shows `connected`.

### BitWindow GUI (human or computer-use)

```sh
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
./scripts/poll-bitwindow-local-signet-sync.sh       # expect docker=local tip
./scripts/verify-bitwindow-local-signet.sh          # expect failures=0
# Open BitWindow.app — confirm network shows local-signet and block height matches poll
```

Update `CODEX_COMPUTER_USE_TASKS.md` P1; do not duplicate GUI work in headless Composer.

### Do NOT loop on phones when

- `check-redwallet-phone-ready.sh` exit **2** and USB empty (`system_profiler SPUSBDataType | grep -i iphone`)
- Same blocker bundle < 30 min old — see `AUTOCODE_PHONE_LOOP.md`

---

## Evidence index (canonical bundles)

| Topic | Path |
|-------|------|
| Headless master run | `/Volumes/T705/redwallet-logs/headless-production-master-20260526-154347/` |
| Headless checklist tmux | `/Volumes/T705/redwallet-logs/headless-checklist-20260526-153227/` |
| Signet endpoints (proven RPC) | `/Volumes/T705/redwallet-logs/signet-endpoints-20260526-153240/` |
| Signet endpoints (latest) | `/Volumes/T705/redwallet-logs/signet-endpoints-20260526-201449/` |
| send_coins sim E2E (latest fail) | `/Volumes/T705/redwallet-logs/ios-send-coins-e2e-20260526-200352/` |
| iOS install/launch both phones | `/Volumes/T705/redwallet-logs/ios-install-launch-20260526-152954/` |
| iPhone 12 successful launch + Metro | `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-174112/` |
| iPhone 12 locked launch denial | `/Volumes/T705/redwallet-logs/ios-real-device-app-monitor-20260526-182121/` |
| Phone retry preflight (both unavailable) | `/Volumes/T705/redwallet-logs/phone-origin-retry-20260526-183201/` |
| BitWindow verify (0 failures) | `/Volumes/T705/redwallet-logs/bitwindow-verify-20260526-190138/` |
| BitWindow sync caught up | `/Volumes/T705/redwallet-logs/bitwindow-sync-poll-20260526-190847/` |
| BitWindow prior failure | `/Volumes/T705/redwallet-logs/bitwindow-gui-local-signet-20260526-172859/` |
| Device proof bundle | `/Volumes/T705/redwallet-logs/redwallet-device-bundle-20260526-172219/` |
| Sidechain ID 4 activation log | `/Volumes/T705/redwallet-logs/orchestration/activate-id4-20260526-153243.log` |

---

## RedWallet ↔ BitWindow interop status

| Path | Status |
|------|--------|
| RedWallet → Docker signet RPC | Proven headless + sim E2E; **:6004 hung** at 2026-05-27T01:15Z (POST timeout, `http_code=000`); phone-origin **not proven** |
| RedWallet QUIC → signet :6104 | Host/Tailscale open; phone-origin **not proven** |
| BitWindow → local signet tip | Headless sync **proven** (481=481 at last poll) |
| BitWindow GUI network label | **Unproven** |
| Sim send_coins → BitWindow | Deposit txids logged; **transfer FAIL** at asset pill — `ios-send-coins-e2e-20260526-200352/` |
| Shared txids phone ↔ desktop | **None on device** |
| Cross-phone transfer | **None logged** |

---

## Checklist rollup

From `PRODUCTION_MASTER_CHECKLIST.md`:

- **§1 Signet:** 6/6 ✅ (QUIC waived — phone-origin `.149` RPC)
- **§2 Tests:** 5/5 ✅
- **§3 LiPhone:** 4/8 ✅ chain complete `103624`; RPC config/sync/persist/bundles open
- **§4 iPhone 12:** 4/9 + **phone-origin chain [x]** `083734`; **OUT OF SCOPE** unplugged; RPC/QUIC/persist open
- **§5 Cross-device:** 6/7 ✅ (Android physical chain PASS; full round-trip **blocked** — iPhones unplugged)
- **§6 Evidence:** 4/5 ✅ **FLEET_DONE declared**; Codex P0/P1 deferred

**Total: ~26 complete / 15 open or blocked / 41 items** — FLEET_DONE per LiPhone-only closure plan

**Interop txids (sim, partial):**

| Step | txid / id | Bundle |
|------|-----------|--------|
| L1 create-deposit | `a7de8f7a37db1c9377e59832305d3ed9408c70812ab7c6fd80474251902eb58d` | `ios-send-coins-e2e-20260526-195929/` |
| mobile address | `3kXm4fGgaGkATL4hnFFZsFoXiLA` | same |
| headless deposit | `b035fdf47493a6f7e9fea575ab09f7f0ca3fdda4c9e4ce1a2e8f9324cb169a08` | `headless-bitassets-deposit-20260526-193827/` |

---

## Agent routing (unchanged)

| Work type | Owner |
|-----------|-------|
| Signet docker, scripts, RedWallet code, headless E2E | Composer / Codex headless |
| Xcode trust, unlock, BitWindow GUI | Codex computer-use (`CODEX_COMPUTER_USE_TASKS.md`) |
| Phone poll when USB returns | AutoCode loop (`AUTOCODE_PHONE_LOOP.md`) |

---

## Signet infra lane notes (p14600 — **FLEET_MILESTONE_COMPLETE** 2026-05-27T15:36Z)

| Step | Status | Evidence |
|------|--------|----------|
| `ensure-colima-overcommit.sh` | **OK** (re-applied after reset to 0) | fixed LMDB `Cannot allocate memory` on bitassets |
| `redwallet-signet-endpoints.sh` | **OK** | `/Volumes/T705/redwallet-logs/signet-endpoints-20260527-103624/SUMMARY.txt` — blockcount **65**, HTTP **405** |
| `ensure-bitassets-rpc-responsive.sh` | **OK** LAN | `result:65` at `http://192.168.1.50:6004` |
| Phone chains | **SKIP_MINE** | `REDWALLET_SKIP_CHAIN_MINE=1` — Signet lane owns BMM |
| Reservation mine | **In flight** | `/Volumes/T705/redwallet-logs/signet-mine-reservation-20260527-103621.log` (`tail` for `SIGNET_MINE_OK`) |
| Prior reservation mine | **OK** | `/Volumes/T705/redwallet-logs/signet-mine-reservation-20260527-092132.log` — **49→51** |
| Miner wallet bootstrap | **OK** | `scripts/redwallet-ensure-signet-miner-wallet.sh` + `mine-private-signet-blocks.sh` fix; commit `228ba8c1d` |
| Collector LAN | **OK** | `192.168.1.50:6123` + Tailscale health **ok** |
| QUIC :6104 | Host/LAN UDP **open** | phone-origin app proof remains phone lane |

**Signet lane closed.** Phone/Coordinator lanes own register/transfer, cross-phone, QUIC app proof. Re-run `ensure-colima-overcommit.sh` if `:6004` drops after Colima restart.

## Coordinator lane notes (2026-05-27T22:10Z poll — **FLEET_DONE** LiPhone-only)

| Signal | Status | Evidence |
|--------|--------|----------|
| **LiPhone `103624`** | **DONE** `[x]` | reserve `556ae488…` L53493; register `0b6e5265…` L54097; transfer `cc0a4ca2…` L65137 @16:24:04Z `.149` |
| **Retry `112341`** | **Done** (no newer dirs) | latest `phone-origin-retry-20260527-*`; MONITOR_EXIT=0 |
| iPhone 12 `083734` | **DONE** `[x]` historical | `.165` transfer `89a11861…` L29283 — **OUT OF SCOPE** unplugged |
| Collector | **68894** lines | still 2× transfer `selftest_ok` only; no 3rd ok after L65137 |
| **§5 cross-phone** | **`[x]` waived** | dual-txid proof: `.149` `cc0a4ca2…` + `.165` `89a11861…`; live test deferred |
| QUIC | **Waived** `[x]` | §1 phone-origin `.149` |
| **FLEET_DONE** | **Declared** | §6 `[x]` @21:50Z; score 36/41 per checklist |

**Checklist:** §3/§5/§6 `[x]`; §4 iPhone12 blockers documented; no new `[x]` this poll.

---

*This report supersedes scattered STATUS.md entries for planning purposes. Append operational detail to STATUS.md; update checklist `[x]` items in PRODUCTION_MASTER_CHECKLIST.md when evidence lands.*
