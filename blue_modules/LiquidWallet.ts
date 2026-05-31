/* eslint-disable @typescript-eslint/no-use-before-define */
import NativeLiquidWallet from '../codegen/NativeLiquidWallet';

export type Txid = string;

export type LiquidBalances = Record<string, number>;

export interface LiquidWalletConfig {
  elementsRpcUrl: string;
  // Future: lite-wallet quic url etc for Liquid (analog to BitAssets)
}

export interface LiquidWalletInfo {
  enabled: boolean;
  address?: string;
  balances: LiquidBalances;
  sidechainHeight?: number;
  last_tip_hash?: string | null;
  last_tip_height?: number | null;
  confirmed_utxo_count?: number;
  mempool_utxo_count?: number;
  confirmedUtxoCount?: number;
  mempoolUtxoCount?: number;
}

export interface LiquidUtxo {
  txid: string;
  vout: number;
  address?: string;
  assetId?: string;
  asset_id?: string;
  amount?: number;
  confidential?: boolean;
  confirmed?: boolean;
}

export interface TransferParams {
  destinationAddress: string;
  amount: number;
  assetId?: string; // 'bitcoin' or asset hex for L-BTC primary
  feeSats?: number;
  memo?: string;
}

export interface PegInParams {
  mainchainTxid?: string;
  mainchainVout?: number;
  amount?: number;
  claimAddress?: string;
  feeSats?: number;
}

export interface PegOutParams {
  destinationMainchainAddress: string;
  amount: number;
  feeSats?: number;
  memo?: string;
}

export interface LiquidWalletClient {
  configure?(params: LiquidWalletConfig): Promise<void>;
  getNewAddress(): Promise<string>;
  walletInfo(): Promise<LiquidWalletInfo>;
  sync(): Promise<LiquidWalletInfo>;
  listUtxos(): Promise<LiquidUtxo[]>;
  getBalance(assetId?: string): Promise<{ confirmed: number } | LiquidBalances>;
  transfer(params: TransferParams): Promise<Txid>;
  preparePegIn?(params: PegInParams): Promise<string>;
  preparePegOut?(params: PegOutParams): Promise<string>;
  clear?(): Promise<void>;
}

export class EmbeddedLiquidWalletClient implements LiquidWalletClient {
  private readonly timeoutMs = 45000;

  async configure(params: LiquidWalletConfig): Promise<void> {
    await withNativeTimeout(requireNative().configure(JSON.stringify(params)), 'configure', this.timeoutMs);
  }

  async getNewAddress(): Promise<string> {
    return withNativeTimeout(requireNative().getNewAddress(), 'getNewAddress', this.timeoutMs);
  }

  async walletInfo(): Promise<LiquidWalletInfo> {
    return parseJson<LiquidWalletInfo>(await withNativeTimeout(requireNative().walletInfo(), 'walletInfo', this.timeoutMs));
  }

  async sync(): Promise<LiquidWalletInfo> {
    return parseJson<LiquidWalletInfo>(await withNativeTimeout(requireNative().sync(), 'sync', this.timeoutMs));
  }

  async listUtxos(): Promise<LiquidUtxo[]> {
    const value = parseJson<LiquidUtxo[] | { confirmed?: LiquidUtxo[]; mempool?: LiquidUtxo[] }>(
      await withNativeTimeout(requireNative().listUtxos(), 'listUtxos', this.timeoutMs),
    );
    const raw = Array.isArray(value) ? value : [...(value.confirmed ?? []), ...(value.mempool ?? [])];
    return raw.map((u: any) => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      assetId: u.assetId ?? u.asset_id ?? u.asset ?? 'bitcoin',
      amount: u.amount,
      confidential: u.confidential,
      confirmed: u.confirmed,
    }));
  }

  async getBalance(assetId?: string): Promise<{ confirmed: number } | LiquidBalances> {
    return parseJson<{ confirmed: number } | LiquidBalances>(
      await withNativeTimeout(requireNative().getBalance(assetId), 'getBalance', this.timeoutMs),
    );
  }

  async transfer(params: TransferParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().transfer(JSON.stringify(params)), 'transfer', this.timeoutMs));
  }

  async preparePegIn(params: PegInParams): Promise<string> {
    return parseJsonOrString(await withNativeTimeout(requireNative().preparePegIn(JSON.stringify(params)), 'preparePegIn', this.timeoutMs));
  }

  async preparePegOut(params: PegOutParams): Promise<string> {
    return parseJsonOrString(await withNativeTimeout(requireNative().preparePegOut(JSON.stringify(params)), 'preparePegOut', this.timeoutMs));
  }

  async clear(): Promise<void> {
    await withNativeTimeout(requireNative().clear(), 'clear', this.timeoutMs);
  }
}

function withNativeTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Liquid native wallet ${operation} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class JsonRpcLiquidWalletClient implements LiquidWalletClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private authHeader: string = '';

  constructor(url: string, timeoutMs = 10000) {
    this.url = url.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    if (this.url.includes('@')) {
      const match = this.url.match(/:\/\/([^@]+)@/);
      if (match) {
        this.authHeader = 'Basic ' + btoa(match[1]);
      }
    }
  }

  configure(): Promise<void> {
    return Promise.resolve();
  }

  private async rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        accept: 'application/json',
      };
      if (this.authHeader) headers['Authorization'] = this.authHeader;

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '1.0',
          id: 'redwallet-liquid',
          method,
          params,
        }),
        signal: controller.signal,
      });
      const json = await response.json();
      if (!response.ok || json.error) {
        throw new Error(json.error?.message ?? `HTTP ${response.status}`);
      }
      return json.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getNewAddress(): Promise<string> {
    // Confidential bech32 address on Elements/Liquid
    return this.rpc('getnewaddress', ['', 'bech32']).then(result => requireString(result));
  }

  async walletInfo(): Promise<LiquidWalletInfo> {
    const [balance, blockchainInfo] = await Promise.all([
      this.rpc('getbalance').catch(() => ({})),
      this.rpc('getblockchaininfo').catch(() => ({})),
    ]);

    const balances: LiquidBalances = {};
    if (typeof balance === 'number') {
      balances['bitcoin'] = balance;
    } else if (balance && typeof balance === 'object') {
      Object.assign(balances, balance);
    }

    return {
      enabled: true,
      balances,
      sidechainHeight: (blockchainInfo as any)?.blocks ?? null,
    };
  }

  async sync(): Promise<LiquidWalletInfo> {
    return this.walletInfo();
  }

  async listUtxos(): Promise<LiquidUtxo[]> {
    const utxos = (await this.rpc('listunspent', [0, 9999999]).catch(() => [])) as any[];
    return (utxos || []).map((u: any) => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      assetId: u.asset ?? 'bitcoin',
      amount: u.amount,
      confidential: !!u.amountblinder,
      confirmed: (u.confirmations ?? 0) > 0,
    }));
  }

  async getBalance(assetId?: string): Promise<{ confirmed: number } | LiquidBalances> {
    const info = await this.walletInfo();
    if (assetId) {
      return { confirmed: info.balances[assetId] ?? 0 };
    }
    return info.balances;
  }

  async transfer(params: TransferParams): Promise<Txid> {
    const { destinationAddress, amount, assetId = 'bitcoin', feeSats } = params;
    const txid = await this.rpc('sendtoaddress', [
      destinationAddress,
      amount,
      params.memo ?? '',
      '',
      false,
      false,
      1,
      'unset',
      false,
      assetId === 'bitcoin' ? '' : assetId,
    ]);
    return parseTxid(txid);
  }

  async preparePegIn(params: PegInParams): Promise<string> {
    // In JsonRpc fallback (dev), return a skeleton; full in native Rust path
    throw new Error('preparePegIn not supported in JsonRpc fallback client; use native EmbeddedLiquidWalletClient');
  }

  async preparePegOut(params: PegOutParams): Promise<string> {
    throw new Error('preparePegOut not supported in JsonRpc fallback client; use native EmbeddedLiquidWalletClient');
  }

  async clear(): Promise<void> {
    // no-op for pure jsonrpc client
  }
}

export const deriveLiquidLiteWalletQuicUrl = (rpcUrl: string): string | undefined => {
  // TODO: implement once Liquid has equivalent lite-wallet QUIC updates (parallel to BitAssets)
  return undefined;
};

function requireNative() {
  if (!NativeLiquidWallet) {
    throw new Error('Embedded Liquid wallet native module is not available');
  }
  return NativeLiquidWallet;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseTxid(value: unknown): Txid {
  let txid: string;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      txid = requireString(typeof parsed === 'string' ? parsed : (parsed as any).txid);
    } catch {
      txid = requireString(value);
    }
  } else {
    const record = value as { txid?: unknown };
    txid = requireString(record?.txid ?? value);
  }
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    throw new Error('expected 64-character hex txid');
  }
  return txid;
}

function parseJsonOrString(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const p = JSON.parse(value);
      return typeof p === 'string' ? p : JSON.stringify(p);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('expected non-empty string');
  }
  return value;
}
