import { Platform } from 'react-native';
import { getBundleId, isEmulatorSync } from 'react-native-device-info';

/** Dev bundle on a physical iPhone — embedded main.jsbundle is built with --dev false. */
const REAL_DEVICE_PROOF_BUNDLE_IDS = new Set(['com.lukekensik.redwallet.dev']);

/** Signet host reachable from Luke's iPhone on Wi‑Fi (Luke LAN signet node). */
export const REDWALLET_PHONE_SIGNET_RPC_HOST = '192.168.1.236';

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
