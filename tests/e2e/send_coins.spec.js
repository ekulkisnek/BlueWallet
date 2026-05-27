import { element, waitFor } from 'detox';
import { execFileSync } from 'child_process';
import { extractTextFromElementById, sleep, tapAndTapAgainIfElementIsNotVisible, waitForId } from './helperz';

const rpcUrl = 'http://127.0.0.1:6004';
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
    
    let onWalletScreen = await isVisibleId('BitAssetsWalletScreen', 3000);
    if (!onWalletScreen) {
      let onAddWallet = await isVisibleId('WalletNameInput', 3000);
      if (!onAddWallet) {
        await waitForId('WalletsList');
        let walletExists = await isVisibleId(walletLabel, 2000);
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

    // Go to Send Details
    await element(by.id('SendButton')).tap();
    await waitForId('BitAssetsAmountInput');

    // Amount field is disabled until an asset pill is selected.
    await waitFor(element(by.id(/^BitAssetsAssetPill-/)).atIndex(0))
      .toBeVisible()
      .withTimeout(20000);
    await element(by.id(/^BitAssetsAssetPill-/)).atIndex(0).tap();
    await sleep(500);

    // Input destination address (BitWindow's address)
    await element(by.id('AddressInput')).tap();
    await element(by.id('AddressInput')).replaceText('3AEJkR1vnY6jbQBN3oUgay7PNsUo');
    await dismissKeyboardIfPresent();

    // Input amount
    await waitFor(element(by.id('BitAssetsAmountInput'))).toBeVisible().withTimeout(5000);
    await element(by.id('BitAssetsAmountInput')).tap();
    await sleep(300);
    await element(by.id('BitAssetsAmountInput')).typeText('1000000');
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
  const feeSats = Number(process.env.BITASSETS_E2E_DEPOSIT_FEE_SATS || 50000);
  // orchestrator CreateDeposit often hangs on Colima; docker CLI matches headless deposit smoke.
  const txid = execFileSync(
    'bash',
    [
      '-lc',
      `BITASSETS_IMAGE=\${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof} docker compose -f "${localDev}/${composeFile}" exec -T bitassets plain_bitassets_app_cli create-deposit --value-sats ${amountSats} --fee-sats ${feeSats} "${address}"`,
    ],
    { encoding: 'utf8', timeout: 120000 },
  ).trim();
  lastDepositTxid = txid;
  console.log('[E2E TEST] create-deposit txid:', txid);
}

function mineBlocks() {
  if (process.env.BITASSETS_E2E_SKIP_MINE === '1') {
    console.log('[E2E TEST] Skipping mine (BITASSETS_E2E_SKIP_MINE=1)');
    return;
  }
  const localDev = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Volumes/T705/code/drivechain-wallet-dev/local-dev';
  const confirmEnv = lastDepositTxid ? `BITASSETS_CONFIRM_TXID=${lastDepositTxid}` : '';
  console.log('[E2E TEST] Mining sidechain block (BMM) to confirm deposit...');
  execFileSync(
    'bash',
    [
      '-lc',
      `cd "${localDev}" && ${confirmEnv} BITASSETS_IMAGE=\${BITASSETS_IMAGE:-local/plain-bitassets:codex-proof} ./scripts/mine-bitassets-block.sh`,
    ],
    { timeout: Number(process.env.BITASSETS_E2E_MINE_TIMEOUT_MS || 120000) },
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
    return;
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


