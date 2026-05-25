import {
  AmmBurnParams,
  AmmMintParams,
  AmmSwapParams,
  EmbeddedBitAssetsWalletClient,
  BitAssetsWalletClient,
  BitAssetsWalletInfo,
  BitAssetsUtxo,
  DutchAuctionBidParams,
  DutchAuctionCollectParams,
  DutchAuctionCreateParams,
  RegisterParams,
  ReserveParams,
  TransferParams,
} from '../../blue_modules/BitAssetsWallet';
import { normalizeBitAssetsError, validateBitAssetsRpcUrl } from '../../blue_modules/BitAssetsWalletForms';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { LegacyWallet } from './legacy-wallet';
import { Transaction } from './types';

export class BitAssetsWallet extends LegacyWallet {
  static readonly type = 'bitassetsWallet';
  static readonly typeReadable = 'BitAssets';
  static readonly subtitleReadable = 'Drivechain';
  // @ts-ignore: override
  public readonly type = BitAssetsWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = BitAssetsWallet.typeReadable;

  preferredBalanceUnit = BitcoinUnit.SATS;
  chain = Chain.OFFCHAIN;
  _address: string | false = false;
  bitassetsRpcUrl = '';
  bitassetsInfo?: BitAssetsWalletInfo;
  bitassetsUtxos: BitAssetsUtxo[] = [];

  static fromJson(obj: string): BitAssetsWallet {
    const parsed = JSON.parse(obj);
    const wallet = new BitAssetsWallet();
    for (const key of Object.keys(parsed)) {
      if (key === 'bitassetsInfo' || key === 'bitassetsUtxos') continue;
      (wallet as unknown as Record<string, unknown>)[key] = parsed[key];
    }
    return wallet;
  }

  async init() {
    if (!this._address && this.secret.startsWith('bitassets://')) {
      this._address = this.secret.slice('bitassets://'.length);
    }
  }

  async generate(rpcUrl?: string): Promise<void> {
    this.bitassetsRpcUrl = validateBitAssetsRpcUrl(rpcUrl ?? this.bitassetsRpcUrl);
    await this.withBitAssetsEvent('generate', { rpcUrl: this.bitassetsRpcUrl }, async () => {
      const client = await this.getConfiguredClient();
      const address = await client.getNewAddress();
      this._address = address;
      this.secret = `bitassets://${address}`;
      return { address };
    });
  }

  getAddress(): string | false {
    return this._address;
  }

  getTransactions(): Transaction[] {
    return [];
  }

  allowOnchainAddress(): Promise<boolean> {
    return Promise.resolve(false);
  }

  allowReceive(): boolean {
    return true;
  }

  allowSend(): boolean {
    return true;
  }

  weOwnAddress(address: string): boolean {
    if (typeof address !== 'string') return false;
    const normalizedAddress = address.trim();
    if (normalizedAddress.length === 0) return false;
    if (this._address === normalizedAddress) return true;
    return this.bitassetsUtxos.some(utxo => utxo.address === normalizedAddress);
  }

  weOwnTransaction(): boolean {
    return false;
  }

  async fetchBalance(): Promise<void> {
    await this.withBitAssetsEvent('fetchBalance', {}, async () => {
      const info = await (await this.getConfiguredClient()).walletInfo();
      this.bitassetsInfo = info;
      this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
      this.unconfirmed_balance = 0;
      this._lastBalanceFetch = +new Date();
      return info;
    });
  }

  async fetchTransactions(): Promise<void> {
    await this.withBitAssetsEvent('fetchTransactions', {}, async () => {
      this.bitassetsUtxos = await (await this.getConfiguredClient()).listUtxos();
      this._lastTxFetch = +new Date();
      return { utxoCount: this.bitassetsUtxos.length };
    });
  }

  async syncBitAssets(): Promise<BitAssetsWalletInfo> {
    return this.withBitAssetsEvent('syncBitAssets', {}, async () => {
      const client = await this.getConfiguredClient();
      const info = await client.sync();
      this.bitassetsUtxos = await client.listUtxos();
      this.bitassetsInfo = info;
      this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
      this._lastBalanceFetch = +new Date();
      this._lastTxFetch = +new Date();
      return info;
    });
  }

  async transferBitAssets(params: TransferParams): Promise<string> {
    return this.withBitAssetsEvent('transferBitAssets', { assetId: params.assetId, amount: params.amount }, async () =>
      (await this.getConfiguredClient()).transfer(params),
    );
  }

  async reserveBitAsset(params: ReserveParams): Promise<string> {
    return this.withBitAssetsEvent('reserveBitAsset', { name: params.name }, async () => (await this.getConfiguredClient()).reserve(params));
  }

  async registerBitAsset(params: RegisterParams): Promise<string> {
    return this.withBitAssetsEvent('registerBitAsset', { name: params.name, initialSupply: params.initialSupply }, async () =>
      (await this.getConfiguredClient()).register(params),
    );
  }

  async ammMint(params: AmmMintParams): Promise<string> {
    return this.withBitAssetsEvent('ammMint', { asset0: params.asset0, asset1: params.asset1 }, async () =>
      (await this.getConfiguredClient()).ammMint(params),
    );
  }

  async ammSwap(params: AmmSwapParams): Promise<string> {
    return this.withBitAssetsEvent('ammSwap', { assetSpend: params.assetSpend, assetReceive: params.assetReceive }, async () =>
      (await this.getConfiguredClient()).ammSwap(params),
    );
  }

  async ammBurn(params: AmmBurnParams): Promise<string> {
    return this.withBitAssetsEvent('ammBurn', { asset0: params.asset0, asset1: params.asset1 }, async () =>
      (await this.getConfiguredClient()).ammBurn(params),
    );
  }

  async dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<string> {
    return this.withBitAssetsEvent('dutchAuctionCreate', { baseAsset: params.baseAsset, quoteAsset: params.quoteAsset }, async () =>
      (await this.getConfiguredClient()).dutchAuctionCreate(params),
    );
  }

  async dutchAuctionBid(params: DutchAuctionBidParams): Promise<string> {
    return this.withBitAssetsEvent('dutchAuctionBid', { auctionId: params.auctionId }, async () =>
      (await this.getConfiguredClient()).dutchAuctionBid(params),
    );
  }

  async dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<string> {
    return this.withBitAssetsEvent('dutchAuctionCollect', { auctionId: params.auctionId }, async () =>
      (await this.getConfiguredClient()).dutchAuctionCollect(params),
    );
  }

  /**
   * Purges the native embedded signer persistence (wallet files in app sandbox + seed from
   * Keychain/Keystore). Call this when deleting the BitAssets wallet entry so no orphan
   * signer state or seeds remain. Safe to call even if no native wallet was ever created.
   * Resolves write/sandbox issues for full lifecycle control of the signer.
   */
  async clearNativeSigner(): Promise<void> {
    const client = this.getClient();
    if (client.clear) {
      try {
        await client.clear();
      } catch (e) {
        if (__DEV__) {
          console.warn('[BitAssetsWallet] native clear failed (non-fatal)', normalizeBitAssetsError(e));
        }
      }
    }
  }

  private getClient(): BitAssetsWalletClient {
    return new EmbeddedBitAssetsWalletClient();
  }

  private async getConfiguredClient(): Promise<BitAssetsWalletClient> {
    const client = this.getClient();
    const rpcUrl = validateBitAssetsRpcUrl(this.bitassetsRpcUrl);
    if (client.configure) {
      await client.configure({ rpcUrl });
    }
    return client;
  }

  private async withBitAssetsEvent<T>(operation: string, fields: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    this.logBitAssetsEvent(operation, 'begin', fields);
    try {
      const result = await run();
      this.logBitAssetsEvent(operation, 'ok', this.resultFields(result));
      return result;
    } catch (error) {
      this.logBitAssetsEvent(operation, 'error', { error: normalizeBitAssetsError(error) });
      throw error;
    }
  }

  private logBitAssetsEvent(operation: string, status: string, fields: Record<string, unknown> = {}): void {
    const payload = {
      component: 'js.BitAssetsWallet',
      operation,
      status,
      walletID: this.getID?.(),
      address: this._address || undefined,
      rpcUrl: this.bitassetsRpcUrl || undefined,
      time: new Date().toISOString(),
      ...fields,
    };
    console.log(`REDWALLET_EVENT ${JSON.stringify(payload)}`);
  }

  private resultFields(result: unknown): Record<string, unknown> {
    if (typeof result === 'string') {
      return /^[0-9a-fA-F]{64}$/.test(result) ? { txid: result } : { resultBytes: result.length };
    }
    if (result && typeof result === 'object') {
      const maybeInfo = result as Partial<BitAssetsWalletInfo>;
      return {
        balanceAssetCount: maybeInfo.balances ? Object.keys(maybeInfo.balances).length : undefined,
        utxoCount: Array.isArray(result) ? result.length : this.bitassetsUtxos.length,
      };
    }
    return {};
  }
}

export function hasBitAssetsWallet(wallets: Array<{ type?: string }>): boolean {
  return wallets.some(wallet => wallet.type === BitAssetsWallet.type);
}
