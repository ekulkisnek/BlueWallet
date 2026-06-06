#!/usr/bin/env node

const fs = require('fs');
const http = require('http');

const listenHost = process.env.LISTEN_HOST || '0.0.0.0';
const listenPort = Number(process.env.LISTEN_PORT || 18443);
const targetHost = process.env.TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.TARGET_PORT || 18443);
const walletName = process.env.WALLET_NAME || 'redwallet-proof';
const cookieFile = process.env.RPC_COOKIE_FILE || '/tmp/liquid-id5-regtest/regtest/.cookie';

process.title = `redwallet-elements-rpc-proxy-${listenPort}`;

function readCookieAuth() {
  const cookie = fs.readFileSync(cookieFile, 'utf8').trim();
  return `Basic ${Buffer.from(cookie).toString('base64')}`;
}

function targetPathFor(pathname) {
  if (pathname && pathname.startsWith('/wallet/')) return pathname;
  return `/wallet/${encodeURIComponent(walletName)}`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, walletName, target: `${targetHost}:${targetPort}` }));
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    let authHeader;
    try {
      authHeader = req.headers.authorization || readCookieAuth();
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unable to read Elements RPC cookie: ${error.message}` }));
      return;
    }

    const upstream = http.request(
      {
        host: targetHost,
        port: targetPort,
        path: targetPathFor(new URL(req.url || '/', 'http://redwallet.local').pathname),
        method: req.method,
        headers: {
          ...req.headers,
          host: `${targetHost}:${targetPort}`,
          authorization: authHeader,
          'content-length': Buffer.concat(chunks).length,
        },
      },
      upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on('error', error => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Elements RPC proxy error: ${error.message}` }));
    });

    upstream.end(Buffer.concat(chunks));
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `redwallet-elements-rpc-proxy ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}/wallet/${walletName}`,
  );
});
