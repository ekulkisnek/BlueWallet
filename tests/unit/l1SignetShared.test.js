const assert = require('assert');
const { sumPaidSatsToAddress } = require('../e2e/l1SignetShared');

describe('l1SignetShared', () => {
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
});
