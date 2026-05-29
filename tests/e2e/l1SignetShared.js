const { execFileSync } = require('child_process');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function localDevPaths() {
  return {
    localDev: process.env.L1_E2E_LOCAL_DEV_DIR || process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Volumes/T705/code/drivechain-wallet-dev/local-dev',
    composeFile: process.env.L1_E2E_COMPOSE_FILE || process.env.BITASSETS_E2E_COMPOSE_FILE || 'docker-compose.local-minimal.yml',
  };
}

function fundL1Address(address, sats) {
  const rootDir = process.env.L1_E2E_ROOT_DIR || '/Volumes/T705/code/work-on-something-to-do-with/redwallet';
  const script = `${rootDir}/scripts/fund-l1-signet-address.sh`;
  const l1Blocks = process.env.L1_E2E_FUND_MINE_BLOCKS || process.env.L1_MINE_BLOCKS || '3';
  console.log(`[L1 E2E] Funding ${address} with ${sats} sats (mine ${l1Blocks} blocks)`);
  const txid = execFileSync('bash', [script, address, String(sats), l1Blocks], {
    encoding: 'utf8',
    timeout: Number(process.env.L1_E2E_FUND_TIMEOUT_MS || 120000),
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    throw new Error(`fund-l1-signet-address returned unexpected txid: ${txid}`);
  }
  console.log(`[L1 E2E] fund txid=${txid}`);
  return txid;
}

function mineL1Blocks(n) {
  const { localDev, composeFile } = localDevPaths();
  const blocks = Number(n);
  if (!Number.isFinite(blocks) || blocks < 1) {
    throw new Error(`mineL1Blocks: invalid block count ${n}`);
  }
  console.log(`[L1 E2E] Mining ${blocks} L1 block(s)`);
  execFileSync('bash', ['-lc', `cd ${shellQuote(localDev)} && ./scripts/mine-private-signet-blocks.sh ${blocks}`], {
    timeout: Number(process.env.L1_E2E_MINE_TIMEOUT_MS || 120000),
  });
}

function sumPaidSatsToAddress(tx, address) {
  let paidSats = 0;
  for (const vout of tx.vout || []) {
    const spk = vout.scriptPubKey || {};
    const addrs = [];
    if (spk.address) addrs.push(spk.address);
    if (Array.isArray(spk.addresses)) addrs.push(...spk.addresses);
    if (addrs.includes(address)) {
      paidSats += Math.round(Number(vout.value) * 1e8);
    }
  }
  return paidSats;
}

function waitForElectrumBalance(address, minSats) {
  const rootDir = process.env.L1_E2E_ROOT_DIR || '/Volumes/T705/code/work-on-something-to-do-with/redwallet';
  const script = `${rootDir}/scripts/preflight-electrum-balance.sh`;
  const ensureElectrum = `${rootDir}/scripts/ensure-l1-electrum.sh`;
  const balanceWaitMs = Number(process.env.L1_E2E_BALANCE_WAIT_MS || 180000);
  const timeoutSec = Math.ceil(balanceWaitMs / 1000);
  const postFundMine = Number(process.env.L1_E2E_POST_FUND_MINE_BLOCKS || process.env.L1_MINE_BLOCKS || 3);

  console.log(`[L1 E2E] Ensuring L1 electrum before balance preflight`);
  try {
    execFileSync('bash', [ensureElectrum], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, L1_E2E_ROOT_DIR: rootDir },
    });
  } catch (e) {
    console.log(`[L1 E2E] ensure-l1-electrum warn: ${(e && e.message) || e}`);
  }

  console.log(`[L1 E2E] Mining ${postFundMine} block(s) before electrum balance wait`);
  mineL1Blocks(postFundMine);

  console.log(`[L1 E2E] Waiting for Electrum balance >= ${minSats} sats on ${address} (timeout ${timeoutSec}s)`);
  execFileSync('bash', [script, address, String(minSats), String(timeoutSec)], {
    encoding: 'utf8',
    timeout: balanceWaitMs + 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      L1_E2E_ROOT_DIR: rootDir,
      REDWALLET_ELECTRUM_HOST: process.env.REDWALLET_ELECTRUM_HOST || '127.0.0.1',
      REDWALLET_ELECTRUM_PORT: process.env.REDWALLET_ELECTRUM_PORT || '60101',
    },
  });
}

function verifyTxPaysAddress(txid, address, minSats) {
  const { localDev, composeFile } = localDevPaths();
  const raw = execFileSync(
    'bash',
    [
      '-lc',
      [
        `cd ${shellQuote(localDev)} &&`,
        `docker compose -f ${shellQuote(composeFile)} exec -T mainchain`,
        `drivechain-cli -signet -rpccookiefile=/data/signet/.cookie getrawtransaction ${shellQuote(txid)} true`,
      ].join(' '),
    ],
    { encoding: 'utf8', timeout: Number(process.env.L1_E2E_VERIFY_TIMEOUT_MS || 60000) },
  );
  const tx = JSON.parse(raw);
  const paidSats = sumPaidSatsToAddress(tx, address);
  if (paidSats < minSats) {
    throw new Error(`tx ${txid} paid ${paidSats} sats to ${address}, expected >= ${minSats}`);
  }
  console.log(`[L1 E2E] verify tx ${txid} paid ${paidSats} sats to ${address}`);
  return paidSats;
}

module.exports = {
  fundL1Address,
  mineL1Blocks,
  waitForElectrumBalance,
  verifyTxPaysAddress,
  sumPaidSatsToAddress,
  shellQuote,
};
