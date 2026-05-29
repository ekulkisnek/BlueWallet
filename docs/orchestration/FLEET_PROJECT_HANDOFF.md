# RedWallet Fleet — Project Handoff (Operator + Next Engineer)

**Last updated:** 2026-05-28  
**Canonical path:** `/Volumes/T705/redwallet-logs/orchestration/FLEET_PROJECT_HANDOFF.md`  
**Repo mirror:** `/Volumes/T705/code/work-on-something-to-do-with/redwallet/docs/orchestration/FLEET_PROJECT_HANDOFF.md`

---

## Paste into chat (operator quick brief)

```
RedWallet fleet handoff (2026-05-28): Android Pixel 0A201JECB03306 PASS — chains 142300 transfer aeb3dce5…, 153100 transfer 69f69b87…, 153524/155139 transfer a155cab5… (see ANDROID_PRODUCTION_QA_REPORT.md). LiPhone FLEET_DONE (103624) but UNPLUGGED/out of scope; iPhone12 paused. Full Android↔iPhone↔desktop round trip NOT done.
Branch: codex/redwallet-utreexo-quic-sync @ 6f6396a9d (4 commits ahead of fork remote; do not push unless asked). Signet: Colima + docker-compose.local-minimal.yml; phones use http://192.168.1.50:6004 (not 127.0.0.1). BitWindow: ED280271… enforcer wallet, sidechain slot 4 plain-bitassets; app at drivechain-frontends/.../Release/BitWindow-LocalSignet.app or /Applications/.
AutoCode: ~/autocode — DB may be malformed after crash; read AUTOCODE_SYSTEM_HANDOFF.md before tick/dispatch. Logs: /Volumes/T705/redwallet-logs/. NO phone-chain runs until lanes re-enabled; NO colima stop during active work.
Resume: colima overcommit → compose up → redwallet-signet-endpoints.sh → ensure-bitassets-rpc-responsive.sh → honor *_LANE_PAUSED.txt → Android-only if device connected.
```

---

## Current status (May 28, 2026)

### Android physical — **PASS**

| Fleet asset ID | Step | Txid (prefix) | Evidence |
|----------------|------|---------------|----------|
| `RWFLEET20260527-142300` | transfer (guarded) | `aeb3dce5…` | `android-phone-chain-0A201JECB03306-20260527-152051-guarded-summary.log`; poll `orchestration/android-transfer-poll-30m-20260527-153000.log` |
| `RWFLEET20260527-153100` | reserve → register → transfer | transfer `69f69b87…` | `orchestration/ANDROID_PRODUCTION_QA_REPORT.md`; collector `real_device_bitassets_selftest_ok` |
| `RWFLEET20260527-153524` / `155139` | transfer (orchestrated) | `a155cab5…` | `android-phone-chain-0A201JECB03306-20260527-153525.log`, `…-160724.log`; collector @21:06Z |

- **Device:** Pixel 4a 5G `0A201JECB03306` (USB), Wi‑Fi `192.168.1.132`
- **Wallet (153100 run):** `30c1101a873f6053e4b47ab9ef32bc059908f9c944803bf0b2c5a49a738bcee7`
- **180s monitor:** `MONITOR_OK blocking=0` — `current-android-real-device-app-monitor/`
- **Verdict:** See `orchestration/ANDROID_PRODUCTION_QA_REPORT.md` (**Overall: PASS**)

### LiPhone — **FLEET_DONE (historical); UNPLUGGED / out of scope**

- Lane **PAUSED:** `LIPHONE_LANE_PAUSED.txt`; AutoCode chat `629e49d5` paused
- Historical full chain `RWFLEET20260527-103624` on `192.168.1.149` — reserve/register/transfer txids in `STATUS.md` @21:45Z and `FLEET_DONE.txt`
- **Do not** run LiPhone phone scripts until USB reconnect + guard file removed

### iPhone 12 mini — **OUT OF SCOPE**

- `IPHONE12_LANE_PAUSED.txt`; AutoCode `d01589fe` paused
- Historical chain `RWFLEET20260527-083734` on `.165` remains evidence only

### Full fleet round trip — **NOT done**

- Checklist §5: Android physical **PASS**; live **Android ↔ iPhone(s) ↔ BitWindow** with txids on all sides — **blocked** (both iPhones unplugged)
- LiPhone-only `FLEET_DONE` (2026-05-27) does **not** close full multi-device round trip

### BitWindow (desktop)

| Item | Value |
|------|--------|
| **App (rebuilt)** | `/Volumes/T705/code/drivechain-frontends/bitwindow/build/macos/Build/Products/Release/BitWindow-LocalSignet.app` |
| **Installed copy** | `/Applications/BitWindow-LocalSignet.app` |
| **Enforcer wallet (use this)** | `ED280271C0757307EE24F14F9690D960` (created 2026-05-12, `walletType: enforcer`) |
| **Do not use** | `17EBC8D2…` (bitcoinCore wallet, same display name) |
| **Sidechain** | Slot **4** — `plain-bitassets` |
| **Network UI** | **L2L-Signet** / local signet; headless bridge `127.0.0.1:38335` |

**Launch / verify (after reboot):**

```bash
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
./scripts/ensure-colima-overcommit.sh
docker compose -f docker-compose.local-minimal.yml up -d
./scripts/launch-bitwindow-local-signet.sh   # or BITWINDOW_SKIP_GUI=1 for headless only
open -a "/Applications/BitWindow-LocalSignet.app"   # or Release path above
```

**Wallet switch (CLI, no Colima stop):**

```bash
curl -sS -X POST http://127.0.0.1:30400/walletmanager.v1.WalletManagerService/SwitchWallet \
  -H 'Content-Type: application/json' \
  -d '{"walletId":"ED280271C0757307EE24F14F9690D960"}'
```

**GUI steps:** Cmd+Q quit → reopen → network **L2L-Signet** → wallet dropdown → **Enforcer Wallet (2026-05-12)** → Sidechains tab → expect **plain-bitassets slot 4**. Details: `BITASSETS_ENFORCER_SIDECHAIN_UI.md`.

**Note:** Go binaries were updated @ `7bb68b9` in drivechain-frontends; full Flutter GUI rebuild needs Dart SDK **3.11.4+** (`flutter build macos` failed on SDK pin — see `sail_ui/pubspec.yaml` uncommitted patch below).

### Signet stack (Colima + Docker)

| Item | Detail |
|------|--------|
| **Runtime** | Colima (`~/.colima/default/docker.sock`); scripts source `redwallet-colima-docker-env.sh` |
| **Compose** | `/Volumes/T705/code/drivechain-wallet-dev/local-dev/docker-compose.local-minimal.yml` |
| **Phone RPC (LAN)** | `http://192.168.1.50:6004` — **never** `127.0.0.1` on physical devices |
| **Tailscale (alt)** | `http://100.76.117.106:6004` when documented in latest `redwallet-signet.env` |
| **QUIC** | UDP `:6104` (not TCP) |
| **Image pin** | `BITASSETS_IMAGE=local/plain-bitassets:codex-proof` |

**Key scripts:**

```bash
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
bash scripts/redwallet-signet-endpoints.sh          # fresh env bundle under redwallet-logs/
scripts/ensure-bitassets-rpc-responsive.sh          # light RPC recover (prefer over colima stop)
scripts/redwallet-colima-bitassets-recover.sh       # escalate only if light recover fails
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
./scripts/ensure-colima-overcommit.sh
./scripts/activate-plain-bitassets-id4.sh           # only if sidechain slot 4 missing
```

Deep reference: `STACK_IMPROVEMENTS_COLIMA_RPC.md`, `drivechain-wallet-dev/local-dev/docs/BITWINDOW_STARTUP_ORDER.md`.

### AutoCode orchestrator

- **Home:** `/Users/lukekensik/autocode`
- **Full handoff:** `orchestration/AUTOCODE_SYSTEM_HANDOFF.md` (repo mirror: `redwallet/docs/orchestration/AUTOCODE_SYSTEM_HANDOFF.md`)
- **Current blocker:** `~/autocode/state/autocode.sqlite` reported **"database disk image is malformed"** — snapshot state dir before repair; avoid write-heavy CLI (`tick`, `priority add`) until fixed
- **Lanes:** Android `p14550` active when device connected; LiPhone/iPhone12 **paused**; Signet `p14600` on-demand for RPC/mining only

---

## Key paths and commits

### Repos and branches

| Repo | Path | Branch / notes |
|------|------|----------------|
| **RedWallet** | `/Volumes/T705/code/work-on-something-to-do-with/redwallet` | `codex/redwallet-utreexo-quic-sync` |
| **drivechain-wallet-dev** | `/Volumes/T705/code/drivechain-wallet-dev` | local-dev stack, no push required |
| **drivechain-frontends** | `/Volumes/T705/code/drivechain-frontends` | BitWindow + `sail_ui`; uncommitted `sail_ui/pubspec.yaml` SDK range patch |

### RedWallet commits (recent fleet work)

| SHA | Subject |
|-----|---------|
| `ef98456b6` | FIX: Android fleet transfer wallet gates and command seeding |
| `6f6396a9d` | FIX: unify Colima docker env and harden bitassets RPC recovery |
| `a763acc84` | REF: streamline Android fleet scripts for transfer-only ops |
| `a907cb9fb` | DOC: Android production PASS and fleet checklist alignment |

**Remote:** tracking `fork/codex/redwallet-utreexo-quic-sync`, **4 commits ahead** (as of handoff capture). **Do not push** unless operator explicitly requests.

**Uncommitted / untracked (redwallet):** doc updates, `preflight-redwallet-android-chain.sh`, e2e tweaks, new orchestration mirror files — review `git status` before next commit.

### BitWindow app paths

```
/Volumes/T705/code/drivechain-frontends/bitwindow/build/macos/Build/Products/Release/BitWindow-LocalSignet.app
/Applications/BitWindow-LocalSignet.app
```

### Logs and evidence root

```
/Volumes/T705/redwallet-logs/
├── orchestration/          # checklists, lane guards, QA reports, this file
├── current-js-event-collector/events.ndjson
├── current-android-real-device-app-monitor/
├── current-device-proof -> …
├── android-phone-chain-0A201JECB03306-*
├── signet-endpoints-*/
└── INFRA_HEALTH_OK.txt     # last known good infra gate (verify live before trusting)
```

### Orchestration doc index

| Doc | Purpose |
|-----|---------|
| `FLEET_PROJECT_HANDOFF.md` | **This file** — project-level operator handoff |
| `AUTOCODE_SYSTEM_HANDOFF.md` | AutoCode daemon, tick model, DB recovery |
| `FLEET_LANES.md` | Lane ownership, pause files, lock rules |
| `PRODUCTION_MASTER_CHECKLIST.md` | Itemized `[x]` / blockers (38/41 + FLEET_DONE LiPhone scope) |
| `PRODUCTION_READINESS_REPORT.md` | Consolidated readiness + evidence links |
| `ANDROID_PRODUCTION_QA_REPORT.md` | Android physical PASS + txids |
| `ANDROID_DEVICE_ONBOARDING.md` | Pixel setup, `ANDROID_SERIAL`, preflight |
| `ANDROID_WALLET_RESTORE.md` | Wallet/asset ID confusion on device |
| `BITASSETS_ENFORCER_SIDECHAIN_UI.md` | BitWindow wallet switch, slot 4 UI |
| `STACK_IMPROVEMENTS_COLIMA_RPC.md` | Colima/RPC recovery script matrix |
| `STATUS.md` | Chronological milestone log |
| `FLEET_DONE.txt` | LiPhone-only closure marker |
| `LIPHONE_LANE_PAUSED.txt` / `IPHONE12_LANE_PAUSED.txt` | Hard gates — honor as law |
| `AUTOCODE_PHONE_LOOP.md` | Phone polling when devices return |
| `CODEX_COMPUTER_USE_TASKS.md` | Deferred GUI tasks |
| `PARENT_CONV_OPERATOR.md` | Parent chat scope decisions |

Repo mirrors (subset): `/Volumes/T705/code/work-on-something-to-do-with/redwallet/docs/orchestration/`

---

## How to resume after reboot (ordered checklist)

1. **Read lane guards** — confirm `LIPHONE_LANE_PAUSED.txt` and `IPHONE12_LANE_PAUSED.txt` still present; do **not** run iOS phone-chain scripts unless explicitly re-scoped and files removed.

2. **Colima + Docker signet**
   ```bash
   cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
   ./scripts/ensure-colima-overcommit.sh
   export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock   # if unset
   docker compose -f docker-compose.local-minimal.yml up -d
   docker compose -f docker-compose.local-minimal.yml ps   # mainchain, enforcer, bitassets healthy
   ```

3. **RPC health (phones)**
   ```bash
   cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
   scripts/ensure-bitassets-rpc-responsive.sh
   bash scripts/redwallet-signet-endpoints.sh
   # Expect HTTP 405 on GET; POST getblockcount returns JSON "result"
   ```

4. **AutoCode (optional — only if DB healthy)**
   ```bash
   cd ~/autocode
   python3 -m autocode.cli daemon status --verbose
   python3 -m autocode.cli doctor
   python3 -m autocode.cli tick --dry-run --max-projects 8
   ```
   If sqlite malformed → snapshot `~/autocode/state/` and repair per `AUTOCODE_SYSTEM_HANDOFF.md` before dispatch.

5. **BitWindow (if desktop interop needed)**
   - Start stack (step 2) first
   - `SwitchWallet` to `ED280271…` or use launch script in `local-dev`
   - Quit/reopen BitWindow GUI; verify sidechain slot 4

6. **Android only (if continuing physical work)**
   ```bash
   export ANDROID_SERIAL=0A201JECB03306
   adb devices   # device authorized
   scripts/preflight-redwallet-android-chain.sh
   # Chain scripts only when RPC + preflight PASS — see ANDROID_DEVICE_ONBOARDING.md
   ```

7. **Evidence discipline** — after any chain step: tail `current-js-event-collector/events.ndjson`; update checklist only with txid + log path.

8. **Do not** run `colima stop` while chain locks, monitors, or `android-phone-chain-*.lock.d` exist under log root.

---

## What's NOT done / optional

| Item | Status | Notes |
|------|--------|-------|
| **Full fleet round trip** | Open | Android ↔ iPhones ↔ BitWindow with live txids all sides |
| **iPhone round trip** | Blocked | Devices unplugged; lanes paused |
| **git push (redwallet)** | Optional | 4 commits ahead of `fork/`; push only when operator asks |
| **git push (drivechain-frontends)** | Optional | BitWindow fixes may live on branch @ `7bb68b9`; `sail_ui/pubspec.yaml` SDK range patch **uncommitted** (allows local Flutter < 3.11.4 pin) |
| **AutoCode DB repair** | **P0 if using AutoCode** | Malformed sqlite — snapshot + integrity check before `tick` |
| **Cross-phone transfer** | Blocked | Needs iPhone12 USB + LiPhone or documented waiver update |
| **Phone-origin QUIC proof** | Waived for LiPhone closure | UDP :6104 host-open; not required for current FLEET_DONE scope |
| **Codex GUI P0/P1** | Deferred | `CODEX_COMPUTER_USE_TASKS.md` |
| **BitWindow Flutter rebuild** | Optional | Dart 3.11.4+ for full GUI after `wallet_reader_provider` fixes |

---

## Safety rules (operator contract)

Treat orchestration as a **single-writer fleet**: never run overlapping phone-chain owners across lanes; honor `*_LANE_PAUSED.txt` as hard stops; do not dispatch AutoCode iOS chats while Android chain scripts hold RPC or device locks; do not use `127.0.0.1` BitAssets RPC on physical phones (use LAN `192.168.1.50:6004` or documented Tailscale URL from the latest `redwallet-signet.env`); do not run `colima stop` or full stack teardown during active `android-phone-chain-*` / iOS chain / transfer polls — use `ensure-bitassets-rpc-responsive.sh` and bitassets-only restarts first; Signet lane owns Docker/RPC recovery while phone lanes own installs and chains; snapshot `~/autocode/state/` before any DB repair; record every PASS with txid in `events.ndjson` or chain log plus a path under `/Volumes/T705/redwallet-logs/`.

---

## Related handoffs (read next)

1. `AUTOCODE_SYSTEM_HANDOFF.md` — scheduler, tick, DB failure modes  
2. `ANDROID_PRODUCTION_QA_REPORT.md` — Android PASS evidence  
3. `BITASSETS_ENFORCER_SIDECHAIN_UI.md` — BitWindow wallet + sidechain UI  
4. `FLEET_LANES.md` — who may touch what  
5. `STACK_IMPROVEMENTS_COLIMA_RPC.md` — RPC recovery escalation  

---

*Generated for operator handoff. No phone-chain execution or git push was performed while writing this document.*
