import { element, waitFor } from 'detox';
import {
  dismissGeneralAlerts,
  extractTextFromElementById,
  helperCreateWallet,
  resetToWalletsList,
  sleep,
  tapAndTapAgainIfElementIsNotVisible,
  waitForId,
} from './helperz';

const walletLabel = process.env.L1_E2E_IOS_RECEIVE_WALLET_LABEL || 'L1IosReceiveSeed';

async function dismissBlockingAlerts() {
  const labels = ['Cancel', 'OK', 'Ok', 'Not Now', 'Not now', 'Later', 'Close', 'Yes, I have.', 'No, and do not ask me again.', "Don't Allow", 'Don\u2019t Allow', 'Don‘t Allow', 'Allow', 'Allow While Using App'];
  for (let round = 0; round < 4; round++) {
    for (const label of labels) {
      try {
        await waitFor(element(by.text(label)))
          .toBeVisible()
          .withTimeout(1200);
        await element(by.text(label)).tap();
        await sleep(400);
      } catch (_) {}
    }
  }
}

async function dismissReceiveNotificationPrompts() {
  try {
    await waitFor(element(by.text('Yes, I have.')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('Yes, I have.')).tap();
  } catch (_) {}
  for (const label of ['No, and do not ask me again.', "Don't Allow", 'Don\u2019t Allow', 'Don‘t Allow', 'Allow', 'Allow While Using App']) {
    try { await element(by.text(label)).tap(); await sleep(100); } catch (_) {}
  }
}

async function openReceiveAndWaitForAddress() {
  await dismissBlockingAlerts();
  await waitForId('ReceiveButton');
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
    await device.launchApp({
      delete: true,
      permissions: { notifications: 'NO' },
      launchArgs: { detoxEnableSynchronization: 'NO' },
    });
    await device.disableSynchronization();
    await waitForId('WalletsList', 120000);
  }, 600000);

  it('creates wallet and logs receive address for Android send E2E', async () => {
    await device.disableSynchronization();
    await sleep(2000);
    // Defensive: system setup prompts (Set up later, iCloud, etc) may appear on fresh/reused sim; best-effort only, ignore busy/not-responded to avoid 10min test timeout
    try {
      await dismissGeneralAlerts();
    } catch (e) {
      console.log('[L1_IOS_ANDROID_E2E] initial dismiss skipped (app busy or system modal):', (e && e.message ? e.message.slice(0, 180) : e));
      if (device.getPlatform() === 'android') { try { await device.pressBack(); } catch (_) {} }
      try { await device.disableSynchronization(); } catch (_) {}
      await sleep(1500);
    }
    await resetToWalletsList(4, true);
    await device.disableSynchronization();

    await helperCreateWallet(walletLabel);

    await device.launchApp({ newInstance: true, permissions: { notifications: 'YES' }, launchArgs: { detoxEnableSynchronization: 'NO' } });
    await device.disableSynchronization();
    await sleep(2000);
    try {
      await dismissGeneralAlerts();
    } catch (e) {
      console.log('[L1_IOS_ANDROID_E2E] post-relaunch dismiss skipped:', (e && e.message ? e.message.slice(0, 180) : e));
      if (device.getPlatform() === 'android') { try { await device.pressBack(); } catch (_) {} }
      await sleep(1000);
    }
    await waitForId('WalletsList', 60000);
    await expect(element(by.id(walletLabel))).toBeVisible();

    await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'ReceiveButton');
    await openReceiveAndWaitForAddress();
    const iosReceiveAddress = await extractTextFromElementById('AddressValue');
    console.log('[L1_IOS_ANDROID_E2E] ios_receive_address=' + iosReceiveAddress);
    if (!iosReceiveAddress || iosReceiveAddress.length < 20) {
      // retry once for flakey address render on sim
      await sleep(2000);
      await element(by.id('ReceiveButton')).tap();
      await waitFor(element(by.id('AddressValue'))).toBeVisible().withTimeout(30000);
      const retryAddr = await extractTextFromElementById('AddressValue');
      console.log('[L1_IOS_ANDROID_E2E] ios_receive_address_retry=' + retryAddr);
    }
  }, 600000);
});
