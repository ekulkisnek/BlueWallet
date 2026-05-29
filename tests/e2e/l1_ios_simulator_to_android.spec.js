import { element, waitFor } from 'detox';
import * as bitcoin from 'bitcoinjs-lib';
import {
  extractTextFromElementById,
  goBack,
  helperCreateWallet,
  sleep,
  tapAndTapAgainIfElementIsNotVisible,
  waitForId,
  waitForText,
} from './helperz';
import { fundL1Address, mineL1Blocks } from './l1SignetShared';

const receiveAddress =
  process.env.ANDROID_L1_RECEIVE_ADDRESS || process.env.L1_RECEIVE_ADDRESS || '';
const walletLabel = process.env.L1_E2E_WALLET_LABEL || 'L1SendE2E';
const sendSats = Number(process.env.L1_E2E_SEND_SATS || 10000);
const fundSats = Number(process.env.L1_E2E_FUND_SATS || 100000);
const sendBtc = (sendSats / 1e8).toFixed(8);

async function dismissGeneralAlerts() {
  const labels = ['Cancel', 'Try again', 'Reset', 'Reset to default', 'OK', 'Ok', 'Continue', 'Skip', 'Not Now', 'Not now', 'Later', 'Close', 'Dismiss'];
  for (let round = 0; round < 5; round++) {
    for (const label of labels) {
      try {
        await waitFor(element(by.text(label)))
          .toBeVisible()
          .withTimeout(1000);
        await element(by.text(label)).tap();
        await sleep(300);
      } catch (_) {}
    }
    try {
      await element(by.id('NavigationCloseButton')).atIndex(0).tap();
    } catch (_) {}
  }
}

async function dismissReceiveNotificationPrompts() {
  try {
    await waitFor(element(by.text('Yes, I have.')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('Yes, I have.')).tap();
  } catch (_) {}
  try {
    await element(by.text('No, and do not ask me again.')).tap();
    await element(by.text('No, and do not ask me again.')).tap();
  } catch (_) {}
}

async function scrollWalletIntoView(walletName) {
  try {
    await waitFor(element(by.id(walletName)))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(400, 'right');
  } catch (_) {
    await waitFor(element(by.id(walletName)))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(400, 'left');
  }
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
  await waitFor(element(by.id('AddressValue')))
    .toBeVisible()
    .withTimeout(90000);
}

async function openWalletSendScreen(walletName) {
  await dismissGeneralAlerts();
  try {
    await waitFor(element(by.id('SendButton')))
      .toBeVisible()
      .withTimeout(5000);
    return;
  } catch (_) {}
  await goBack();
  await dismissGeneralAlerts();
  try {
    await waitFor(element(by.id('SendButton')))
      .toBeVisible()
      .withTimeout(5000);
    return;
  } catch (_) {}
  await scrollWalletIntoView(walletName);
  await tapAndTapAgainIfElementIsNotVisible(walletName, 'SendButton');
  await waitFor(element(by.id('SendButton')))
    .toBeVisible()
    .withTimeout(60000);
}

describe('L1 signet iOS simulator to Android receive', () => {
  beforeAll(async () => {
    if (!receiveAddress) {
      throw new Error('ANDROID_L1_RECEIVE_ADDRESS or L1_RECEIVE_ADDRESS is required');
    }
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

  it('creates wallet, receives L1 funding, sends to Android address', async () => {
    await device.disableSynchronization();
    await sleep(2000);
    await dismissGeneralAlerts();
    await helperCreateWallet(walletLabel);

    if (process.env.L1_E2E_POST_CREATE_RELAUNCH === '1') {
      await device.launchApp({ newInstance: true, permissions: { notifications: 'YES' }, launchArgs: { detoxEnableSynchronization: 'NO' } });
      await device.disableSynchronization();
      await waitForId('WalletsList');
      await expect(element(by.id(walletLabel))).toBeVisible();
    } else {
      await dismissGeneralAlerts();
      await expect(element(by.id(walletLabel))).toBeVisible();
    }

    await openWalletReceiveScreen(walletLabel);
    const iosReceiveAddress = await extractTextFromElementById('AddressValue');
    console.log('[L1_IOS_ANDROID_E2E] ios_receive_address=' + iosReceiveAddress);

    fundL1Address(iosReceiveAddress, fundSats);
    mineL1Blocks(Number(process.env.L1_E2E_POST_FUND_MINE_BLOCKS || 3));

    await openWalletSendScreen(walletLabel);

    try {
      await element(by.id('TransactionsListEmpty')).swipe('down', 'slow');
    } catch (_) {
      try {
        await element(by.id('WalletTransactionsScrollView')).swipe('down', 'slow');
      } catch (_) {}
    }
    await sleep(Number(process.env.L1_E2E_BALANCE_WAIT_MS || 20000));

    await element(by.id('SendButton')).tap();
    await waitForId('AddressInput');
    await element(by.id('AddressInput')).replaceText(receiveAddress);
    await element(by.id('BitcoinAmountInput')).replaceText(sendBtc);
    if (device.getPlatform() === 'ios') {
      await element(by.id('BitcoinAmountInput')).tapReturnKey();
    }
    await sleep(500);

    await element(by.id('CreateTransactionButton')).tap();
    await waitForId('TransactionValue');
    await element(by.id('TransactionDetailsButton')).tap();
    const txhex = await extractTextFromElementById('TxhexInput');
    const txid = bitcoin.Transaction.fromHex(txhex).getId();
    console.log('[L1_IOS_ANDROID_E2E] txid=' + txid);

    await goBack();
    await waitForText('Send now');
    await element(by.text('Send now')).tap();
    await waitForText('Done', 60000);
    await element(by.text('Done')).tap();
  }, 600000);
});
