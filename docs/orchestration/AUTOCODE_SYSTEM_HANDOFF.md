# AutoCode System Handoff (Repo Mirror)

Canonical full handoff lives at:
`/Volumes/T705/redwallet-logs/orchestration/AUTOCODE_SYSTEM_HANDOFF.md`

This repo copy is intentionally concise for engineers working inside `redwallet`.

## Quickstart

```bash
cd /Users/lukekensik/autocode
python3 -m autocode.cli daemon status --verbose
python3 -m autocode.cli doctor
cd /Volumes/T705/code/drivechain-wallet-dev/local-dev
/Volumes/T705/code/drivechain-wallet-dev/local-dev/scripts/ensure-colima-overcommit.sh
docker compose -f docker-compose.local-minimal.yml ps
cd /Volumes/T705/code/work-on-something-to-do-with/redwallet
bash scripts/redwallet-signet-endpoints.sh
python3 -m autocode.cli tick --dry-run --max-projects 8
python3 -m autocode.cli priority list --limit 20
```

## What AutoCode is here

- Local daemon scheduler (`~/autocode`) that discovers chats, dispatches jobs per tick, and tracks completion evidence.
- Tick dispatch is slot-based: sends up to `min(--max-projects, capacity) - active_jobs`.
- Lanes and lock files in orchestration docs define who can run what (especially phones/signet).

## Critical directories

- AutoCode state: `~/autocode/state/autocode.sqlite`, `~/autocode/state/jobs`, `~/autocode/state/audit.jsonl`
- AutoCode logs: `~/autocode/logs/autocode.log`, `~/autocode/logs/launchd.*.log`
- Fleet docs: `redwallet-logs/orchestration/PRODUCTION_READINESS_REPORT.md`, `PRODUCTION_MASTER_CHECKLIST.md`, `FLEET_LANES.md`, `STATUS.md`

## Current lane model (from docs)

- Android lane active (`p14550`, device `0A201JECB03306`)
- LiPhone lane paused (`p14700`, `629e49d5`, `LIPHONE_LANE_PAUSED.txt`)
- iPhone12 lane paused (`p14800`, `d01589fe`, `IPHONE12_LANE_PAUSED.txt`)
- Signet lane on-demand for RPC/mining recovery (`p14600`, `f2859837`)
- Coordinator lane for closure/checklist, not phone-chain execution (`p15000`)

## Safety rules

- Never overlap phone-chain owners across lanes.
- Do not run `colima stop` during active runs.
- Do not use `127.0.0.1` RPC URL on physical phones; use LAN/Tailscale host.
- Honor `*_LANE_PAUSED.txt` files as hard gates.

## Common operations

- Discover/status: `python3 -m autocode.cli discover|status|now|queue`
- Pause/unpause flow: `pause`, `priority remove`, then `priority add` when re-enabling
- Dispatch control: `tick --dry-run --max-projects N` before live dispatch

## Frequent failures and fixes

- Repeated `sent=0`: check capacity, leases, paused lanes, and infra blockers before forcing dispatch.
- RPC `:6004` hangs: run `scripts/ensure-bitassets-rpc-responsive.sh`, restart bitassets only if needed.
- BitWindow sidecar/bridge issues: use documented sidecar + localhost bridge flow; trust headless verify when GUI label is inconsistent.
- Current blocker during this handoff: AutoCode DB reports "database disk image is malformed"; recover DB before write-heavy operations.

## Evidence conventions

- Put all proof in timestamped bundles under `/Volumes/T705/redwallet-logs/`.
- Treat `events.ndjson`, `phone-chain-*.log`, `android-phone-chain-*.log`, and `SUMMARY.txt` as canonical txid/PASS sources.
- Track closure with checklist `[x]`, `CHAIN_OK`/`selftest_ok`, and explicit `FLEET_DONE` notes.

## Done definitions

- Android done: reserve/register/transfer txids + monitor pass + bundled evidence.
- Full fleet done: all required checklist items complete or documented accepted blockers, with linked evidence.
