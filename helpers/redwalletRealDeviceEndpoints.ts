/** Mac host on Core Device USB tunnel (ifconfig inet6 fd26:…::2). Phone reaches Mac at this address. */
export const REDWALLET_USB_TUNNEL_MAC_IPV6 = 'fd26:d730:42fb::2';

export const REDWALLET_USB_TUNNEL_COLLECTOR_EVENTS = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6123/events`;
export const REDWALLET_USB_TUNNEL_COMMAND = `http://[${REDWALLET_USB_TUNNEL_MAC_IPV6}]:6124/command`;
