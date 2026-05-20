import NativeBitAssetsWallet from '../codegen/NativeBitAssetsWallet';

export type Txid = string;

export type BitAssetsBalances = Record<string, number>;

export interface BitAssetsWalletQuicStatus {
  enabled: boolean;
  connected: boolean;
  last_message_unix_ms?: number | null;
  last_error?: string | null;
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
}

export class EmbeddedBitAssetsWalletClient implements BitAssetsWalletClient {
  async getNewAddress(): Promise<string> {
    return requireNative().getNewAddress();
  }

  async walletInfo(): Promise<BitAssetsWalletInfo> {
    return parseJson<BitAssetsWalletInfo>(await requireNative().walletInfo());
  }

  async sync(): Promise<BitAssetsWalletInfo> {
    return parseJson<BitAssetsWalletInfo>(await requireNative().sync());
  }

  async listUtxos(): Promise<BitAssetsUtxo[]> {
    const value = parseJson<BitAssetsUtxo[] | { confirmed?: BitAssetsUtxo[]; mempool?: BitAssetsUtxo[] }>(await requireNative().listUtxos());
    return Array.isArray(value) ? value : [...(value.confirmed ?? []), ...(value.mempool ?? [])];
  }

  async getBalance(assetId?: string): Promise<{ confirmed: number } | BitAssetsBalances> {
    return parseJson<{ confirmed: number } | BitAssetsBalances>(await requireNative().getBalance(assetId));
  }

  async transfer(params: TransferParams): Promise<Txid> {
    return parseTxid(await requireNative().transfer(JSON.stringify(params)));
  }

  async reserve(params: ReserveParams): Promise<Txid> {
    return parseTxid(await requireNative().reserve(JSON.stringify(params)));
  }

  async register(params: RegisterParams): Promise<Txid> {
    return parseTxid(await requireNative().register(JSON.stringify(params)));
  }

  async ammMint(params: AmmMintParams): Promise<Txid> {
    return parseTxid(await requireNative().ammMint(JSON.stringify(params)));
  }

  async ammSwap(params: AmmSwapParams): Promise<Txid> {
    return parseTxid(await requireNative().ammSwap(JSON.stringify(params)));
  }

  async ammBurn(params: AmmBurnParams): Promise<Txid> {
    return parseTxid(await requireNative().ammBurn(JSON.stringify(params)));
  }

  async dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<Txid> {
    return parseTxid(await requireNative().dutchAuctionCreate(JSON.stringify(params)));
  }

  async dutchAuctionBid(params: DutchAuctionBidParams): Promise<Txid> {
    return parseTxid(await requireNative().dutchAuctionBid(JSON.stringify(params)));
  }

  async dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<Txid> {
    return parseTxid(await requireNative().dutchAuctionCollect(JSON.stringify(params)));
  }
}

export class JsonRpcBitAssetsWalletClient implements BitAssetsWalletClient {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10000,
  ) {}

  getNewAddress(): Promise<string> {
    return this.rpc('bitassets_getnewaddress').then(result => requireString(result));
  }

  walletInfo(): Promise<BitAssetsWalletInfo> {
    return this.rpc('bitassets_walletinfo') as Promise<BitAssetsWalletInfo>;
  }

  sync(): Promise<BitAssetsWalletInfo> {
    return this.rpc('bitassets_sync') as Promise<BitAssetsWalletInfo>;
  }

  async listUtxos(): Promise<BitAssetsUtxo[]> {
    const value = await this.rpc('bitassets_listutxos');
    if (Array.isArray(value)) return value as BitAssetsUtxo[];
    const record = value as { confirmed?: BitAssetsUtxo[]; mempool?: BitAssetsUtxo[] };
    return [...(record.confirmed ?? []), ...(record.mempool ?? [])];
  }

  getBalance(assetId?: string): Promise<{ confirmed: number } | BitAssetsBalances> {
    return this.rpc('bitassets_getbalance', assetId ? [assetId] : []) as Promise<{ confirmed: number } | BitAssetsBalances>;
  }

  transfer(params: TransferParams): Promise<Txid> {
    return this.rpc('bitassets_transfer', [
      params.destinationAddress,
      params.assetId,
      params.amount,
      params.feeSats ?? 0,
      params.memo ?? null,
    ]).then(result => requireString(result));
  }

  reserve(params: ReserveParams): Promise<Txid> {
    return this.rpc('bitassets_reserve', [params.name, params.feeSats ?? 0]).then(result => requireString(result));
  }

  register(params: RegisterParams): Promise<Txid> {
    return this.rpc('bitassets_register', [params.name, params.initialSupply, params.bitassetData, params.feeSats ?? 0]).then(result =>
      requireString(result),
    );
  }

  ammMint(params: AmmMintParams): Promise<Txid> {
    return this.rpc('bitassets_amm_mint', [
      params.asset0,
      params.asset1,
      params.amount0,
      params.amount1,
      params.lpTokenMint,
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  ammSwap(params: AmmSwapParams): Promise<Txid> {
    return this.rpc('bitassets_amm_swap', [
      params.assetSpend,
      params.assetReceive,
      params.amountSpend,
      params.amountReceive,
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  ammBurn(params: AmmBurnParams): Promise<Txid> {
    return this.rpc('bitassets_amm_burn', [
      params.asset0,
      params.asset1,
      params.amount0,
      params.amount1,
      params.lpTokenBurn,
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<Txid> {
    return this.rpc('bitassets_dutch_auction_create', [
      {
        base_asset: params.baseAsset,
        quote_asset: params.quoteAsset,
        base_amount: params.baseAmount,
        start_price: params.startPrice,
        end_price: params.endPrice,
        duration: params.duration,
      },
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  dutchAuctionBid(params: DutchAuctionBidParams): Promise<Txid> {
    return this.rpc('bitassets_dutch_auction_bid', [
      params.auctionId,
      params.baseAsset,
      params.quoteAsset,
      params.bidSize,
      params.receiveQuantity,
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<Txid> {
    return this.rpc('bitassets_dutch_auction_collect', [
      params.auctionId,
      params.baseAsset,
      params.quoteAsset,
      params.amountBase,
      params.amountQuote,
      params.feeSats ?? 0,
    ]).then(result => requireString(result));
  }

  private async rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'redwallet-bitassets', method, params }),
        signal: controller.signal,
      });
      const envelope = await response.json();
      if (!response.ok || envelope.error) {
        throw new Error(envelope.error?.message ?? `HTTP ${response.status}`);
      }
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }
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

function parseTxid(value: string): Txid {
  try {
    const parsed = JSON.parse(value);
    return requireString(typeof parsed === 'string' ? parsed : parsed.txid);
  } catch {
    return requireString(value);
  }
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('expected non-empty string');
  }
  return value;
}
