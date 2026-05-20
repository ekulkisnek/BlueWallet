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
    if (rpcUrl) {
      this.bitassetsRpcUrl = rpcUrl;
    }
    const client = this.getClient();
    if (client.configure && this.bitassetsRpcUrl) {
      await client.configure({ rpcUrl: this.bitassetsRpcUrl });
    }
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
    return this._address === address;
  }

  weOwnTransaction(): boolean {
    return false;
  }

  async fetchBalance(): Promise<void> {
    const info = await this.getClient().walletInfo();
    this.bitassetsInfo = info;
    this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
    this.unconfirmed_balance = 0;
    this._lastBalanceFetch = +new Date();
  }

  async fetchTransactions(): Promise<void> {
    this.bitassetsUtxos = await this.getClient().listUtxos();
    this._lastTxFetch = +new Date();
  }

  async syncBitAssets(): Promise<BitAssetsWalletInfo> {
    const info = await this.getClient().sync();
    this.bitassetsInfo = info;
    this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
    this._lastBalanceFetch = +new Date();
    return info;
  }

  transferBitAssets(params: TransferParams): Promise<string> {
    return this.getClient().transfer(params);
  }

  reserveBitAsset(params: ReserveParams): Promise<string> {
    return this.getClient().reserve(params);
  }

  registerBitAsset(params: RegisterParams): Promise<string> {
    return this.getClient().register(params);
  }

  ammMint(params: AmmMintParams): Promise<string> {
    return this.getClient().ammMint(params);
  }

  ammSwap(params: AmmSwapParams): Promise<string> {
    return this.getClient().ammSwap(params);
  }

  ammBurn(params: AmmBurnParams): Promise<string> {
    return this.getClient().ammBurn(params);
  }

  dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<string> {
    return this.getClient().dutchAuctionCreate(params);
  }

  dutchAuctionBid(params: DutchAuctionBidParams): Promise<string> {
    return this.getClient().dutchAuctionBid(params);
  }

  dutchAuctionCollect(params: DutchAuctionCollectParams): Promise<string> {
    return this.getClient().dutchAuctionCollect(params);
  }

  private getClient(): BitAssetsWalletClient {
    return new EmbeddedBitAssetsWalletClient();
  }
}
