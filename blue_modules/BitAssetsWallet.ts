/* eslint-disable @typescript-eslint/no-use-before-define */
import NativeBitAssetsWallet from '../codegen/NativeBitAssetsWallet';

export type Txid = string;

export type BitAssetsBalances = Record<string, number>;

export interface BitAssetsWalletQuicStatus {
  enabled: boolean;
  connected: boolean;
  last_message_unix_ms?: number | null;
  last_error?: string | null;
}

export interface BitAssetsChainInfo {
  sidechain_height: number | null;
  mainchain_hash: string | null;
  sidechain_hash: string | null;
  peer_count: number;
}

export interface BitAssetsWalletInfo {
  enabled: boolean;
  address_count: number;
  confirmed_utxo_count: number;
  mempool_utxo_count: number;
  balances: BitAssetsBalances;
  last_tip_hash?: string | null;
  last_tip_height?: number | null;
  quic?: BitAssetsWalletQuicStatus;
}

export interface BitAssetsUtxo {
  outpoint?: { txid?: string; vout?: number };
  txid?: string;
  vout?: number;
  address?: string;
  asset_id?: string;
  amount?: number;
  content_kind?: string;
  confirmed?: boolean;
  utreexo_leaf_hash?: string;
  proof_refs?: Array<{
    block_hash?: string | null;
    sidechain_block_height?: number;
    bmm_inclusions?: string[];
    best_main_verification?: string;
  }>;
}

export interface BitAssetsProofSummary {
  confirmed: number;
  proofBacked: number;
  missingProofs: number;
  label: string;
}

export function isProofBackedBitAssetsUtxo(utxo: BitAssetsUtxo): boolean {
  return (
    utxo.confirmed !== false &&
    typeof utxo.utreexo_leaf_hash === 'string' &&
    utxo.utreexo_leaf_hash.length > 0 &&
    Array.isArray(utxo.proof_refs) &&
    utxo.proof_refs.length > 0 &&
    utxo.proof_refs.every(
      proof =>
        typeof proof.sidechain_block_height === 'number' &&
        Array.isArray(proof.bmm_inclusions) &&
        proof.bmm_inclusions.length > 0 &&
        typeof proof.best_main_verification === 'string' &&
        proof.best_main_verification.length > 0,
    )
  );
}

export function summarizeBitAssetsProofState(utxos: BitAssetsUtxo[]): BitAssetsProofSummary {
  const confirmed = utxos.filter(utxo => utxo.confirmed !== false).length;
  const proofBacked = utxos.filter(isProofBackedBitAssetsUtxo).length;
  const missingProofs = Math.max(confirmed - proofBacked, 0);
  return {
    confirmed,
    proofBacked,
    missingProofs,
    label:
      confirmed === 0
        ? 'No confirmed UTXOs'
        : missingProofs > 0
          ? `${proofBacked}/${confirmed} proof-backed; sync incomplete`
          : `${proofBacked}/${confirmed} proof-backed`,
  };
}

export interface TransferParams {
  destinationAddress: string;
  assetId: string;
  amount: number;
  feeSats?: number;
  memo?: string;
}

export interface ReserveParams {
  name: string;
  feeSats?: number;
}

export interface RegisterParams {
  name: string;
  initialSupply: number;
  bitassetData: unknown;
  feeSats?: number;
}

export interface AmmMintParams {
  asset0: string;
  asset1: string;
  amount0: number;
  amount1: number;
  lpTokenMint: number;
  feeSats?: number;
}

export interface AmmSwapParams {
  assetSpend: string;
  assetReceive: string;
  amountSpend: number;
  amountReceive: number;
  feeSats?: number;
}

export interface AmmBurnParams {
  asset0: string;
  asset1: string;
  amount0: number;
  amount1: number;
  lpTokenBurn: number;
  feeSats?: number;
}

export interface DutchAuctionCreateParams {
  baseAsset: string;
  quoteAsset: string;
  baseAmount: number;
  startPrice: number;
  endPrice: number;
  duration: number;
  feeSats?: number;
}

export interface DutchAuctionBidParams {
  auctionId: string;
  baseAsset: string;
  quoteAsset: string;
  bidSize: number;
  receiveQuantity: number;
  feeSats?: number;
}

export interface DutchAuctionCollectParams {
  auctionId: string;
  baseAsset: string;
  quoteAsset: string;
  amountBase: number;
  amountQuote: number;
  feeSats?: number;
}

export interface BitAssetsWalletClient {
  configure?(params: BitAssetsWalletConfig): Promise<void>;
  getNewAddress(): Promise<string>;
  walletInfo(): Promise<BitAssetsWalletInfo>;
  sync(): Promise<BitAssetsWalletInfo>;
  listUtxos(): Promise<BitAssetsUtxo[]>;
  getBalance(assetId?: string): Promise<{ confirmed: number } | BitAssetsBalances>;
  transfer(params: TransferParams): Promise<Txid>;
  reserve(params: ReserveParams): Promise<Txid>;
  register(params: RegisterParams): Promise<Txid>;
  ammMint(params: AmmMintParams): Promise<Txid>;
  ammSwap(params: AmmSwapParams): Promise<Txid>;
  ammBurn(params: AmmBurnParams): Promise<Txid>;
  dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<Txid>;
  dutchAuctionBid(params: DutchAuctionBidParams): Promise<Txid>;
  dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<Txid>;
  clear?(): Promise<void>;
}

export interface BitAssetsWalletConfig {
  rpcUrl: string;
  bitassetsLiteWalletQuicUrl?: string;
  seedHex?: string;
}

export function deriveBitAssetsLiteWalletQuicUrl(rpcUrl: string): string | undefined {
  try {
    const parsed = new URL(rpcUrl);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    if (!parsed.hostname || !Number.isInteger(port)) return undefined;
    return `${parsed.hostname}:${port + 100}`;
  } catch {
    return undefined;
  }
}

export class EmbeddedBitAssetsWalletClient implements BitAssetsWalletClient {
  private readonly timeoutMs = 45000;

  async configure(params: BitAssetsWalletConfig): Promise<void> {
    await withNativeTimeout(requireNative().configure(JSON.stringify(params)), 'configure', this.timeoutMs);
  }

  async getNewAddress(): Promise<string> {
    return withNativeTimeout(requireNative().getNewAddress(), 'getNewAddress', this.timeoutMs);
  }

  async walletInfo(): Promise<BitAssetsWalletInfo> {
    return parseJson<BitAssetsWalletInfo>(await withNativeTimeout(requireNative().walletInfo(), 'walletInfo', this.timeoutMs));
  }

  async sync(): Promise<BitAssetsWalletInfo> {
    return parseJson<BitAssetsWalletInfo>(await withNativeTimeout(requireNative().sync(), 'sync', this.timeoutMs));
  }

  async listUtxos(): Promise<BitAssetsUtxo[]> {
    const value = parseJson<BitAssetsUtxo[] | { confirmed?: BitAssetsUtxo[]; mempool?: BitAssetsUtxo[] }>(
      await withNativeTimeout(requireNative().listUtxos(), 'listUtxos', this.timeoutMs),
    );
    return Array.isArray(value) ? value : [...(value.confirmed ?? []), ...(value.mempool ?? [])];
  }

  async getBalance(assetId?: string): Promise<{ confirmed: number } | BitAssetsBalances> {
    return parseJson<{ confirmed: number } | BitAssetsBalances>(
      await withNativeTimeout(requireNative().getBalance(assetId), 'getBalance', this.timeoutMs),
    );
  }

  async transfer(params: TransferParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().transfer(JSON.stringify(params)), 'transfer', this.timeoutMs));
  }

  async reserve(params: ReserveParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().reserve(JSON.stringify(params)), 'reserve', this.timeoutMs));
  }

  async register(params: RegisterParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().register(JSON.stringify(params)), 'register', this.timeoutMs));
  }

  async ammMint(params: AmmMintParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().ammMint(JSON.stringify(params)), 'ammMint', this.timeoutMs));
  }

  async ammSwap(params: AmmSwapParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().ammSwap(JSON.stringify(params)), 'ammSwap', this.timeoutMs));
  }

  async ammBurn(params: AmmBurnParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().ammBurn(JSON.stringify(params)), 'ammBurn', this.timeoutMs));
  }

  async dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<Txid> {
    return parseTxid(
      await withNativeTimeout(requireNative().dutchAuctionCreate(JSON.stringify(params)), 'dutchAuctionCreate', this.timeoutMs),
    );
  }

  async dutchAuctionBid(params: DutchAuctionBidParams): Promise<Txid> {
    return parseTxid(await withNativeTimeout(requireNative().dutchAuctionBid(JSON.stringify(params)), 'dutchAuctionBid', this.timeoutMs));
  }

  async dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<Txid> {
    return parseTxid(
      await withNativeTimeout(requireNative().dutchAuctionCollect(JSON.stringify(params)), 'dutchAuctionCollect', this.timeoutMs),
    );
  }

  async clear(): Promise<void> {
    await withNativeTimeout(requireNative().clear(), 'clear', this.timeoutMs);
  }
}

function withNativeTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`BitAssets native wallet ${operation} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function fetchBitAssetsChainInfo(rpcUrl: string, timeoutMs = 8000): Promise<BitAssetsChainInfo> {
  const call = async (method: string): Promise<unknown> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'chain-info', method, params: [] }),
        signal: controller.signal,
      });
      const env = await r.json();
      if (env.error) throw new Error(env.error.message);
      return env.result;
    } finally {
      clearTimeout(t);
    }
  };

  const [blockcount, mainHash, sideHash, peers] = await Promise.allSettled([
    call('getblockcount'),
    call('get_best_mainchain_block_hash'),
    call('get_best_sidechain_block_hash'),
    call('list_peers'),
  ]);

  return {
    sidechain_height: blockcount.status === 'fulfilled' ? Number(blockcount.value) : null,
    mainchain_hash: mainHash.status === 'fulfilled' && typeof mainHash.value === 'string' ? mainHash.value : null,
    sidechain_hash: sideHash.status === 'fulfilled' && typeof sideHash.value === 'string' ? sideHash.value : null,
    peer_count: peers.status === 'fulfilled' && Array.isArray(peers.value) ? peers.value.length : 0,
  };
}

function requireNative() {
  if (!NativeBitAssetsWallet) {
    throw new Error('Embedded BitAssets wallet native module is not available');
  }
  return NativeBitAssetsWallet;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseTxid(value: unknown): Txid {
  let txid: string;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      txid = requireString(typeof parsed === 'string' ? parsed : parsed.txid);
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

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('expected non-empty string');
  }
  return value;
}
