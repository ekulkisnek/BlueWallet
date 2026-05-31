export interface LiquidWalletCreationParams {
  rpcUrl: string;
}

function isLocalLiquidRpcHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  // Core Device USB tunnel (Mac fd26:…::2, phone ::1)
  if (host.startsWith('fd') && host.includes(':')) return true;
  // Tailscale / CGNAT dev range (100.64.0.0/10)
  const tailscaleMatch = /^100\.(\d{1,3})\./.exec(host);
  if (tailscaleMatch) {
    const secondOctet = Number(tailscaleMatch[1]);
    if (Number.isInteger(secondOctet) && secondOctet >= 64 && secondOctet <= 127) return true;
  }
  const match = /^172\.(\d{1,2})\./.exec(host);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

export function validateLiquidRpcUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('Elements RPC URL is required for Liquid wallet.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Elements RPC URL must be a valid http(s) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Elements RPC URL must use http or https.');
  }

  if (!parsed.hostname) {
    throw new Error('Elements RPC URL must include a host.');
  }

  if (parsed.protocol === 'http:' && !isLocalLiquidRpcHost(parsed.hostname)) {
    throw new Error('Elements RPC URL must use HTTPS unless it points to a local or private development host.');
  }

  return trimmed;
}

export function redactSensitiveLiquidDetails(message: string): string {
  return message
    .replace(/("(?:seed_hex|seedHex|blinding|blinder)"\s*:\s*")([0-9a-f]{64,}?)(")/gi, '$1[redacted]$3')
    .replace(/((?:seed_hex|seedHex|blinding|blinder)\s*[:=]\s*)([0-9a-f]{64,})/gi, '$1[redacted]')
    .replace(/\b[0-9a-f]{64,}\b/gi, '[redacted-secret]');
}

export function sanitizeRpcUrlForLog(rpcUrl: string): string {
  try {
    const u = new URL(rpcUrl);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
      return u.toString().replace(/:\/\/\*\*\*:\*\*\*@/, '://***@');
    }
    return rpcUrl;
  } catch {
    return rpcUrl.replace(/:\/\/[^@]+@/, '://***@');
  }
}

export function normalizeLiquidError(error: unknown): string {
  let raw = error instanceof Error ? error.message : String(error);
  // Unwrap common RN/native bridge and grok error envelopes so users never see raw JSON or code prefixes
  raw = raw.replace(/^(?:LIQUID_WALLET_(?:ERROR|CONFIG_ERROR)|Error|NativeModules?Error|RCTNativeModuleError)[:\s]*/i, '');
  // If the error payload is JSON (e.g. from bridge or RPC), extract a human message
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      raw = parsed.message || parsed.error?.message || parsed.error || raw;
      if (typeof raw !== 'string') raw = JSON.stringify(raw);
    }
  } catch {
    // not JSON, keep raw
  }
  // Handle RN error objects and userInfo shapes from native
  if (error && typeof error === 'object') {
    const anyErr = error as any;
    if (anyErr.message && typeof anyErr.message === 'string') raw = anyErr.message;
    if (anyErr.userInfo?.message) raw = anyErr.userInfo.message;
    if (anyErr.code && typeof anyErr.code === 'string' && !raw.includes(anyErr.code)) {
      raw = `${raw} [${anyErr.code}]`;
    }
  }
  const message = redactSensitiveLiquidDetails(raw);
  if (/fee[_ ]?sats|nonzero fee/i.test(message)) {
    return 'Liquid constructors currently support fee_sats = 0 only for MVP.';
  }
  if (
    /network request failed|failed to fetch|abort|connection refused|connect.*failed|econn|unreachable|timeout|could not (connect|reach)|rpc.*(error|fail)|native.*(error|fail)|elementsd|signet/i.test(
      message,
    )
  ) {
    return 'Could not reach the Elements RPC endpoint. Check the RPC URL and local regtest/signet elementsd.';
  }
  if (/not enough funds|insufficient/i.test(message)) {
    return 'Not enough L-BTC (or asset) funds for this operation.';
  }
  if (/stale|resync|tip height|partially synced/i.test(message)) {
    return 'Liquid wallet state is stale. Sync again before creating a transaction.';
  }
  return message || 'Unknown error';
}

export function normalizeLiquidRpcUrlForRuntime(rpcUrl: string): string {
  // Runtime normalization (loopback -> canonical LAN) is handled in liquid-wallet.ts using redwalletRealDevice* helpers.
  // This is a pass-through validate for direct callers (e.g. Add.tsx forms).
  return validateLiquidRpcUrl(rpcUrl);
}
