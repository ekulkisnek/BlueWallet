import {
  AmmBurnParams,
  AmmMintParams,
  AmmSwapParams,
  deriveBitAssetsLiteWalletQuicUrl,
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
} from "../../blue_modules/BitAssetsWallet";
import * as bip39 from "bip39";
import {
  normalizeBitAssetsError,
  sanitizeRpcUrlForLog,
  validateBitAssetsRpcUrl,
} from "../../blue_modules/BitAssetsWalletForms";
import { uint8ArrayToHex } from "../../blue_modules/uint8array-extras";
import { BitcoinUnit, Chain } from "../../models/bitcoinUnits";
import { LegacyWallet } from "./legacy-wallet";
import { Transaction } from "./types";
import { Platform } from "react-native";
import { isEmulatorSync } from "react-native-device-info";
import { randomBytes } from "../rng";
import { isRedWalletCoreDeviceUsbTunnelHost } from "../../helpers/redwalletRealDeviceEndpoints";
import {
  canonicalBitAssetsQuicUrlForRuntime,
  canonicalBitAssetsRpcUrlForRuntime,
  isRedWalletAndroidRealDeviceProofEnabled,
  isRedWalletAndroidLanMacEndpointsOnly,
  isRedWalletAndroidPhysicalDevice,
  isRedWalletIosPhysicalDevice,
  isRedWalletRealDeviceProofEnabled,
} from "../../helpers/redwalletRealDeviceProof";

function isLoopbackBitAssetsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isLoopbackBitAssetsRpcUrl(rpcUrl: string): boolean {
  if (!rpcUrl.trim()) return true;
  try {
    return isLoopbackBitAssetsHost(
      new URL(validateBitAssetsRpcUrl(rpcUrl)).hostname,
    );
  } catch {
    return true;
  }
}

function isLoopbackBitAssetsQuicUrl(quicUrl: string): boolean {
  if (!quicUrl.trim()) return true;
  const host = quicUrl.split(":")[0] ?? "";
  return isLoopbackBitAssetsHost(host);
}

function isUsbTunnelBitAssetsRpcUrl(rpcUrl: string): boolean {
  if (!rpcUrl.trim()) return false;
  try {
    return isRedWalletCoreDeviceUsbTunnelHost(
      new URL(validateBitAssetsRpcUrl(rpcUrl)).hostname,
    );
  } catch {
    return false;
  }
}

function isUsbTunnelBitAssetsQuicUrl(quicUrl: string): boolean {
  if (!quicUrl.trim()) return false;
  const host = quicUrl.split(":")[0] ?? "";
  return isRedWalletCoreDeviceUsbTunnelHost(host);
}

function isEmulatorLoopbackBitAssetsRpcUrl(rpcUrl: string): boolean {
  if (Platform.OS !== "android" || !isRedWalletAndroidPhysicalDevice())
    return false;
  try {
    return new URL(validateBitAssetsRpcUrl(rpcUrl)).hostname === "10.0.2.2";
  } catch {
    return false;
  }
}

function shouldUseCanonicalBitAssetsEndpoints(): boolean {
  if (Platform.OS === "android") {
    return isRedWalletAndroidPhysicalDevice();
  }
  if (Platform.OS !== "ios") return false;
  try {
    if (isEmulatorSync()) return false;
  } catch {
    return isRedWalletIosPhysicalDevice();
  }
  // Embedded main.jsbundle is built with --dev false; physical iPhones must never keep loopback RPC.
  return (
    isRedWalletIosPhysicalDevice() ||
    isRedWalletRealDeviceProofEnabled() ||
    __DEV__
  );
}

function isPhysicalDeviceForBitAssets(): boolean {
  if (Platform.OS === "android") {
    return isRedWalletAndroidPhysicalDevice();
  }
  if (Platform.OS !== "ios") return false;
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
    // Device-info can fail on some CoreDevice builds; prefer LAN signet over loopback.
    return true;
  }
}

function shouldDeriveLoopbackBitAssetsQuicUrl(rpcUrl: string): boolean {
  if (Platform.OS !== "ios" || !isLoopbackBitAssetsRpcUrl(rpcUrl)) return true;
  try {
    return !isEmulatorSync();
  } catch {
    return true;
  }
}

export function normalizeBitAssetsRpcUrlForRuntime(rpcUrl: string): string {
  if (
    isRedWalletAndroidRealDeviceProofEnabled() &&
    isLoopbackBitAssetsRpcUrl(rpcUrl)
  ) {
    return validateBitAssetsRpcUrl(rpcUrl);
  }
  if (
    isPhysicalDeviceForBitAssets() &&
    (!rpcUrl.trim() ||
      isLoopbackBitAssetsRpcUrl(rpcUrl) ||
      isEmulatorLoopbackBitAssetsRpcUrl(rpcUrl) ||
      (isRedWalletAndroidLanMacEndpointsOnly() &&
        isUsbTunnelBitAssetsRpcUrl(rpcUrl)))
  ) {
    return canonicalBitAssetsRpcUrlForRuntime();
  }
  if (!shouldUseCanonicalBitAssetsEndpoints()) {
    return validateBitAssetsRpcUrl(rpcUrl);
  }
  if (
    !rpcUrl.trim() ||
    isLoopbackBitAssetsRpcUrl(rpcUrl) ||
    (isRedWalletAndroidLanMacEndpointsOnly() &&
      isUsbTunnelBitAssetsRpcUrl(rpcUrl))
  ) {
    return canonicalBitAssetsRpcUrlForRuntime();
  }
  return validateBitAssetsRpcUrl(rpcUrl);
}

export function normalizeBitAssetsLiteWalletQuicUrlForRuntime(
  rpcUrl: string,
  quicUrl: string,
): string {
  const explicit = quicUrl.trim().toLowerCase();
  if (explicit === "none" || explicit === "disabled" || explicit === "off") {
    return "";
  }
  const resolvedRpc = normalizeBitAssetsRpcUrlForRuntime(rpcUrl);
  const derived =
    quicUrl ||
    (shouldDeriveLoopbackBitAssetsQuicUrl(resolvedRpc)
      ? deriveBitAssetsLiteWalletQuicUrl(resolvedRpc)
      : "") ||
    "";
  if (
    isRedWalletAndroidRealDeviceProofEnabled() &&
    isLoopbackBitAssetsQuicUrl(derived)
  ) {
    return derived;
  }
  if (
    isPhysicalDeviceForBitAssets() &&
    (!derived.trim() ||
      isLoopbackBitAssetsQuicUrl(derived) ||
      (isRedWalletAndroidLanMacEndpointsOnly() &&
        isUsbTunnelBitAssetsQuicUrl(derived)))
  ) {
    return canonicalBitAssetsQuicUrlForRuntime();
  }
  if (!shouldUseCanonicalBitAssetsEndpoints()) {
    return derived;
  }
  if (
    !derived.trim() ||
    isLoopbackBitAssetsQuicUrl(derived) ||
    (isRedWalletAndroidLanMacEndpointsOnly() &&
      isUsbTunnelBitAssetsQuicUrl(derived))
  ) {
    return canonicalBitAssetsQuicUrlForRuntime();
  }
  return derived;
}

function isBitAssetsLiteWalletQuicDisabled(quicUrl?: string | null): boolean {
  const explicit = String(quicUrl ?? "")
    .trim()
    .toLowerCase();
  return explicit === "none" || explicit === "disabled" || explicit === "off";
}

export class BitAssetsWallet extends LegacyWallet {
  static readonly type = "bitassetsWallet";
  static readonly typeReadable = "BitAssets";
  static readonly subtitleReadable = "Drivechain";
  // @ts-ignore: override
  public readonly type: "bitassetsWallet" = BitAssetsWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = BitAssetsWallet.typeReadable;

  preferredBalanceUnit = BitcoinUnit.SATS;
  chain = Chain.OFFCHAIN;
  _address: string | false = false;
  bitassetsRpcUrl = "";
  bitassetsLiteWalletQuicUrl = "";
  bitassetsLiteWalletQuicDisabled = false;
  bitassetsInfo?: BitAssetsWalletInfo;
  bitassetsUtxos: BitAssetsUtxo[] = [];

  static fromJson(obj: string): BitAssetsWallet {
    const parsed = JSON.parse(obj);
    const wallet = new BitAssetsWallet();
    for (const key of Object.keys(parsed)) {
      if (key === "bitassetsInfo" || key === "bitassetsUtxos") continue;
      (wallet as unknown as Record<string, unknown>)[key] = parsed[key];
    }
    return wallet;
  }

  async init() {
    if (!this._address && this.secret.startsWith("bitassets://")) {
      this._address = this.secret.slice("bitassets://".length);
    }
    if (shouldUseCanonicalBitAssetsEndpoints() && this.bitassetsRpcUrl) {
      this.bitassetsRpcUrl = normalizeBitAssetsRpcUrlForRuntime(
        this.bitassetsRpcUrl,
      );
      if (this.bitassetsLiteWalletQuicDisabled) {
        this.bitassetsLiteWalletQuicUrl = "";
      } else {
        this.bitassetsLiteWalletQuicUrl =
          normalizeBitAssetsLiteWalletQuicUrlForRuntime(
            this.bitassetsRpcUrl,
            this.bitassetsLiteWalletQuicUrl,
          );
      }
    }
  }

  async generate(
    rpcUrl?: string,
    bitassetsLiteWalletQuicUrl?: string | null,
  ): Promise<void> {
    const seedPhrase = this.secret || (await this.generateSeedPhrase());
    const seedHex = this.seedPhraseToSeedHex(seedPhrase);
    this.configureBitAssetsEndpoints(rpcUrl, bitassetsLiteWalletQuicUrl);
    await this.withBitAssetsEvent(
      "generate",
      { rpcUrl: this.bitassetsRpcUrl },
      async () => {
        let client: BitAssetsWalletClient;
        let address = "";
        try {
          client = await this.getConfiguredClient(seedHex);
          address = await client.getNewAddress();
        } catch (error) {
          await this.clearNativeSigner();
          client = await this.getConfiguredClient(seedHex);
          address = await client.getNewAddress();
        }
        this._address = address;
        this.secret = seedPhrase;
        return { address };
      },
    );
  }

  configureBitAssetsEndpoints(
    rpcUrl?: string,
    bitassetsLiteWalletQuicUrl?: string | null,
  ): void {
    this.bitassetsRpcUrl = normalizeBitAssetsRpcUrlForRuntime(
      validateBitAssetsRpcUrl(rpcUrl ?? this.bitassetsRpcUrl),
    );
    if (isBitAssetsLiteWalletQuicDisabled(bitassetsLiteWalletQuicUrl)) {
      this.bitassetsLiteWalletQuicDisabled = true;
      this.bitassetsLiteWalletQuicUrl = "";
      return;
    }

    this.bitassetsLiteWalletQuicDisabled = false;
    this.bitassetsLiteWalletQuicUrl =
      normalizeBitAssetsLiteWalletQuicUrlForRuntime(
        this.bitassetsRpcUrl,
        bitassetsLiteWalletQuicUrl === undefined
          ? shouldDeriveLoopbackBitAssetsQuicUrl(this.bitassetsRpcUrl)
            ? (deriveBitAssetsLiteWalletQuicUrl(this.bitassetsRpcUrl) ?? "")
            : ""
          : (bitassetsLiteWalletQuicUrl ?? ""),
      );
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
    if (typeof address !== "string") return false;
    const normalizedAddress = address.trim();
    if (normalizedAddress.length === 0) return false;
    if (this._address === normalizedAddress) return true;
    return this.bitassetsUtxos.some(
      (utxo) => utxo.address === normalizedAddress,
    );
  }

  weOwnTransaction(): boolean {
    return false;
  }

  async fetchBalance(): Promise<void> {
    await this.withBitAssetsEvent("fetchBalance", {}, async () => {
      const info = await (await this.getConfiguredClient()).walletInfo();
      this.bitassetsInfo = info;
      await this.reconcileAddressUtxosFromChain();
      const reconciledBalances = this.balanceFromUtxos(this.bitassetsUtxos);
      if (Object.keys(reconciledBalances).length > 0) {
        this.bitassetsInfo = {
          ...info,
          confirmed_utxo_count: Math.max(
            info.confirmed_utxo_count ?? 0,
            this.bitassetsUtxos.filter((utxo) => utxo.confirmed !== false)
              .length,
          ),
          balances: {
            ...(info.balances ?? {}),
            ...reconciledBalances,
          },
        };
      }
      this.balance = Object.values(info.balances ?? {}).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      if (this.bitassetsInfo !== info) {
        this.balance = Object.values(this.bitassetsInfo.balances ?? {}).reduce(
          (sum, amount) => sum + amount,
          0,
        );
      }
      this.unconfirmed_balance = 0;
      this._lastBalanceFetch = +new Date();
      return this.bitassetsInfo;
    });
  }

  async fetchTransactions(): Promise<void> {
    await this.withBitAssetsEvent("fetchTransactions", {}, async () => {
      this.bitassetsUtxos = await (
        await this.getConfiguredClient()
      ).listUtxos();
      await this.reconcileAddressUtxosFromChain();
      this._lastTxFetch = +new Date();
      return { utxoCount: this.bitassetsUtxos.length };
    });
  }

  async syncBitAssets(): Promise<BitAssetsWalletInfo> {
    return this.withBitAssetsEvent("syncBitAssets", {}, async () => {
      const client = await this.getConfiguredClient();
      const info = await client.sync();
      this.bitassetsUtxos = await client.listUtxos();
      await this.reconcileAddressUtxosFromChain();
      this.bitassetsInfo = info;
      const reconciledBalances = this.balanceFromUtxos(this.bitassetsUtxos);
      if (Object.keys(reconciledBalances).length > 0) {
        this.bitassetsInfo = {
          ...info,
          confirmed_utxo_count: Math.max(
            info.confirmed_utxo_count ?? 0,
            this.bitassetsUtxos.filter((utxo) => utxo.confirmed !== false)
              .length,
          ),
          balances: {
            ...(info.balances ?? {}),
            ...reconciledBalances,
          },
        };
      }
      this.balance = Object.values(info.balances ?? {}).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      if (this.bitassetsInfo !== info) {
        this.balance = Object.values(this.bitassetsInfo.balances ?? {}).reduce(
          (sum, amount) => sum + amount,
          0,
        );
      }
      this._lastBalanceFetch = +new Date();
      this._lastTxFetch = +new Date();
      return this.bitassetsInfo;
    });
  }

  async transferBitAssets(params: TransferParams): Promise<string> {
    return this.withBitAssetsEvent(
      "transferBitAssets",
      { assetId: params.assetId, amount: params.amount },
      async () => (await this.getConfiguredClient()).transfer(params),
    );
  }

  async reserveBitAsset(params: ReserveParams): Promise<string> {
    return this.withBitAssetsEvent(
      "reserveBitAsset",
      { name: params.name },
      async () => (await this.getConfiguredClient()).reserve(params),
    );
  }

  async registerBitAsset(params: RegisterParams): Promise<string> {
    return this.withBitAssetsEvent(
      "registerBitAsset",
      { name: params.name, initialSupply: params.initialSupply },
      async () => (await this.getConfiguredClient()).register(params),
    );
  }

  async ammMint(params: AmmMintParams): Promise<string> {
    return this.withBitAssetsEvent(
      "ammMint",
      { asset0: params.asset0, asset1: params.asset1 },
      async () => (await this.getConfiguredClient()).ammMint(params),
    );
  }

  async ammSwap(params: AmmSwapParams): Promise<string> {
    return this.withBitAssetsEvent(
      "ammSwap",
      { assetSpend: params.assetSpend, assetReceive: params.assetReceive },
      async () => (await this.getConfiguredClient()).ammSwap(params),
    );
  }

  async ammBurn(params: AmmBurnParams): Promise<string> {
    return this.withBitAssetsEvent(
      "ammBurn",
      { asset0: params.asset0, asset1: params.asset1 },
      async () => (await this.getConfiguredClient()).ammBurn(params),
    );
  }

  async dutchAuctionCreate(params: DutchAuctionCreateParams): Promise<string> {
    return this.withBitAssetsEvent(
      "dutchAuctionCreate",
      { baseAsset: params.baseAsset, quoteAsset: params.quoteAsset },
      async () => (await this.getConfiguredClient()).dutchAuctionCreate(params),
    );
  }

  async dutchAuctionBid(params: DutchAuctionBidParams): Promise<string> {
    return this.withBitAssetsEvent(
      "dutchAuctionBid",
      { auctionId: params.auctionId },
      async () => (await this.getConfiguredClient()).dutchAuctionBid(params),
    );
  }

  async dutchAuctionCollect(
    params: DutchAuctionCollectParams,
  ): Promise<string> {
    return this.withBitAssetsEvent(
      "dutchAuctionCollect",
      { auctionId: params.auctionId },
      async () =>
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
          console.warn(
            "[BitAssetsWallet] native clear failed (non-fatal)",
            normalizeBitAssetsError(e),
          );
        }
      }
    }
  }

  private getClient(): BitAssetsWalletClient {
    return new EmbeddedBitAssetsWalletClient();
  }

  private async getConfiguredClient(seedHex?: string): Promise<BitAssetsWalletClient> {
    const client = this.getClient();
    const rpcUrl = normalizeBitAssetsRpcUrlForRuntime(
      validateBitAssetsRpcUrl(this.bitassetsRpcUrl),
    );
    if (this.bitassetsRpcUrl !== rpcUrl) {
      this.bitassetsRpcUrl = rpcUrl;
    }
    const quicUrl = this.bitassetsLiteWalletQuicDisabled
      ? ""
      : normalizeBitAssetsLiteWalletQuicUrlForRuntime(
          rpcUrl,
          this.bitassetsLiteWalletQuicUrl ||
            (shouldDeriveLoopbackBitAssetsQuicUrl(rpcUrl)
              ? deriveBitAssetsLiteWalletQuicUrl(rpcUrl)
              : "") ||
            "",
        );
    this.bitassetsLiteWalletQuicUrl = quicUrl;
    if (client.configure) {
      await client.configure({
        rpcUrl,
        ...(seedHex ? { seedHex } : {}),
        ...(this.bitassetsLiteWalletQuicDisabled
          ? { bitassetsLiteWalletQuicUrl: "disabled" }
          : quicUrl
            ? { bitassetsLiteWalletQuicUrl: quicUrl }
            : {}),
      });
    }
    return client;
  }

  private async generateSeedPhrase(): Promise<string> {
    const entropy = await randomBytes(16);
    return bip39.entropyToMnemonic(uint8ArrayToHex(entropy));
  }

  private seedPhraseToSeedHex(seedPhrase: string): string {
    return uint8ArrayToHex(bip39.mnemonicToSeedSync(seedPhrase));
  }

  private async reconcileAddressUtxosFromChain(): Promise<void> {
    const address = this.getAddress();
    if (!address) return;
    const chainUtxos = await this.fetchChainUtxosForAddress(address).catch(
      (error) => {
        this.logBitAssetsEvent("reconcileAddressUtxosFromChain", "error", {
          error: normalizeBitAssetsError(error),
        });
        if (__DEV__) {
          console.warn(
            "[BitAssetsWallet] chain UTXO reconciliation failed",
            normalizeBitAssetsError(error),
          );
        }
        return [];
      },
    );
    this.logBitAssetsEvent("reconcileAddressUtxosFromChain", "ok", {
      chainUtxoCount: chainUtxos.length,
    });
    if (chainUtxos.length === 0) return;

    const existingKeys = new Set(
      this.bitassetsUtxos.map((utxo) => this.utxoKey(utxo)).filter(Boolean),
    );
    for (const utxo of chainUtxos) {
      const key = this.utxoKey(utxo);
      if (!key || existingKeys.has(key)) continue;
      this.bitassetsUtxos.push(utxo);
      existingKeys.add(key);
    }
  }

  private async fetchChainUtxosForAddress(
    address: string,
  ): Promise<BitAssetsUtxo[]> {
    const rpcUrl = normalizeBitAssetsRpcUrlForRuntime(
      validateBitAssetsRpcUrl(this.bitassetsRpcUrl),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "redwallet-bitassets-list-utxos",
          method: "list_utxos",
          params: [],
        }),
        signal: controller.signal,
      });
      const envelope = await response.json();
      if (!response.ok || envelope.error) {
        throw new Error(envelope.error?.message ?? `HTTP ${response.status}`);
      }
      const values = Array.isArray(envelope.result) ? envelope.result : [];
      return values.flatMap((entry: any): BitAssetsUtxo[] => {
        if (entry?.output?.address !== address) return [];
        const bitAsset = entry?.output?.content?.BitAsset;
        if (!Array.isArray(bitAsset) || typeof bitAsset[0] !== "string")
          return [];
        const amount = Number(bitAsset[1] ?? 0);
        const regular = entry?.outpoint?.Regular;
        return [
          {
            txid: typeof regular?.txid === "string" ? regular.txid : undefined,
            vout: Number.isInteger(regular?.vout) ? regular.vout : undefined,
            outpoint:
              typeof regular?.txid === "string" &&
              Number.isInteger(regular?.vout)
                ? { txid: regular.txid, vout: regular.vout }
                : undefined,
            address,
            asset_id: bitAsset[0],
            amount,
            content_kind: "BitAsset",
            confirmed: true,
          },
        ];
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private balanceFromUtxos(utxos: BitAssetsUtxo[]): Record<string, number> {
    const balances: Record<string, number> = {};
    for (const utxo of utxos) {
      if (utxo.confirmed === false || !utxo.asset_id) continue;
      balances[utxo.asset_id] =
        (balances[utxo.asset_id] ?? 0) + Number(utxo.amount ?? 0);
    }
    return balances;
  }

  private utxoKey(utxo: BitAssetsUtxo): string {
    const txid = utxo.txid ?? utxo.outpoint?.txid;
    const vout = utxo.vout ?? utxo.outpoint?.vout;
    return txid && Number.isInteger(vout) ? `${txid}:${vout}` : "";
  }

  private async withBitAssetsEvent<T>(
    operation: string,
    fields: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    this.logBitAssetsEvent(operation, "begin", fields);
    try {
      const result = await run();
      this.logBitAssetsEvent(operation, "ok", this.resultFields(result));
      return result;
    } catch (error) {
      this.logBitAssetsEvent(operation, "error", {
        error: normalizeBitAssetsError(error),
      });
      throw error;
    }
  }

  private logBitAssetsEvent(
    operation: string,
    status: string,
    fields: Record<string, unknown> = {},
  ): void {
    const rpcUrl = sanitizeRpcUrlForLog(
      normalizeBitAssetsRpcUrlForRuntime(
        this.bitassetsRpcUrl || canonicalBitAssetsRpcUrlForRuntime(),
      ),
    );
    const liteWalletQuicUrl = this.bitassetsLiteWalletQuicDisabled
      ? ""
      : normalizeBitAssetsLiteWalletQuicUrlForRuntime(
          rpcUrl,
          this.bitassetsLiteWalletQuicUrl ||
            canonicalBitAssetsQuicUrlForRuntime(),
        );
    const payload = {
      component: "js.BitAssetsWallet",
      operation,
      status,
      walletID: this.getID?.(),
      address: this._address || undefined,
      rpcUrl,
      bitassetsLiteWalletQuicUrl: sanitizeRpcUrlForLog(liteWalletQuicUrl),
      time: new Date().toISOString(),
      ...fields,
    };
    console.log(`REDWALLET_EVENT ${JSON.stringify(payload)}`);
  }

  private resultFields(result: unknown): Record<string, unknown> {
    if (typeof result === "string") {
      return /^[0-9a-fA-F]{64}$/.test(result)
        ? { txid: result }
        : { resultBytes: result.length };
    }
    if (result && typeof result === "object") {
      const maybeInfo = result as Partial<BitAssetsWalletInfo>;
      return {
        balanceAssetCount: maybeInfo.balances
          ? Object.keys(maybeInfo.balances).length
          : undefined,
        utxoCount: Array.isArray(result)
          ? result.length
          : this.bitassetsUtxos.length,
      };
    }
    return {};
  }
}

export function hasBitAssetsWallet(wallets: Array<{ type?: string }>): boolean {
  return wallets.some((wallet) => wallet.type === BitAssetsWallet.type);
}
