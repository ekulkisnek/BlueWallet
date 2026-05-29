import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { isRedWalletAndroidLanMacEndpointsOnly } from './redwalletRealDeviceProof';
import { REDWALLET_SIGNET_PHONE_HOST } from './redwalletSignetEndpoints.generated';
import { REDWALLET_USB_TUNNEL_MAC_IPV6 as GENERATED_USB_TUNNEL_MAC_IPV6 } from './redwalletUsbTunnel.generated';

/** Mac-side Core Device USB tunnel (::2 on Mac, phone uses ::1). Regenerated at bundle time. */
export const REDWALLET_USB_TUNNEL_MAC_IPV6 = GENERATED_USB_TUNNEL_MAC_IPV6;

export const REDWALLET_USB_TUNNEL_COLLECTOR_EVENTS = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6123/events`;
export const REDWALLET_USB_TUNNEL_COMMAND = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6124/command`;

/** Runtime file written by proof scripts via devicectl (optional). */
export const REDWALLET_USB_TUNNEL_HOST_FILE = 'redwallet-usb-tunnel-host.txt';

/** Luke signet Mac over Tailscale — iOS fallback; omitted on physical Android (logcat noise). */
export const REDWALLET_TAILSCALE_MAC_HOST = '100.76.117.106';

export const REDWALLET_LAN_COLLECTOR_EVENTS = `http://${REDWALLET_SIGNET_PHONE_HOST}:6123/events`;
export const REDWALLET_LAN_BITASSETS_COMMAND = `http://${REDWALLET_SIGNET_PHONE_HOST}:6124/command`;
export const REDWALLET_LAN_BTC_COMMAND = `http://${REDWALLET_SIGNET_PHONE_HOST}:6125/command`;
export const REDWALLET_LAN_BTC_RESULT = `http://${REDWALLET_SIGNET_PHONE_HOST}:6125/result`;
export const REDWALLET_TAILSCALE_COLLECTOR_EVENTS = `http://${REDWALLET_TAILSCALE_MAC_HOST}:6123/events`;

/** Android emulator host loopback via adb reverse (optional dev path). */
const REDWALLET_ANDROID_EMULATOR_COMMAND_URLS = [
  `http://10.0.2.2:6124/command`,
  `http://127.0.0.1:6124/command`,
  REDWALLET_LAN_BITASSETS_COMMAND,
];

const REDWALLET_ANDROID_EMULATOR_BTC_COMMAND_URLS = [
  `http://10.0.2.2:6125/command`,
  `http://127.0.0.1:6125/command`,
  REDWALLET_LAN_BTC_COMMAND,
];

const REDWALLET_ANDROID_EMULATOR_BTC_RESULT_URLS = [
  `http://10.0.2.2:6125/result`,
  `http://127.0.0.1:6125/result`,
  REDWALLET_LAN_BTC_RESULT,
];

export function isRedWalletCoreDeviceUsbTunnelHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host.startsWith('fd') && host.includes(':');
}

export function redWalletCollectorEventUrlsForRuntime(): string[] {
  if (isRedWalletAndroidLanMacEndpointsOnly()) {
    return [REDWALLET_LAN_COLLECTOR_EVENTS];
  }
  if (Platform.OS === 'android') {
    return [REDWALLET_LAN_COLLECTOR_EVENTS, REDWALLET_TAILSCALE_COLLECTOR_EVENTS];
  }
  return [REDWALLET_USB_TUNNEL_COLLECTOR_EVENTS, REDWALLET_TAILSCALE_COLLECTOR_EVENTS, REDWALLET_LAN_COLLECTOR_EVENTS];
}

export async function resolveRedWalletBitAssetsCommandUrls(): Promise<string[]> {
  if (isRedWalletAndroidLanMacEndpointsOnly()) {
    return [REDWALLET_LAN_BITASSETS_COMMAND];
  }
  if (Platform.OS === 'android') {
    return [...REDWALLET_ANDROID_EMULATOR_COMMAND_URLS];
  }

  const urls: string[] = [];
  const tunnelFile = `${RNFS.DocumentDirectoryPath}/${REDWALLET_USB_TUNNEL_HOST_FILE}`;
  if (await RNFS.exists(tunnelFile)) {
    const host = (await RNFS.readFile(tunnelFile, 'utf8')).trim();
    if (host) {
      urls.push(`http://[${host}]:6124/command`);
    }
  }
  urls.push(REDWALLET_USB_TUNNEL_COMMAND, REDWALLET_LAN_BITASSETS_COMMAND);
  return urls;
}

export async function resolveRedWalletBtcCommandUrls(): Promise<string[]> {
  if (isRedWalletAndroidLanMacEndpointsOnly()) {
    // USB adb reverse (127.0.0.1) first — works when Mac LAN IP is unreachable on Wi‑Fi.
    return [`http://127.0.0.1:6125/command`, REDWALLET_LAN_BTC_COMMAND];
  }
  if (Platform.OS === 'android') {
    return [...REDWALLET_ANDROID_EMULATOR_BTC_COMMAND_URLS];
  }

  const urls: string[] = [];
  const tunnelFile = `${RNFS.DocumentDirectoryPath}/${REDWALLET_USB_TUNNEL_HOST_FILE}`;
  if (await RNFS.exists(tunnelFile)) {
    const host = (await RNFS.readFile(tunnelFile, 'utf8')).trim();
    if (host) {
      urls.push(`http://[${host}]:6125/command`);
    }
  }
  urls.push(`http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6125/command`, REDWALLET_LAN_BTC_COMMAND);
  return urls;
}

export function resolveRedWalletBtcResultUrls(): string[] {
  if (isRedWalletAndroidLanMacEndpointsOnly()) {
    return [`http://127.0.0.1:6125/result`, REDWALLET_LAN_BTC_RESULT];
  }
  if (Platform.OS === 'android') {
    return [...REDWALLET_ANDROID_EMULATOR_BTC_RESULT_URLS];
  }
  return [`http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6125/result`, REDWALLET_LAN_BTC_RESULT];
}
