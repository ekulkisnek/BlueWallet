const { execFileSync } = require('child_process');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function readBitAssetsTxProof(localDevDir, composeFile, txid) {
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
  return JSON.parse(proof);
}

function mineBitAssetsTx(txid) {
  if (!txid) throw new Error('Cannot mine BitAssets tx without txid');
  const localDevDir = process.env.BITASSETS_E2E_LOCAL_DEV_DIR || '/Volumes/T705/code/drivechain-wallet-dev/local-dev';
  const composeFile = process.env.BITASSETS_E2E_COMPOSE_FILE || 'docker-compose.local-minimal.yml';
  console.log(`[BitAssets E2E] mining tx ${txid}`);
  const command = [
    `cd ${shellQuote(localDevDir)} &&`,
    `COMPOSE_FILE=${shellQuote(composeFile)}`,
    `BITASSETS_CONFIRM_TXID=${shellQuote(txid)}`,
    `BITASSETS_IMAGE=${shellQuote(process.env.BITASSETS_IMAGE || 'local/plain-bitassets:codex-proof')}`,
    `BITASSETS_PLATFORM=${shellQuote(process.env.BITASSETS_PLATFORM || 'linux/amd64')}`,
    `BMM_MINE_ATTEMPTS=${shellQuote(process.env.BMM_MINE_ATTEMPTS || '6')}`,
    `BMM_REQUEST_SETTLE_SECS=${shellQuote(process.env.BMM_REQUEST_SETTLE_SECS || '30')}`,
    `BITASSETS_MINE_TIMEOUT=${shellQuote(process.env.BITASSETS_MINE_TIMEOUT || '120')}`,
    './scripts/mine-bitassets-block.sh',
  ].join(' ');
  execFileSync('bash', ['-lc', command], {
    stdio: 'inherit',
    timeout: Number(process.env.BITASSETS_E2E_MINE_TIMEOUT_MS || 300000),
  });
  let parsedProof = readBitAssetsTxProof(localDevDir, composeFile, txid);
  const minimumConfirmations = Number(process.env.BITASSETS_E2E_MIN_PROOF_CONFIRMATIONS || 1);
  for (let attempt = 1; Number(parsedProof?.confirmations ?? 0) < minimumConfirmations && attempt <= 2; attempt++) {
    console.log(
      `[BitAssets E2E] tx ${txid} proof has ${Number(parsedProof?.confirmations ?? 0)} confirmations; mining maturity block ${attempt}/2`,
    );
    const maturityCommand = [
      `cd ${shellQuote(localDevDir)} &&`,
      `COMPOSE_FILE=${shellQuote(composeFile)}`,
      `BITASSETS_IMAGE=${shellQuote(process.env.BITASSETS_IMAGE || 'local/plain-bitassets:codex-proof')}`,
      `BITASSETS_PLATFORM=${shellQuote(process.env.BITASSETS_PLATFORM || 'linux/amd64')}`,
      `BMM_MINE_ATTEMPTS=${shellQuote(process.env.BMM_MINE_ATTEMPTS || '6')}`,
      `BMM_REQUEST_SETTLE_SECS=${shellQuote(process.env.BMM_REQUEST_SETTLE_SECS || '30')}`,
      `BITASSETS_MINE_TIMEOUT=${shellQuote(process.env.BITASSETS_MINE_TIMEOUT || '120')}`,
      './scripts/mine-bitassets-block.sh',
    ].join(' ');
    execFileSync('bash', ['-lc', maturityCommand], {
      stdio: 'inherit',
      timeout: Number(process.env.BITASSETS_E2E_MINE_TIMEOUT_MS || 300000),
    });
    parsedProof = readBitAssetsTxProof(localDevDir, composeFile, txid);
  }
  if (typeof parsedProof?.sidechain_block_height !== 'number') {
    throw new Error(`BitAssets tx ${txid} was not confirmed after mining: ${JSON.stringify(parsedProof)}`);
  }
  console.log(
    `[BitAssets E2E] confirmed tx ${txid} at sidechain height ${parsedProof.sidechain_block_height} with ${Number(
      parsedProof.confirmations ?? 0,
    )} confirmations`,
  );
}

module.exports = { mineBitAssetsTx, shellQuote };
