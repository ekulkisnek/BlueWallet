import fs from 'fs';
import { element, waitFor } from 'detox';
import { extractTextFromElementById, sleep, tapAndTapAgainIfElementIsNotVisible, waitForId } from './helperz';

const describeIf = process.env.BITASSETS_BITWINDOW_RECEIVE_E2E === '1' ? describe : describe.skip;
const rpcUrl = process.env.BITASSETS_RPC_URL || 'http://127.0.0.1:6004';
const walletLabel = process.env.BITASSETS_BITWINDOW_RECEIVE_WALLET_LABEL || 'BitWindow-Recv-E2E';
const addressFile = process.env.BITASSETS_BITWINDOW_RECEIVE_ADDRESS_FILE || '';
const minSats = Number(process.env.BITASSETS_BITWINDOW_RECEIVE_MIN_SATS || '1');

describeIf('BitWindow → simulator receive', () => {
  const launchArgs = { detoxEnableSynchronization: 'NO' };

  async function openWallet() {
    await device.disableSynchronization();
    const onWalletScreen = await isVisibleId('BitAssetsWalletScreen', 3000);
    if (onWalletScreen) return;

    await waitForId('WalletsList');
    const walletExists = await isVisibleId(walletLabel, 2000);
    if (walletExists) {
      await element(by.id(walletLabel)).tap();
      return;
    }

    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
    await element(by.id('WalletNameInput')).replaceText(walletLabel);
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
    await waitFor(element(by.id('Create')))
      .toBeVisible()
      .whileElement(by.id('ScrollView'))
      .scroll(500, 'down');
    await element(by.id('Create')).tap();
    await sleep(2000);
    await waitFor(element(by.id(walletLabel)))
      .toBeVisible()
      .withTimeout(8000);
    await element(by.id(walletLabel)).tap();
  }

  async function tapSyncButton() {
    if (device.getPlatform() !== 'android') {
      try {
        await element(by.label('done')).tap();
      } catch (_) {}
    }
    try {
      await element(by.id('BitAssetsE2ETopSyncButton')).tap();
      return;
    } catch (_) {}
    try {
      await element(by.id('BitAssetsE2ESyncButton')).tap();
      return;
    } catch (_) {}
    try {
      await element(by.id('BitAssetsToolsButton')).tap();
      await waitFor(element(by.id('BitAssetsSyncButton')))
        .toExist()
        .withTimeout(3000);
      await element(by.id('BitAssetsSyncButton')).tap();
    } catch (_) {}
  }

  it('setup: create BitAssets wallet and dump receive address', async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' }, launchArgs });
    await openWallet();
    await waitForId('BitAssetsWalletScreen');
    const address = (await extractTextFromElementById('BitAssetsAddress')).trim();
    if (!address) throw new Error('BitAssetsAddress empty');
    if (!addressFile) throw new Error('BITASSETS_BITWINDOW_RECEIVE_ADDRESS_FILE required');
    fs.writeFileSync(addressFile, `${address}\n`);
    console.log('[bitwindow_receive] simulator_address=', address);
  }, 180000);

  it('verify: sync and show received BitAssets balance', async () => {
    if (process.env.BITASSETS_BITWINDOW_RECEIVE_VERIFY !== '1') return;

    await device.launchApp({ newInstance: true, permissions: { notifications: 'NO' }, launchArgs });
    await openWallet();
    await waitForId('BitAssetsWalletScreen');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await tapSyncButton();
      await sleep(8000);
      if (!(await isVisibleId('BitAssetsEmptyBalances', 1500))) break;
    }

    await waitFor(element(by.id('BitAssetsEmptyBalances')))
      .not.toExist()
      .withTimeout(120000);

    const amountText = await extractTextFromElementById('BitAssetsBalanceAmount-0');
    const amount = Number(String(amountText).replace(/[^\d.]/g, ''));
    console.log('[bitwindow_receive] balance_amount_0=', amountText, 'parsed=', amount);
    if (!Number.isFinite(amount) || amount < minSats) {
      throw new Error(`expected balance >= ${minSats} sats, got ${amountText}`);
    }
  }, 240000);
});

async function isVisibleId(id, timeout = 3000) {
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout);
    return true;
  } catch (_) {
    return false;
  }
}
