#!/usr/bin/env node
/**
 * Serves a one-shot BitAssets self-test command for real-device StorageProvider polling.
 * Phones fetch http://<mac-lan>:6124/command — must match BITASSETS_REAL_DEVICE_SELFTEST_COMMAND_URL.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { listen } = require('./redwallet-http-listen');

const host = process.env.REDWALLET_BITASSETS_COMMAND_HOST || '0.0.0.0';
const port = Number(process.env.REDWALLET_BITASSETS_COMMAND_PORT || 6124);
const logRoot = process.env.REDWALLET_LOG_ROOT || '/Volumes/T705/redwallet-logs';
const runDir =
  process.env.REDWALLET_BITASSETS_COMMAND_DIR ||
  path.join(logRoot, `redwallet-bitassets-command-server-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')}`);
const currentLink = path.join(logRoot, 'current-bitassets-command-server');
const commandPath = path.join(runDir, 'command.json');
const requestsPath = path.join(runDir, 'requests.ndjson');
const logPath = path.join(runDir, 'server.log');

const defaultCommand = {
  operation: 'createWallet',
  commandId: process.env.REDWALLET_BITASSETS_COMMAND_ID || `phone-proof-${Date.now()}`,
  label: process.env.REDWALLET_BITASSETS_COMMAND_LABEL || 'Real device BitAssets',
  rpcUrl: process.env.BITASSETS_RPC_URL || 'http://100.76.117.106:6004',
  bitassetsLiteWalletQuicUrl:
    process.env.BITASSETS_LITE_WALLET_QUIC_URL ||
    (() => {
      const rpc = process.env.BITASSETS_RPC_URL || 'http://100.76.117.106:6004';
      try {
        const u = new URL(rpc);
        return `${u.hostname}:6104`;
      } catch {
        return '100.76.117.106:6104';
      }
    })(),
  skipSync: false,
};

fs.mkdirSync(runDir, { recursive: true });
if (!fs.existsSync(commandPath)) {
  fs.writeFileSync(commandPath, `${JSON.stringify(defaultCommand, null, 2)}\n`);
}
try {
  fs.rmSync(currentLink, { force: true });
  fs.symlinkSync(runDir, currentLink);
} catch (error) {
  fs.writeFileSync(path.join(runDir, 'symlink-error.txt'), String(error?.stack || error));
}

const summary = [
  `url=http://${host}:${port}/command`,
  `command=${JSON.stringify(JSON.parse(fs.readFileSync(commandPath, 'utf8')))}`,
  `run_dir=${runDir}`,
].join('\n');
fs.writeFileSync(path.join(runDir, 'SUMMARY.txt'), `${summary}\n`);

function log(line) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

function appendRequest(entry) {
  fs.appendFileSync(requestsPath, `${JSON.stringify(entry)}\n`);
}

const server = http.createServer((req, res) => {
  appendRequest({ time: new Date().toISOString(), method: req.method, url: req.url, remote: req.socket.remoteAddress });
  log(`${req.method} ${req.url} from ${req.socket.remoteAddress || 'unknown'}`);

  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, commandReady: fs.existsSync(commandPath) }));
    return;
  }

  if (!req.url.startsWith('/command')) {
    res.writeHead(404).end('not found');
    return;
  }

  if (!fs.existsSync(commandPath)) {
    res.writeHead(204).end();
    return;
  }

  const body = fs.readFileSync(commandPath);
  const servedPath = path.join(runDir, `served-${Date.now()}-command.json`);
  if (process.env.REDWALLET_BITASSETS_COMMAND_REPEAT === '1') {
    fs.copyFileSync(commandPath, servedPath);
    log(`served command (repeat) from ${servedPath}`);
  } else {
    fs.renameSync(commandPath, servedPath);
    log(`served command from ${servedPath}`);
  }
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
});

listen(server, port, host, () => {
  log(`RedWallet BitAssets command server listening on http://${host}:${port}/command`);
  log(`run_dir=${runDir}`);
});
