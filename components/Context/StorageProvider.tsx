import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, LayoutAnimation } from "react-native";
import RNFS from "react-native-fs";
import {
  BlueApp as BlueAppClass,
  HDSegwitBech32Wallet,
  LegacyWallet,
  TCounterpartyMetadata,
  TTXMetadata,
  WatchOnlyWallet,
} from "../../class";
import {
  BitAssetsWallet as BitAssetsWalletClass,
  normalizeBitAssetsLiteWalletQuicUrlForRuntime,
  normalizeBitAssetsRpcUrlForRuntime,
} from "../../class/wallets/bitassets-wallet";
import {
  LiquidWallet as LiquidWalletClass,
  normalizeLiquidRpcUrlForRuntime,
} from "../../class/wallets/liquid-wallet";
import { AbstractHDElectrumWallet } from "../../class/wallets/abstract-hd-electrum-wallet";
import type { TWallet } from "../../class/wallets/types";
import presentAlert from "../../components/Alert";
import loc, { formatBalanceWithoutSuffix } from "../../loc";
import * as BlueElectrum from "../../blue_modules/BlueElectrum";
import triggerHapticFeedback, {
  HapticFeedbackTypes,
} from "../../blue_modules/hapticFeedback";
import { startAndDecrypt } from "../../blue_modules/start-and-decrypt";
import {
  isNotificationsEnabled,
  majorTomToGroundControl,
  unsubscribe,
} from "../../blue_modules/notifications";
import { BitcoinUnit } from "../../models/bitcoinUnits";
import { navigationRef } from "../../NavigationService";
import { getScanWasBBQR } from "../../helpers/scan-qr.ts";
import { setWalletIdMustUseBBQR } from "../../blue_modules/ur";
import { redWalletEvent } from "../../helpers/redwalletDeviceLogger";
import {
  resolveRedWalletBitAssetsCommandUrls,
  resolveRedWalletBtcCommandUrls,
  resolveRedWalletBtcResultUrls,
} from "../../helpers/redwalletRealDeviceEndpoints";
import { isRedWalletRealDeviceProofEnabled } from "../../helpers/redwalletRealDeviceProof";
import { REDWALLET_SIGNET_BITASSETS_RPC_URL } from "../../helpers/redwalletSignetEndpoints.generated";

const BlueApp = BlueAppClass.getInstance();
const BITASSETS_REAL_DEVICE_SELFTEST_COMMAND = `${RNFS.DocumentDirectoryPath}/redwallet-bitassets-selftest-command.json`;
const BITASSETS_REAL_DEVICE_SELFTEST_RESULT = `${RNFS.DocumentDirectoryPath}/redwallet-bitassets-selftest-result.json`;
const BITASSETS_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS = 8000;
const BTC_REAL_DEVICE_COMMAND = `${RNFS.DocumentDirectoryPath}/redwallet-btc-selftest-command.json`;
const BTC_REAL_DEVICE_RESULT = `${RNFS.DocumentDirectoryPath}/redwallet-btc-selftest-result.json`;
const BTC_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS = 8000;
const LIQUID_REAL_DEVICE_SELFTEST_COMMAND = `${RNFS.DocumentDirectoryPath}/redwallet-liquid-selftest-command.json`;
const LIQUID_REAL_DEVICE_SELFTEST_RESULT = `${RNFS.DocumentDirectoryPath}/redwallet-liquid-selftest-result.json`;

// hashmap of timestamps we _started_ refetching some wallet
const _lastTimeTriedToRefetchWallet: { [walletID: string]: number } = {};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeBitAssetsRpc(
  rpcUrl: string,
  timeoutMs = BITASSETS_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      rpcUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "redwallet-real-device-probe",
          method: "get_lite_wallet_update",
          params: [
            [
              "0000000000000000000000000000000000000000000000000000000000000000",
            ],
            null,
          ],
        }),
      },
      timeoutMs,
    );
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      responseBytes: text.length,
      responseHead: text.slice(0, 240),
    };
  } catch (error: any) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error?.message ?? String(error),
    };
  }
}

async function fetchBitAssetsRealDeviceCommand(
  walletID = "",
  options: { consumeLocalFile?: boolean } = {},
): Promise<string> {
  const consumeLocalFile = options.consumeLocalFile !== false;
  const exists = await RNFS.exists(BITASSETS_REAL_DEVICE_SELFTEST_COMMAND);
  if (exists) {
    const rawCommand = await RNFS.readFile(
      BITASSETS_REAL_DEVICE_SELFTEST_COMMAND,
      "utf8",
    );
    if (consumeLocalFile) {
      await RNFS.unlink(BITASSETS_REAL_DEVICE_SELFTEST_COMMAND).catch(
        () => undefined,
      );
    }
    return rawCommand;
  }

  if (isRedWalletRealDeviceProofEnabled()) {
    const startedAt = Date.now();
    for (const baseUrl of await resolveRedWalletBitAssetsCommandUrls()) {
      try {
        const url = walletID
          ? `${baseUrl}?walletID=${encodeURIComponent(walletID)}`
          : baseUrl;
        const response = await fetchWithTimeout(
          url,
          {
            method: "GET",
            headers: { accept: "application/json" },
          },
          BITASSETS_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS,
        );
        if (response.status === 204 || response.status === 404) continue;
        const rawCommand = await response.text();
        redWalletEvent("real_device_bitassets_selftest_command_fetch", {
          walletID,
          url: baseUrl,
          ok: response.ok,
          status: response.status,
          durationMs: Date.now() - startedAt,
          responseBytes: rawCommand.length,
        });
        if (response.ok && rawCommand.trim()) return rawCommand;
      } catch (error: any) {
        redWalletEvent("real_device_bitassets_selftest_command_fetch_error", {
          walletID,
          url: baseUrl,
          error: error?.message ?? String(error),
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  return "";
}

let realDeviceBitAssetsSelftestInFlight = false;
let realDeviceBtcCommandInFlight = false;

const BITASSETS_REGISTER_RESERVATION_RETRY_MS = 3000;
const BITASSETS_REGISTER_RESERVATION_MAX_ATTEMPTS = 12;

function isBitAssetsReservationUtxoMissingError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? String(error);
  return message.includes("no wallet UTXO matching reservation");
}

function isBitAssetsStaleSyncError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? String(error);
  return /stale|resync from snapshot|from_block_hash|partially synced|partial sync|not known/i.test(
    message,
  );
}

function isBitAssetsInsufficientFundsError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? String(error);
  return /not enough native wallet BitAsset funds/i.test(message);
}

async function syncBitAssetsWithLogging(
  wallet: BitAssetsWalletClass,
  operation: string,
): Promise<boolean> {
  const maxAttempts =
    operation === "transfer" || operation.startsWith("transfer:") ? 5 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await wallet.syncBitAssets();
      return true;
    } catch (syncError: any) {
      redWalletEvent("real_device_bitassets_selftest_sync_error", {
        walletID: wallet.getID?.(),
        operation,
        attempt,
        error: syncError?.message ?? String(syncError),
      });
      if (attempt >= maxAttempts || !isBitAssetsStaleSyncError(syncError)) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }
  return false;
}

async function registerBitAssetAfterReservationSync(
  wallet: BitAssetsWalletClass,
  params: {
    name: string;
    initialSupply: number;
    bitassetData: Record<string, unknown>;
    feeSats: number;
  },
  operation: string,
): Promise<string> {
  for (
    let attempt = 1;
    attempt <= BITASSETS_REGISTER_RESERVATION_MAX_ATTEMPTS;
    attempt++
  ) {
    await syncBitAssetsWithLogging(
      wallet,
      `${operation}:pre-register:${attempt}`,
    );
    try {
      return await wallet.registerBitAsset(params);
    } catch (error: any) {
      if (
        !isBitAssetsReservationUtxoMissingError(error) ||
        attempt >= BITASSETS_REGISTER_RESERVATION_MAX_ATTEMPTS
      ) {
        throw error;
      }
      redWalletEvent("real_device_bitassets_selftest_register_retry", {
        walletID: wallet.getID?.(),
        operation,
        name: params.name,
        attempt,
        error: error?.message ?? String(error),
      });
      await new Promise((resolve) =>
        setTimeout(resolve, BITASSETS_REGISTER_RESERVATION_RETRY_MS),
      );
    }
  }
  throw new Error(
    `register failed after ${BITASSETS_REGISTER_RESERVATION_MAX_ATTEMPTS} sync attempts`,
  );
}

async function resolveBitAssetsSelftestWallet(
  wallets: BitAssetsWalletClass[],
  command: Record<string, unknown>,
): Promise<BitAssetsWalletClass | null> {
  if (wallets.length === 0) return null;
  const walletId = String(command.walletID ?? command.walletId ?? "").trim();
  if (walletId) {
    const match = wallets.find((w) => w.getID?.() === walletId);
    if (match) return match;
    redWalletEvent("real_device_bitassets_selftest_wallet_missing", {
      walletID: walletId,
      operation: String(command.operation ?? ""),
      availableWalletIDs: wallets.map((w) => w.getID?.()).filter(Boolean),
    });
    return null;
  }
  const operation = String(command.operation ?? "");
  const assetId = String(command.assetId ?? "").trim();
  if (operation === "transfer" && assetId) {
    for (const wallet of wallets) {
      try {
        const info = await wallet.syncBitAssets();
        const balance = Number(info.balances?.[assetId] ?? 0);
        if (balance > 0) return wallet;
      } catch {
        // try next wallet
      }
    }
  }
  return wallets[0];
}

async function transferBitAssetsAfterSync(
  wallet: BitAssetsWalletClass,
  params: {
    destinationAddress: string;
    assetId: string;
    amount: number;
    feeSats: number;
    memo?: string;
  },
  operation: string,
): Promise<string> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const synced = await syncBitAssetsWithLogging(
      wallet,
      `${operation}:pre-transfer:${attempt}`,
    );
    if (!synced) {
      throw new Error(
        "BitAssets wallet sync failed before transfer; wallet state is stale",
      );
    }
    try {
      return await wallet.transferBitAssets(params);
    } catch (error: any) {
      if (!isBitAssetsInsufficientFundsError(error) || attempt >= maxAttempts) {
        throw error;
      }
      redWalletEvent("real_device_bitassets_selftest_transfer_retry", {
        walletID: wallet.getID?.(),
        operation,
        attempt,
        assetId: params.assetId,
        error: error?.message ?? String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error("transfer failed after sync retries");
}

async function runBitAssetsRealDeviceSelftestCommandInner(
  wallet: BitAssetsWalletClass,
  prefetchedCommand = "",
): Promise<void> {
  const rawCommand =
    prefetchedCommand ||
    (await fetchBitAssetsRealDeviceCommand(wallet.getID?.() ?? ""));
  if (!rawCommand) return;

  const command = JSON.parse(rawCommand);
  const operation = String(command.operation ?? "");
  const commandId = String(command.commandId ?? "");
  const startedAt = Date.now();
  const assetName = String(command.name ?? "");
  redWalletEvent("real_device_bitassets_selftest_begin", {
    walletID: wallet.getID?.(),
    address: wallet.getAddress() || "",
    operation,
    commandId,
    ...(assetName ? { name: assetName } : {}),
  });

  try {
    const commandRpcUrl = String(
      command.rpcUrl ?? command.bitassetsRpcUrl ?? "",
    ).trim();
    if (commandRpcUrl) {
      const rpcUrl = normalizeBitAssetsRpcUrlForRuntime(commandRpcUrl);
      const quicUrl = normalizeBitAssetsLiteWalletQuicUrlForRuntime(
        rpcUrl,
        command.bitassetsLiteWalletQuicUrl === undefined
          ? ""
          : String(command.bitassetsLiteWalletQuicUrl ?? ""),
      );
      if (
        wallet.bitassetsRpcUrl !== rpcUrl ||
        wallet.bitassetsLiteWalletQuicUrl !== quicUrl ||
        command.bitassetsLiteWalletQuicUrl !== undefined
      ) {
        wallet.configureBitAssetsEndpoints(
          rpcUrl,
          command.bitassetsLiteWalletQuicUrl === undefined
            ? quicUrl
            : String(command.bitassetsLiteWalletQuicUrl ?? ""),
        );
      }
    }

    let txid = "";
    let okOperation = operation;
    if (operation === "clearNative") {
      await wallet.clearNativeSigner();
      okOperation = "clearNative";
    } else if (operation === "reserveRegister") {
      const name = String(command.name);
      const feeSats = Number(command.feeSats ?? 0);
      await wallet.reserveBitAsset({ name, feeSats });
      await syncBitAssetsWithLogging(wallet, operation);
      txid = await registerBitAssetAfterReservationSync(
        wallet,
        {
          name,
          initialSupply: Number(command.initialSupply),
          bitassetData: command.bitassetData ?? {},
          feeSats,
        },
        operation,
      );
      okOperation = "register";
    } else if (operation === "reserve") {
      txid = await wallet.reserveBitAsset({
        name: String(command.name),
        feeSats: Number(command.feeSats ?? 0),
      });
    } else if (operation === "register") {
      const registerParams = {
        name: String(command.name),
        initialSupply: Number(command.initialSupply),
        bitassetData: (command.bitassetData ?? {}) as Record<string, unknown>,
        feeSats: Number(command.feeSats ?? 0),
      };
      if (isRedWalletRealDeviceProofEnabled()) {
        txid = await registerBitAssetAfterReservationSync(
          wallet,
          registerParams,
          operation,
        );
      } else {
        txid = await wallet.registerBitAsset(registerParams);
      }
    } else if (operation === "transfer") {
      const transferParams = {
        destinationAddress: String(command.destinationAddress),
        assetId: String(command.assetId),
        amount: Number(command.amount),
        feeSats: Number(command.feeSats ?? 0),
        memo: command.memo ? String(command.memo) : undefined,
      };
      if (isRedWalletRealDeviceProofEnabled()) {
        txid = await transferBitAssetsAfterSync(
          wallet,
          transferParams,
          operation,
        );
      } else {
        txid = await wallet.transferBitAssets(transferParams);
      }
    } else if (operation === "sync") {
      await wallet.syncBitAssets();
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
      okOperation = "sync";
    } else {
      throw new Error(
        `Unsupported BitAssets real-device selftest operation: ${operation}`,
      );
    }

    if (operation !== "sync" && !isRedWalletRealDeviceProofEnabled()) {
      await wallet.syncBitAssets();
    } else if (operation === "reserve") {
      // Register/transfer read reservation UTXOs from native cache; refresh after reserve.
      try {
        await wallet.syncBitAssets();
      } catch (syncError: any) {
        redWalletEvent("real_device_bitassets_selftest_sync_error", {
          walletID: wallet.getID?.(),
          operation,
          error: syncError?.message ?? String(syncError),
        });
      }
    }
    await RNFS.writeFile(
      BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
      JSON.stringify({
        ok: true,
        operation: okOperation,
        commandId,
        txid,
        address: wallet.getAddress() || "",
        balanceAssetCount: Object.keys(wallet.bitassetsInfo?.balances ?? {})
          .length,
        utxoCount: wallet.bitassetsUtxos.length,
        balances: wallet.bitassetsInfo?.balances ?? {},
        durationMs: Date.now() - startedAt,
        ts: new Date().toISOString(),
      }),
      "utf8",
    );
    redWalletEvent("real_device_bitassets_selftest_ok", {
      walletID: wallet.getID?.(),
      operation: okOperation,
      commandId,
      ...(assetName ? { name: assetName } : {}),
      txid,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await RNFS.writeFile(
      BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
      JSON.stringify({
        ok: false,
        operation,
        commandId,
        error: message,
        durationMs: Date.now() - startedAt,
        ts: new Date().toISOString(),
      }),
      "utf8",
    );
    redWalletEvent("real_device_bitassets_selftest_error", {
      walletID: wallet.getID?.(),
      operation,
      commandId,
      error: message,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function runBitAssetsRealDeviceSelftestCommand(
  wallet: BitAssetsWalletClass,
  prefetchedCommand = "",
): Promise<void> {
  if (realDeviceBitAssetsSelftestInFlight) {
    redWalletEvent("real_device_bitassets_selftest_skipped", {
      walletID: wallet.getID?.(),
      reason: "selftest_in_flight",
      prefetchedCommandBytes: prefetchedCommand.length,
    });
    return;
  }
  realDeviceBitAssetsSelftestInFlight = true;
  try {
    await runBitAssetsRealDeviceSelftestCommandInner(wallet, prefetchedCommand);
  } finally {
    realDeviceBitAssetsSelftestInFlight = false;
  }
}

async function postBtcRealDeviceResult(
  result: Record<string, unknown>,
): Promise<void> {
  if (!isRedWalletRealDeviceProofEnabled()) return;
  const startedAt = Date.now();
  for (const resultUrl of resolveRedWalletBtcResultUrls()) {
    try {
      const response = await fetchWithTimeout(
        resultUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result),
        },
        BTC_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS,
      );
      redWalletEvent("real_device_btc_command_result_post", {
        ok: response.ok,
        status: response.status,
        url: resultUrl,
        durationMs: Date.now() - startedAt,
        operation: result.operation,
        commandId: result.commandId,
      });
      if (response.ok) return;
    } catch (error: any) {
      redWalletEvent("real_device_btc_command_result_post_error", {
        error: error?.message ?? String(error),
        url: resultUrl,
        durationMs: Date.now() - startedAt,
        operation: result.operation,
        commandId: result.commandId,
      });
    }
  }
}

async function broadcastViaCoreRpc(
  coreRpcUrl: string,
  txhex: string,
): Promise<string> {
  const url = new URL(coreRpcUrl);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (username || password) {
    headers.authorization = `Basic ${btoa(`${username}:${password}`)}`;
  }
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "redwallet-sendrawtransaction",
        method: "sendrawtransaction",
        params: [txhex],
      }),
    },
    20000,
  );
  const body = await response.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    // Keep body below for error context.
  }
  if (!response.ok || parsed?.error) {
    throw new Error(
      `Core RPC broadcast failed: ${parsed?.error?.message ?? body}`,
    );
  }
  const txid = String(parsed?.result ?? "").trim();
  if (txid.length !== 64) {
    throw new Error(`Core RPC broadcast returned invalid txid: ${body}`);
  }
  return txid;
}

async function broadcastViaHelper(
  broadcastUrl: string,
  txhex: string,
): Promise<string> {
  const response = await fetchWithTimeout(
    broadcastUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txhex }),
    },
    20000,
  );
  const body = await response.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    // Keep body below for error context.
  }
  if (!response.ok || parsed?.ok === false) {
    throw new Error(`Broadcast helper failed: ${parsed?.error ?? body}`);
  }
  const txid = String(parsed?.txid ?? parsed?.result ?? "").trim();
  if (txid.length !== 64) {
    throw new Error(`Broadcast helper returned invalid txid: ${body}`);
  }
  return txid;
}

async function executeBtcSendL1Command(
  wallets: TWallet[],
  command: Record<string, unknown>,
): Promise<{
  txid: string;
  txhex: string;
  walletID: string;
  destinationAddress: string;
  amountSats: number;
}> {
  const walletID = String(command.walletID ?? "").trim();
  const destinationAddress = String(
    command.address ?? command.destinationAddress ?? "",
  ).trim();
  const amountSats = Number(command.amountSats ?? command.sats ?? 0);
  const feeRate = Number(command.feeRate ?? command.feeRateSatPerByte ?? 1);

  if (!destinationAddress) {
    throw new Error("sendL1 requires address");
  }
  if (!Number.isFinite(amountSats) || amountSats <= 500) {
    throw new Error(`sendL1 invalid amountSats: ${amountSats}`);
  }

  let wallet = walletID
    ? (wallets.find((w) => w.getID() === walletID) as
        | HDSegwitBech32Wallet
        | undefined)
    : undefined;
  if (walletID && !wallet) {
    throw new Error(`No native L1 wallet found for walletID ${walletID}`);
  }
  if (!wallet) {
    wallet = wallets.find((w) => w.type === HDSegwitBech32Wallet.type) as
      | HDSegwitBech32Wallet
      | undefined;
  }
  if (!wallet) {
    throw new Error("No native L1 wallet available for sendL1");
  }

  const commandUtxos = Array.isArray(command.utxos)
    ? command.utxos
        .map((utxo: any) => ({
          txid: String(utxo.txid ?? ""),
          vout: Number(utxo.vout ?? utxo.tx_pos ?? 0),
          value: Number(utxo.value ?? 0),
          address: String(utxo.address ?? ""),
          height: Number(utxo.height ?? 0),
          confirmations: Number(utxo.confirmations ?? 1),
        }))
        .filter(
          (utxo) => utxo.txid.length === 64 && utxo.address && utxo.value > 0,
        )
    : [];
  const coreRpcUrl = String(
    command.coreRpcUrl ?? command.mainchainRpcUrl ?? "",
  ).trim();
  const broadcastUrl = String(command.broadcastUrl ?? "").trim();
  const needsElectrum =
    commandUtxos.length === 0 || (!broadcastUrl && !coreRpcUrl);
  if (needsElectrum) {
    redWalletEvent("real_device_btc_send_l1_connect_begin", {
      walletID: wallet.getID(),
      destinationAddress,
      amountSats,
    });
    if (!(await BlueElectrum.ping())) {
      if (await BlueElectrum.isDisabled()) {
        await BlueElectrum.setDisabled(false);
      }
      await BlueElectrum.removePreferredServer();
      await withTimeout(
        BlueElectrum.connectMain("signet"),
        20000,
        "Timed out connecting to signet Electrum",
      );
    }
    await withTimeout(
      BlueElectrum.waitTillConnected(),
      20000,
      "Timed out waiting for signet Electrum",
    );
    if (!(await BlueElectrum.ping())) {
      throw new Error("Signet Electrum ping failed");
    }
    redWalletEvent("real_device_btc_send_l1_connect_ok", {
      walletID: wallet.getID(),
    });
  } else {
    redWalletEvent("real_device_btc_send_l1_connect_skipped", {
      walletID: wallet.getID(),
      reason: "manual_utxos_with_local_broadcast",
      utxoCount: commandUtxos.length,
      hasBroadcastUrl: !!broadcastUrl,
      hasCoreRpcUrl: !!coreRpcUrl,
    });
  }

  let utxos;
  if (commandUtxos.length > 0) {
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "manual_utxos_begin",
      utxoCount: commandUtxos.length,
    });
    utxos = commandUtxos.map((utxo) => ({
      ...utxo,
      wif: wallet._getWifForAddress(utxo.address),
    }));
    const manualBalance = utxos.reduce(
      (sum, utxo) => sum + Number(utxo.value || 0),
      0,
    );
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "manual_utxos_ok",
      utxoCount: utxos.length,
      manualBalance,
    });
    if (manualBalance < amountSats + 2000) {
      throw new Error(
        `Insufficient manual UTXO balance: ${manualBalance} < ${amountSats + 2000}`,
      );
    }
  }

  const minBalance = amountSats + 2000;
  if (!utxos) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await wallet.fetchBalance();
      if (typeof wallet.fetchUtxo === "function") {
        await wallet.fetchUtxo();
      }
      if (wallet.getBalance() >= minBalance) {
        break;
      }
      if (attempt === 19) {
        throw new Error(
          `Insufficient balance after sync: ${wallet.getBalance()} < ${minBalance}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    utxos = wallet.getUtxo();
  }

  redWalletEvent("real_device_btc_send_l1_step", {
    walletID: wallet.getID(),
    step: "change_begin",
  });
  const change = await wallet.getChangeAddressAsync();
  if (!change) {
    throw new Error("Could not derive change address");
  }
  redWalletEvent("real_device_btc_send_l1_step", {
    walletID: wallet.getID(),
    step: "change_ok",
    change,
  });

  redWalletEvent("real_device_btc_send_l1_step", {
    walletID: wallet.getID(),
    step: "create_transaction_begin",
    utxoCount: utxos.length,
  });
  const { tx } = wallet.createTransaction(
    utxos,
    [{ address: destinationAddress, value: amountSats }],
    feeRate,
    change,
    AbstractHDElectrumWallet.defaultRBFSequence,
    false,
    0,
  );
  if (!tx) {
    throw new Error("createTransaction returned no tx");
  }

  const txhex = tx.toHex();
  const txid = tx.getId();
  redWalletEvent("real_device_btc_send_l1_step", {
    walletID: wallet.getID(),
    step: "create_transaction_ok",
    txid,
    txhexBytes: txhex.length / 2,
  });
  let broadcastResult = "";
  if (broadcastUrl) {
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "helper_broadcast_begin",
      broadcastUrl,
    });
    const helperTxid = await broadcastViaHelper(broadcastUrl, txhex);
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "helper_broadcast_ok",
      txid: helperTxid,
    });
    return {
      txid: helperTxid,
      txhex,
      walletID: wallet.getID(),
      destinationAddress,
      amountSats,
    };
  }
  if (coreRpcUrl) {
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "core_broadcast_begin",
      coreRpcUrl,
    });
    const coreTxid = await broadcastViaCoreRpc(coreRpcUrl, txhex);
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "core_broadcast_ok",
      txid: coreTxid,
    });
    return {
      txid: coreTxid,
      txhex,
      walletID: wallet.getID(),
      destinationAddress,
      amountSats,
    };
  }

  try {
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "electrum_broadcast_begin",
    });
    broadcastResult = await BlueElectrum.broadcastV2(txhex);
  } catch (error: any) {
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "electrum_broadcast_error",
      error: error?.message ?? String(error),
      hasBroadcastUrl: !!broadcastUrl,
      hasCoreRpcUrl: !!coreRpcUrl,
    });
    if (broadcastUrl) {
      redWalletEvent("real_device_btc_send_l1_step", {
        walletID: wallet.getID(),
        step: "helper_broadcast_begin",
        broadcastUrl,
      });
      const helperTxid = await broadcastViaHelper(broadcastUrl, txhex);
      redWalletEvent("real_device_btc_send_l1_step", {
        walletID: wallet.getID(),
        step: "helper_broadcast_ok",
        txid: helperTxid,
      });
      return {
        txid: helperTxid,
        txhex,
        walletID: wallet.getID(),
        destinationAddress,
        amountSats,
      };
    }
    if (!coreRpcUrl) {
      throw new Error(
        `broadcastTx threw: ${error?.message ?? String(error)} txhex=${txhex}`,
      );
    }
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "core_broadcast_begin",
      coreRpcUrl,
    });
    const coreTxid = await broadcastViaCoreRpc(coreRpcUrl, txhex);
    redWalletEvent("real_device_btc_send_l1_step", {
      walletID: wallet.getID(),
      step: "core_broadcast_ok",
      txid: coreTxid,
    });
    return {
      txid: coreTxid,
      txhex,
      walletID: wallet.getID(),
      destinationAddress,
      amountSats,
    };
  }
  const broadcastOk =
    typeof broadcastResult === "string" &&
    (broadcastResult.indexOf("successfully") !== -1 ||
      broadcastResult.length === 64);
  if (!broadcastOk) {
    throw new Error(`broadcastTx failed: ${String(broadcastResult)}`);
  }

  await wallet.fetchBalance();

  return {
    txid,
    txhex,
    walletID: wallet.getID(),
    destinationAddress,
    amountSats,
  };
}

async function fetchBtcRealDeviceCommand(): Promise<string> {
  const exists = await RNFS.exists(BTC_REAL_DEVICE_COMMAND);
  if (exists) {
    const rawCommand = await RNFS.readFile(BTC_REAL_DEVICE_COMMAND, "utf8");
    await RNFS.unlink(BTC_REAL_DEVICE_COMMAND).catch(() => undefined);
    return rawCommand;
  }

  if (!isRedWalletRealDeviceProofEnabled()) return "";
  const startedAt = Date.now();
  for (const baseUrl of await resolveRedWalletBtcCommandUrls()) {
    try {
      const response = await fetchWithTimeout(
        baseUrl,
        {
          method: "GET",
          headers: { accept: "application/json" },
        },
        BTC_REAL_DEVICE_COMMAND_FETCH_TIMEOUT_MS,
      );
      if (response.status === 204 || response.status === 404) continue;
      const rawCommand = await response.text();
      redWalletEvent("real_device_btc_command_fetch", {
        url: baseUrl,
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - startedAt,
        responseBytes: rawCommand.length,
      });
      if (response.ok && rawCommand.trim()) return rawCommand;
    } catch (error: any) {
      redWalletEvent("real_device_btc_command_fetch_error", {
        url: baseUrl,
        error: error?.message ?? String(error),
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return "";
}

async function fetchLiquidRealDeviceCommand(
  options: { consumeLocalFile?: boolean } = {},
): Promise<string> {
  const consumeLocalFile = options.consumeLocalFile !== false;
  const exists = await RNFS.exists(LIQUID_REAL_DEVICE_SELFTEST_COMMAND);
  if (!exists) return "";
  let rawCommand = await RNFS.readFile(
    LIQUID_REAL_DEVICE_SELFTEST_COMMAND,
    "utf8",
  );
  if (!rawCommand.trim()) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    rawCommand = await RNFS.readFile(
      LIQUID_REAL_DEVICE_SELFTEST_COMMAND,
      "utf8",
    );
  }
  if (consumeLocalFile) {
    await RNFS.unlink(LIQUID_REAL_DEVICE_SELFTEST_COMMAND).catch(
      () => undefined,
    );
  }
  return rawCommand;
}

async function runLiquidRealDeviceSelftestCommand(
  wallet: LiquidWalletClass,
  rawCommand: string,
): Promise<void> {
  const startedAt = Date.now();
  let operation = "";
  let commandId = "";
  try {
    const command = JSON.parse(rawCommand) as Record<string, unknown>;
    operation = String(command.operation ?? "");
    commandId = String(command.commandId ?? "");
    const commandRpcUrl = String(
      command.rpcUrl ?? command.elementsRpcUrl ?? "",
    ).trim();
    if (commandRpcUrl) {
      wallet.elementsRpcUrl = normalizeLiquidRpcUrlForRuntime(commandRpcUrl);
    }
    const commandElectrumUrl = String(
      command.electrumUrl ?? command.liquidElectrumUrl ?? "",
    ).trim();
    if (commandElectrumUrl) {
      wallet.liquidElectrumUrl = commandElectrumUrl;
      wallet.liquidWalletMode = "lwk";
    }
    const commandWalletMode = String(
      command.walletMode ?? command.wallet_mode ?? "",
    ).trim();
    if (commandWalletMode === "lwk" || commandWalletMode === "utreexo") {
      wallet.liquidWalletMode = commandWalletMode as any;
    }
    const commandQuicUrl = String(
      command.liquidLiteWalletQuicUrl ?? command.quicUrl ?? "",
    ).trim();
    const resolvedCommandQuicUrl =
      commandQuicUrl ||
      (commandWalletMode === "lwk" || commandElectrumUrl
        ? "disabled"
        : undefined);
    if (commandRpcUrl || resolvedCommandQuicUrl) {
      wallet.configureLiquidEndpoints(
        commandRpcUrl
          ? normalizeLiquidRpcUrlForRuntime(commandRpcUrl)
          : undefined,
        resolvedCommandQuicUrl,
      );
    }

    let txid = "";
    if (operation === "sync") {
      await wallet.syncLiquid();
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
    } else if (operation === "transfer") {
      txid = await wallet.transferLiquid({
        destinationAddress: String(
          command.destinationAddress ?? command.address ?? "",
        ),
        amount: Number(command.amount ?? command.amountSats ?? 0),
        assetId: command.assetId ? String(command.assetId) : undefined,
        feeSats: Number(command.feeSats ?? 0),
        memo: command.memo ? String(command.memo) : undefined,
      });
      await wallet.syncLiquid();
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
    } else {
      throw new Error(`Unsupported Liquid selftest operation: ${operation}`);
    }

    await RNFS.writeFile(
      LIQUID_REAL_DEVICE_SELFTEST_RESULT,
      JSON.stringify({
        ok: true,
        operation,
        commandId,
        txid,
        walletID: wallet.getID(),
        address: wallet.getAddress() || "",
        rpcUrl: wallet.elementsRpcUrl,
        balanceAssetCount: Object.keys(wallet.liquidInfo?.balances ?? {})
          .length,
        utxoCount: wallet.liquidUtxos.length,
        utxos: wallet.liquidUtxos,
        balances: wallet.liquidInfo?.balances ?? {},
        durationMs: Date.now() - startedAt,
        ts: new Date().toISOString(),
      }),
      "utf8",
    );
    redWalletEvent("real_device_liquid_selftest_ok", {
      operation,
      commandId,
      walletID: wallet.getID(),
      txid,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const result = {
      ok: false,
      operation,
      commandId,
      error: error?.message ?? String(error),
      stack: error?.stack ?? "",
      durationMs: Date.now() - startedAt,
      ts: new Date().toISOString(),
    };
    await RNFS.writeFile(
      LIQUID_REAL_DEVICE_SELFTEST_RESULT,
      JSON.stringify(result),
      "utf8",
    ).catch(() => undefined);
    redWalletEvent("real_device_liquid_selftest_error", result);
  }
}

interface StorageContextType {
  wallets: TWallet[];
  setWalletsWithNewOrder: (wallets: TWallet[]) => void;
  txMetadata: TTXMetadata;
  counterpartyMetadata: TCounterpartyMetadata;
  saveToDisk: (force?: boolean) => Promise<void>;
  selectedWalletID: () => string | undefined; // Change from string|undefined to a function
  addWallet: (wallet: TWallet) => void;
  deleteWallet: (wallet: TWallet) => Promise<void>;
  currentSharedCosigner: string;
  setSharedCosigner: (cosigner: string) => void;
  addAndSaveWallet: (wallet: TWallet) => Promise<void>;
  fetchAndSaveWalletTransactions: (walletID: string) => Promise<void>;
  walletsInitialized: boolean;
  setWalletsInitialized: (initialized: boolean) => void;
  refreshAllWalletTransactions: (
    lastSnappedTo?: number,
    showUpdateStatusIndicator?: boolean,
  ) => Promise<void>;
  resetWallets: () => void;
  walletTransactionUpdateStatus: WalletTransactionsStatus | string;
  setWalletTransactionUpdateStatus: (
    status: WalletTransactionsStatus | string,
  ) => void;
  getTransactions: typeof BlueApp.getTransactions;
  fetchWalletBalances: typeof BlueApp.fetchWalletBalances;
  fetchWalletTransactions: typeof BlueApp.fetchWalletTransactions;
  getBalance: typeof BlueApp.getBalance;
  isStorageEncrypted: typeof BlueApp.storageIsEncrypted;
  startAndDecrypt: typeof startAndDecrypt;
  encryptStorage: typeof BlueApp.encryptStorage;
  sleep: typeof BlueApp.sleep;
  createFakeStorage: typeof BlueApp.createFakeStorage;
  decryptStorage: typeof BlueApp.decryptStorage;
  isPasswordInUse: typeof BlueApp.isPasswordInUse;
  cachedPassword: typeof BlueApp.cachedPassword;
  getItem: typeof BlueApp.getItem;
  setItem: typeof BlueApp.setItem;
  handleWalletDeletion: (
    walletID: string,
    forceDelete?: boolean,
  ) => Promise<boolean>;
  confirmWalletDeletion: (wallet: any, onConfirmed: () => void) => void;
}

export enum WalletTransactionsStatus {
  NONE = "NONE",
  ALL = "ALL",
}

// @ts-ignore default value does not match the type
export const StorageContext = createContext<StorageContextType>(undefined);

export const StorageProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const txMetadata = useRef<TTXMetadata>(BlueApp.tx_metadata);
  const counterpartyMetadata = useRef<TCounterpartyMetadata>(
    BlueApp.counterparty_metadata || {},
  ); // init

  const [wallets, setWallets] = useState<TWallet[]>([]);
  const [walletTransactionUpdateStatus, setWalletTransactionUpdateStatus] =
    useState<WalletTransactionsStatus | string>(WalletTransactionsStatus.NONE);
  const [walletsInitialized, setWalletsInitialized] = useState<boolean>(false);
  const [currentSharedCosigner, setCurrentSharedCosigner] =
    useState<string>("");

  const selectedWalletID = useCallback((): string | undefined => {
    if (!navigationRef.current || !navigationRef.current.isReady())
      return undefined;

    const screensToCheck = [
      "LNDCreateInvoice",
      "SendDetails",
      "WalletTransactions",
      "TransactionStatus",
    ];

    const currentRoute = navigationRef.current.getCurrentRoute();
    console.debug("[StorageProvider] Current route:", currentRoute?.name);

    if (currentRoute) {
      if (screensToCheck.includes(currentRoute.name) && currentRoute.params) {
        const params = currentRoute.params as { walletID?: string };
        if (params.walletID) {
          console.debug(
            "[StorageProvider] selectedWalletID from current route:",
            params.walletID,
          );
          return params.walletID;
        }
      }
    }

    const state = navigationRef.current.getState();

    if (state?.routes) {
      for (const screenName of screensToCheck) {
        const walletID = findWalletIDInNavigationState(
          state.routes,
          screenName,
        );
        if (walletID) {
          console.debug(
            "[StorageProvider] selectedWalletID from navigation state:",
            walletID,
            "in screen:",
            screenName,
          );
          return walletID;
        }
      }

      const drawerRoute = state.routes.find(
        (route) => route.name === "DrawerRoot",
      );
      if (drawerRoute?.state?.routes) {
        const detailViewStack = drawerRoute.state.routes.find(
          (route) => route.name === "DetailViewStackScreensStack",
        );
        if (detailViewStack?.state?.routes) {
          for (const route of detailViewStack.state.routes) {
            if (
              screensToCheck.includes(route.name) &&
              (route.params as { walletID?: string })?.walletID
            ) {
              console.debug(
                "[StorageProvider] selectedWalletID from drawer navigation:",
                (route.params as { walletID?: string })?.walletID,
              );
              return (route.params as { walletID?: string })?.walletID;
            }
          }
        }
      }
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findWalletIDInNavigationState = (
    routes: any[],
    screenName: string,
  ): string | undefined => {
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i];

      if (
        route.name === screenName &&
        (route.params as { walletID?: string }).walletID
      ) {
        return (route.params as { walletID?: string }).walletID;
      }

      if (route.state?.routes) {
        const walletID = findWalletIDInNavigationState(
          route.state.routes,
          screenName,
        );
        if (walletID) return walletID;
      }

      if (
        route.params?.screen === screenName &&
        route.params?.params?.walletID
      ) {
        return route.params.params.walletID;
      }

      if (
        route.name === "DetailViewStackScreensStack" &&
        route.params?.screen === screenName &&
        route.params?.params?.walletID
      ) {
        return route.params.params.walletID;
      }
    }

    return undefined;
  };

  const saveToDisk = useCallback(
    async (force: boolean = false) => {
      if (!force && BlueApp.getWallets().length === 0) {
        console.debug("Not saving empty wallets array");
        return;
      }
      BlueApp.tx_metadata = txMetadata.current;
      BlueApp.counterparty_metadata = counterpartyMetadata.current;
      await BlueApp.saveToDisk();
      const w: TWallet[] = [...BlueApp.getWallets()];
      setWallets(w);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txMetadata.current, counterpartyMetadata.current],
  );

  const addWallet = useCallback((wallet: TWallet) => {
    const walletID = wallet.getID?.();
    if (
      walletID &&
      BlueApp.wallets.some(
        (existingWallet) => existingWallet.getID?.() === walletID,
      )
    ) {
      console.warn(`Skipping duplicate wallet add for ${walletID}`);
      setWallets([...BlueApp.getWallets()]);
      return;
    }
    BlueApp.wallets.push(wallet);
    setWallets([...BlueApp.getWallets()]);
  }, []);

  const deleteWallet = useCallback(async (wallet: TWallet) => {
    await BlueApp.deleteWallet(wallet);
    setWallets([...BlueApp.getWallets()]);
  }, []);

  const handleWalletDeletion = useCallback(
    async (walletID: string, forceDelete = false): Promise<boolean> => {
      console.debug(`handleWalletDeletion: invoked for walletID ${walletID}`);
      const wallet = wallets.find((w) => w.getID() === walletID);
      if (!wallet) {
        console.warn(`handleWalletDeletion: wallet not found for ${walletID}`);
        return false;
      }

      if (forceDelete) {
        await deleteWallet(wallet);
        await saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        return true;
      }

      let isNotificationsSettingsEnabled = false;
      try {
        isNotificationsSettingsEnabled = await isNotificationsEnabled();
      } catch (error) {
        console.error(
          `handleWalletDeletion: error checking notifications for wallet ${walletID}`,
          error,
        );
        return await new Promise<boolean>((resolve) => {
          presentAlert({
            title: loc.errors.error,
            message: loc.wallets.details_delete_wallet_error_message,
            buttons: [
              {
                text: loc.wallets.details_delete_anyway,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID, true);
                  resolve(result);
                },
                style: "destructive",
              },
              {
                text: loc.wallets.list_tryagain,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
              },
              {
                text: loc._.cancel,
                onPress: () => resolve(false),
                style: "cancel",
              },
            ],
            options: { cancelable: false },
          });
        });
      }

      try {
        if (isNotificationsSettingsEnabled) {
          const externalAddresses = wallet.getAllExternalAddresses();
          if (externalAddresses.length > 0) {
            console.debug(
              `handleWalletDeletion: unsubscribing addresses for wallet ${walletID}`,
            );
            try {
              await unsubscribe(externalAddresses, [], []);
              console.debug(
                `handleWalletDeletion: unsubscribe succeeded for wallet ${walletID}`,
              );
            } catch (unsubscribeError) {
              console.error(
                `handleWalletDeletion: unsubscribe failed for wallet ${walletID}`,
                unsubscribeError,
              );
              presentAlert({
                title: loc.errors.error,
                message: loc.wallets.details_delete_wallet_error_message,
                buttons: [{ text: loc._.ok, onPress: () => {} }],
                options: { cancelable: false },
              });
              return false;
            }
          }
        }
        await deleteWallet(wallet);
        console.debug(
          `handleWalletDeletion: wallet ${walletID} deleted successfully`,
        );
        await saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        return true;
      } catch (e: unknown) {
        console.error(
          `handleWalletDeletion: encountered error for wallet ${walletID}`,
          e,
        );
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return await new Promise<boolean>((resolve) => {
          presentAlert({
            title: loc.errors.error,
            message: loc.wallets.details_delete_wallet_error_message,
            buttons: [
              {
                text: loc.wallets.details_delete_anyway,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID, true);
                  resolve(result);
                },
                style: "destructive",
              },
              {
                text: loc.wallets.list_tryagain,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
              },
              {
                text: loc._.cancel,
                onPress: () => resolve(false),
                style: "cancel",
              },
            ],
            options: { cancelable: false },
          });
        });
      }
    },
    [deleteWallet, saveToDisk, wallets],
  );

  const resetWallets = useCallback(() => {
    setWallets(BlueApp.getWallets());
  }, []);

  const setWalletsWithNewOrder = useCallback(
    (wlts: TWallet[]) => {
      BlueApp.wallets = wlts;
      saveToDisk();
    },
    [saveToDisk],
  );

  // Initialize wallets
  useEffect(() => {
    if (walletsInitialized) {
      txMetadata.current = BlueApp.tx_metadata;
      counterpartyMetadata.current = BlueApp.counterparty_metadata;
      setWallets(BlueApp.getWallets());
    }
  }, [walletsInitialized]);

  // Add a refresh lock to prevent concurrent refreshes
  const refreshingRef = useRef<boolean>(false);
  const realDeviceSmokeRef = useRef<boolean>(false);
  const realDeviceBtcCommandRef = useRef<boolean>(false);
  const realDeviceBitAssetsCommandRef = useRef<boolean>(false);
  const realDeviceLiquidCommandRef = useRef<boolean>(false);

  const refreshAllWalletTransactions = useCallback(
    async (
      lastSnappedTo?: number,
      showUpdateStatusIndicator: boolean = true,
    ) => {
      if (refreshingRef.current) {
        console.debug(
          "[refreshAllWalletTransactions] Refresh already in progress",
        );
        return;
      }
      console.debug("[refreshAllWalletTransactions] Starting refresh");
      refreshingRef.current = true;

      const TIMEOUT_DURATION = 30000;
      let refreshTimeout;
      const timeoutPromise = new Promise<never>(
        (_resolve, reject) =>
          (refreshTimeout = setTimeout(() => {
            console.debug("[refreshAllWalletTransactions] Timeout reached");
            reject(new Error("Timeout reached"));
          }, TIMEOUT_DURATION)),
      );

      try {
        if (showUpdateStatusIndicator) {
          console.debug(
            "[refreshAllWalletTransactions] Setting wallet transaction status to ALL",
          );
          setWalletTransactionUpdateStatus(WalletTransactionsStatus.ALL);
        }
        console.debug(
          "[refreshAllWalletTransactions] Waiting for connectivity...",
        );
        await BlueElectrum.waitTillConnected();
        if (!(await BlueElectrum.ping())) {
          // above `waitTillConnected` is not reliable, as app might have returned from long sleep, so it thinks its
          // connected but actually socket is closed. thus, we ping, and if it fails - we wait again (reconnection code
          // should pick up)
          console.log(
            "[refreshAllWalletTransactions] ping failed, waiting for connection...",
          );
          await BlueElectrum.waitTillConnected();
        }

        console.debug("[refreshAllWalletTransactions] Connected to Electrum");

        // Restore fetch payment codes timing measurement
        if (typeof BlueApp.fetchSenderPaymentCodes === "function") {
          const codesStart = Date.now();
          console.debug(
            "[refreshAllWalletTransactions] Fetching sender payment codes",
          );
          await BlueApp.fetchSenderPaymentCodes(lastSnappedTo);
          const codesEnd = Date.now();
          console.debug(
            "[refreshAllWalletTransactions] fetch payment codes took",
            (codesEnd - codesStart) / 1000,
            "sec",
          );
        } else {
          console.warn(
            "[refreshAllWalletTransactions] fetchSenderPaymentCodes is not available",
          );
        }

        console.debug(
          "[refreshAllWalletTransactions] Fetching wallet balances and transactions",
        );
        await Promise.race([
          (async () => {
            const balanceStart = Date.now();
            await BlueApp.fetchWalletBalances(lastSnappedTo);
            const balanceEnd = Date.now();
            console.debug(
              "[refreshAllWalletTransactions] fetch balance took",
              (balanceEnd - balanceStart) / 1000,
              "sec",
            );

            const txStart = Date.now();
            await BlueApp.fetchWalletTransactions(lastSnappedTo);
            const txEnd = Date.now();
            console.debug(
              "[refreshAllWalletTransactions] fetch tx took",
              (txEnd - txStart) / 1000,
              "sec",
            );

            clearTimeout(refreshTimeout);

            console.debug("[refreshAllWalletTransactions] Saving data to disk");
            await saveToDisk();
          })(),
          timeoutPromise,
        ]);
        console.debug(
          "[refreshAllWalletTransactions] Refresh completed successfully",
        );
      } catch (error) {
        console.error("[refreshAllWalletTransactions] Error:", error);
      } finally {
        console.debug(
          "[refreshAllWalletTransactions] Resetting wallet transaction status and refresh lock",
        );
        setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
        refreshingRef.current = false;
      }
    },
    [saveToDisk],
  );

  const fetchAndSaveWalletTransactions = useCallback(
    async (walletID: string) => {
      const index = wallets.findIndex((wallet) => wallet.getID() === walletID);
      let noErr = true;
      try {
        if (
          Date.now() - (_lastTimeTriedToRefetchWallet[walletID] || 0) <
          5000
        ) {
          console.debug(
            "[fetchAndSaveWalletTransactions] Re-fetch wallet happens too fast; NOP",
          );
          return;
        }
        _lastTimeTriedToRefetchWallet[walletID] = Date.now();

        await BlueElectrum.waitTillConnected();
        setWalletTransactionUpdateStatus(walletID);

        const balanceStart = Date.now();
        await BlueApp.fetchWalletBalances(index);
        const balanceEnd = Date.now();
        console.debug(
          "[fetchAndSaveWalletTransactions] fetch balance took",
          (balanceEnd - balanceStart) / 1000,
          "sec",
        );

        const txStart = Date.now();
        await BlueApp.fetchWalletTransactions(index);
        const txEnd = Date.now();
        console.debug(
          "[fetchAndSaveWalletTransactions] fetch tx took",
          (txEnd - txStart) / 1000,
          "sec",
        );
      } catch (err) {
        noErr = false;
        console.error("[fetchAndSaveWalletTransactions] Error:", err);
      } finally {
        setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
      }
      if (noErr) await saveToDisk();
    },
    [saveToDisk, wallets],
  );

  useEffect(() => {
    if (
      !isRedWalletRealDeviceProofEnabled() ||
      realDeviceBitAssetsCommandRef.current ||
      !walletsInitialized
    )
      return;

    let cancelled = false;
    const maybeCreateBitAssetsWallet = async () => {
      if (cancelled || realDeviceBitAssetsCommandRef.current) return;
      const rawCommand = await fetchBitAssetsRealDeviceCommand("", {
        consumeLocalFile: false,
      });
      if (!rawCommand) return;

      const startedAt = Date.now();
      let operation = "";
      let commandId = "";
      try {
        const command = JSON.parse(rawCommand);
        operation = String(command.operation ?? "");
        commandId = String(command.commandId ?? "");

        if (operation !== "createWallet") {
          return;
        }

        const existingBitAssetsWallets = wallets.filter(
          (wallet) => wallet.type === BitAssetsWalletClass.type,
        );
        if (existingBitAssetsWallets.length > 0) {
          await RNFS.unlink(BITASSETS_REAL_DEVICE_SELFTEST_COMMAND).catch(
            () => undefined,
          );
          const result = {
            ok: true,
            status: "create_wallet_already_exists",
            operation,
            commandId,
            walletCount: existingBitAssetsWallets.length,
            availableWalletIDs: existingBitAssetsWallets
              .map((w) => w.getID?.())
              .filter(Boolean),
            ts: new Date().toISOString(),
          };
          await RNFS.writeFile(
            BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
            JSON.stringify(result),
            "utf8",
          ).catch(() => undefined);
          redWalletEvent("real_device_bitassets_wallet_create_skipped", result);
          return;
        }

        realDeviceBitAssetsCommandRef.current = true;
        await RNFS.unlink(BITASSETS_REAL_DEVICE_SELFTEST_COMMAND).catch(
          () => undefined,
        );
        redWalletEvent("real_device_bitassets_command_begin", {
          operation,
          commandId,
        });

        const wallet = new BitAssetsWalletClass();
        wallet.setLabel(String(command.label ?? "iPhone BitAssets"));
        wallet.setUserHasSavedExport(true);
        const rpcUrl = normalizeBitAssetsRpcUrlForRuntime(
          String(
            command.rpcUrl ??
              command.bitassetsRpcUrl ??
              REDWALLET_SIGNET_BITASSETS_RPC_URL,
          ),
        );
        const quicUrl =
          command.bitassetsLiteWalletQuicUrl === undefined
            ? undefined
            : String(command.bitassetsLiteWalletQuicUrl ?? "");
        await wallet.clearNativeSigner();
        await wallet.generate(rpcUrl, quicUrl);
        if (!command.skipSync) {
          await wallet.syncBitAssets();
        }
        addWallet(wallet);
        await saveToDisk(true);

        const result = {
          ok: true,
          operation,
          commandId,
          walletID: wallet.getID(),
          label: wallet.getLabel(),
          type: wallet.type,
          typeReadable: wallet.typeReadable,
          address: wallet.getAddress() || "",
          rpcUrl: wallet.bitassetsRpcUrl,
          liteWalletQuicUrl: wallet.bitassetsLiteWalletQuicUrl,
          info: wallet.bitassetsInfo,
          utxoCount: wallet.bitassetsUtxos.length,
          durationMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        };

        await RNFS.writeFile(
          BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
          JSON.stringify(result),
          "utf8",
        );
        redWalletEvent("real_device_bitassets_wallet_created", result);
      } catch (error: any) {
        const result = {
          ok: false,
          operation,
          commandId,
          error: error?.message ?? String(error),
          stack: error?.stack ?? "",
          durationMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        };
        await RNFS.writeFile(
          BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
          JSON.stringify(result),
          "utf8",
        ).catch(() => undefined);
        redWalletEvent("real_device_bitassets_command_error", result);
      }
    };
    const runMaybeCreateBitAssetsWallet = () => {
      maybeCreateBitAssetsWallet().catch(() => undefined);
    };
    runMaybeCreateBitAssetsWallet();
    const interval = setInterval(runMaybeCreateBitAssetsWallet, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [addWallet, saveToDisk, wallets, walletsInitialized]);

  useEffect(() => {
    let cancelled = false;
    const maybeCreateLiquidWallet = async () => {
      if (cancelled || realDeviceLiquidCommandRef.current) return;
      const rawCommand = await fetchLiquidRealDeviceCommand({
        consumeLocalFile: false,
      });
      if (!rawCommand) return;

      const startedAt = Date.now();
      let operation = "";
      let commandId = "";
      try {
        const command = JSON.parse(rawCommand) as Record<string, unknown>;
        operation = String(command.operation ?? "");
        commandId = String(command.commandId ?? "");
        if (operation !== "createWallet") {
          return;
        }

        realDeviceLiquidCommandRef.current = true;
        await RNFS.unlink(LIQUID_REAL_DEVICE_SELFTEST_COMMAND).catch(
          () => undefined,
        );
        redWalletEvent("real_device_liquid_command_begin", {
          operation,
          commandId,
        });

        const wallet = new LiquidWalletClass();
        wallet.setLabel(String(command.label ?? "iOS Liquid sim"));
        wallet.setUserHasSavedExport(true);
        const requestedRpcUrl = String(
          command.rpcUrl ?? command.elementsRpcUrl ?? "",
        ).trim();
        const requestedElectrumUrl = String(
          command.electrumUrl ?? command.liquidElectrumUrl ?? "",
        ).trim();
        if (requestedElectrumUrl) {
          wallet.liquidElectrumUrl = requestedElectrumUrl;
          wallet.liquidWalletMode = "lwk";
        }
        const requestedWalletMode = String(
          command.walletMode ?? command.wallet_mode ?? "",
        ).trim();
        if (
          requestedWalletMode === "lwk" ||
          requestedWalletMode === "utreexo"
        ) {
          wallet.liquidWalletMode = requestedWalletMode as any;
        }
        const requestedQuicUrl = String(
          command.liquidLiteWalletQuicUrl ?? command.quicUrl ?? "",
        ).trim();
        const resolvedRequestedQuicUrl =
          requestedQuicUrl ||
          (requestedWalletMode === "utreexo" ? undefined : "disabled");
        await wallet.generate(
          requestedRpcUrl
            ? normalizeLiquidRpcUrlForRuntime(requestedRpcUrl)
            : undefined,
          resolvedRequestedQuicUrl,
        );
        if (!command.skipSync) {
          await wallet.syncLiquid();
          await wallet.fetchBalance();
          await wallet.fetchTransactions();
        }
        addWallet(wallet);
        await saveToDisk(true);

        const result = {
          ok: true,
          operation,
          commandId,
          walletID: wallet.getID(),
          label: wallet.getLabel(),
          type: wallet.type,
          typeReadable: wallet.typeReadable,
          address: wallet.getAddress() || "",
          rpcUrl: wallet.elementsRpcUrl,
          balanceAssetCount: Object.keys(wallet.liquidInfo?.balances ?? {})
            .length,
          utxoCount: wallet.liquidUtxos.length,
          balances: wallet.liquidInfo?.balances ?? {},
          durationMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        };
        await RNFS.writeFile(
          LIQUID_REAL_DEVICE_SELFTEST_RESULT,
          JSON.stringify(result),
          "utf8",
        );
        redWalletEvent("real_device_liquid_wallet_created", result);
      } catch (error: any) {
        const result = {
          ok: false,
          operation,
          commandId,
          error: error?.message ?? String(error),
          stack: error?.stack ?? "",
          durationMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        };
        await RNFS.writeFile(
          LIQUID_REAL_DEVICE_SELFTEST_RESULT,
          JSON.stringify(result),
          "utf8",
        ).catch(() => undefined);
        redWalletEvent("real_device_liquid_command_error", result);
      } finally {
        if (operation === "createWallet") {
          realDeviceLiquidCommandRef.current = false;
        }
      }
    };

    const runMaybeCreateLiquidWallet = () => {
      maybeCreateLiquidWallet().catch(() => undefined);
    };
    runMaybeCreateLiquidWallet();
    const interval = setInterval(runMaybeCreateLiquidWallet, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [addWallet, saveToDisk, wallets, walletsInitialized]);

  useEffect(() => {
    if (
      !isRedWalletRealDeviceProofEnabled() ||
      realDeviceSmokeRef.current ||
      !walletsInitialized
    )
      return;
    const bitAssetsWallets = wallets.filter(
      (wallet): wallet is BitAssetsWalletClass =>
        wallet.type === BitAssetsWalletClass.type,
    );
    if (bitAssetsWallets.length === 0) return;
    realDeviceSmokeRef.current = true;
    (async () => {
      const proofMode = isRedWalletRealDeviceProofEnabled();
      let smokeWallets = proofMode
        ? bitAssetsWallets.slice(0, 1)
        : bitAssetsWallets;
      let prefetchedCommand = proofMode
        ? await fetchBitAssetsRealDeviceCommand(
            smokeWallets[0]?.getID?.() ?? "",
            { consumeLocalFile: false },
          )
        : "";
      let smokeCommand: Record<string, unknown> = {};
      if (prefetchedCommand.trim()) {
        try {
          smokeCommand = JSON.parse(prefetchedCommand) as Record<
            string,
            unknown
          >;
          if (String(smokeCommand.operation ?? "") === "createWallet") {
            prefetchedCommand = "";
            smokeCommand = {};
          }
        } catch {
          prefetchedCommand = "";
        }
      }
      if (proofMode && prefetchedCommand.trim()) {
        const resolved = await resolveBitAssetsSelftestWallet(
          bitAssetsWallets,
          smokeCommand,
        );
        if (resolved) {
          smokeWallets = [resolved];
        }
      }
      redWalletEvent("real_device_bitassets_smoke_begin", {
        walletCount: bitAssetsWallets.length,
        smokeWalletCount: smokeWallets.length,
        prefetchedCommandBytes: prefetchedCommand.length,
      });
      for (const wallet of smokeWallets) {
        try {
          const address = wallet.getAddress() || "";
          const hasCommand = prefetchedCommand.trim().length > 0;
          const rpcUrl = hasCommand
            ? wallet.bitassetsRpcUrl
            : normalizeBitAssetsRpcUrlForRuntime(wallet.bitassetsRpcUrl);
          if (!hasCommand && wallet.bitassetsRpcUrl !== rpcUrl) {
            wallet.bitassetsRpcUrl = rpcUrl;
          }
          const quicUrl = hasCommand
            ? wallet.bitassetsLiteWalletQuicUrl
            : normalizeBitAssetsLiteWalletQuicUrlForRuntime(
                rpcUrl,
                wallet.bitassetsLiteWalletQuicUrl,
              );
          if (!hasCommand && wallet.bitassetsLiteWalletQuicUrl !== quicUrl) {
            wallet.bitassetsLiteWalletQuicUrl = quicUrl;
          }
          redWalletEvent("real_device_bitassets_smoke_wallet", {
            walletID: wallet.getID?.(),
            address,
            rpcUrl,
            liteWalletQuicUrl: quicUrl,
            hasAddress: address.length > 0,
          });
          // Command-server selftest first — rpc probe can block and QUIC sync may never return.
          await runBitAssetsRealDeviceSelftestCommand(
            wallet,
            prefetchedCommand,
          );
          if (!proofMode) {
            const rpcHealth = await probeBitAssetsRpc(rpcUrl);
            redWalletEvent("real_device_bitassets_rpc_probe", {
              walletID: wallet.getID?.(),
              rpcUrl,
              ...rpcHealth,
            });
          }
          let info: Awaited<
            ReturnType<BitAssetsWalletClass["syncBitAssets"]>
          > | null = null;
          if (!proofMode) {
            try {
              info = await wallet.syncBitAssets();
              await wallet.fetchBalance();
              await wallet.fetchTransactions();
            } catch (syncError: any) {
              redWalletEvent("real_device_bitassets_smoke_sync_error", {
                walletID: wallet.getID?.(),
                rpcUrl: wallet.bitassetsRpcUrl,
                error: syncError?.message ?? String(syncError),
              });
            }
          }
          redWalletEvent("real_device_bitassets_smoke_ok", {
            walletID: wallet.getID?.(),
            address: wallet.getAddress() || "",
            rpcUrl: wallet.bitassetsRpcUrl,
            tip: info?.last_tip_height ?? null,
            balanceAssetCount: Object.keys(info?.balances ?? {}).length,
            utxoCount: wallet.bitassetsUtxos.length,
          });
        } catch (error: any) {
          redWalletEvent("real_device_bitassets_smoke_error", {
            walletID: wallet.getID?.(),
            error: error?.message ?? String(error),
          });
        }
      }
      await saveToDisk().catch((error) => {
        redWalletEvent("real_device_bitassets_smoke_save_error", {
          error: error?.message ?? String(error),
        });
      });
      redWalletEvent("real_device_bitassets_smoke_done", {
        walletCount: bitAssetsWallets.length,
      });
    })();
  }, [saveToDisk, wallets, walletsInitialized]);

  // USB push can land while the app stays foregrounded; devicectl cold launch often fails (CoreDevice 1011).
  useEffect(() => {
    if (!isRedWalletRealDeviceProofEnabled() || !walletsInitialized) return;
    const bitAssetsWallets = wallets.filter(
      (wallet): wallet is BitAssetsWalletClass =>
        wallet.type === BitAssetsWalletClass.type,
    );
    if (bitAssetsWallets.length === 0) return;

    let cancelled = false;
    const maybeRunPushedSelftest = async () => {
      if (cancelled) return;
      let prefetchedCommand = "";
      const commandExists = await RNFS.exists(
        BITASSETS_REAL_DEVICE_SELFTEST_COMMAND,
      );
      if (commandExists) {
        prefetchedCommand = await RNFS.readFile(
          BITASSETS_REAL_DEVICE_SELFTEST_COMMAND,
          "utf8",
        );
        await RNFS.unlink(BITASSETS_REAL_DEVICE_SELFTEST_COMMAND).catch(
          () => undefined,
        );
      } else {
        prefetchedCommand = await fetchBitAssetsRealDeviceCommand(
          bitAssetsWallets[0]?.getID?.() ?? "",
        );
        if (!prefetchedCommand.trim()) return;
      }
      let command: Record<string, unknown> = {};
      try {
        command = JSON.parse(prefetchedCommand) as Record<string, unknown>;
      } catch (error: any) {
        redWalletEvent("real_device_bitassets_selftest_error", {
          operation: "parseCommand",
          error: error?.message ?? String(error),
          commandBytes: prefetchedCommand.length,
        });
        return;
      }
      redWalletEvent("real_device_bitassets_selftest_command_seen", {
        operation: String(command.operation ?? ""),
        commandId: String(command.commandId ?? ""),
        commandWalletID: String(command.walletID ?? command.walletId ?? ""),
        walletCount: bitAssetsWallets.length,
        availableWalletIDs: bitAssetsWallets
          .map((w) => w.getID?.())
          .filter(Boolean),
        commandBytes: prefetchedCommand.length,
      });
      if (String(command.operation ?? "") === "createWallet") {
        await RNFS.writeFile(
          BITASSETS_REAL_DEVICE_SELFTEST_RESULT,
          JSON.stringify({
            ok: true,
            status: "create_wallet_already_consumed",
            operation: "createWallet",
            commandId: String(command.commandId ?? ""),
            walletCount: bitAssetsWallets.length,
            availableWalletIDs: bitAssetsWallets
              .map((w) => w.getID?.())
              .filter(Boolean),
            ts: new Date().toISOString(),
          }),
          "utf8",
        ).catch(() => undefined);
        return;
      }
      const wallet = await resolveBitAssetsSelftestWallet(
        bitAssetsWallets,
        command,
      );
      if (!wallet) {
        const missingWalletId = String(
          command.walletID ?? command.walletId ?? "",
        ).trim();
        redWalletEvent("real_device_bitassets_selftest_error", {
          walletID: missingWalletId,
          operation: String(command.operation ?? ""),
          error: missingWalletId
            ? `BitAssets wallet ${missingWalletId} is not loaded on device`
            : "No BitAssets wallet is available for command",
          availableWalletIDs: bitAssetsWallets
            .map((w) => w.getID?.())
            .filter(Boolean),
        });
        return;
      }
      const rpcUrl = normalizeBitAssetsRpcUrlForRuntime(wallet.bitassetsRpcUrl);
      if (wallet.bitassetsRpcUrl !== rpcUrl) {
        wallet.bitassetsRpcUrl = rpcUrl;
      }
      const quicUrl = normalizeBitAssetsLiteWalletQuicUrlForRuntime(
        rpcUrl,
        wallet.bitassetsLiteWalletQuicUrl,
      );
      if (wallet.bitassetsLiteWalletQuicUrl !== quicUrl) {
        wallet.bitassetsLiteWalletQuicUrl = quicUrl;
      }
      redWalletEvent("real_device_bitassets_selftest_push_resume", {
        walletID: wallet.getID?.(),
        rpcUrl,
        liteWalletQuicUrl: quicUrl,
      });
      await runBitAssetsRealDeviceSelftestCommand(wallet, prefetchedCommand);
    };

    const runPushedSelftest = () => {
      maybeRunPushedSelftest().catch(() => undefined);
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runPushedSelftest();
    });
    runPushedSelftest();
    const interval = setInterval(runPushedSelftest, 4000);
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(interval);
    };
  }, [wallets, walletsInitialized]);

  useEffect(() => {
    if (!walletsInitialized) return;
    const liquidWallets = wallets.filter(
      (wallet): wallet is LiquidWalletClass =>
        wallet.type === LiquidWalletClass.type,
    );
    if (liquidWallets.length === 0) return;

    let cancelled = false;
    const maybeRunPushedLiquidSelftest = async () => {
      if (cancelled) return;
      const rawCommand = await fetchLiquidRealDeviceCommand();
      if (!rawCommand) return;
      let command: Record<string, unknown> = {};
      try {
        command = JSON.parse(rawCommand) as Record<string, unknown>;
      } catch {
        return;
      }
      if (String(command.operation ?? "") === "createWallet") {
        await RNFS.writeFile(
          LIQUID_REAL_DEVICE_SELFTEST_COMMAND,
          rawCommand,
          "utf8",
        ).catch(() => undefined);
        return;
      }
      const walletID = String(
        command.walletID ?? command.walletId ?? "",
      ).trim();
      const wallet =
        (walletID
          ? liquidWallets.find((w) => w.getID() === walletID)
          : liquidWallets[0]) ?? liquidWallets[0];
      await runLiquidRealDeviceSelftestCommand(wallet, rawCommand);
      await saveToDisk().catch((error) => {
        redWalletEvent("real_device_liquid_selftest_save_error", {
          error: error?.message ?? String(error),
        });
      });
    };

    const runPushedLiquidSelftest = () => {
      maybeRunPushedLiquidSelftest().catch(() => undefined);
    };
    runPushedLiquidSelftest();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runPushedLiquidSelftest();
    });
    const interval = setInterval(runPushedLiquidSelftest, 4000);
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(interval);
    };
  }, [saveToDisk, wallets, walletsInitialized]);

  useEffect(() => {
    if (!isRedWalletRealDeviceProofEnabled() || !walletsInitialized) return;

    let cancelled = false;
    const runBtcRealDeviceCommand = async () => {
      if (cancelled || realDeviceBtcCommandInFlight) return;
      const rawCommand = await fetchBtcRealDeviceCommand();
      if (!rawCommand) return;
      realDeviceBtcCommandInFlight = true;

      const startedAt = Date.now();
      let operation = "";
      let commandId = "";
      try {
        const command = JSON.parse(rawCommand) as Record<string, unknown>;
        operation = String(command.operation ?? "");
        commandId = String(command.commandId ?? "");
        redWalletEvent("real_device_btc_command_begin", {
          operation,
          commandId,
        });

        if (operation === "createWallet") {
          if (realDeviceBtcCommandRef.current) {
            return;
          }
          realDeviceBtcCommandRef.current = true;

          redWalletEvent("real_device_btc_create_wallet_step", {
            commandId,
            step: "generate_begin",
          });
          const wallet = new HDSegwitBech32Wallet();
          await wallet.generate();
          redWalletEvent("real_device_btc_create_wallet_step", {
            commandId,
            step: "generate_ok",
          });
          wallet.setLabel(
            String(command.label ?? "iPhone signet funding proof"),
          );
          wallet.setUserHasSavedExport(true);
          const address = wallet._getExternalAddressByIndex(0);
          redWalletEvent("real_device_btc_create_wallet_step", {
            commandId,
            step: "address_ok",
            address,
          });
          addWallet(wallet);
          redWalletEvent("real_device_btc_create_wallet_step", {
            commandId,
            step: "save_begin",
            walletID: wallet.getID(),
          });
          await Promise.race([
            saveToDisk(true),
            new Promise((_resolve, reject) =>
              setTimeout(
                () => reject(new Error("saveToDisk timeout after 15000ms")),
                15000,
              ),
            ),
          ]);
          redWalletEvent("real_device_btc_create_wallet_step", {
            commandId,
            step: "save_ok",
            walletID: wallet.getID(),
          });

          const result = {
            ok: true,
            operation,
            commandId,
            walletID: wallet.getID(),
            label: wallet.getLabel(),
            type: wallet.type,
            typeReadable: wallet.typeReadable,
            address,
            xpub: wallet.getXpub(),
            durationMs: Date.now() - startedAt,
            ts: new Date().toISOString(),
          };

          await RNFS.writeFile(
            BTC_REAL_DEVICE_RESULT,
            JSON.stringify(result),
            "utf8",
          );
          redWalletEvent("real_device_btc_wallet_created", result);
          await postBtcRealDeviceResult(result);
          return;
        }

        if (operation === "sendL1") {
          const walletID = String(command.walletID ?? "").trim();
          const hasWallet =
            wallets.some(
              (w) =>
                w.getID() === walletID && w.type === HDSegwitBech32Wallet.type,
            ) || wallets.some((w) => w.type === HDSegwitBech32Wallet.type);
          if (!hasWallet) {
            await RNFS.writeFile(BTC_REAL_DEVICE_COMMAND, rawCommand, "utf8");
            redWalletEvent("real_device_btc_command_deferred", {
              operation,
              commandId,
              reason: "wallet_not_ready",
            });
            return;
          }

          const sendResult = await executeBtcSendL1Command(wallets, command);
          const result = {
            ok: true,
            operation,
            commandId,
            ...sendResult,
            durationMs: Date.now() - startedAt,
            ts: new Date().toISOString(),
          };
          await RNFS.writeFile(
            BTC_REAL_DEVICE_RESULT,
            JSON.stringify(result),
            "utf8",
          );
          redWalletEvent("real_device_btc_send_l1", result);
          await postBtcRealDeviceResult(result);
          return;
        }

        throw new Error(
          `Unsupported BTC real-device command operation: ${operation}`,
        );
      } catch (error: any) {
        const result = {
          ok: false,
          operation,
          commandId,
          error: error?.message ?? String(error),
          stack: error?.stack ?? "",
          durationMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        };
        await RNFS.writeFile(
          BTC_REAL_DEVICE_RESULT,
          JSON.stringify(result),
          "utf8",
        ).catch(() => undefined);
        redWalletEvent("real_device_btc_command_error", result);
        await postBtcRealDeviceResult(result);
      } finally {
        realDeviceBtcCommandInFlight = false;
      }
    };

    runBtcRealDeviceCommand().catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runBtcRealDeviceCommand().catch(() => undefined);
    });
    const interval = setInterval(
      () => runBtcRealDeviceCommand().catch(() => undefined),
      4000,
    );
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(interval);
    };
  }, [addWallet, saveToDisk, wallets, walletsInitialized]);

  const addAndSaveWallet = useCallback(
    async (w: TWallet) => {
      if (wallets.some((i) => i.getID() === w.getID())) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ message: "This wallet has been previously imported." });
        return;
      }
      const emptyWalletLabel = new LegacyWallet().getLabel();
      if (w.getLabel() === emptyWalletLabel)
        w.setLabel(loc.wallets.import_imported + " " + w.typeReadable);
      w.setUserHasSavedExport(true);
      addWallet(w);
      if (getScanWasBBQR()) {
        // to avoid proxying `useBBQR` through a bunch of screens during import procedure, we use a trick:
        // on add-wallet screen we reset `lastScanWasBBQR` to false. then potentially user scans QR in BBQR format
        // and saves his wallet to storage, in which case execution lands here, where we check last scan and save walletID
        // internally as a marker that this wallet should display animated QR codes in this format
        await setWalletIdMustUseBBQR(w.getID());
      }
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      await saveToDisk();

      presentAlert({
        hapticFeedback: HapticFeedbackTypes.ImpactHeavy,
        message:
          w.type === WatchOnlyWallet.type
            ? loc.wallets.import_success_watchonly
            : loc.wallets.import_success,
      });

      await w.fetchBalance();
      try {
        await majorTomToGroundControl(w.getAllExternalAddresses(), [], []);
      } catch (error) {
        console.warn("Failed to setup notifications:", error);
        // Consider if user should be notified of notification setup failure
      }
    },
    [wallets, addWallet, saveToDisk],
  );

  function confirmWalletDeletion(wallet: any, onConfirmed: () => void) {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
    try {
      const balance = formatBalanceWithoutSuffix(
        wallet.getBalance(),
        BitcoinUnit.SATS,
        true,
      );
      presentAlert({
        title: loc.wallets.details_delete_wallet,
        message: loc.formatString(loc.wallets.details_del_wb_q, { balance }),
        buttons: [
          {
            text: loc.wallets.details_delete,
            onPress: () => {
              triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
              LayoutAnimation.configureNext(
                LayoutAnimation.Presets.easeInEaseOut,
              );
              onConfirmed();
            },
            style: "destructive",
          },
          {
            text: loc._.cancel,
            onPress: () => {},
            style: "cancel",
          },
        ],
        options: { cancelable: false },
      });
    } catch (error) {
      // Handle error silently if needed
    }
  }

  const value: StorageContextType = useMemo(
    () => ({
      wallets,
      setWalletsWithNewOrder,
      txMetadata: txMetadata.current,
      counterpartyMetadata: counterpartyMetadata.current,
      saveToDisk,
      getTransactions: BlueApp.getTransactions,
      selectedWalletID,
      addWallet,
      deleteWallet,
      currentSharedCosigner,
      setSharedCosigner: setCurrentSharedCosigner,
      addAndSaveWallet,
      setItem: BlueApp.setItem,
      getItem: BlueApp.getItem,
      fetchWalletBalances: BlueApp.fetchWalletBalances,
      fetchWalletTransactions: BlueApp.fetchWalletTransactions,
      fetchAndSaveWalletTransactions,
      isStorageEncrypted: BlueApp.storageIsEncrypted,
      encryptStorage: BlueApp.encryptStorage,
      startAndDecrypt,
      cachedPassword: BlueApp.cachedPassword,
      getBalance: BlueApp.getBalance,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      sleep: BlueApp.sleep,
      createFakeStorage: BlueApp.createFakeStorage,
      resetWallets,
      decryptStorage: BlueApp.decryptStorage,
      isPasswordInUse: BlueApp.isPasswordInUse,
      walletTransactionUpdateStatus,
      setWalletTransactionUpdateStatus,
      handleWalletDeletion,
      confirmWalletDeletion,
    }),
    [
      wallets,
      setWalletsWithNewOrder,
      saveToDisk,
      selectedWalletID,
      addWallet,
      deleteWallet,
      currentSharedCosigner,
      addAndSaveWallet,
      fetchAndSaveWalletTransactions,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      resetWallets,
      walletTransactionUpdateStatus,
      handleWalletDeletion,
    ],
  );

  return (
    <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
  );
};
