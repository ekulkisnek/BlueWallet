import { Platform } from 'react-native';
import { getBundleId, isEmulatorSync } from 'react-native-device-info';
import {
  REDWALLET_SIGNET_BITASSETS_QUIC_URL,
  REDWALLET_SIGNET_BITASSETS_RPC_URL,
  REDWALLET_SIGNET_PHONE_HOST,
} from './redwalletSignetEndpoints.generated';

/** Dev bundle on a physical iPhone — embedded main.jsbundle is built with --dev false. */
const REAL_DEVICE_PROOF_BUNDLE_IDS = new Set(['com.lukekensik.redwallet.dev']);

/** Signet host reachable from iPhone on Wi‑Fi (from scripts/redwallet-signet-endpoints.sh). */
export const REDWALLET_PHONE_SIGNET_RPC_HOST = REDWALLET_SIGNET_PHONE_HOST;

export function isRedWalletIosRealDeviceProofEnabled(): boolean {
  if (Platform.OS !== 'ios' || Platform.isPad) return false;
  if (__DEV__) return true;
  try {
    return REAL_DEVICE_PROOF_BUNDLE_IDS.has(getBundleId());
  } catch {
    return false;
  }
}

export function isRedWalletIosPhysicalDevice(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return !isEmulatorSync();
  } catch {
    return true;
  }
}

export function canonicalBitAssetsRpcUrlForRuntime(): string {
  return REDWALLET_SIGNET_BITASSETS_RPC_URL;
}

export function canonicalBitAssetsQuicUrlForRuntime(): string {
  return REDWALLET_SIGNET_BITASSETS_QUIC_URL;
}

export { REDWALLET_SIGNET_BITASSETS_RPC_URL, REDWALLET_SIGNET_BITASSETS_QUIC_URL, REDWALLET_SIGNET_PHONE_HOST };
