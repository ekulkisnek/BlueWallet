#!/usr/bin/env node

const net = require('net');

const listenHost = process.env.LISTEN_HOST || '127.0.0.1';
const listenPort = Number(process.env.LISTEN_PORT || 0);
const targetHost = process.env.TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.TARGET_PORT || 0);

if (!listenPort || !targetPort) {
  console.error('LISTEN_PORT and TARGET_PORT are required');
  process.exit(2);
}

process.title = `redwallet-tcp-proxy-${listenPort}`;

const server = net.createServer(client => {
  const upstream = net.connect({ host: targetHost, port: targetPort });
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', error => {
  console.error(error);
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`${process.title} ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});
