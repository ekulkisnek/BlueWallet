import { element, waitFor } from 'detox';
import { execFileSync } from 'child_process';

import { extractTextFromElementById, sleep, tapAndTapAgainIfElementIsNotVisible, waitForId } from './helperz';

const describeIfBitAssets = process.env.BITASSETS_E2E === '1' ? describe : describe.skip;
const rpcUrl = process.env.BITASSETS_RPC_URL || (device.getPlatform() === 'android' ? 'http://10.0.2.2:6004' : 'http://127.0.0.1:6004');
const walletLabel = process.env.BITASSETS_E2E_WALLET_LABEL || 'BitAssets';
const noSyncLaunchArgs = { detoxEnableSynchronization: 'NO' };
const requireRpc = process.env.BITASSETS_E2E_REQUIRE_RPC === '1' || process.env.BITASSETS_E2E_FULL === '1';
const submitLabels = {
  transfer: 'Send transfer',
  reserve: 'Reserve name',
  register: 'Register asset',
  ammMint: 'Mint LP',
  ammSwap: 'Swap',
  ammBurn: 'Burn LP',
  dutchAuctionCreate: 'Create auction',
  dutchAuctionBid: 'Bid',
  dutchAuctionCollect: 'Collect',
};
const operationLabels = {
  transfer: 'Transfer',
  reserve: 'Reserve',
  register: 'Register',
  ammMint: 'AMM mint',
  ammSwap: 'AMM swap',
  ammBurn: 'AMM burn',
  dutchAuctionCreate: 'Auction create',
  dutchAuctionBid: 'Auction bid',
  dutchAuctionCollect: 'Auction collect',
};

describeIfBitAssets('BitAssets native mobile wallet', () => {
  beforeAll(async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' }, launchArgs: noSyncLaunchArgs });
    await device.disableSynchronization();
  }, 120000);

  it('creates a native wallet, syncs, and exposes typed constructor forms', async () => {
    await device.disableSynchronization();
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
      await tapSyncButton();
      await waitFor(element(by.id('BitAssetsEmptyBalances')))
        .toExist()
        .withTimeout(60000);
    }

    if (process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW !== '1') {
      await selectOperation('reserve');
      await sleep(500);
      await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText('Reserve');
      await scrollToBitAssetsField('name');
      await expect(element(by.id('BitAssetsBroadcastButton'))).toExist();
    }

    await device.terminateApp();
    await device.launchApp({ newInstance: true, permissions: { notifications: 'NO' }, launchArgs: noSyncLaunchArgs });
    await device.disableSynchronization();
    await openCreatedWallet();
    await waitForId('BitAssetsWalletScreen');
    if (requireRpc) {
      await tapSyncButton();
      await waitFor(element(by.id('BitAssetsEmptyBalances')))
        .toExist()
        .withTimeout(60000);
    }
  });

  it('runs native constructor broadcasts when BITASSETS_E2E_FULL is enabled', async () => {
    if (process.env.BITASSETS_E2E_FULL !== '1') return;

    await device.disableSynchronization();
    await openCreatedWallet();
    await waitForId('BitAssetsWalletScreen');
    const reserveName = process.env.BITASSETS_E2E_RESERVE_NAME || `full-${Date.now()}`;
    const reserveTxid = await submitOperation('reserve', { name: reserveName });

    if (process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
      await mineAndSync(reserveTxid, 1);

      let registerTxid;
      try {
        registerTxid = await submitOperation('register', {
          name: reserveName,
          initialSupply: process.env.BITASSETS_E2E_INITIAL_SUPPLY || '25',
        });
      } catch (error) {
        const message = String(error?.message ?? error);
        if (!/reservation|wallet UTXO/i.test(message)) throw error;
        await tapSyncButton();
        await sleep(5000);
        registerTxid = await submitOperation('register', {
          name: reserveName,
          initialSupply: process.env.BITASSETS_E2E_INITIAL_SUPPLY || '25',
        });
      }
      await mineAndSync(registerTxid, 1);
      await tapSyncButton();
      await sleep(8000);

      const assetId = latestBitAssetId();
      const destinationAddress = await extractTextFromElementById('BitAssetsAddress');
      let transferTxid;
      try {
        transferTxid = await submitOperation('transfer', {
          destinationAddress,
          assetId,
          amount: '1',
        });
      } catch (error) {
        const message = String(error?.message ?? error);
        if (!/not enough native wallet BitAsset funds/i.test(message)) throw error;
        await tapSyncButton();
        await sleep(5000);
        transferTxid = await submitOperation('transfer', {
          destinationAddress,
          assetId,
          amount: '1',
        });
      }
      await mineAndSync(transferTxid, 1);
      await expectProofBackedUtxos();
      return;
    }

    if (process.env.BITASSETS_E2E_ASSET_A && process.env.BITASSETS_E2E_ASSET_B) {
      const assetA = process.env.BITASSETS_E2E_ASSET_A;
      const assetB = process.env.BITASSETS_E2E_ASSET_B;
      await submitOperation('register', {
        name: process.env.BITASSETS_E2E_REGISTER_NAME || process.env.BITASSETS_E2E_RESERVE_NAME || `reg-${Date.now()}`,
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
  if (process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
    await tapE2ESubmitButton(operation);
    await waitForBitAssetsSubmitTxid();
    return extractLatestTxid();
  }

  await selectOperation(operation);
  let lastField = '';
  for (const [key, value] of Object.entries(values)) {
    if (value === '') continue;
    await scrollToBitAssetsField(key);
    if (device.getPlatform() === 'android' && process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
      if (key === 'name') {
        await element(by.id(bitAssetsFieldId(key))).tap();
        try {
          await element(by.id(bitAssetsFieldId(key))).clearText();
        } catch (_) {}
        await element(by.id(bitAssetsFieldId(key))).typeText(String(value));
      } else {
        await element(by.id(bitAssetsFieldId(key))).replaceText(String(value));
      }
    } else {
      await element(by.id(bitAssetsFieldId(key))).replaceText(String(value));
    }
    if (device.getPlatform() === 'ios' && process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
      try {
        await element(by.id(bitAssetsFieldId(key))).tapReturnKey();
      } catch (_) {}
    }
    if (device.getPlatform() === 'android' && process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
      try {
        await device.pressBack();
      } catch (_) {}
    }
    lastField = key;
  }
  if (process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
    await tapE2ESubmitButton(operation);
    await waitForBitAssetsSubmitTxid();
    return extractLatestTxid();
  }
  if (device.getPlatform() === 'ios' && lastField) {
    try {
      await element(by.id(bitAssetsFieldId(lastField))).tapReturnKey();
      await waitForBitAssetsSubmitTxid();
      return extractLatestTxid();
    } catch (_) {}
  }
  await scrollToBroadcastButton();
  if (await resultHasTxid(1000)) return extractLatestTxid();
  try {
    await element(by.id('BitAssetsBroadcastButton')).tap();
  } catch (error) {
    if (device.getPlatform() !== 'ios') throw error;
    try {
      await waitForBitAssetsSubmitTxid();
      await sleep(500);
      return extractLatestTxid();
    } catch (_) {}
    try {
      await element(by.label(submitLabels[operation])).tap();
    } catch (fallbackError) {
      if (await resultHasTxid(1000)) return extractLatestTxid();
      throw fallbackError;
    }
  }
  await waitForBitAssetsSubmitTxid();
  await sleep(500);
  return extractLatestTxid();
}

async function selectOperation(operation) {
  const expectedLabel = operationLabels[operation];
  try {
    await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText(expectedLabel);
    return;
  } catch (_) {}

  if (process.env.BITASSETS_E2E_PROVE_MOBILE_FLOW === '1') {
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(700, 'up');
    } catch (_) {}
    let selected = false;
    try {
      await element(by.id(`BitAssetsE2EOperation-${operation}`)).tap();
      await sleep(500);
      await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText(expectedLabel);
      selected = true;
    } catch (_operationButtonError) {
      selected = false;
    }
    if (!selected) {
      await scrollToBitAssetsField('OperationInput');
      await element(by.id('BitAssetsE2EOperationInput')).replaceText(operation);
      if (device.getPlatform() === 'android') {
        try {
          await device.pressBack();
        } catch (_keyboardDismissError) {}
      }
    }
    await sleep(500);
    await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText(expectedLabel);
    return;
  }

  try {
    await waitFor(element(by.id(`BitAssetsOperation-${operation}`)))
      .toBeVisible()
      .whileElement(by.id('BitAssetsWalletScreen'))
      .scroll(500, 'down');
    await element(by.id(`BitAssetsOperation-${operation}`)).tap();
  } catch (_scrollError) {
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(400, 'down');
      await element(by.id(`BitAssetsOperation-${operation}`)).tap();
    } catch (_tapError) {
      try {
        await element(by.text(expectedLabel)).tap();
      } catch (error) {
        if (device.getPlatform() === 'android') {
          await element(by.id('BitAssetsWalletScreen')).tapAtPoint({ x: 600, y: 1320 });
        } else {
          throw error;
        }
      }
    }
  }

  await sleep(500);
  await expect(element(by.id('BitAssetsSelectedOperation'))).toHaveText(expectedLabel);
}

async function extractLatestTxid() {
  return extractTxid(await extractTextFromElementById('BitAssetsResultText'));
}

async function mineAndSync(txid, minimumProofBackedUtxos) {
  mineBitAssetsTx(txid);
  await tapSyncButton();
  await expectProofBackedUtxos(minimumProofBackedUtxos);
}

async function tapSyncButton() {
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

  try {
    await element(by.id('BitAssetsWalletScreen')).scroll(700, 'up');
    await element(by.id('BitAssetsE2ESyncButton')).tap();
    return;
  } catch (_) {}

  await element(by.id('BitAssetsWalletScreen')).tapAtPoint({ x: 160, y: 220 });
}

async function tapE2ESubmitButton(operation) {
  const topOperationSubmitId = `BitAssetsE2ETopSubmit-${operation}`;
  const operationSubmitId = `BitAssetsE2ESubmit-${operation}`;
  const currentOperationSubmitId = `BitAssetsE2ESubmitCurrent-${operation}`;
  try {
    await element(by.id('BitAssetsWalletScreen')).scroll(1200, 'up');
  } catch (_) {}
  try {
    await element(by.id(topOperationSubmitId)).tap();
    return;
  } catch (_) {}

  try {
    await scrollToBroadcastButton();
    await element(by.id(currentOperationSubmitId)).tap();
    return;
  } catch (_) {}

  try {
    await element(by.id(operationSubmitId)).tap();
    return;
  } catch (_) {}

  await openCreatedWallet();
  await element(by.id('BitAssetsWalletScreen')).scroll(700, 'up');
  try {
    await element(by.id(operationSubmitId)).tap();
  } catch (error) {
    if (device.getPlatform() !== 'android') throw error;
    await element(by.id('BitAssetsWalletScreen')).tapAtPoint({ x: 500, y: 1250 });
  }
}

function mineBitAssetsTx(txid) {
  if (!txid) throw new Error('Cannot mine BitAssets tx without txid');
  const localDevDir = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Users/lukekensik/drivechain-wallet-dev/local-dev';
  const composeFile = process.env.BITASSETS_E2E_COMPOSE_FILE || 'docker-compose.local-minimal.yml';
  console.log(`[BitAssets E2E] mining tx ${txid}`);
  const command = [
    `cd ${shellQuote(localDevDir)} &&`,
    `COMPOSE_FILE=${shellQuote(composeFile)}`,
    `BITASSETS_CONFIRM_TXID=${shellQuote(txid)}`,
    `BITASSETS_IMAGE=${shellQuote(process.env.BITASSETS_IMAGE || 'local/plain-bitassets:codex-proof')}`,
    `BMM_MINE_ATTEMPTS=${shellQuote(process.env.BMM_MINE_ATTEMPTS || '8')}`,
    `BMM_REQUEST_SETTLE_SECS=${shellQuote(process.env.BMM_REQUEST_SETTLE_SECS || '40')}`,
    `BITASSETS_MINE_TIMEOUT=${shellQuote(process.env.BITASSETS_MINE_TIMEOUT || '120')}`,
    './scripts/mine-bitassets-block.sh',
  ].join(' ');
  execFileSync('bash', ['-lc', command], { stdio: 'inherit', timeout: Number(process.env.BITASSETS_E2E_MINE_TIMEOUT_MS || 900000) });
  const proof = execFileSync(
    'bash',
    [
      '-lc',
      [
        `cd ${shellQuote(localDevDir)} &&`,
        `docker compose -f ${shellQuote(composeFile)} exec -T bitassets plain_bitassets_app_cli get-transaction-proof ${shellQuote(txid)}`,
      ].join(' '),
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  const parsedProof = JSON.parse(proof);
  if (typeof parsedProof?.sidechain_block_height !== 'number') {
    throw new Error(`BitAssets tx ${txid} was not confirmed after mining: ${proof}`);
  }
  console.log(`[BitAssets E2E] confirmed tx ${txid} at sidechain height ${parsedProof.sidechain_block_height}`);
}

function latestBitAssetId() {
  const localDevDir = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Users/lukekensik/drivechain-wallet-dev/local-dev';
  const composeFile = process.env.BITASSETS_E2E_COMPOSE_FILE || 'docker-compose.local-minimal.yml';
  const output = execFileSync(
    'bash',
    [
      '-lc',
      [
        `cd ${shellQuote(localDevDir)} &&`,
        `docker compose -f ${shellQuote(composeFile)} exec -T bitassets plain_bitassets_app_cli bitassets`,
      ].join(' '),
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  const bitassets = JSON.parse(output);
  if (!Array.isArray(bitassets) || bitassets.length === 0) {
    throw new Error(`No BitAssets returned by plain-bitassets: ${output}`);
  }
  const [, assetId] = bitassets[bitassets.length - 1];
  if (assetId === undefined || assetId === null) {
    throw new Error(`Could not extract latest BitAsset id: ${output}`);
  }
  console.log(`[BitAssets E2E] latest registered BitAsset id ${assetId}`);
  return String(assetId);
}

async function expectProofBackedUtxos(minimum = 1) {
  for (let i = 0; i < 6; i++) {
    await scrollToProofBackedCount();
    const rawCount = await extractTextFromElementById('BitAssetsProofBackedUtxoCount');
    const count = Number(String(rawCount).replace(/[^\d]/g, ''));
    if (Number.isFinite(count) && count >= minimum) return;
    await tapSyncButton();
    await sleep(3000);
  }
  await scrollToProofBackedCount();
  await expect(element(by.id('BitAssetsProofBackedUtxoCount'))).toHaveText(String(minimum));
}

function extractTxid(text) {
  const match = String(text).match(/[0-9a-f]{64}/i);
  if (!match) throw new Error(`Could not extract txid from BitAssets result: ${text}`);
  return match[0];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function scrollToProofBackedCount() {
  try {
    await waitFor(element(by.id('BitAssetsProofBackedUtxoCount')))
      .toBeVisible()
      .withTimeout(2000);
    return;
  } catch (_) {}
  await waitFor(element(by.id('BitAssetsProofBackedUtxoCount')))
    .toBeVisible()
    .whileElement(by.id('BitAssetsWalletScreen'))
    .scroll(500, 'up');
}

async function waitForBitAssetsSubmitTxid() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await resultHasTxid(1000)) return;
    if (await isExistingId('BitAssetsError', 1000)) {
      let errorText = '<unreadable>';
      try {
        errorText = await extractTextFromElementById('BitAssetsErrorText');
      } catch (_) {}
      try {
        errorText = errorText === '<unreadable>' ? await extractTextFromElementById('BitAssetsError') : errorText;
      } catch (_) {}
      throw new Error(`BitAssets submit failed: ${errorText}`);
    }
    await sleep(1000);
  }
  const result = (await isExistingId('BitAssetsResultText', 1000)) ? await extractTextFromElementById('BitAssetsResultText') : '<missing>';
  throw new Error(`Timed out waiting for BitAssets submit txid. Last result: ${result}`);
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

async function scrollToBitAssetsField(field) {
  const fieldId = bitAssetsFieldId(field);
  for (let i = 0; i < 8; i++) {
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(220, 'up');
    } catch (_) {}
    if (await isVisibleId(fieldId, 500)) return;
  }

  for (let i = 0; i < 8; i++) {
    if (await isVisibleId(fieldId, 500)) return;
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(180, 'down');
    } catch (_) {}
  }

  for (let i = 0; i < 4; i++) {
    if (await isVisibleId(fieldId, 500)) return;
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(120, 'up');
    } catch (_) {}
  }

  await waitFor(element(by.id(fieldId)))
    .toBeVisible()
    .withTimeout(3000);
}

function bitAssetsFieldId(field) {
  if (field === 'OperationInput') return 'BitAssetsE2EOperationInput';
  if (field === 'ParamsInput') return 'BitAssetsE2EParamsInput';
  return `BitAssetsField-${field}`;
}

async function scrollToBroadcastButton() {
  try {
    await waitFor(element(by.id('BitAssetsBroadcastButton')))
      .toBeVisible()
      .whileElement(by.id('BitAssetsWalletScreen'))
      .scroll(300, 'down');
  } catch (_) {
    if (device.getPlatform() === 'ios') return;
    await waitFor(element(by.id('BitAssetsBroadcastButton')))
      .toBeVisible()
      .withTimeout(5000);
  }

  // iOS can consider the button visible while its tappable point is clipped
  // under the top safe area after field-focused scrolling. Move content down
  // enough that the native hittable point is inside the viewport.
  if (device.getPlatform() === 'ios') {
    try {
      await element(by.id('BitAssetsWalletScreen')).scroll(180, 'up');
    } catch (_) {}
  }
}
