import {
  EmbeddedBitAssetsWalletClient,
  BitAssetsWalletClient,
  BitAssetsWalletInfo,
  BitAssetsUtxo,
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
  bitassetsInfo?: BitAssetsWalletInfo;
  bitassetsUtxos: BitAssetsUtxo[] = [];

  async init() {
    if (!this._address && this.secret.startsWith('bitassets://')) {
      this._address = this.secret.slice('bitassets://'.length);
    }
  }

  async generate(): Promise<void> {
    const address = await this.getClient().getNewAddress();
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

  private getClient(): BitAssetsWalletClient {
    return new EmbeddedBitAssetsWalletClient();
  }
}
