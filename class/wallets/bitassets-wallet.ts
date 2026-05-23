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

  async init() {
    if (!this._address && this.secret.startsWith('bitassets://')) {
      this._address = this.secret.slice('bitassets://'.length);
    }
  }

  async generate(rpcUrl?: string): Promise<void> {
    this.bitassetsRpcUrl = validateBitAssetsRpcUrl(rpcUrl ?? this.bitassetsRpcUrl);
    const client = await this.getConfiguredClient();
    const address = await client.getNewAddress();
    this._address = address;
    this.secret = `bitassets://${address}`;
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
    const info = await (await this.getConfiguredClient()).walletInfo();
    this.bitassetsInfo = info;
    this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
    this.unconfirmed_balance = 0;
    this._lastBalanceFetch = +new Date();
  }

  async fetchTransactions(): Promise<void> {
    this.bitassetsUtxos = await (await this.getConfiguredClient()).listUtxos();
    this._lastTxFetch = +new Date();
  }

  async syncBitAssets(): Promise<BitAssetsWalletInfo> {
    const client = await this.getConfiguredClient();
    const info = await client.sync();
    this.bitassetsUtxos = await client.listUtxos();
    this.bitassetsInfo = info;
    this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
    this._lastBalanceFetch = +new Date();
    this._lastTxFetch = +new Date();
    return info;
  }

  async transferBitAssets(params: TransferParams): Promise<string> {
    return (await this.getConfiguredClient()).transfer(params);
  }

  async reserveBitAsset(params: ReserveParams): Promise<string> {
    return (await this.getConfiguredClient()).reserve(params);
  }

  async registerBitAsset(params: RegisterParams): Promise<string> {
    return (await this.getConfiguredClient()).register(params);
  }

  async ammMint(params: AmmMintParams): Promise<string> {
    return (await this.getConfiguredClient()).ammMint(params);
  }

  async ammSwap(params: AmmSwapParams): Promise<string> {
    return (await this.getConfiguredClient()).ammSwap(params);
  }

  async ammBurn(params: AmmBurnParams): Promise<string> {
    return (await this.getConfiguredClient()).ammBurn(params);
  }

  async dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<string> {
    return (await this.getConfiguredClient()).dutchAuctionCreate(params);
  }

  async dutchAuctionBid(params: DutchAuctionBidParams): Promise<string> {
    return (await this.getConfiguredClient()).dutchAuctionBid(params);
  }

  async dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<string> {
    return (await this.getConfiguredClient()).dutchAuctionCollect(params);
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
}

export function hasBitAssetsWallet(wallets: Array<{ type?: string }>): boolean {
  return wallets.some(wallet => wallet.type === BitAssetsWallet.type);
}
