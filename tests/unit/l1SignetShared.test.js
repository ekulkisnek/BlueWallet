const assert = require('assert');

jest.mock('child_process');
const cp = require('child_process');
const { sumPaidSatsToAddress, verifyTxPaysAddress } = require('../e2e/l1SignetShared');

const KNOWN_FUND_TXID_1 = '5d201abc2a73ddd65d70a35d969fd36166a279eff8ab01b3319da0e63fb7fb02';
const KNOWN_FUND_TXID_2 = '0b93bad64bcbcadf0151e2016253d652db903e4c337119a1faefa24519fe950b';
const TARGET_ADDR = 'tb1qeyvr4693xjtexcw5j4kr9xj9xvr99sf2t4lz5v';

describe('l1SignetShared', () => {
  beforeEach(() => {
    cp.execFileSync.mockClear();
  });

  it('sumPaidSatsToAddress totals matching vouts', () => {
    const tx = {
      vout: [
        { value: 0.0001, scriptPubKey: { address: 'bc1qaaa' } },
        { value: 0.00005, scriptPubKey: { addresses: ['bc1qbbb', 'bc1qaaa'] } },
        { value: 0.001, scriptPubKey: { address: 'bc1qccc' } },
      ],
    };
    assert.strictEqual(sumPaidSatsToAddress(tx, 'bc1qaaa'), 15000);
    assert.strictEqual(sumPaidSatsToAddress(tx, 'bc1qccc'), 100000);
    assert.strictEqual(sumPaidSatsToAddress(tx, 'bc1qmissing'), 0);
  });

  // Edge cases for sumPaidSatsToAddress (pure, no side effects)
  it('sumPaidSatsToAddress handles missing/empty vout and malformed entries', () => {
    assert.strictEqual(sumPaidSatsToAddress({}, 'any'), 0);
    assert.strictEqual(sumPaidSatsToAddress({ vout: [] }, 'any'), 0);
    assert.strictEqual(sumPaidSatsToAddress({ vout: [{}, { value: 0.1, scriptPubKey: null }, { value: 0.1, scriptPubKey: {} }] }, 'any'), 0);
    assert.strictEqual(sumPaidSatsToAddress({ vout: [{ value: 0.1 }] }, 'any'), 0); // no scriptPubKey
    assert.strictEqual(sumPaidSatsToAddress({ vout: [{ scriptPubKey: {} }] }, 'any'), 0); // no value
  });

  it('sumPaidSatsToAddress sums multiple vouts to same address and handles string values', () => {
    const tx = {
      vout: [
        { value: 0.00001, scriptPubKey: { address: 'tb1qtest' } },
        { value: '0.00002', scriptPubKey: { address: 'tb1qtest' } }, // string BTC
        { value: 0.00003, scriptPubKey: { addresses: ['tb1qother', 'tb1qtest'] } },
      ],
    };
    assert.strictEqual(sumPaidSatsToAddress(tx, 'tb1qtest'), 6000); // 1000+2000+3000
  });

  it('sumPaidSatsToAddress handles 1 sat, 0, and precision rounding', () => {
    const tx = {
      vout: [
        { value: 0.00000001, scriptPubKey: { address: 'tb1qsat' } }, // 1 sat exact
        { value: 0, scriptPubKey: { address: 'tb1qzero' } },
        { value: 0.000000012, scriptPubKey: { address: 'tb1qround' } }, // 1.2 -> 1 (safe fp)
      ],
    };
    assert.strictEqual(sumPaidSatsToAddress(tx, 'tb1qsat'), 1);
    assert.strictEqual(sumPaidSatsToAddress(tx, 'tb1qzero'), 0);
    assert.strictEqual(sumPaidSatsToAddress(tx, 'tb1qround'), 1);
  });

  // verifyTxPaysAddress tests using known signet txids from L1_VERIFIED_EVIDENCE.md
  // (mocked exec to simulate private-signet getrawtransaction responses; real txids used for test identity)
  it('verifyTxPaysAddress succeeds for known fund txid 5d20... (100k sats to target)', () => {
    const sampleTx = {
      vout: [
        { value: 47.7561039, scriptPubKey: { address: 'tb1q46t9zdnwjauel9zupd3em0aqjafxa8q0vhturt' } },
        { value: 0.001, scriptPubKey: { address: TARGET_ADDR } },
      ],
    };
    cp.execFileSync.mockReturnValueOnce(JSON.stringify(sampleTx));
    const paid = verifyTxPaysAddress(KNOWN_FUND_TXID_1, TARGET_ADDR, 100000);
    assert.strictEqual(paid, 100000);
    assert.strictEqual(cp.execFileSync.mock.calls.length, 1);
  });

  it('verifyTxPaysAddress succeeds for known fund txid 0b93... (100k sats to target)', () => {
    const sampleTx = {
      vout: [
        { value: 47.73692624, scriptPubKey: { address: 'tb1q7umwzdlpeahc4mj4jzc4p656ecp9e2a2uyy5q5' } },
        { value: 0.001, scriptPubKey: { address: TARGET_ADDR } },
      ],
    };
    cp.execFileSync.mockReturnValueOnce(JSON.stringify(sampleTx));
    const paid = verifyTxPaysAddress(KNOWN_FUND_TXID_2, TARGET_ADDR, 100000);
    assert.strictEqual(paid, 100000);
  });

  it('verifyTxPaysAddress throws when paid sats < minSats for known txid pattern', () => {
    const lowPayTx = {
      vout: [{ value: 0.0005, scriptPubKey: { address: TARGET_ADDR } }], // only 50000 sats
    };
    cp.execFileSync.mockReturnValueOnce(JSON.stringify(lowPayTx));
    assert.throws(() => {
      verifyTxPaysAddress(KNOWN_FUND_TXID_1, TARGET_ADDR, 100000);
    }, /paid 50000 sats.*expected >= 100000/);
  });

  it('verifyTxPaysAddress throws on non-JSON RPC response', () => {
    cp.execFileSync.mockReturnValueOnce('not json');
    assert.throws(() => {
      verifyTxPaysAddress('deadbeef'.repeat(8), 'tb1qany', 1);
    }, /Unexpected token|JSON/);
  });
});
