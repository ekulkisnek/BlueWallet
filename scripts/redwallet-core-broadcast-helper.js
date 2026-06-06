#!/usr/bin/env node

const http = require('http');
const { execFile } = require('child_process');

const host = process.env.REDWALLET_BROADCAST_HELPER_HOST || '0.0.0.0';
const port = Number(process.env.REDWALLET_BROADCAST_HELPER_PORT || 6126);
const container = process.env.REDWALLET_ENFORCER_CONTAINER || 'private-drivechain-local-enforcer-1';
const cookieFile = process.env.REDWALLET_MAINCHAIN_COOKIE_FILE || '/daemon-dir/signet/.cookie';

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function broadcast(txhex, cb) {
  execFile(
    'docker',
    [
      'exec',
      container,
      '/usr/bin/bitcoin-cli',
      '-signet',
      '-rpcconnect=mainchain',
      '-rpcport=38332',
      `-rpccookiefile=${cookieFile}`,
      'sendrawtransaction',
      txhex,
    ],
    { timeout: 20000 },
    (error, stdout, stderr) => {
      if (error) return cb(new Error((stderr || stdout || error.message).trim()));
      cb(null, stdout.trim());
    },
  );
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,accept',
      });
      return res.end();
    }
    if (req.method !== 'POST' || req.url !== '/broadcast') return send(res, 404, { ok: false, error: 'not found' });
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const { txhex } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!/^[0-9a-fA-F]+$/.test(txhex || '')) return send(res, 400, { ok: false, error: 'invalid txhex' });
        broadcast(txhex, (error, txid) => {
          if (error) return send(res, 500, { ok: false, error: error.message });
          send(res, 200, { ok: true, txid });
        });
      } catch (error) {
        send(res, 400, { ok: false, error: error.message });
      }
    });
  })
  .listen(port, host, () => console.log(`RedWallet Core broadcast helper listening on http://${host}:${port}`));
