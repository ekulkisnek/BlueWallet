#!/usr/bin/env node
/* Minimal Electrum JSON-lines shim for the local Elements regtest proof path. */
const net = require('net');
const crypto = require('crypto');

const host = process.env.LIQUID_ELECTRUM_SHIM_HOST || '0.0.0.0';
const port = Number(process.env.LIQUID_ELECTRUM_SHIM_PORT || 60401);
const rpcUrl = process.env.LIQUID_RPC_URL || 'http://127.0.0.1:18443';
const cookieFile = process.env.LIQUID_RPC_COOKIE || '/tmp/liquid-id5-regtest/regtest/.cookie';
const fs = require('fs');
const auth = Buffer.from(fs.readFileSync(cookieFile, 'utf8').trim()).toString('base64');

const txById = new Map();
const originalToElementsTxid = new Map();
const elementsToOriginalTxid = new Map();
const utxosByScripthash = new Map();
const historyByScripthash = new Map();
const spent = new Set();
let indexedHeight = -1;
let indexInFlight = null;

process.on('uncaughtException', error => {
  console.error(`shim uncaughtException ${error?.stack || error}`);
});

process.on('unhandledRejection', error => {
  console.error(`shim unhandledRejection ${error?.stack || error}`);
});

async function rpc(method, params = [], wallet = '') {
  const url = wallet ? `${rpcUrl.replace(/\/$/, '')}/wallet/${wallet}` : rpcUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'shim', method, params }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`RPC ${method} returned non-JSON HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.result;
}

function scripthash(scriptHex) {
  return Buffer.from(crypto.createHash('sha256').update(Buffer.from(scriptHex, 'hex')).digest()).reverse().toString('hex');
}

function electrumHeaderHex(height) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(0x20000000, 0);
  const heightSalt = crypto.createHash('sha256').update(String(height)).digest();
  heightSalt.copy(header, 4, 0, 32);
  heightSalt.copy(header, 36, 0, 32);
  header.writeUInt32LE(Math.floor(Date.now() / 1000), 68);
  header.writeUInt32LE(0x207fffff, 72);
  header.writeUInt32LE(height >>> 0, 76);
  return serializeElementsHeaderFromBitcoinHeaderHex(header.toString('hex'), height);
}

function addHistory(sh, tx_hash, height) {
  if (!historyByScripthash.has(sh)) historyByScripthash.set(sh, []);
  const rows = historyByScripthash.get(sh);
  if (!rows.some(row => row.tx_hash === tx_hash)) rows.push({ tx_hash, height });
}

function writeUInt32LE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function writeUInt64BE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

function writeUInt64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function varInt(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n >>> 0, 1);
  return b;
}

function readVarInt(buffer, cursor) {
  const first = buffer[cursor.offset++];
  if (first < 0xfd) return first;
  if (first === 0xfd) {
    const n = buffer.readUInt16LE(cursor.offset);
    cursor.offset += 2;
    return n;
  }
  if (first === 0xfe) {
    const n = buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    return n;
  }
  const n = buffer.readBigUInt64LE(cursor.offset);
  cursor.offset += 8;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('varint too large');
  return Number(n);
}

function readSlice(buffer, cursor, len) {
  const out = buffer.subarray(cursor.offset, cursor.offset + len);
  cursor.offset += len;
  if (out.length !== len) throw new Error('truncated raw transaction');
  return out;
}

function writeVarSlice(bytes) {
  return Buffer.concat([varInt(bytes.length), bytes]);
}

function readVarSlice(buffer, cursor) {
  return readSlice(buffer, cursor, readVarInt(buffer, cursor));
}

function readWitnessStack(buffer, cursor) {
  const items = readVarInt(buffer, cursor);
  const stack = [];
  for (let i = 0; i < items; i++) stack.push(readVarSlice(buffer, cursor));
  return stack;
}

function readConfidentialAsset(buffer, cursor) {
  const prefix = readSlice(buffer, cursor, 1)[0];
  if (prefix === 0) return { prefix, asset: null };
  if (prefix === 1 || prefix === 10 || prefix === 11) {
    return { prefix, asset: readSlice(buffer, cursor, 32) };
  }
  throw new Error(`unsupported Elements asset prefix ${prefix}`);
}

function readConfidentialValue(buffer, cursor) {
  const prefix = readSlice(buffer, cursor, 1)[0];
  if (prefix === 0) return 0n;
  if (prefix === 1) return readSlice(buffer, cursor, 8).readBigUInt64BE(0);
  if (prefix === 8 || prefix === 9) {
    readSlice(buffer, cursor, 32);
    throw new Error('cannot translate blinded Elements output value to Bitcoin-style local tx');
  }
  throw new Error(`unsupported Elements value prefix ${prefix}`);
}

function readConfidentialNonce(buffer, cursor) {
  const prefix = readSlice(buffer, cursor, 1)[0];
  if (prefix === 0) return;
  if (prefix === 2 || prefix === 3) {
    readSlice(buffer, cursor, 32);
    return;
  }
  throw new Error(`unsupported Elements nonce prefix ${prefix}`);
}

function readElementsInputRaw(buffer, cursor) {
  const start = cursor.offset;
  readSlice(buffer, cursor, 32);
  const encodedVout = buffer.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  readVarSlice(buffer, cursor);
  cursor.offset += 4;
  if (encodedVout !== 0xffffffff && (encodedVout & 0x80000000) !== 0) {
    readSlice(buffer, cursor, 32);
    readSlice(buffer, cursor, 32);
    readConfidentialValue(buffer, cursor);
    readConfidentialValue(buffer, cursor);
  }
  return buffer.subarray(start, cursor.offset);
}

function readElementsOutputRaw(buffer, cursor) {
  const start = cursor.offset;
  readConfidentialAsset(buffer, cursor);
  readConfidentialValueAllowConfidential(buffer, cursor);
  readConfidentialNonce(buffer, cursor);
  readVarSlice(buffer, cursor);
  return buffer.subarray(start, cursor.offset);
}

function readConfidentialValueAllowConfidential(buffer, cursor) {
  const prefix = readSlice(buffer, cursor, 1)[0];
  if (prefix === 0) return;
  if (prefix === 1) {
    readSlice(buffer, cursor, 8);
    return;
  }
  if (prefix === 8 || prefix === 9) {
    readSlice(buffer, cursor, 32);
    return;
  }
  throw new Error(`unsupported Elements value prefix ${prefix}`);
}

function readElementsInputWitnessRaw(buffer, cursor) {
  const start = cursor.offset;
  readVarSlice(buffer, cursor);
  readVarSlice(buffer, cursor);
  readWitnessStack(buffer, cursor);
  readWitnessStack(buffer, cursor);
  return buffer.subarray(start, cursor.offset);
}

function readElementsOutputWitnessRaw(buffer, cursor) {
  const start = cursor.offset;
  readVarSlice(buffer, cursor);
  readVarSlice(buffer, cursor);
  return buffer.subarray(start, cursor.offset);
}

function elementsCoreHexToLwkHex(coreHex) {
  const buffer = Buffer.from(coreHex, 'hex');
  const cursor = { offset: 0 };
  const version = readSlice(buffer, cursor, 4);
  const marker = buffer[cursor.offset++];
  const flag = buffer[cursor.offset++];
  if (marker !== 0 || (flag !== 0 && flag !== 1)) return coreHex;
  const inputCountOffset = cursor.offset;
  const inputCount = readVarInt(buffer, cursor);
  const inputCountRaw = buffer.subarray(inputCountOffset, cursor.offset);
  const inputs = [];
  for (let i = 0; i < inputCount; i++) inputs.push(readElementsInputRaw(buffer, cursor));
  const outputCountOffset = cursor.offset;
  const outputCount = readVarInt(buffer, cursor);
  const outputCountRaw = buffer.subarray(outputCountOffset, cursor.offset);
  const outputs = [];
  for (let i = 0; i < outputCount; i++) outputs.push(readElementsOutputRaw(buffer, cursor));
  const inputWitnesses = [];
  const outputWitnesses = [];
  if (flag === 1) {
    for (let i = 0; i < inputCount; i++) inputWitnesses.push(readElementsInputWitnessRaw(buffer, cursor));
    for (let i = 0; i < outputCount; i++) outputWitnesses.push(readElementsOutputWitnessRaw(buffer, cursor));
  }
  const lockTime = readSlice(buffer, cursor, 4);
  return Buffer.concat([
    version,
    Buffer.from([flag]),
    inputCountRaw,
    ...inputs,
    outputCountRaw,
    ...outputs,
    lockTime,
    ...inputWitnesses,
    ...outputWitnesses,
  ]).toString('hex');
}

function elementsLwkHexToCoreHex(lwkHex) {
  // LWK already gives us a fully signed Elements transaction. Do not translate
  // it after signing; the local Liquid node must run in Elements mode and accept
  // these bytes directly.
  return lwkHex;
}

function elementsTxHexToBitcoinRawHex(elementsHex) {
  const buffer = Buffer.from(elementsHex, 'hex');
  const cursor = { offset: 0 };
  const version = buffer.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  const witnessFlag = readSlice(buffer, cursor, 1)[0];
  if (witnessFlag !== 0 && witnessFlag !== 1) {
    throw new Error(`unsupported Elements witness flag ${witnessFlag}`);
  }

  const inputCount = readVarInt(buffer, cursor);
  if (inputCount === 0) throw new Error('Elements transaction has no inputs');
  const inputs = [];
  let inputTotal = 0;
  for (let i = 0; i < inputCount; i++) {
    const syntheticTxidLE = readSlice(buffer, cursor, 32);
    const syntheticTxid = Buffer.from(syntheticTxidLE).reverse().toString('hex');
    const originalTxid = elementsToOriginalTxid.get(syntheticTxid) || syntheticTxid;
    const originalTxidLE = Buffer.from(originalTxid, 'hex').reverse();
    const encodedVout = buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    const vout = encodedVout & 0x3fffffff;
    const hasIssuance = encodedVout !== 0xffffffff && (encodedVout & (1 << 31)) !== 0;
    const script = readVarSlice(buffer, cursor);
    const sequence = buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    if (hasIssuance) {
      readSlice(buffer, cursor, 32); // asset blinding nonce
      readSlice(buffer, cursor, 32); // asset entropy
      readConfidentialValue(buffer, cursor); // issuance amount
      readConfidentialValue(buffer, cursor); // inflation keys
    }
    const prev = `${syntheticTxid}:${vout}`;
    for (const rows of utxosByScripthash.values()) {
      const found = rows.find(row => `${row.tx_hash}:${row.tx_pos}` === prev);
      if (found) inputTotal += found.value;
    }
    inputs.push({ txidLE: originalTxidLE, vout, script, sequence, witness: [] });
  }

  const outputCount = readVarInt(buffer, cursor);
  const outputs = [];
  for (let i = 0; i < outputCount; i++) {
    readConfidentialAsset(buffer, cursor);
    const valuePrefixOffset = cursor.offset;
    let value = null;
    try {
      value = readConfidentialValue(buffer, cursor);
    } catch (error) {
      if (!/blinded Elements output value/.test(error.message)) throw error;
      cursor.offset = valuePrefixOffset;
      readConfidentialValueAllowConfidential(buffer, cursor);
    }
    readConfidentialNonce(buffer, cursor);
    const script = readVarSlice(buffer, cursor);
    outputs.push({ value, script });
  }
  const lockTime = buffer.readUInt32LE(cursor.offset);
  cursor.offset += 4;

  if (witnessFlag === 1) {
    for (const input of inputs) {
      readVarSlice(buffer, cursor); // amount rangeproof
      readVarSlice(buffer, cursor); // inflation keys rangeproof
      input.witness = readWitnessStack(buffer, cursor);
      readWitnessStack(buffer, cursor); // pegin witness
    }
    for (let i = 0; i < outputCount; i++) {
      readVarSlice(buffer, cursor); // surjection proof
      readVarSlice(buffer, cursor); // rangeproof
    }
  }

  const hasBitcoinWitness = inputs.some(input => input.witness.length > 0);
  const feeOutputCount = outputs.filter(output => output.script.length === 0).length;
  const explicitTotal = outputs.reduce((sum, output) => sum + (output.value === null ? 0 : Number(output.value)), 0);
  const blindedNonFee = outputs.filter(output => output.value === null && output.script.length > 0);
  let remaining = inputTotal > 0 ? inputTotal - explicitTotal - feeOutputCount : 0;
  const defaultSend = Number(process.env.REDWALLET_LIQUID_TEST_SEND_SATS || 5000000);
  for (const output of outputs) {
    if (output.value !== null || output.script.length === 0) continue;
    if (blindedNonFee.length > 1 && output === blindedNonFee[0] && remaining > defaultSend) {
      output.value = BigInt(defaultSend);
      remaining -= defaultSend;
    } else {
      output.value = BigInt(Math.max(0, remaining));
      remaining = 0;
    }
  }
  const parts = [writeUInt32LE(version)];
  if (hasBitcoinWitness) parts.push(Buffer.from([0, 1]));
  parts.push(varInt(inputs.length));
  for (const input of inputs) {
    parts.push(
      input.txidLE,
      writeUInt32LE(input.vout),
      writeVarSlice(input.script),
      writeUInt32LE(input.sequence),
    );
  }
  const spendableOutputs = outputs.filter(output => output.script.length > 0);
  parts.push(varInt(spendableOutputs.length));
  for (const output of spendableOutputs) {
    parts.push(writeUInt64LE(output.value), writeVarSlice(output.script));
  }
  if (hasBitcoinWitness) {
    for (const input of inputs) {
      parts.push(varInt(input.witness.length));
      for (const item of input.witness) parts.push(writeVarSlice(item));
    }
  }
  parts.push(writeUInt32LE(lockTime));
  return Buffer.concat(parts).toString('hex');
}

function parseBitcoinRawTransaction(hex) {
  const buffer = Buffer.from(hex, 'hex');
  const cursor = { offset: 0 };
  const version = buffer.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  let inputCount = readVarInt(buffer, cursor);
  let hasWitness = false;
  if (inputCount === 0 && buffer[cursor.offset] === 1) {
    hasWitness = true;
    cursor.offset += 1;
    inputCount = readVarInt(buffer, cursor);
  }
  const inputs = [];
  for (let i = 0; i < inputCount; i++) {
    const txidLE = readSlice(buffer, cursor, 32);
    const vout = buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    const scriptLen = readVarInt(buffer, cursor);
    const script = readSlice(buffer, cursor, scriptLen);
    const sequence = buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    inputs.push({ txidLE, vout, script, sequence });
  }
  const outputCount = readVarInt(buffer, cursor);
  const outputs = [];
  for (let i = 0; i < outputCount; i++) {
    const value = buffer.readBigUInt64LE(cursor.offset);
    cursor.offset += 8;
    const scriptLen = readVarInt(buffer, cursor);
    const script = readSlice(buffer, cursor, scriptLen);
    outputs.push({ value, script });
  }
  if (hasWitness) {
    for (let i = 0; i < inputCount; i++) {
      const items = readVarInt(buffer, cursor);
      for (let j = 0; j < items; j++) {
        const len = readVarInt(buffer, cursor);
        readSlice(buffer, cursor, len);
      }
    }
  }
  const lockTime = buffer.readUInt32LE(cursor.offset);
  return { version, inputs, outputs, lockTime };
}

function serializeElementsTransactionFromBitcoinHex(bitcoinHex) {
  const tx = parseBitcoinRawTransaction(bitcoinHex);
  const policyAssetId = Buffer.from(
    process.env.LIQUID_POLICY_ASSET || '5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225',
    'hex',
  ).reverse();
  const parts = [
    writeUInt32LE(tx.version),
    Buffer.from([0]), // no Elements witness section in the synthetic prev-tx data
    varInt(tx.inputs.length),
  ];
  for (const input of tx.inputs) {
    parts.push(
      input.txidLE,
      writeUInt32LE(input.vout),
      varInt(input.script.length),
      input.script,
      writeUInt32LE(input.sequence),
    );
  }
  parts.push(varInt(tx.outputs.length));
  for (const output of tx.outputs) {
    parts.push(
      Buffer.from([1]), // confidential::Asset::Explicit
      policyAssetId,
      Buffer.from([1]), // confidential::Value::Explicit
      writeUInt64BE(output.value),
      Buffer.from([0]), // confidential::Nonce::Null
      varInt(output.script.length),
      output.script,
    );
  }
  parts.push(writeUInt32LE(tx.lockTime));
  return Buffer.concat(parts).toString('hex');
}

function serializeElementsHeaderFromBitcoinHeaderHex(bitcoinHeaderHex, height) {
  const header = Buffer.from(bitcoinHeaderHex, 'hex');
  if (header.length < 72) throw new Error(`truncated block header: ${bitcoinHeaderHex}`);
  return Buffer.concat([
    header.subarray(0, 72), // version, prev hash, merkle root, time
    writeUInt32LE(Number(height) >>> 0),
    Buffer.from([0]), // empty proof challenge script
    Buffer.from([0]), // empty proof solution script
  ]).toString('hex');
}

function elementsTransactionHexFromRpcTx(tx) {
  if (!tx?.hex) return null;
  const raw = String(tx.hex).toLowerCase();
  const maybeElementsFlag = raw.slice(8, 10);
  if (maybeElementsFlag === '00' || maybeElementsFlag === '01') {
    return raw;
  }
  try {
    return serializeElementsTransactionFromBitcoinHex(tx.hex);
  } catch (error) {
    console.error(`failed to synthesize Elements tx for ${tx.txid}: ${error.message}`);
    return tx.hex;
  }
}

function txidFromSerializedHex(hex) {
  const first = crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest();
  return Buffer.from(crypto.createHash('sha256').update(first).digest()).reverse().toString('hex');
}

async function indexChain() {
  if (indexInFlight) return indexInFlight;
  indexInFlight = indexChainOnce().finally(() => {
    indexInFlight = null;
  });
  return indexInFlight;
}

async function indexChainOnce() {
  const height = await rpc('getblockcount');
  if (height === indexedHeight) return;
  txById.clear();
  originalToElementsTxid.clear();
  elementsToOriginalTxid.clear();
  utxosByScripthash.clear();
  historyByScripthash.clear();
  spent.clear();
  for (let h = 0; h <= height; h++) {
    const hash = await rpc('getblockhash', [h]);
    const block = await rpc('getblock', [hash, 2]);
    for (const tx of block.tx || []) {
      const elementsHex = elementsTransactionHexFromRpcTx(tx) || tx.hex;
      const elementsTxid = txidFromSerializedHex(elementsHex);
      originalToElementsTxid.set(tx.txid, elementsTxid);
      elementsToOriginalTxid.set(elementsTxid, tx.txid);
      txById.set(tx.txid, elementsHex);
      txById.set(elementsTxid, elementsHex);
      for (const vin of tx.vin || []) {
        if (vin.txid && Number.isInteger(vin.vout)) {
          spent.add(`${originalToElementsTxid.get(vin.txid) || vin.txid}:${vin.vout}`);
        }
      }
      for (const vout of tx.vout || []) {
        const scriptHex = vout.scriptPubKey?.hex;
        if (!scriptHex) continue;
        const sh = scripthash(scriptHex);
        addHistory(sh, tx.txid, h);
        if (!utxosByScripthash.has(sh)) utxosByScripthash.set(sh, []);
        utxosByScripthash.get(sh).push({
          tx_hash: tx.txid,
          tx_pos: vout.n,
          height: h,
          value: Math.round(Number(vout.value || 0) * 100000000),
        });
      }
    }
  }
  for (const [sh, rows] of utxosByScripthash) {
    utxosByScripthash.set(sh, rows.filter(row => !spent.has(`${row.tx_hash}:${row.tx_pos}`)));
  }
  indexedHeight = height;
}

async function handle(method, params) {
  if (method === 'server.version') return ['redwallet-liquid-shim', '1.6'];
  if (method === 'server.ping') return null;
  if (method === 'blockchain.headers.subscribe') {
    const height = await rpc('getblockcount');
    return { height, hex: electrumHeaderHex(height) };
  }
  if (method === 'blockchain.block.header') {
    const height = await rpc('getblockcount');
    const requested = Number(params[0]);
    const safeHeight = Math.max(0, Math.min(Number.isFinite(requested) ? requested : height, height));
    return electrumHeaderHex(safeHeight);
  }
  if (method === 'blockchain.estimatefee') return 0.00001;
  if (method === 'blockchain.relayfee') return 0.00001;
  if (method === 'blockchain.scripthash.subscribe') {
    await indexChain();
    const rows = historyByScripthash.get(params[0]) || [];
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  if (method === 'blockchain.scripthash.get_history') {
    await indexChain();
    return historyByScripthash.get(params[0]) || [];
  }
  if (method === 'blockchain.scripthash.listunspent') {
    await indexChain();
    return utxosByScripthash.get(params[0]) || [];
  }
  if (method === 'blockchain.scripthash.get_balance') {
    await indexChain();
    const confirmed = (utxosByScripthash.get(params[0]) || []).reduce((sum, row) => sum + row.value, 0);
    return { confirmed, unconfirmed: 0 };
  }
  if (method === 'blockchain.transaction.get') {
    await indexChain();
    const txHex = txById.get(params[0]) || await rpc('getrawtransaction', [params[0], false]);
    if (typeof txHex !== 'string' || txHex.length === 0) {
      throw new Error(`transaction not found: ${params[0]}`);
    }
    return txHex;
  }
  if (method === 'blockchain.transaction.broadcast') {
    const txHex = String(params[0] || '');
    fs.writeFileSync('/tmp/redwallet-liquid-last-broadcast.hex', txHex);
    console.error(`shim broadcast tx bytes=${txHex.length / 2} prefix=${txHex.slice(0, 80)}`);
    const coreHex = elementsLwkHexToCoreHex(txHex);
    console.error(`shim broadcast core tx bytes=${coreHex.length / 2} prefix=${coreHex.slice(0, 80)}`);
    return rpc('sendrawtransaction', [coreHex]);
  }
  throw new Error(`unsupported method ${method}`);
}

net.createServer(socket => {
  let buffer = '';
  socket.on('error', error => {
    console.error(`shim socket ERROR ${error.message}`);
  });
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      console.error(`shim recv ${line.slice(0, 300)}`);
      Promise.resolve()
        .then(async () => {
          const parsed = JSON.parse(line);
          const requests = Array.isArray(parsed) ? parsed : [parsed];
          const responses = await Promise.all(requests.map(async req => {
            try {
              const result = await handle(req.method, req.params || []);
              console.error(`shim ${req.method} -> ${Array.isArray(result) ? `array(${result.length})` : typeof result}`);
              return { jsonrpc: '2.0', id: req.id, result };
            } catch (error) {
              console.error(`shim ${req.method} ERROR ${error.message}`);
              return { jsonrpc: '2.0', id: req.id, error: { code: 1, message: error.message } };
            }
          }));
          socket.write(`${JSON.stringify(Array.isArray(parsed) ? responses : responses[0])}\n`);
        })
        .catch(error => {
          let id = null;
          try { id = JSON.parse(line).id; } catch {}
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: 1, message: error.message } })}\n`);
        });
    }
  });
}).listen(port, host, () => {
  console.log(`redwallet liquid electrum shim listening on ${host}:${port}`);
});
