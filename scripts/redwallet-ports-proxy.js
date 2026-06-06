#!/usr/bin/env node

const net = require('net');
const dgram = require('dgram');

const LAN_IP = process.env.MAC_LAN_IP || '192.168.1.236';
const RPC_TARGET_PORT = Number(process.env.REDWALLET_LIQUID_RPC_TARGET_PORT || 6055);
const QUIC_TARGET_PORT = Number(process.env.REDWALLET_LIQUID_QUIC_TARGET_PORT || 6105);

// 1. TCP Proxy for RPC (Port 6055)
const tcpServer = net.createServer(socket => {
  const target = net.createConnection({ host: '127.0.0.1', port: RPC_TARGET_PORT });
  socket.pipe(target).pipe(socket);

  socket.on('error', err => {
    console.error(`[TCP Proxy] Client socket error: ${err.message}`);
    target.destroy();
  });
  target.on('error', err => {
    console.error(`[TCP Proxy] Target socket error: ${err.message}`);
    socket.destroy();
  });
});

tcpServer.listen(6055, LAN_IP, () => {
  console.log(`[TCP Proxy] Listening on ${LAN_IP}:6055 -> 127.0.0.1:${RPC_TARGET_PORT}`);
});

// 2. UDP Proxy for QUIC (Port 6105)
const udpServer = dgram.createSocket('udp4');
const clients = new Map(); // key: clientKey (ip:port), value: { targetSocket, lastActive }

udpServer.on('error', err => {
  console.error(`[UDP Proxy] Server error: ${err.message}`);
  udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
  const clientKey = `${rinfo.address}:${rinfo.port}`;
  let client = clients.get(clientKey);

  if (!client) {
    const targetSocket = dgram.createSocket('udp4');
    targetSocket.on('message', targetMsg => {
      udpServer.send(targetMsg, rinfo.port, rinfo.address, err => {
        if (err) console.error(`[UDP Proxy] Error sending to client ${clientKey}: ${err.message}`);
      });
    });
    targetSocket.on('error', err => {
      console.error(`[UDP Proxy] Target socket error for ${clientKey}: ${err.message}`);
    });
    client = { targetSocket, lastActive: Date.now() };
    clients.set(clientKey, client);
  }

  client.lastActive = Date.now();
  client.targetSocket.send(msg, QUIC_TARGET_PORT, '127.0.0.1', err => {
    if (err) console.error(`[UDP Proxy] Error sending to target: ${err.message}`);
  });
});

udpServer.bind(6105, LAN_IP, () => {
  console.log(`[UDP Proxy] Listening on ${LAN_IP}:6105 -> 127.0.0.1:${QUIC_TARGET_PORT}`);
});

// Cleanup inactive UDP clients every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, client] of clients.entries()) {
    if (now - client.lastActive > 60000) { // 1 minute timeout
      client.targetSocket.close();
      clients.delete(key);
      console.log(`[UDP Proxy] Cleaned up idle client session for ${key}`);
    }
  }
}, 30000);
