import { element, waitFor } from 'detox';
import * as bitcoin from 'bitcoinjs-lib';
import {
  dismissGeneralAlerts,
  dismissPostFundAlerts,
  extractTextFromElementById,
  goBack,
  helperCreateWallet,
  launchAppUntilWalletsList,
  proceedAfterElectrumFund,
  resetToWalletsList,
  sleep,
  waitForCreateTransactionButton,
  waitForId,
  waitForText,
  openSendViaHomeScanBip21,
} from './helperz';
import { fundL1Address, mineL1Blocks, waitForElectrumBalance } from './l1SignetShared';

const receiveAddress = process.env.ANDROID_L1_RECEIVE_ADDRESS || process.env.L1_RECEIVE_ADDRESS || '';
const walletLabel = process.env.L1_E2E_WALLET_LABEL || 'L1SendE2E';
const sendSats = Number(process.env.L1_E2E_SEND_SATS || 10000);
const fundSats = Number(process.env.L1_E2E_FUND_SATS || 100000);
const sendBtc = (sendSats / 1e8).toFixed(8);
const TEST_TIMEOUT_MS = Number(process.env.L1_E2E_TEST_TIMEOUT_MS || 1200000);

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
    // pull-to-refresh simulation to force list update post-fund
    try { await element(by.id('WalletsList')).swipe('down', 'slow', 0.6); } catch (_) {}
    await sleep(400);
    try { await device.disableSynchronization(); } catch (_) {}
  }
  console.log('[L1_IOS_ANDROID_E2E] scrollWalletIntoView giving up after retries');
}

async function openWalletReceiveScreen(walletName) {
  await dismissGeneralAlerts();
  await scrollWalletIntoView(walletName);
  await element(by.id(walletName)).tap();
  await sleep(800);
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
  let tapped = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await device.disableSynchronization();
      await waitFor(element(by.id('ReceiveButton')))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id('ReceiveButton')).tap();
      tapped = true;
      break;
    } catch (e) {
      console.log(
        '[L1_IOS_ANDROID_E2E] ReceiveButton tap attempt',
        attempt + 1,
        e && e.message ? e.message.slice(0, 120) : e,
      );
      try {
        await element(by.id('TransactionsListView')).swipe('up', 'slow', 0.3);
      } catch (_) {}
      try {
        await element(by.id('WalletsList')).swipe('down', 'slow', 0.2);
      } catch (_) {}
      await sleep(600);
    }
  }
  if (!tapped) {
    try {
      await element(by.text('Receive')).tap();
      tapped = true;
    } catch (_) {
      await element(by.id('ReceiveButton')).multiTap(2);
      tapped = true;
    }
  }
  await dismissReceiveNotificationPrompts();
  await waitFor(element(by.id('AddressValue')))
    .toBeVisible()
    .withTimeout(90000);
}

describe('L1 signet iOS simulator to Android receive', () => {
  // Supervisor escalation: never post-fund relaunch on iOS sim (app-busy / deeplink wedge).
  process.env.L1_E2E_POST_FUND_RELAUNCH = '0';

  beforeAll(async () => {
    if (!receiveAddress) {
      throw new Error('ANDROID_L1_RECEIVE_ADDRESS or L1_RECEIVE_ADDRESS is required');
    }
    await device.terminateApp();
    await device.clearKeychain();
    await launchAppUntilWalletsList({ deleteOnFirst: true });
  }, 600000);

  it(
    'creates wallet, receives L1 funding, sends to Android address',
    async () => {
      await device.disableSynchronization();
      await sleep(2000);
      try {
        await dismissGeneralAlerts();
      } catch (e) {
        console.log('[L1_IOS_ANDROID_E2E] pre-create dismiss skipped (app busy/permission):', (e && e.message ? e.message.slice(0, 120) : e));
        try { await device.disableSynchronization(); } catch (_) {}
      }
      await resetToWalletsList(5);
      try {
        await dismissGeneralAlerts();
      } catch (e) {
        console.log('[L1_IOS_ANDROID_E2E] post-reset dismiss skipped:', (e && e.message ? e.message.slice(0, 120) : e));
      }
      await device.disableSynchronization();
      await helperCreateWallet(walletLabel);
      try {
        await dismissGeneralAlerts();
      } catch (e) {
        console.log('[L1_IOS_ANDROID_E2E] post-create dismiss skipped:', (e && e.message ? e.message.slice(0, 120) : e));
        try { await device.disableSynchronization(); } catch (_) {}
      }
      // helperCreateWallet already lands on WalletsList with wallet visible — avoid extra reset cycles.
      await expect(element(by.id(walletLabel))).toBeVisible();

      await openWalletReceiveScreen(walletLabel);
      const iosReceiveAddress = await extractTextFromElementById('AddressValue');
      console.log('[L1_IOS_ANDROID_E2E] ios_receive_address=' + iosReceiveAddress);

      fundL1Address(iosReceiveAddress, fundSats);
      mineL1Blocks(Number(process.env.L1_E2E_POST_FUND_MINE_BLOCKS || 3));

      // Re-disable sync + settle after external fund/mine (addresses "app busy" + L1SendE2E not found on main queue pending)
      await device.disableSynchronization();
      if (process.env.L1_E2E_POST_FUND_RELAUNCH === '1') {
        await device.terminateApp();
        await device.launchApp({
          newInstance: true,
          permissions: { notifications: 'NO' },
          launchArgs: { detoxEnableSynchronization: 'NO' },
        });
        await device.disableSynchronization();
        await sleep(4000);
        await dismissPostFundAlerts();
        await resetToWalletsList(6, true);
        await waitForId('WalletsList', 60000);
      }
      await resetToWalletsList(5, true);
      await dismissPostFundAlerts();
      await sleep(2000);
      try {
        await element(by.id('WalletsList')).swipe('down', 'slow');
      } catch (_) {}

      waitForElectrumBalance(iosReceiveAddress, sendSats);

      await scrollWalletIntoView(walletLabel);
      await element(by.id(walletLabel)).tap();
      await proceedAfterElectrumFund();

      await device.disableSynchronization();
      await dismissPostFundAlerts();
      // Escalation: home-screen QR backdoor BIP21 — not SendButton / not OS deeplink relaunch.
      await openSendViaHomeScanBip21(receiveAddress, sendBtc);
      await waitForCreateTransactionButton(180000);
      for (let attempt = 0; attempt < 5; attempt++) {
        await element(by.id('CreateTransactionButton')).tap();
        try {
          await waitForId('TransactionValue', 180000);
          break;
        } catch (_) {
          if (attempt === 4) throw new Error('CreateTransactionButton did not produce TransactionValue');
          await dismissPostFundAlerts();
          await device.disableSynchronization();
          if (device.getPlatform() === 'ios') {
            try { await device.reloadReactNative(); } catch (_) {}
          }
          await resetToWalletsList(3, true);
          await openSendViaHomeScanBip21(receiveAddress, sendBtc);
          await sleep(10000);
        }
      }
      await element(by.id('TransactionDetailsButton')).tap();
      const txhex = await extractTextFromElementById('TxhexInput');
      const txid = bitcoin.Transaction.fromHex(txhex).getId();
      console.log('[L1_IOS_ANDROID_E2E] txid=' + txid);

      await goBack();
      await waitForText('Send now');
      await element(by.text('Send now')).tap();
      await waitForText('Done', 60000);
      await element(by.text('Done')).tap();
    },
    TEST_TIMEOUT_MS,
  );
});
