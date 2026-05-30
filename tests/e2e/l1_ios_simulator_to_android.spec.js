import { element, waitFor } from 'detox';
import * as bitcoin from 'bitcoinjs-lib';
import {
  dismissGeneralAlerts,
  dismissPostFundAlerts,
  extractTextFromElementById,
  goBack,
  helperCreateWallet,
  launchAppUntilWalletsList,
  pullRefreshWalletTransactions,
  resetToWalletsList,
  sleep,
  tapAndTapAgainIfElementIsNotVisible,
  waitForCreateTransactionButton,
  waitForId,
  waitForText,
  waitForWalletBalancePositive,
} from './helperz';
import { fundL1Address, mineL1Blocks, waitForElectrumBalance } from './l1SignetShared';

const receiveAddress = process.env.ANDROID_L1_RECEIVE_ADDRESS || process.env.L1_RECEIVE_ADDRESS || '';
const walletLabel = process.env.L1_E2E_WALLET_LABEL || 'L1SendE2E';
const sendSats = Number(process.env.L1_E2E_SEND_SATS || 10000);
const fundSats = Number(process.env.L1_E2E_FUND_SATS || 100000);
const sendBtc = (sendSats / 1e8).toFixed(8);
const BALANCE_WAIT_MS = Number(process.env.L1_E2E_BALANCE_WAIT_MS || 180000);
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
  await device.disableSynchronization();
  await resetToWalletsList(6, true);
  await dismissPostFundAlerts();
  try { await element(by.id('WalletsList')).swipe('down', 'slow', 0.4); } catch (_) {}
  await sleep(400);
  await scrollWalletIntoView(walletName);
  await tapAndTapAgainIfElementIsNotVisible(walletName, 'SendButton');
  await pullRefreshWalletTransactions();
  await waitForWalletBalancePositive(BALANCE_WAIT_MS);
  await waitFor(element(by.id('SendButton')))
    .toBeVisible()
    .withTimeout(120000);
}

describe('L1 signet iOS simulator to Android receive', () => {
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
      // Post-create cleanup: extra dismiss/reset/swipe to survive transient modal overlays (RNSModalScreen snapshots) that make WalletsList unhittable on iOS sim
      try {
        await dismissGeneralAlerts();
      } catch (e) {
        console.log('[L1_IOS_ANDROID_E2E] post-create dismiss skipped:', (e && e.message ? e.message.slice(0, 120) : e));
        try { await device.disableSynchronization(); } catch (_) {}
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

      await openWalletSendScreen(walletLabel);

      try {
        await element(by.id('TransactionsListEmpty')).swipe('down', 'slow');
      } catch (_) {
        try {
          await element(by.id('WalletTransactionsScrollView')).swipe('down', 'slow');
        } catch (_) {}
      }
      // Short UI settle for balance render on wallet detail (electrum preflight already confirmed chain balance).
      await sleep(Math.min(8000, BALANCE_WAIT_MS));

      // openWalletSendScreen already navigated to wallet detail with SendButton visible — do not resetToWalletsList again (that was undoing nav and causing L1SendE2E wedge).
      await element(by.id('SendButton')).tap();
      await waitForId('AddressInput');
      await element(by.id('AddressInput')).replaceText(receiveAddress);
      await element(by.id('BitcoinAmountInput')).replaceText(sendBtc);
      if (device.getPlatform() === 'ios') {
        await element(by.id('BitcoinAmountInput')).tapReturnKey();
      }
      await sleep(1500);
      // Re-trigger fee calc if CreateTransactionButton still hidden (ActivityIndicator while isLoading / balance=0).
      try {
        await element(by.id('BitcoinAmountInput')).tap();
        await element(by.id('BitcoinAmountInput')).replaceText(sendBtc);
        await element(by.id('BitcoinAmountInput')).tapReturnKey();
      } catch (_) {}
      await sleep(1500);

      await device.disableSynchronization();
      await dismissPostFundAlerts();
      // Harden against L1SendE2E not found / CreateTransactionButton missing after fund (app busy or slow balance render on iOS sim post-mine).
      // Explicit wait + scroll + re-enable before taps. Matches known simulator blocker.
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
          // App-busy / TransactionValue flake recovery: reload + scroll + re-open send
          if (device.getPlatform() === 'ios') {
            try { await device.reloadReactNative(); } catch (_) {}
          }
          await resetToWalletsList(3, true);
          await openWalletSendScreen(walletLabel);
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
