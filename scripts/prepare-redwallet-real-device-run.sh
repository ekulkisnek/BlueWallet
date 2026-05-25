#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${REDWALLET_LOG_ROOT:-/Volumes/T705/redwallet-logs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUTPUT_ROOT%/}/real-device-readiness-${STAMP}"
MINUTES="${MINUTES:-20}"

mkdir -p "$OUT_DIR"

cd "$ROOT_DIR"

echo "[1/4] Discovering signet endpoints..."
scripts/redwallet-signet-endpoints.sh "$OUT_DIR" > "$OUT_DIR/endpoints.out" 2>&1 || true
ENV_FILE="$(awk -F= '/^env_file=/{print $2}' "$OUT_DIR/endpoints.out" | tail -1)"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

echo "[2/4] Collecting baseline logs..."
scripts/collect-redwallet-device-logs.sh "$OUTPUT_ROOT" "$MINUTES" > "$OUT_DIR/baseline-log-bundle.out" 2>&1 || true
BASELINE_BUNDLE="$(awk -F= '/^output_dir=/{print $2}' "$OUT_DIR/baseline-log-bundle.out" | tail -1)"

echo "[3/4] Checking iOS build settings..."
xcodebuild -workspace ios/BlueWallet.xcworkspace -scheme BlueWallet -showBuildSettings \
  > "$OUT_DIR/xcode-build-settings.txt" 2>&1 || true

echo "[4/4] Checking JS/unit readiness..."
npx jest tests/unit/bitassets-wallet.test.ts --runInBand \
  > "$OUT_DIR/bitassets-unit.log" 2>&1 || true

cat > "$OUT_DIR/NEXT_STEPS.txt" <<EOF
RedWallet real-device readiness bundle

Endpoint env:
  ${ENV_FILE:-missing}

Baseline log bundle:
  ${BASELINE_BUNDLE:-missing}

When the iPhones are present:
1. Put the Mac and both iPhones on the same Wi-Fi, or connect all three to Tailscale.
2. Run:
     source "${ENV_FILE:-$OUT_DIR/redwallet-signet.env}"
     scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 20
3. Open ios/BlueWallet.xcworkspace in Xcode.
4. Select the BlueWallet scheme and the connected iPhone target.
5. Use the chosen BITASSETS_RPC_URL from the env file in the BitAssets wallet setup screen.
6. After every install/sync/send attempt, run:
     scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30

Current phone-ready BitAssets RPC candidate:
  ${BITASSETS_RPC_URL:-not discovered}

Codex should inspect this bundle first:
  $OUT_DIR
EOF

cat "$OUT_DIR/NEXT_STEPS.txt"
