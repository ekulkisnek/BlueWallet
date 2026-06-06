import {
  deriveLiquidLiteWalletQuicUrl,
  EmbeddedLiquidWalletClient,
  JsonRpcLiquidWalletClient,
  LiquidWalletClient,
  LiquidWalletInfo,
  LiquidUtxo,
  TransferParams,
} from '../../blue_modules/LiquidWallet';
import { normalizeLiquidError, sanitizeRpcUrlForLog, validateLiquidRpcUrl } from '../../blue_modules/LiquidWalletForms';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { LegacyWallet } from './legacy-wallet';
import { Transaction } from './types';
import { Platform } from 'react-native';
import { isEmulatorSync } from 'react-native-device-info';
import { isRedWalletCoreDeviceUsbTunnelHost } from '../../helpers/redwalletRealDeviceEndpoints';
import {
  canonicalLiquidElectrumUrlForRuntime,
  canonicalLiquidRpcUrlForRuntime,
  canonicalLiquidQuicUrlForRuntime,
  isRedWalletAndroidRealDeviceProofEnabled,
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
  try {
    if (isEmulatorSync()) return false;
  } catch {
    // ignore
  }
  // main.jsbundle is built with --dev false; __DEV__ is false on real devices using embedded bundle.
  if (!__DEV__) return true;
  try {
    return !isEmulatorSync();
  } catch {
    // Device-info can fail on some CoreDevice builds; prefer LAN over loopback.
    return true;
  }
}

function isLoopbackLiquidQuicUrl(quicUrl: string): boolean {
  if (!quicUrl.trim()) return true;
  const host = quicUrl.split(':')[0] ?? '';
  return isLoopbackLiquidHost(host);
}

function isUsbTunnelLiquidQuicUrl(quicUrl: string): boolean {
  if (!quicUrl.trim()) return false;
  const host = quicUrl.split(':')[0] ?? '';
  return isRedWalletCoreDeviceUsbTunnelHost(host);
}

function shouldDeriveLoopbackLiquidQuicUrl(rpcUrl: string): boolean {
  if (Platform.OS !== 'ios' || !isLoopbackLiquidRpcUrl(rpcUrl)) return true;
  try {
    return !isEmulatorSync();
  } catch {
    return true;
  }
}

export function normalizeLiquidLiteWalletQuicUrlForRuntime(rpcUrl: string, quicUrl: string): string {
  const explicit = quicUrl.trim().toLowerCase();
  if (explicit === 'none' || explicit === 'disabled' || explicit === 'off') {
    return '';
  }
  if (!rpcUrl.trim() && !quicUrl.trim()) {
    return '';
  }
  const resolvedRpc = normalizeLiquidRpcUrlForRuntime(rpcUrl);
  const derived = quicUrl || (shouldDeriveLoopbackLiquidQuicUrl(resolvedRpc) ? deriveLiquidLiteWalletQuicUrl(resolvedRpc) : '') || '';
  if (isRedWalletAndroidRealDeviceProofEnabled() && isLoopbackLiquidQuicUrl(derived)) {
    return derived;
  }
  if (
    isPhysicalDeviceForLiquid() &&
    (!derived.trim() ||
      isLoopbackLiquidQuicUrl(derived) ||
      (isRedWalletAndroidLanMacEndpointsOnly() && isUsbTunnelLiquidQuicUrl(derived)))
  ) {
    return canonicalLiquidQuicUrlForRuntime();
  }
  if (!shouldUseCanonicalLiquidEndpoints()) {
    return derived;
  }
  if (
    !derived.trim() ||
    isLoopbackLiquidQuicUrl(derived) ||
    (isRedWalletAndroidLanMacEndpointsOnly() && isUsbTunnelLiquidQuicUrl(derived))
  ) {
    return canonicalLiquidQuicUrlForRuntime();
  }
  return derived;
}

function isLiquidLiteWalletQuicDisabled(quicUrl?: string | null): boolean {
  const explicit = String(quicUrl ?? '').trim().toLowerCase();
  return explicit === 'none' || explicit === 'disabled' || explicit === 'off';
}

export function normalizeLiquidRpcUrlForRuntime(rpcUrl: string): string {
  if (isRedWalletAndroidRealDeviceProofEnabled() && isLoopbackLiquidRpcUrl(rpcUrl)) {
    return validateLiquidRpcUrl(rpcUrl);
  }
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
  if (!rpcUrl.trim() || isLoopbackLiquidRpcUrl(rpcUrl) || (isRedWalletAndroidLanMacEndpointsOnly() && isUsbTunnelLiquidRpcUrl(rpcUrl))) {
    return canonicalLiquidRpcUrlForRuntime();
  }
  return validateLiquidRpcUrl(rpcUrl);
}

function shouldUseJsonRpcLiquidClient(rpcUrl: string): boolean {
  try {
    const url = new URL(validateLiquidRpcUrl(rpcUrl));
    return url.username.length > 0 || url.password.length > 0 || url.pathname.includes('/wallet/');
  } catch {
    return false;
  }
}

export const EMBEDDED_LIQUID_PLACEHOLDER_RPC_URL = 'http://127.0.0.1:18443';

export class LiquidWallet extends LegacyWallet {
  static readonly type = 'liquidWallet';
  static readonly typeReadable = 'Liquid (L-BTC)';
  static readonly subtitleReadable = 'Sidechain';
  // @ts-ignore: override
  public readonly type: 'liquidWallet' = LiquidWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = LiquidWallet.typeReadable;

  preferredBalanceUnit = BitcoinUnit.SATS;
  chain = Chain.OFFCHAIN;
  _address: string | false = false;
  elementsRpcUrl = '';
  liquidWalletMode: 'lwk' | 'utreexo' | 'elements-rpc' | 'local-only' = 'lwk';
  liquidElectrumUrl = '';
  liquidLiteWalletQuicUrl = '';
  liquidLiteWalletQuicDisabled = false;
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
      if (this.liquidLiteWalletQuicDisabled) {
        this.liquidLiteWalletQuicUrl = '';
      } else {
        this.liquidLiteWalletQuicUrl = normalizeLiquidLiteWalletQuicUrlForRuntime(
          this.elementsRpcUrl,
          this.liquidLiteWalletQuicUrl,
        );
      }
    }
  }

  async generate(rpcUrl?: string, liquidLiteWalletQuicUrl?: string | null): Promise<void> {
    this.configureLiquidEndpoints(rpcUrl, liquidLiteWalletQuicUrl);
    await this.withLiquidEvent('generate', { mode: this.elementsRpcUrl ? 'embedded-with-rpc' : 'embedded-local' }, async () => {
      let client: LiquidWalletClient;
      let address = '';
      try {
        client = await this.getConfiguredClient();
        address = await client.getNewAddress();
      } catch (error) {
        await this.clearNativeSigner();
        try {
          client = await this.getConfiguredClient();
          address = await client.getNewAddress();
        } catch (retryError) {
          if (!this.elementsRpcUrl) {
            throw retryError;
          }
          if (__DEV__) {
            console.warn('[LiquidWallet] native generate failed, falling back to JSON-RPC', normalizeLiquidError(retryError));
          }
          client = new JsonRpcLiquidWalletClient(this.elementsRpcUrl);
          address = await client.getNewAddress();
        }
      }
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
    if (this.liquidWalletMode === 'elements-rpc' && this.elementsRpcUrl && shouldUseJsonRpcLiquidClient(this.elementsRpcUrl)) {
      return new JsonRpcLiquidWalletClient(this.elementsRpcUrl);
    }
    return new EmbeddedLiquidWalletClient();
  }

  configureLiquidEndpoints(rpcUrl?: string, liquidLiteWalletQuicUrl?: string | null): void {
    const requestedRpcUrl = (rpcUrl ?? this.elementsRpcUrl).trim();
    this.elementsRpcUrl = requestedRpcUrl ? normalizeLiquidRpcUrlForRuntime(validateLiquidRpcUrl(requestedRpcUrl)) : '';
    if (isLiquidLiteWalletQuicDisabled(liquidLiteWalletQuicUrl)) {
      this.liquidLiteWalletQuicDisabled = true;
      this.liquidLiteWalletQuicUrl = '';
      this.liquidWalletMode = 'lwk';
    } else {
      this.liquidLiteWalletQuicDisabled = false;
      this.liquidLiteWalletQuicUrl = normalizeLiquidLiteWalletQuicUrlForRuntime(
        this.elementsRpcUrl,
        liquidLiteWalletQuicUrl === undefined
          ? ''
          : (liquidLiteWalletQuicUrl ?? ''),
      );
      this.liquidWalletMode = this.liquidLiteWalletQuicUrl ? 'utreexo' : 'lwk';
    }
  }

  private async getConfiguredClient(): Promise<LiquidWalletClient> {
    const client = this.getClient();
    const rpcUrl = this.elementsRpcUrl
      ? normalizeLiquidRpcUrlForRuntime(validateLiquidRpcUrl(this.elementsRpcUrl))
      : '';
    if (this.elementsRpcUrl && this.elementsRpcUrl !== rpcUrl) this.elementsRpcUrl = rpcUrl;
    const quicUrl = this.liquidLiteWalletQuicDisabled
      ? ''
      : normalizeLiquidLiteWalletQuicUrlForRuntime(
          rpcUrl,
          this.liquidLiteWalletQuicUrl || '',
        );
    this.liquidLiteWalletQuicUrl = quicUrl;
    const walletMode = (quicUrl && !this.liquidLiteWalletQuicDisabled) ? 'utreexo' : 'lwk';
    this.liquidWalletMode = walletMode;
    const electrumUrl =
      walletMode === 'lwk'
        ? this.liquidElectrumUrl || canonicalLiquidElectrumUrlForRuntime()
        : '';
    this.liquidElectrumUrl = electrumUrl;
    if (client.configure) {
      await client.configure({
        elementsRpcUrl: rpcUrl,
        walletMode,
        electrumUrl,
        ...(quicUrl ? { liquidLiteWalletQuicUrl: quicUrl } : {}),
      });
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
    const rpcUrl = this.elementsRpcUrl
      ? sanitizeRpcUrlForLog(normalizeLiquidRpcUrlForRuntime(this.elementsRpcUrl))
      : 'embedded-local';
    const liteWalletQuicUrl = this.liquidLiteWalletQuicDisabled
      ? 'disabled'
      : !this.elementsRpcUrl && !this.liquidLiteWalletQuicUrl
      ? ''
      : normalizeLiquidLiteWalletQuicUrlForRuntime(
          this.elementsRpcUrl,
          this.liquidLiteWalletQuicUrl || canonicalLiquidQuicUrlForRuntime(),
        );
    const payload = {
      component: 'js.LiquidWallet',
      operation,
      status,
      walletID: this.getID?.(),
      address: this._address || undefined,
      rpcUrl,
      liquidLiteWalletQuicUrl: sanitizeRpcUrlForLog(liteWalletQuicUrl),
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
