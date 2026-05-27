import { REDWALLET_USB_TUNNEL_MAC_IPV6 as GENERATED_USB_TUNNEL_MAC_IPV6 } from './redwalletUsbTunnel.generated';

/** Mac-side Core Device USB tunnel (::2 on Mac, phone uses ::1). Regenerated at bundle time. */
export const REDWALLET_USB_TUNNEL_MAC_IPV6 = GENERATED_USB_TUNNEL_MAC_IPV6;

export const REDWALLET_USB_TUNNEL_COLLECTOR_EVENTS = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6123/events`;
export const REDWALLET_USB_TUNNEL_COMMAND = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6124/command`;

/** Runtime file written by proof scripts via devicectl (optional). */
export const REDWALLET_USB_TUNNEL_HOST_FILE = 'redwallet-usb-tunnel-host.txt';
