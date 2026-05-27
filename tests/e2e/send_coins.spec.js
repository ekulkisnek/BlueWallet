import { element, waitFor } from 'detox';
import { execFileSync } from 'child_process';
import { extractTextFromElementById, sleep, tapAndTapAgainIfElementIsNotVisible, waitForId } from './helperz';
import { mineBitAssetsTx } from './bitassetsE2eShared';

const rpcUrl = process.env.BITASSETS_RPC_URL || 'http://192.168.1.50:6004';
const walletLabel = 'BitAssets-Send-E2E';
let lastDepositTxid = '';

describe('BitAssets Send Coins E2E', () => {
  beforeAll(async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' }, launchArgs: { detoxEnableSynchronization: 'NO' } });
    await device.disableSynchronization();
  }, 120000);

  it('creates wallet, funds it, and sends coins to BitWindow address', async () => {
    await device.disableSynchronization();

    const onWalletScreen = await isVisibleId('BitAssetsWalletScreen', 3000);
    if (!onWalletScreen) {
      let onAddWallet = await isVisibleId('WalletNameInput', 3000);
      if (!onAddWallet) {
        await waitForId('WalletsList');
        const walletExists = await isVisibleId(walletLabel, 2000);
        if (walletExists) {
          await element(by.id(walletLabel)).tap();
        } else {
          await waitFor(element(by.id('CreateAWallet')))
            .toBeVisible()
            .whileElement(by.id('WalletsList'))
            .scroll(500, 'right');
          await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
          onAddWallet = true;
        }
      }

      if (onAddWallet) {
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
          .withTimeout(5000);
        await element(by.id(walletLabel)).tap();
      }
    }
    await waitForId('BitAssetsWalletScreen');

    // Get the address of the newly created mobile wallet
    const mobileAddress = await extractTextFromElementById('BitAssetsAddress');
    console.log('[E2E TEST] Mobile wallet address:', mobileAddress);

    // Fund the mobile wallet address from the mainchain!
    fundAddressFromMainchain(mobileAddress, 5000000); // Send 5,000,000 sats (0.05 BTC)
    mineBlocks();

    // Now, we must sync the mobile wallet so it sees the deposit
    await tapSyncButton();
    await sleep(5000);
    await tapSyncButton();
    await sleep(5000);

    if (process.env.BITASSETS_SEND_COINS_SKIP_REGISTER !== '1') {
      await ensureRegisteredBitAssetForSend();
      await tapSyncButton();
      await sleep(5000);
    }

    // Go to Send Details
    await element(by.id('SendButton')).tap();
    await waitForId('BitAssetsAmountInput');

    // Amount field is disabled until an asset pill is selected.
    await waitFor(element(by.id(/^BitAssetsAssetPill-/)).atIndex(0))
      .toBeVisible()
      .withTimeout(20000);
    await element(by.id(/^BitAssetsAssetPill-/))
      .atIndex(0)
      .tap();
    await sleep(500);

    // Input destination address (BitWindow's address)
    await element(by.id('AddressInput')).tap();
    await element(by.id('AddressInput')).replaceText('3AEJkR1vnY6jbQBN3oUgay7PNsUo');
    await dismissKeyboardIfPresent();

    // Input amount
    await waitFor(element(by.id('BitAssetsAmountInput')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('BitAssetsAmountInput')).tap();
    await sleep(300);
    await element(by.id('BitAssetsAmountInput')).typeText(process.env.BITASSETS_SEND_COINS_AMOUNT || '1');
    await dismissKeyboardIfPresent();

    // Input memo
    await element(by.id('BitAssetsMemoInput')).tap();
    await element(by.id('BitAssetsMemoInput')).replaceText('Sent from RedWallet E2E');
    await dismissKeyboardIfPresent();

    // Tap next/send
    await element(by.id('BitAssetsSendButton')).tap();

    // Wait for success screen
    await waitFor(element(by.text('Success')))
      .toBeVisible()
      .withTimeout(20000);

    console.log('[E2E TEST] Send transaction completed successfully on mobile!');

    // Mine L1 and L2 blocks to confirm the transfer
    mineBlocks();

    console.log('[E2E TEST] All steps finished successfully!');
  });
});

function fundAddressFromMainchain(address, amountSats) {
  console.log(`[E2E TEST] Funding ${address} with ${amountSats} sats`);
  const localDev = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Volumes/T705/code/drivechain-wallet-dev/local-dev';
  const composeFile = process.env.BITASSETS_E2E_COMPOSE_FILE || 'docker-compose.local-minimal.yml';
  const l1MineBlocks = Number(process.env.BITASSETS_E2E_PRE_MINE_L1_BLOCKS || 2);
  if (l1MineBlocks > 0) {
    console.log(`[E2E TEST] Mining ${l1MineBlocks} L1 block(s) before create-deposit (clear mempool RBF)`);
    execFileSync('bash', ['-lc', `cd "${localDev}" && ./scripts/mine-private-signet-blocks.sh ${l1MineBlocks}`], {
      timeout: Number(process.env.BITASSETS_E2E_PRE_MINE_TIMEOUT_MS || 90000),
    });
  }
  const baseFee = Number(process.env.BITASSETS_E2E_DEPOSIT_FEE_SATS || 50000);
  const feeSteps = String(process.env.BITASSETS_E2E_DEPOSIT_FEE_STEPS || `${baseFee},${baseFee * 3},${baseFee * 6}`)
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
  let lastErr = '';
  for (const feeSats of feeSteps) {
    try {
      const txid = execFileSync(
        'bash',
        [
          '-lc',
          `BITASSETS_IMAGE=\${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof} docker compose -f "${localDev}/${composeFile}" exec -T bitassets plain_bitassets_app_cli create-deposit --value-sats ${amountSats} --fee-sats ${feeSats} "${address}"`,
        ],
        { encoding: 'utf8', timeout: 90000 },
      ).trim();
      if (!/^[0-9a-f]{64}$/i.test(txid)) {
        lastErr = `unexpected create-deposit output: ${txid}`;
        continue;
      }
      lastDepositTxid = txid;
      console.log('[E2E TEST] create-deposit txid:', txid, 'feeSats:', feeSats);
      return;
    } catch (e) {
      lastErr = e?.message || String(e);
      console.log(`[E2E TEST] create-deposit failed feeSats=${feeSats}:`, lastErr.slice(0, 240));
    }
  }
  throw new Error(`create-deposit failed after fee retries: ${lastErr}`);
}

function mineBlocks() {
  if (process.env.BITASSETS_E2E_SKIP_MINE === '1') {
    console.log('[E2E TEST] Skipping mine (BITASSETS_E2E_SKIP_MINE=1)');
    return;
  }
  const localDev = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Volumes/T705/code/drivechain-wallet-dev/local-dev';
  const postL1 = Number(process.env.BITASSETS_E2E_POST_DEPOSIT_L1_BLOCKS || 6);
  console.log(`[E2E TEST] Mining ${postL1} L1 block(s) after deposit...`);
  execFileSync('bash', ['-lc', `cd "${localDev}" && ./scripts/mine-private-signet-blocks.sh ${postL1}`], {
    timeout: Number(process.env.BITASSETS_E2E_POST_L1_MINE_TIMEOUT_MS || 120000),
  });
  const waitDepositProof = process.env.BITASSETS_E2E_WAIT_DEPOSIT_CONFIRM === '1';
  const confirmEnv = waitDepositProof && lastDepositTxid ? `BITASSETS_CONFIRM_TXID=${lastDepositTxid}` : '';
  if (waitDepositProof && lastDepositTxid) {
    console.log('[E2E TEST] Mining sidechain block (BMM) until deposit proof...');
  } else {
    console.log('[E2E TEST] Mining sidechain block (BMM) without deposit-proof wait...');
  }
  execFileSync(
    'bash',
    [
      '-lc',
      `cd "${localDev}" && ${confirmEnv} BITASSETS_IMAGE=\${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof} ./scripts/mine-bitassets-block.sh`,
    ],
    { timeout: Number(process.env.BITASSETS_E2E_MINE_TIMEOUT_MS || 180000) },
  );
  console.log('[E2E TEST] Mining complete');
}

async function tapSyncButton() {
  if (device.getPlatform() !== 'android') {
    await dismissKeyboardIfPresent();
  }
  await openBitAssetsTools();
  try {
    await element(by.id('BitAssetsWalletScreen')).scroll(1200, 'up');
  } catch (_) {}
  try {
    await element(by.id('BitAssetsE2ETopSyncButton')).tap();
    return;
  } catch (_) {}

  try {
    await element(by.id('BitAssetsE2ESyncButton')).tap();
    return;
  } catch (_) {}

  try {
    await element(by.id('BitAssetsSyncButton')).tap();
  } catch (_) {}
}

async function openBitAssetsTools() {
  if (await isExistingId('BitAssetsSyncButton', 750)) return;

  try {
    await waitFor(element(by.id('BitAssetsToolsButton')))
      .toBeVisible()
      .withTimeout(1500);
    await element(by.id('BitAssetsToolsButton')).tap();
    await waitFor(element(by.id('BitAssetsSyncButton')))
      .toExist()
      .withTimeout(3000);
  } catch (_) {}
}

async function dismissKeyboardIfPresent() {
  if (device.getPlatform() === 'android') {
    return;
  }
  try {
    await element(by.label('done')).tap();
    await sleep(250);
    return;
  } catch (_) {}
  try {
    await element(by.text('done')).tap();
    await sleep(250);
    return;
  } catch (_) {}
  try {
    await element(by.label('Done')).tap();
    await sleep(250);
    return;
  } catch (_) {}
  try {
    await element(by.id('BitAssetsWalletScreen')).tapAtPoint({ x: 415, y: 817 });
    await sleep(500);
  } catch (_) {}
}

async function isExistingId(id, timeout = 1000) {
  try {
    await waitFor(element(by.id(id)))
      .toExist()
      .withTimeout(timeout);
    return true;
  } catch (_) {
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

async function ensureRegisteredBitAssetForSend() {
  console.log('[E2E TEST] Reserve + register BitAsset (deposit alone has no send pills)');
  const reserveTxid = await submitViaE2ETop('reserve');
  console.log('[E2E TEST] reserve txid:', reserveTxid);
  mineBitAssetsTx(reserveTxid);
  await tapSyncButton();
  await sleep(5000);

  let registerTxid;
  try {
    registerTxid = await submitViaE2ETop('register');
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!/reservation|wallet UTXO/i.test(message)) throw error;
    await tapSyncButton();
    await sleep(5000);
    registerTxid = await submitViaE2ETop('register');
  }
  console.log('[E2E TEST] register txid:', registerTxid);
  mineBitAssetsTx(registerTxid);
}

async function submitViaE2ETop(operation) {
  await openBitAssetsTools();
  try {
    await element(by.id('BitAssetsWalletScreen')).scroll(1200, 'up');
  } catch (_) {}
  await element(by.id(`BitAssetsE2ETopSubmit-${operation}`)).tap();
  return waitForSubmitTxid();
}

async function waitForSubmitTxid(previousTxid) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await resultHasTxid(1000)) {
      const txid = extractTxid(await extractTextFromElementById('BitAssetsResultText'));
      if (!previousTxid || txid !== previousTxid) return txid;
    }
    if (await isExistingId('BitAssetsError', 1000)) {
      let errorText = '<unreadable>';
      try {
        errorText = await extractTextFromElementById('BitAssetsErrorText');
      } catch (_) {}
      throw new Error(`BitAssets submit failed: ${errorText}`);
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for BitAssets submit txid');
}

async function resultHasTxid(timeout = 1000) {
  if (!(await isExistingId('BitAssetsResultText', timeout))) return false;
  try {
    const result = await extractTextFromElementById('BitAssetsResultText');
    return /[0-9a-f]{64}/i.test(String(result));
  } catch (_) {
    return false;
  }
}

function extractTxid(text) {
  const match = String(text).match(/[0-9a-f]{64}/i);
  if (!match) throw new Error(`Could not extract txid from BitAssets result: ${text}`);
  return match[0];
}
