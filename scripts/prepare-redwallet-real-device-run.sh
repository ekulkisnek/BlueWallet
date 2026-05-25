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

cat > "$OUT_DIR/TWO_IPHONE_SIGNING_AND_NETWORK.txt" <<EOF
RedWallet two-iPhone legitimate deployment checklist

Network:
1. Prefer Tailscale when the phones are not on the exact same Wi-Fi as this Mac.
2. Otherwise put both phones and the Mac on the same Wi-Fi/VLAN.
3. Use the endpoint from the generated env file:
     ${BITASSETS_RPC_URL:-not discovered}
4. The phone must be able to reach the Mac on BitAssets RPC port 6004 and Metro
   port 8081 for dev builds. A simulator may keep using localhost/127.0.0.1.

Signing:
1. LiPhone on Luke's Apple account can use Xcode direct deploy if the device is
   trusted, online, and included in the selected development team profile.
2. The second iPhone on a different Apple account cannot be installed by
   bypassing Apple's signing model. Use one of:
   - add the device UDID to the Apple Developer team provisioning profile,
   - TestFlight/internal distribution from App Store Connect,
   - an Ad Hoc profile that includes that UDID,
   - direct Xcode deploy only if that Apple account/team can sign the bundle.
3. If either phone is only visible as offline/unavailable, unlock it, trust this
   Mac, enable Developer Mode if prompted, and rerun the collector.

Required proof before FLEET_DONE:
1. Bundle from before install.
2. Bundle after install/launch on each phone.
3. Bundle after sync/receive/send/balance/restart on each phone.
4. Bundle containing desktop wallet interop txids and BitAssets proof-backed
   state from Luke's signet.
EOF

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
3. Read:
     $OUT_DIR/TWO_IPHONE_SIGNING_AND_NETWORK.txt
4. Open ios/BlueWallet.xcworkspace in Xcode.
5. Select the BlueWallet scheme and each connected iPhone target in turn.
6. Use the chosen BITASSETS_RPC_URL from the env file in the BitAssets wallet setup screen.
7. After every install/sync/send/restart attempt, run:
     scripts/collect-redwallet-device-logs.sh /Volumes/T705/redwallet-logs 30

Current phone-ready BitAssets RPC candidate:
  ${BITASSETS_RPC_URL:-not discovered}

Structured current-bundle symlink:
  /Volumes/T705/redwallet-logs/current-device-proof

Codex should inspect this bundle first:
  $OUT_DIR
EOF

cat "$OUT_DIR/NEXT_STEPS.txt"
