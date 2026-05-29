#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.REDWALLET_BTC_COMMAND_HOST || '0.0.0.0';
const port = Number(process.env.REDWALLET_BTC_COMMAND_PORT || 6125);
const outDir = process.env.REDWALLET_BTC_COMMAND_OUT_DIR || '/Volumes/T705/redwallet-logs/current-iphone12-btc-command';
const commandPath = path.join(outDir, 'command.json');
const resultPath = path.join(outDir, 'result.json');
const eventsPath = path.join(outDir, 'server-events.ndjson');

fs.mkdirSync(outDir, { recursive: true });

let commandServed = false;

function writeEvent(event, details = {}) {
  fs.appendFileSync(eventsPath, `${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}\n`);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, commandReady: fs.existsSync(commandPath) && !commandServed });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,accept',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/command')) {
    if (commandServed || !fs.existsSync(commandPath)) {
      writeEvent('command_empty', { url: req.url });
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }

    const command = fs.readFileSync(commandPath);
    commandServed = true;
    writeEvent('command_served', { bytes: command.length, url: req.url });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': command.length,
      'access-control-allow-origin': '*',
    });
    res.end(command);
    return;
  }

  if (req.method === 'POST' && req.url === '/result') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      fs.writeFileSync(resultPath, body);
      writeEvent('result_received', { bytes: body.length });
      sendJson(res, 200, { ok: true, resultPath });
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(port, host, () => {
  writeEvent('listening', { host, port, outDir });
  console.log(`RedWallet BTC command server listening on http://${host}:${port}`);
  console.log(`Command path: ${commandPath}`);
  console.log(`Result path: ${resultPath}`);
});
