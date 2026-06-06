import { Platform } from 'react-native';
import { getBundleId, isEmulatorSync } from 'react-native-device-info';
import {
  REDWALLET_SIGNET_BITASSETS_QUIC_URL,
  REDWALLET_SIGNET_BITASSETS_RPC_URL,
  REDWALLET_SIGNET_PHONE_HOST,
} from './redwalletSignetEndpoints.generated';

/** Dev bundle on a physical iPhone — embedded main.jsbundle is built with --dev false. */
const REAL_DEVICE_PROOF_BUNDLE_IDS = new Set(['com.lukekensik.redwallet.dev', 'com.lukekensik.redwallet.twophones']);

/** Signet host reachable from iPhone on Wi‑Fi (from scripts/redwallet-signet-endpoints.sh). */
export const REDWALLET_PHONE_SIGNET_RPC_HOST = REDWALLET_SIGNET_PHONE_HOST;

export function isRedWalletIosPhysicalDevice(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return !isEmulatorSync();
  } catch {
    return true;
  }
}

export function isRedWalletAndroidPhysicalDevice(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    return !isEmulatorSync();
  } catch {
    return true;
  }
}

/** Physical Android uses Mac LAN for command/collector/RPC — never LiPhone USB tunnel hosts. */
export function isRedWalletAndroidLanMacEndpointsOnly(): boolean {
  return isRedWalletAndroidPhysicalDevice();
}

export function isRedWalletMobilePhysicalDevice(): boolean {
  return isRedWalletIosPhysicalDevice() || isRedWalletAndroidPhysicalDevice();
}

export function isRedWalletIosRealDeviceProofEnabled(): boolean {
  if (Platform.OS !== 'ios' || Platform.isPad) return false;
  // __DEV__ includes iOS simulator (Detox + simctl command-server L1 E2E).
  if (__DEV__) return true;
  try {
    if (isEmulatorSync()) return false;
  } catch {
    // fall through
  }
  try {
    return REAL_DEVICE_PROOF_BUNDLE_IDS.has(getBundleId());
  } catch {
    return false;
  }
}

/** Debug APK on a physical Android device (Metro / adb reverse). */
export function isRedWalletAndroidRealDeviceProofEnabled(): boolean {
  if (Platform.OS !== 'android') return false;
  if (!isRedWalletAndroidPhysicalDevice()) return false;
  return __DEV__;
}

export function isRedWalletRealDeviceProofEnabled(): boolean {
  return isRedWalletIosRealDeviceProofEnabled() || isRedWalletAndroidRealDeviceProofEnabled();
}

export function canonicalBitAssetsRpcUrlForRuntime(): string {
  return REDWALLET_SIGNET_BITASSETS_RPC_URL;
}

export function canonicalBitAssetsQuicUrlForRuntime(): string {
  return REDWALLET_SIGNET_BITASSETS_QUIC_URL;
}

export { REDWALLET_SIGNET_BITASSETS_RPC_URL, REDWALLET_SIGNET_BITASSETS_QUIC_URL, REDWALLET_SIGNET_PHONE_HOST };

export function canonicalLiquidRpcUrlForRuntime(): string {
  return `http://${REDWALLET_SIGNET_PHONE_HOST}:6055`;
}

/** Canonical LAN-reachable Liquid Electrum endpoint for node-free mobile Liquid sends. */
export function canonicalLiquidElectrumUrlForRuntime(): string {
  return `tcp://${REDWALLET_SIGNET_PHONE_HOST}:60401`;
}

/** Canonical LAN-reachable Liquid QUIC endpoint. */
export function canonicalLiquidQuicUrlForRuntime(): string {
  return REDWALLET_SIGNET_BITASSETS_QUIC_URL;
}
