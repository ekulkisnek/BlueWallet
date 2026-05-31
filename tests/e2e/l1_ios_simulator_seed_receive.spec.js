import { element, waitFor } from 'detox';
import {
  dismissGeneralAlerts,
  extractTextFromElementById,
  helperCreateWallet,
  launchAppUntilWalletsList,
  resetToWalletsList,
  sleep,
  waitForId,
} from './helperz';

const walletLabel = process.env.L1_E2E_IOS_RECEIVE_WALLET_LABEL || 'L1IosReceiveSeed';

async function dismissReceiveNotificationPrompts() {
  try {
    await waitFor(element(by.text('Yes, I have.')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('Yes, I have.')).tap();
  } catch (_) {}
  for (const label of [
    'No, and do not ask me again.',
    "Don't Allow",
    'Don\u2019t Allow',
    'Don‘t Allow',
    'Allow',
    'Allow While Using App',
  ]) {
    try {
      await element(by.text(label)).tap();
      await sleep(100);
    } catch (_) {}
  }
}

async function scrollWalletIntoView(walletName) {
  console.log('[L1_IOS_ANDROID_E2E] scrollWalletIntoView start for ' + walletName);
  const dirs = ['right', 'left', 'down', 'up'];
  for (let round = 0; round < 4; round++) {
    for (const dir of dirs) {
      try {
        await waitFor(element(by.id(walletName)))
          .toBeVisible()
          .whileElement(by.id('WalletsList'))
          .scroll(450, dir);
        console.log('[L1_IOS_ANDROID_E2E] scrollWalletIntoView found via ' + dir);
        return;
      } catch (_) {}
      try {
        await element(by.id('WalletsList')).swipe(dir === 'right' || dir === 'left' ? dir : 'right', 'slow', 0.5);
      } catch (_) {}
      await sleep(200);
    }
    try {
      await element(by.id('WalletsList')).swipe('down', 'slow', 0.6);
    } catch (_) {}
    await sleep(400);
    try {
      await device.disableSynchronization();
    } catch (_) {}
  }
  console.log('[L1_IOS_ANDROID_E2E] scrollWalletIntoView giving up after retries');
}

async function openWalletReceiveScreen(walletName) {
  await dismissGeneralAlerts();
  await scrollWalletIntoView(walletName);
  await element(by.id(walletName)).tap();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await waitFor(element(by.id('ReceiveButton')))
        .toBeVisible()
        .withTimeout(4000);
      break;
    } catch (_) {
      await dismissGeneralAlerts();
    }
  }
  await dismissGeneralAlerts();
  await element(by.id('ReceiveButton')).tap();
  await dismissReceiveNotificationPrompts();
  await waitFor(element(by.id('ReceiveDetailsScrollView')))
    .toBeVisible()
    .withTimeout(30000);
  await waitFor(element(by.id('AddressValue')))
    .toBeVisible()
    .withTimeout(90000);
}

describe('L1 signet iOS simulator receive seed', () => {
  beforeAll(async () => {
    await device.terminateApp();
    await device.clearKeychain();
    await launchAppUntilWalletsList({ deleteOnFirst: true });
  }, 600000);

  it('creates wallet and logs receive address for Android send E2E', async () => {
    await device.disableSynchronization();
    await sleep(2000);
    try {
      await dismissGeneralAlerts();
    } catch (e) {
      console.log('[L1_IOS_ANDROID_E2E] pre-create dismiss skipped:', e && e.message ? e.message.slice(0, 180) : e);
      try {
        await device.disableSynchronization();
      } catch (_) {}
    }
    await resetToWalletsList(5);
    await device.disableSynchronization();
    await helperCreateWallet(walletLabel);
    try {
      await dismissGeneralAlerts();
    } catch (e) {
      console.log('[L1_IOS_ANDROID_E2E] post-create dismiss skipped:', e && e.message ? e.message.slice(0, 180) : e);
      try {
        await device.disableSynchronization();
      } catch (_) {}
    }
    await resetToWalletsList(5);
    try {
      await element(by.id('WalletsList')).swipe('down', 'slow', 0.5);
    } catch (_) {}
    await sleep(300);

    if (process.env.L1_E2E_POST_CREATE_RELAUNCH === '1') {
      await device.launchApp({
        newInstance: true,
        permissions: { notifications: 'YES' },
        launchArgs: { detoxEnableSynchronization: 'NO' },
      });
      await device.disableSynchronization();
      await waitForId('WalletsList');
    } else {
      await dismissGeneralAlerts();
    }
    await expect(element(by.id(walletLabel))).toBeVisible();

    await openWalletReceiveScreen(walletLabel);
    const iosReceiveAddress = await extractTextFromElementById('AddressValue');
    console.log('[L1_IOS_ANDROID_E2E] ios_receive_address=' + iosReceiveAddress);
    if (!iosReceiveAddress || iosReceiveAddress.length < 20) {
      // retry once for flakey address render on sim
      await sleep(2000);
      await element(by.id('ReceiveButton')).tap();
      await waitFor(element(by.id('AddressValue')))
        .toBeVisible()
        .withTimeout(30000);
      const retryAddr = await extractTextFromElementById('AddressValue');
      console.log('[L1_IOS_ANDROID_E2E] ios_receive_address_retry=' + retryAddr);
    }
  }, 600000);
});
