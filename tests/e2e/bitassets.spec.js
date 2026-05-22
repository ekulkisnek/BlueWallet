import { element, waitFor } from 'detox';

import { sleep, tapAndTapAgainIfElementIsNotVisible, waitForId } from './helperz';

const describeIfBitAssets = process.env.BITASSETS_E2E === '1' ? describe : describe.skip;
const rpcUrl = process.env.BITASSETS_RPC_URL || (device.getPlatform() === 'android' ? 'http://10.0.2.2:6004' : 'http://127.0.0.1:6004');
const walletLabel = process.env.BITASSETS_E2E_WALLET_LABEL || 'BitAssets';
const noSyncLaunchArgs = { detoxEnableSynchronization: 'NO' };
const requireRpc = process.env.BITASSETS_E2E_REQUIRE_RPC === '1' || process.env.BITASSETS_E2E_FULL === '1';

describeIfBitAssets('BitAssets native mobile wallet', () => {
  beforeAll(async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'YES' }, launchArgs: noSyncLaunchArgs });
  }, 120000);

  it('creates a native wallet, syncs, and exposes typed constructor forms', async () => {
    await waitForId('WalletsList');
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
    if (process.env.BITASSETS_E2E_WALLET_LABEL) {
      await element(by.id('WalletNameInput')).replaceText(walletLabel);
    }
    await waitForId('ActivateBitAssetsButton');
    await tapAndTapAgainIfElementIsNotVisible('ActivateBitAssetsButton', 'BitAssetsRpcUrlInput');
    await waitFor(element(by.id('BitAssetsRpcUrlInput')))
      .toBeVisible()
      .whileElement(by.id('ScrollView'))
      .scroll(400, 'down');
    await waitForId('BitAssetsRpcUrlInput');
    await element(by.id('BitAssetsRpcUrlInput')).replaceText(rpcUrl);
    if (device.getPlatform() === 'ios') {
      await element(by.id('BitAssetsRpcUrlInput')).tapReturnKey();
    }
    await sleep(500);
    await scrollToCreateButtonIfNeeded();
    await element(by.id('Create')).tap();
    await sleep(1000);
    await openCreatedWallet();
    await waitForId('BitAssetsWalletScreen');
    if (requireRpc) {
      await element(by.id('BitAssetsSyncButton')).tap();
      await waitForId('BitAssetsEmptyBalances', 60000);
    }

    await selectReserveOperation();
    await sleep(500);
    await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText('Reserve');
    await scrollToBitAssetsField('name');
    await expect(element(by.id('BitAssetsBroadcastButton'))).toExist();

    await device.terminateApp();
    await device.launchApp({ newInstance: true, permissions: { notifications: 'YES' }, launchArgs: noSyncLaunchArgs });
    await openCreatedWallet();
    await waitForId('BitAssetsWalletScreen');
    if (requireRpc) {
      await element(by.id('BitAssetsSyncButton')).tap();
      await waitForId('BitAssetsEmptyBalances', 60000);
    }
  });

  it('runs native constructor broadcasts when BITASSETS_E2E_FULL is enabled', async () => {
    if (process.env.BITASSETS_E2E_FULL !== '1') return;

    await waitForId('BitAssetsWalletScreen');
    await submitOperation('reserve', { name: process.env.BITASSETS_E2E_RESERVE_NAME || `FULL${Date.now()}` });

    if (process.env.BITASSETS_E2E_ASSET_A && process.env.BITASSETS_E2E_ASSET_B) {
      const assetA = process.env.BITASSETS_E2E_ASSET_A;
      const assetB = process.env.BITASSETS_E2E_ASSET_B;
      await submitOperation('register', {
        name: process.env.BITASSETS_E2E_REGISTER_NAME || process.env.BITASSETS_E2E_RESERVE_NAME || `REG${Date.now()}`,
        initialSupply: process.env.BITASSETS_E2E_INITIAL_SUPPLY || '100',
        bitassetData: process.env.BITASSETS_E2E_ASSET_DATA || '{}',
      });
      await submitOperation('transfer', {
        destinationAddress: process.env.BITASSETS_E2E_DESTINATION || '',
        assetId: assetA,
        amount: '1',
      });
      await submitOperation('ammMint', { asset0: assetA, asset1: assetB, amount0: '1', amount1: '1', lpTokenMint: '1' });
      await submitOperation('ammSwap', { assetSpend: assetA, assetReceive: assetB, amountSpend: '1', amountReceive: '1' });
      await submitOperation('ammBurn', { asset0: assetA, asset1: assetB, amount0: '1', amount1: '1', lpTokenBurn: '1' });
      await submitOperation('dutchAuctionCreate', {
        baseAsset: assetA,
        quoteAsset: assetB,
        baseAmount: '1',
        startPrice: '2',
        endPrice: '1',
        duration: '10',
      });
    }

    if (process.env.BITASSETS_E2E_AUCTION_ID && process.env.BITASSETS_E2E_ASSET_A && process.env.BITASSETS_E2E_ASSET_B) {
      await submitOperation('dutchAuctionBid', {
        auctionId: process.env.BITASSETS_E2E_AUCTION_ID,
        baseAsset: process.env.BITASSETS_E2E_ASSET_A,
        quoteAsset: process.env.BITASSETS_E2E_ASSET_B,
        bidSize: '1',
        receiveQuantity: '1',
      });
      await submitOperation('dutchAuctionCollect', {
        auctionId: process.env.BITASSETS_E2E_AUCTION_ID,
        baseAsset: process.env.BITASSETS_E2E_ASSET_A,
        quoteAsset: process.env.BITASSETS_E2E_ASSET_B,
        amountBase: '1',
        amountQuote: '1',
      });
    }
  });
});

async function submitOperation(operation, values) {
  await element(by.id(`BitAssetsOperation-${operation}`)).tap();
  await sleep(500);
  for (const [key, value] of Object.entries(values)) {
    if (value === '') continue;
    await scrollToBitAssetsField(key);
    await element(by.id(`BitAssetsField-${key}`)).replaceText(String(value));
  }
  await element(by.id('BitAssetsBroadcastButton')).tap();
  await waitForId('BitAssetsResult', 90000);
  await sleep(500);
}

async function scrollToCreateButtonIfNeeded() {
  try {
    await waitFor(element(by.id('Create')))
      .toBeVisible()
      .withTimeout(3000);
    return;
  } catch (_) {}

  await waitFor(element(by.id('Create')))
    .toBeVisible()
    .whileElement(by.id('ScrollView'))
    .scroll(500, 'down');
}

async function openCreatedWallet() {
  if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;

  try {
    await waitFor(element(by.id(walletLabel)))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id(walletLabel)).tap();
    if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;
  } catch (_) {}

  const walletCardId = `WalletCard-${walletLabel}`;
  try {
    await waitFor(element(by.id(walletCardId)))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id(walletCardId)).tap();
    if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;
  } catch (_) {}

  try {
    await waitFor(element(by.text(walletLabel)))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text(walletLabel)).tap();
    if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;
  } catch (_) {}

  await openSelectedWalletCard();
}

async function openSelectedWalletCard() {
  if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;
  try {
    await waitFor(element(by.id('SelectedWalletCard')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('SelectedWalletCard')).tap();
    if (await isVisibleId('BitAssetsWalletScreen', 3000)) return;
  } catch (_) {}

  await element(by.id('WalletsList')).tapAtPoint({ x: 200, y: 95 });
}

async function selectReserveOperation() {
  try {
    await element(by.id('BitAssetsOperation-reserve')).tap();
    await sleep(500);
    if (await isSelectedOperation('Reserve')) return;
  } catch (_err) {
    // fall through to the text matcher and coordinate fallback below
  }

  try {
    await element(by.text('Reserve')).tap();
    await sleep(500);
    if (await isSelectedOperation('Reserve')) return;
  } catch (_err) {
    // fall through to the coordinate fallback below
  }

  if (device.getPlatform() === 'ios') {
    await element(by.id('BitAssetsWalletScreen')).tapAtPoint({ x: 200, y: 430 });
  }
}

async function isSelectedOperation(label) {
  try {
    await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText(label);
    return true;
  } catch (_err) {
    return false;
  }
}

async function isVisibleId(id, timeout = 1000) {
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout);
    return true;
  } catch (_) {
    return false;
  }
}

async function scrollToBitAssetsField(field) {
  await waitFor(element(by.id(`BitAssetsField-${field}`)))
    .toBeVisible()
    .whileElement(by.id('BitAssetsWalletScreen'))
    .scroll(500, 'down');
}
