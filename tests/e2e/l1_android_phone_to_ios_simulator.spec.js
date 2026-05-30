import { element, waitFor } from 'detox';
import * as bitcoin from 'bitcoinjs-lib';
import {
  dismissGeneralAlerts,
  dismissPostFundAlerts,
  extractTextFromElementById,
  goBack,
  launchAppUntilWalletsList,
  pullRefreshWalletTransactions,
  resetToWalletsList,
  scrollUpOnHomeScreen,
  sleep,
  tapAndTapAgainIfElementIsNotVisible,
  waitForCreateTransactionButton,
  waitForId,
  waitForText,
} from './helperz';
import { fundL1Address, mineL1Blocks, waitForElectrumBalance } from './l1SignetShared';

const receiveAddress = process.env.IOS_L1_RECEIVE_ADDRESS || process.env.L1_RECEIVE_ADDRESS || '';
const walletLabel = process.env.L1_E2E_WALLET_LABEL || 'L1AndroidSendE2E';
const sendSats = Number(process.env.L1_E2E_SEND_SATS || 10000);
const fundSats = Number(process.env.L1_E2E_FUND_SATS || 100000);
const sendBtc = (sendSats / 1e8).toFixed(8);
const BALANCE_WAIT_MS = Number(process.env.L1_E2E_BALANCE_WAIT_MS || 120000);
const TEST_TIMEOUT_MS = Number(process.env.L1_E2E_TEST_TIMEOUT_MS || 1200000);

async function dismissBlockingAlerts() {
  const labels = [
    'Cancel',
    'Try again',
    'Reset',
    'Reset to default',
    'OK',
    'Ok',
    'Not Now',
    'Not now',
    'Later',
    'Close',
    'Yes, I have.',
    'No, and do not ask me again.',
    'Set up later',
    'Set Up Later',
    'Maybe Later',
    'Remind Me Later',
    'Skip for now',
    "Don't Allow",
    'Don\u2019t Allow',
    'Don‘t Allow',
    'Allow',
    'Allow While Using App',
  ];
  for (let round = 0; round < 4; round++) {
    for (const label of labels) {
      try {
        await waitFor(element(by.text(label)))
          .toBeVisible()
          .withTimeout(1500);
        await element(by.text(label)).tap();
        await sleep(500);
      } catch (_) {}
    }
  }
}

async function dismissReceiveNotificationPrompts() {
  for (const label of ['Yes, I have.', 'No, and do not ask me again.', "Don't Allow", 'Don\u2019t Allow', 'Don‘t Allow', 'Allow', 'Allow While Using App']) {
    try {
      await waitFor(element(by.text(label)))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.text(label)).tap();
      await sleep(100);
      if (label.startsWith('No,') || label.includes('Allow')) {
        try { await element(by.text(label)).tap(); } catch (_) {}
      }
    } catch (_) {}
  }
}

async function openReceiveAndWaitForAddress() {
  await waitForId('ReceiveButton');
  await dismissBlockingAlerts();
  await element(by.id('ReceiveButton')).tap();
  await dismissReceiveNotificationPrompts();
  await waitFor(element(by.id('AddressValue')))
    .toBeVisible()
    .withTimeout(90000);
}

async function createBitcoinWallet(walletName) {
  await waitFor(element(by.id('CreateAWallet')))
    .toBeVisible()
    .whileElement(by.id('WalletsList'))
    .scroll(500, 'right');
  await sleep(300);
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
  await waitForId('WalletNameInput');
  await element(by.id('WalletNameInput')).tap();
  await sleep(200);
  await element(by.id('WalletNameInput')).replaceText(walletName);
  await waitForId('ActivateBitcoinButton');
  await element(by.id('ActivateBitcoinButton')).tap();
  await element(by.id('ActivateBitcoinButton')).tap();
  await tapAndTapAgainIfElementIsNotVisible('Create', 'PleaseBackupScrollView');
  await waitFor(element(by.id('PleasebackupOk')))
    .toBeVisible()
    .whileElement(by.id('PleaseBackupScrollView'))
    .scroll(500, 'down');
  await element(by.id('PleasebackupOk')).tap();
  try {
    await waitFor(element(by.text('OK')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('OK')).tap();
  } catch (_) {}
  await scrollUpOnHomeScreen();
  await element(by.id('WalletsList')).swipe('right', 'fast', 1);
  await sleep(500);
  await waitFor(element(by.id(walletName)))
    .toBeVisible()
    .withTimeout(15000);
}

describe('L1 signet Android phone to iOS simulator receive', () => {
  beforeAll(async () => {
    if (!receiveAddress) {
      throw new Error('IOS_L1_RECEIVE_ADDRESS or L1_RECEIVE_ADDRESS is required');
    }
    await device.clearKeychain();
    await launchAppUntilWalletsList({ deleteOnFirst: true });
    await dismissGeneralAlerts();
  }, 600000);

  it(
    'creates wallet, receives L1 funding, sends to iOS simulator address',
    async () => {
      await device.disableSynchronization();
      await sleep(2000);
      await dismissGeneralAlerts();
      await resetToWalletsList(5);
      await dismissBlockingAlerts();

      await waitForId('WalletsList');
      await createBitcoinWallet(walletLabel);
      await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'ReceiveButton');
      await dismissBlockingAlerts();
      await openReceiveAndWaitForAddress();
      const androidReceiveAddress = await extractTextFromElementById('AddressValue');
      console.log('[L1_ANDROID_IOS_E2E] android_receive_address=', androidReceiveAddress);

      fundL1Address(androidReceiveAddress, fundSats);
      mineL1Blocks(Number(process.env.L1_E2E_POST_FUND_MINE_BLOCKS || 3));

      // Re-disable sync + settle after external fund/mine (parity with ios-sim leg; addresses app busy + nav flakes on Android device)
      await device.disableSynchronization();
      await sleep(2500);
      await resetToWalletsList(10, true);
      await dismissPostFundAlerts();
      await dismissBlockingAlerts();

      try {
        await waitFor(element(by.id('TransactionsListEmpty')))
          .toBeVisible()
          .withTimeout(5000);
        await element(by.id('TransactionsListEmpty')).swipe('down', 'slow');
      } catch (_) {
        try {
          await element(by.id('WalletTransactionsScrollView')).swipe('down', 'slow');
        } catch (_) {}
      }

      waitForElectrumBalance(androidReceiveAddress, sendSats);
      await sleep(Math.min(8000, BALANCE_WAIT_MS));

      try {
        await waitFor(element(by.id(walletLabel)))
          .toBeVisible()
          .whileElement(by.id('WalletsList'))
          .scroll(500, 'right');
      } catch (_) {
        await waitFor(element(by.id(walletLabel)))
          .toBeVisible()
          .whileElement(by.id('WalletsList'))
          .scroll(500, 'left');
      }
      await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'SendButton');
      await pullRefreshWalletTransactions();
      await waitForId('SendButton', 60000);
      await element(by.id('SendButton')).tap();
      await waitForId('AddressInput');
      await element(by.id('AddressInput')).tap();
      await element(by.id('AddressInput')).replaceText(receiveAddress);
      await element(by.id('BitcoinAmountInput')).tap();
      await element(by.id('BitcoinAmountInput')).replaceText(sendBtc);
      await sleep(500);

      await device.disableSynchronization();
      await dismissPostFundAlerts();
      // Harden against CreateTransactionButton not found after fund on Android device (app busy / balance render lag post-mine).
      try { await element(by.id('SendDetailsScroll')).swipe('up', 'fast', 0.3); } catch (_) {}
      try { await element(by.type('RCTScrollView')).atIndex(0).swipe('up', 'fast', 0.3); } catch (_) {}
      await sleep(2000);
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
          await sleep(10000);
        }
      }
      await element(by.id('TransactionDetailsButton')).tap();
      const txhex = await extractTextFromElementById('TxhexInput');
      const txid = bitcoin.Transaction.fromHex(txhex).getId();
      console.log('[L1_ANDROID_IOS_E2E] txid=' + txid);
      process.env.L1_E2E_TXID = txid;

      await goBack();
      await waitForText('Send now');
      await element(by.text('Send now')).tap();
      await waitForText('Done', 60000);
      await element(by.text('Done')).tap();
      await sleep(1000);
    },
    TEST_TIMEOUT_MS,
  );
});
