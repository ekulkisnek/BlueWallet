import {
  EmbeddedLiquidWalletClient,
  LiquidWalletClient,
  LiquidWalletInfo,
  LiquidUtxo,
  TransferParams,
} from '../../blue_modules/LiquidWallet';
import { normalizeLiquidError, validateLiquidRpcUrl } from '../../blue_modules/LiquidWalletForms';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { LegacyWallet } from './legacy-wallet';
import { Transaction } from './types';
import { Platform } from 'react-native';
import { isEmulatorSync } from 'react-native-device-info';
import { isRedWalletCoreDeviceUsbTunnelHost } from '../../helpers/redwalletRealDeviceEndpoints';
import {
  canonicalLiquidRpcUrlForRuntime,
  isRedWalletAndroidLanMacEndpointsOnly,
  isRedWalletAndroidPhysicalDevice,
  isRedWalletIosPhysicalDevice,
  isRedWalletRealDeviceProofEnabled,
} from '../../helpers/redwalletRealDeviceProof';

function isLoopbackLiquidHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function isLoopbackLiquidRpcUrl(rpcUrl: string): boolean {
  if (!rpcUrl.trim()) return true;
  try {
    return isLoopbackLiquidHost(new URL(validateLiquidRpcUrl(rpcUrl)).hostname);
  } catch {
    return true;
  }
}

function isUsbTunnelLiquidRpcUrl(rpcUrl: string): boolean {
  if (!rpcUrl.trim()) return false;
  try {
    return isRedWalletCoreDeviceUsbTunnelHost(new URL(validateLiquidRpcUrl(rpcUrl)).hostname);
  } catch {
    return false;
  }
}

function isEmulatorLoopbackLiquidRpcUrl(rpcUrl: string): boolean {
  if (Platform.OS !== 'android' || !isRedWalletAndroidPhysicalDevice()) return false;
  try {
    return new URL(validateLiquidRpcUrl(rpcUrl)).hostname === '10.0.2.2';
  } catch {
    return false;
  }
}

function shouldUseCanonicalLiquidEndpoints(): boolean {
  if (Platform.OS === 'android') {
    return isRedWalletAndroidPhysicalDevice();
  }
  if (Platform.OS !== 'ios') return false;
  try {
    if (isEmulatorSync()) return false;
  } catch {
    return isRedWalletIosPhysicalDevice();
  }
  // Embedded main.jsbundle is built with --dev false; physical iPhones must never keep loopback RPC.
  return isRedWalletIosPhysicalDevice() || isRedWalletRealDeviceProofEnabled() || __DEV__;
}

function isPhysicalDeviceForLiquid(): boolean {
  if (Platform.OS === 'android') {
    return isRedWalletAndroidPhysicalDevice();
  }
  if (Platform.OS !== 'ios') return false;
  // main.jsbundle is built with --dev false; __DEV__ is false on real devices using embedded bundle.
  if (!__DEV__) return true;
  try {
    return !isEmulatorSync();
  } catch {
    // Device-info can fail on some CoreDevice builds; prefer LAN over loopback.
    return true;
  }
}

export function normalizeLiquidRpcUrlForRuntime(rpcUrl: string): string {
  if (
    isPhysicalDeviceForLiquid() &&
    (!rpcUrl.trim() ||
      isLoopbackLiquidRpcUrl(rpcUrl) ||
      isEmulatorLoopbackLiquidRpcUrl(rpcUrl) ||
      (isRedWalletAndroidLanMacEndpointsOnly() && isUsbTunnelLiquidRpcUrl(rpcUrl)))
  ) {
    return canonicalLiquidRpcUrlForRuntime();
  }
  if (!shouldUseCanonicalLiquidEndpoints()) {
    return validateLiquidRpcUrl(rpcUrl);
  }
  if (
    !rpcUrl.trim() ||
    isLoopbackLiquidRpcUrl(rpcUrl) ||
    (isRedWalletAndroidLanMacEndpointsOnly() && isUsbTunnelLiquidRpcUrl(rpcUrl))
  ) {
    return canonicalLiquidRpcUrlForRuntime();
  }
  return validateLiquidRpcUrl(rpcUrl);
}

export class LiquidWallet extends LegacyWallet {
  static readonly type = 'liquidWallet';
  static readonly typeReadable = 'Liquid (L-BTC)';
  static readonly subtitleReadable = 'Sidechain';
  // @ts-ignore: override
  public readonly type = LiquidWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = LiquidWallet.typeReadable;

  preferredBalanceUnit = BitcoinUnit.SATS;
  chain = Chain.OFFCHAIN;
  _address: string | false = false;
  elementsRpcUrl = '';
  liquidInfo?: LiquidWalletInfo;
  liquidUtxos: LiquidUtxo[] = [];

  static fromJson(obj: string): LiquidWallet {
    const parsed = JSON.parse(obj);
    const wallet = new LiquidWallet();
    for (const key of Object.keys(parsed)) {
      if (key === 'liquidInfo' || key === 'liquidUtxos') continue;
      (wallet as unknown as Record<string, unknown>)[key] = parsed[key];
    }
    return wallet;
  }

  async init() {
    if (!this._address && this.secret.startsWith('liquid://')) {
      this._address = this.secret.slice('liquid://'.length);
    }
    if (shouldUseCanonicalLiquidEndpoints() && this.elementsRpcUrl) {
      this.elementsRpcUrl = normalizeLiquidRpcUrlForRuntime(this.elementsRpcUrl);
    }
  }

  async generate(rpcUrl?: string): Promise<void> {
    this.elementsRpcUrl = normalizeLiquidRpcUrlForRuntime(validateLiquidRpcUrl(rpcUrl ?? this.elementsRpcUrl));
    await this.withLiquidEvent('generate', { rpcUrl: this.elementsRpcUrl }, async () => {
      const client = await this.getConfiguredClient();
      const address = await client.getNewAddress();
      this._address = address;
      this.secret = `liquid://${address}`;
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
    return this.liquidUtxos.some(utxo => utxo.address === normalizedAddress);
  }

  weOwnTransaction(): boolean {
    return false;
  }

  async fetchBalance(): Promise<void> {
    await this.withLiquidEvent('fetchBalance', {}, async () => {
      const info = await (await this.getConfiguredClient()).walletInfo();
      this.liquidInfo = info;
      this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
      this.unconfirmed_balance = 0;
      this._lastBalanceFetch = +new Date();
      return info;
    });
  }

  async fetchTransactions(): Promise<void> {
    await this.withLiquidEvent('fetchTransactions', {}, async () => {
      this.liquidUtxos = await (await this.getConfiguredClient()).listUtxos();
      this._lastTxFetch = +new Date();
      return { utxoCount: this.liquidUtxos.length };
    });
  }

  async syncLiquid(): Promise<LiquidWalletInfo> {
    return this.withLiquidEvent('syncLiquid', {}, async () => {
      const client = await this.getConfiguredClient();
      const info = await client.sync();
      this.liquidUtxos = await client.listUtxos();
      this.liquidInfo = info;
      this.balance = Object.values(info.balances ?? {}).reduce((sum, amount) => sum + amount, 0);
      this._lastBalanceFetch = +new Date();
      this._lastTxFetch = +new Date();
      return info;
    });
  }

  async transferLiquid(params: TransferParams): Promise<string> {
    return this.withLiquidEvent('transferLiquid', { assetId: params.assetId, amount: params.amount }, async () =>
      (await this.getConfiguredClient()).transfer(params),
    );
  }

  /**
   * Purges the native embedded signer persistence (wallet files in app sandbox + seed from
   * Keychain/Keystore). Call this when deleting the Liquid wallet entry so no orphan
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
          console.warn('[LiquidWallet] native clear failed (non-fatal)', normalizeLiquidError(e));
        }
      }
    }
  }

  private getClient(): LiquidWalletClient {
    return new EmbeddedLiquidWalletClient();
  }

  private async getConfiguredClient(): Promise<LiquidWalletClient> {
    const client = this.getClient();
    const rpcUrl = normalizeLiquidRpcUrlForRuntime(validateLiquidRpcUrl(this.elementsRpcUrl));
    if (this.elementsRpcUrl !== rpcUrl) {
      this.elementsRpcUrl = rpcUrl;
    }
    if (client.configure) {
      await client.configure({ elementsRpcUrl: rpcUrl });
    }
    return client;
  }

  private async withLiquidEvent<T>(operation: string, fields: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    this.logLiquidEvent(operation, 'begin', fields);
    try {
      const result = await run();
      this.logLiquidEvent(operation, 'ok', this.resultFields(result));
      return result;
    } catch (error) {
      this.logLiquidEvent(operation, 'error', { error: normalizeLiquidError(error) });
      throw error;
    }
  }

  private logLiquidEvent(operation: string, status: string, fields: Record<string, unknown> = {}): void {
    const rpcUrl = normalizeLiquidRpcUrlForRuntime(this.elementsRpcUrl || canonicalLiquidRpcUrlForRuntime());
    const payload = {
      component: 'js.LiquidWallet',
      operation,
      status,
      walletID: this.getID?.(),
      address: this._address || undefined,
      rpcUrl,
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
      const maybeInfo = result as Partial<LiquidWalletInfo>;
      return {
        balanceAssetCount: maybeInfo.balances ? Object.keys(maybeInfo.balances).length : undefined,
        utxoCount: Array.isArray(result) ? result.length : this.liquidUtxos.length,
      };
    }
    return {};
  }
}

export function hasLiquidWallet(wallets: Array<{ type?: string }>): boolean {
  return wallets.some(wallet => wallet.type === LiquidWallet.type);
}
