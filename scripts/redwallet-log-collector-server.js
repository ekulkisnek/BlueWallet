#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.REDWALLET_LOG_COLLECTOR_HOST || '0.0.0.0';
const port = Number(process.env.REDWALLET_LOG_COLLECTOR_PORT || 6123);
const logRoot = process.env.REDWALLET_LOG_ROOT || '/Volumes/T705/redwallet-logs';
const runDir =
  process.env.REDWALLET_LOG_COLLECTOR_DIR ||
  path.join(logRoot, `redwallet-js-event-collector-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`);
const currentLink = path.join(logRoot, 'current-js-event-collector');
const eventsPath = path.join(runDir, 'events.ndjson');
const requestsPath = path.join(runDir, 'requests.ndjson');

fs.mkdirSync(runDir, { recursive: true });
try {
  fs.rmSync(currentLink, { force: true });
  fs.symlinkSync(runDir, currentLink);
} catch (error) {
  fs.writeFileSync(path.join(runDir, 'symlink-error.txt'), String(error && error.stack ? error.stack : error));
}

function append(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestRecord = {
    ts: new Date().toISOString(),
    method: req.method,
    url: req.url,
    remoteAddress: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      append(requestsPath, { ...requestRecord, status: 200 });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/events') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      append(requestsPath, { ...requestRecord, status: 404 });
      return;
    }
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      parsed = { raw: body };
    }
    append(eventsPath, { collectorTs: new Date().toISOString(), remoteAddress: req.socket.remoteAddress, event: parsed });
    res.writeHead(204);
    res.end();
    append(requestsPath, { ...requestRecord, status: 204, bytes: body.length });
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error\n');
    append(requestsPath, { ...requestRecord, status: 500, error: String(error && error.stack ? error.stack : error) });
  }
});

server.listen(port, host, () => {
  const summary = [
    `run_dir=${runDir}`,
    `current_link=${currentLink}`,
    `url=http://${host}:${port}/events`,
    `health=http://${host}:${port}/health`,
    `events=${eventsPath}`,
    `started=${new Date().toISOString()}`,
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'SUMMARY.txt'), `${summary}\n`);
  console.log(summary);
});
