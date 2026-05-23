const mockNativeModule = {
  configure: jest.fn(),
  getNewAddress: jest.fn(),
  walletInfo: jest.fn(),
  sync: jest.fn(),
  listUtxos: jest.fn(),
  getBalance: jest.fn(),
  transfer: jest.fn(),
  reserve: jest.fn(),
  register: jest.fn(),
  ammMint: jest.fn(),
  ammSwap: jest.fn(),
  ammBurn: jest.fn(),
  dutchAuctionCreate: jest.fn(),
  dutchAuctionBid: jest.fn(),
  dutchAuctionCollect: jest.fn(),
  clear: jest.fn(),
};

jest.mock('../../codegen/NativeBitAssetsWallet', () => mockNativeModule);
jest.mock('../../blue_modules/BlueElectrum', () => ({
  connectMain: jest.fn(),
}));
jest.mock('../../class/wallets/legacy-wallet', () => ({
  LegacyWallet: class {
    static fromJson(obj: string) {
      const parsed = JSON.parse(obj);
      const wallet = new this();
      for (const key of Object.keys(parsed)) {
        (wallet as any)[key] = parsed[key];
      }
      return wallet;
    }

    secret = '';
    balance = 0;
    unconfirmed_balance = 0;
    _lastBalanceFetch = 0;
    _lastTxFetch = 0;
    private label = '';

    setLabel(label: string) {
      this.label = label;
    }

    getLabel() {
      return this.label;
    }

    getBalance() {
      return this.balance;
    }
  },
}));

const { BitAssetsWallet } = require('../../class/wallets/bitassets-wallet');
const { EmbeddedBitAssetsWalletClient, JsonRpcBitAssetsWalletClient } = require('../../blue_modules/BitAssetsWallet');
const {
  BITASSETS_OPERATION_DEFINITIONS,
  applyBitAssetsE2ETestDefaults,
  buildBitAssetsOperationParams,
  initialBitAssetsFormState,
  normalizeBitAssetsError,
  validateBitAssetsRpcUrl,
} = require('../../blue_modules/BitAssetsWalletForms');
const { walletOpenRouteFor } = require('../../screen/wallets/walletOpenRoute');

describe('BitAssets mobile wallet bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeModule.configure.mockResolvedValue('{"configured":true}');
    mockNativeModule.getNewAddress.mockResolvedValue('bitassets-address-1');
    mockNativeModule.walletInfo.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        address_count: 1,
        confirmed_utxo_count: 2,
        mempool_utxo_count: 0,
        balances: { asset_a: 40, asset_b: 2 },
        last_tip_hash: 'tip',
        last_tip_height: 7,
      }),
    );
    mockNativeModule.sync.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        address_count: 1,
        confirmed_utxo_count: 1,
        mempool_utxo_count: 0,
        balances: { asset_a: 25 },
      }),
    );
    mockNativeModule.listUtxos.mockResolvedValue(
      JSON.stringify({
        confirmed: [
          {
            txid: 'a',
            vout: 0,
            asset_id: 'asset_a',
            amount: 25,
            confirmed: true,
            utreexo_leaf_hash: 'leaf-a-utreexo',
            proof_refs: [
              {
                block_hash: 'side-block-1',
                sidechain_block_height: 123,
                bmm_inclusions: ['bmm-incl-xyz'],
                best_main_verification: 'best-main-ok',
              },
            ],
          },
        ],
        mempool: [
          {
            txid: 'b',
            vout: 1,
            asset_id: 'asset_b',
            amount: 3,
            confirmed: false,
          },
        ],
      }),
    );
    mockNativeModule.getBalance.mockResolvedValue(JSON.stringify({ asset_a: 25 }));
    mockNativeModule.clear.mockResolvedValue('{"cleared":true}');
  });

  it('creates a native wallet, stores its address, and sums balances', async () => {
    const wallet = new BitAssetsWallet();
    wallet.setLabel('Mobile BitAssets');

    await wallet.generate('http://127.0.0.1:6004');
    await wallet.fetchBalance();

    expect(mockNativeModule.configure).toHaveBeenCalledWith(JSON.stringify({ rpcUrl: 'http://127.0.0.1:6004' }));
    expect(mockNativeModule.getNewAddress).toHaveBeenCalledTimes(1);
    expect(wallet.getAddress()).toBe('bitassets-address-1');
    expect(wallet.secret).toBe('bitassets://bitassets-address-1');
    expect(wallet.getBalance()).toBe(42);
  });

  it('rehydrates persisted BitAssets wallets and configures the native signer before every use', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';
    mockNativeModule.reserve.mockResolvedValue('txid');

    await wallet.init();
    await wallet.fetchBalance();
    await expect(wallet.reserveBitAsset({ name: 'PERSISTED', feeSats: 0 })).resolves.toBe('txid');

    expect(wallet.getAddress()).toBe('persisted-address');
    expect(mockNativeModule.configure).toHaveBeenCalledTimes(2);
    expect(mockNativeModule.configure).toHaveBeenCalledWith(JSON.stringify({ rpcUrl: 'http://127.0.0.1:6004' }));
    expect(mockNativeModule.reserve).toHaveBeenCalledWith(JSON.stringify({ name: 'PERSISTED', feeSats: 0 }));
  });

  it('keeps only persistent BitAssets wallet fields on the JS wallet', async () => {
    const wallet = new BitAssetsWallet();
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';

    await wallet.syncBitAssets();

    expect((wallet as any)._bitassetsConfiguredRpcUrl).toBeUndefined();
    expect(wallet.bitassetsRpcUrl).toBe('http://127.0.0.1:6004');
  });

  it('purges native signer persistence through the embedded bridge', async () => {
    const wallet = new BitAssetsWallet();

    await expect(wallet.clearNativeSigner()).resolves.toBeUndefined();

    expect(mockNativeModule.clear).toHaveBeenCalledTimes(1);
  });

  it('syncs and flattens confirmed and mempool UTXOs', async () => {
    const wallet = new BitAssetsWallet();

    const info = await wallet.syncBitAssets();

    expect(info.balances.asset_a).toBe(25);
    expect(wallet.getBalance()).toBe(25);
    expect(wallet.bitassetsUtxos.map((utxo: { txid?: string }) => utxo.txid)).toEqual(['a', 'b']);
  });

  it('persists proof-backed BitAssets UTXOs across wallet JSON round trips', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';

    await wallet.syncBitAssets();

    const persisted = JSON.stringify({ ...wallet, type: wallet.type });
    const restored = BitAssetsWallet.fromJson(persisted) as typeof wallet;
    await restored.init();

    expect(restored.getAddress()).toBe('persisted-address');
    expect(restored.bitassetsUtxos).toEqual(wallet.bitassetsUtxos);
    expect(restored.bitassetsUtxos[0].utreexo_leaf_hash).toBe('leaf-a-utreexo');
    expect(restored.bitassetsUtxos[0].proof_refs?.[0]).toMatchObject({
      sidechain_block_height: 123,
      bmm_inclusions: ['bmm-incl-xyz'],
      best_main_verification: 'best-main-ok',
    });
  });

  it('keeps proof-backed receive and change UTXOs after native asset creation and send flow', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';
    mockNativeModule.reserve.mockResolvedValue('tx-reserve');
    mockNativeModule.register.mockResolvedValue('tx-register');
    mockNativeModule.transfer.mockResolvedValue('tx-transfer');
    mockNativeModule.sync.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        address_count: 2,
        confirmed_utxo_count: 2,
        mempool_utxo_count: 0,
        balances: { asset_a: 24 },
        last_tip_hash: 'tip-after-transfer',
        last_tip_height: 125,
      }),
    );
    mockNativeModule.listUtxos.mockResolvedValue(
      JSON.stringify({
        confirmed: [
          {
            txid: 'tx-register',
            vout: 0,
            asset_id: 'asset_a',
            amount: 23,
            content_kind: 'bitasset',
            confirmed: true,
            utreexo_leaf_hash: 'leaf-register-receive',
            proof_refs: [
              {
                block_hash: 'side-block-register',
                sidechain_block_height: 124,
                bmm_inclusions: ['bmm-register'],
                best_main_verification: 'best-main-register',
              },
            ],
          },
          {
            txid: 'tx-transfer',
            vout: 1,
            asset_id: 'asset_a',
            amount: 1,
            content_kind: 'bitasset',
            confirmed: true,
            utreexo_leaf_hash: 'leaf-transfer-change',
            proof_refs: [
              {
                block_hash: 'side-block-transfer',
                sidechain_block_height: 125,
                bmm_inclusions: ['bmm-transfer'],
                best_main_verification: 'best-main-transfer',
              },
            ],
          },
        ],
        mempool: [],
      }),
    );

    await expect(wallet.reserveBitAsset({ name: 'FLOW', feeSats: 0 })).resolves.toBe('tx-reserve');
    await expect(wallet.registerBitAsset({ name: 'FLOW', initialSupply: 25, bitassetData: {}, feeSats: 0 })).resolves.toBe('tx-register');
    await expect(
      wallet.transferBitAssets({ destinationAddress: 'persisted-address', assetId: 'asset_a', amount: 1, feeSats: 0 }),
    ).resolves.toBe('tx-transfer');
    await wallet.syncBitAssets();

    const persisted = JSON.stringify({ ...wallet, type: wallet.type });
    const restored = BitAssetsWallet.fromJson(persisted) as typeof wallet;
    await restored.init();

    expect(restored.bitassetsInfo?.last_tip_height).toBe(125);
    expect(restored.bitassetsUtxos).toHaveLength(2);
    expect(restored.bitassetsUtxos.map((utxo: { utreexo_leaf_hash?: string }) => utxo.utreexo_leaf_hash)).toEqual([
      'leaf-register-receive',
      'leaf-transfer-change',
    ]);
    expect(
      restored.bitassetsUtxos.every(
        (utxo: { proof_refs?: Array<{ sidechain_block_height?: number; bmm_inclusions?: string[]; best_main_verification?: string }> }) =>
          typeof utxo.proof_refs?.[0]?.sidechain_block_height === 'number' &&
          Boolean(utxo.proof_refs?.[0]?.bmm_inclusions?.length) &&
          Boolean(utxo.proof_refs?.[0]?.best_main_verification),
      ),
    ).toBe(true);
  });

  it('serializes every native constructor payload and parses txids', async () => {
    const client = new EmbeddedBitAssetsWalletClient();
    mockNativeModule.transfer.mockResolvedValue(JSON.stringify({ txid: 'tx-transfer' }));
    mockNativeModule.reserve.mockResolvedValue('tx-reserve');
    mockNativeModule.register.mockResolvedValue(JSON.stringify({ txid: 'tx-register' }));
    mockNativeModule.ammMint.mockResolvedValue(JSON.stringify({ txid: 'tx-mint' }));
    mockNativeModule.ammSwap.mockResolvedValue(JSON.stringify({ txid: 'tx-swap' }));
    mockNativeModule.ammBurn.mockResolvedValue(JSON.stringify({ txid: 'tx-burn' }));
    mockNativeModule.dutchAuctionCreate.mockResolvedValue(JSON.stringify({ txid: 'tx-create' }));
    mockNativeModule.dutchAuctionBid.mockResolvedValue(JSON.stringify({ txid: 'tx-bid' }));
    mockNativeModule.dutchAuctionCollect.mockResolvedValue(JSON.stringify({ txid: 'tx-collect' }));

    await expect(
      client.transfer({
        destinationAddress: 'dest',
        assetId: 'asset',
        amount: 1,
        feeSats: 0,
        memo: 'm',
      }),
    ).resolves.toBe('tx-transfer');
    await expect(client.reserve({ name: 'ASSET', feeSats: 0 })).resolves.toBe('tx-reserve');
    await expect(
      client.register({
        name: 'ASSET',
        initialSupply: 100,
        bitassetData: { ticker: 'ASSET' },
        feeSats: 0,
      }),
    ).resolves.toBe('tx-register');
    await expect(
      client.ammMint({
        asset0: 'a',
        asset1: 'b',
        amount0: 1,
        amount1: 2,
        lpTokenMint: 3,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-mint');
    await expect(
      client.ammSwap({
        assetSpend: 'a',
        assetReceive: 'b',
        amountSpend: 1,
        amountReceive: 2,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-swap');
    await expect(
      client.ammBurn({
        asset0: 'a',
        asset1: 'b',
        amount0: 1,
        amount1: 2,
        lpTokenBurn: 3,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-burn');
    await expect(
      client.dutchAuctionCreate({
        baseAsset: 'a',
        quoteAsset: 'b',
        baseAmount: 1,
        startPrice: 2,
        endPrice: 1,
        duration: 10,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-create');
    await expect(
      client.dutchAuctionBid({
        auctionId: 'auction',
        baseAsset: 'a',
        quoteAsset: 'b',
        bidSize: 1,
        receiveQuantity: 2,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-bid');
    await expect(
      client.dutchAuctionCollect({
        auctionId: 'auction',
        baseAsset: 'a',
        quoteAsset: 'b',
        amountBase: 1,
        amountQuote: 2,
        feeSats: 0,
      }),
    ).resolves.toBe('tx-collect');

    expect(JSON.parse(mockNativeModule.ammMint.mock.calls[0][0])).toEqual({
      asset0: 'a',
      asset1: 'b',
      amount0: 1,
      amount1: 2,
      lpTokenMint: 3,
      feeSats: 0,
    });
  });

  it('maps JSON-RPC fallback methods to the Floresta API', async () => {
    const calls: any[] = [];
    const fetchMock = jest.fn(async (_url, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return {
        ok: true,
        json: async () => ({
          result:
            body.method === 'bitassets_listutxos'
              ? {
                  confirmed: [
                    {
                      txid: 'x',
                      utreexo_leaf_hash: 'leaf-x',
                      proof_refs: [
                        {
                          block_hash: 'block-x',
                          sidechain_block_height: 42,
                          bmm_inclusions: ['bmm-x'],
                          best_main_verification: 'verified',
                        },
                      ],
                    },
                  ],
                  mempool: [],
                }
              : 'txid',
        }),
      };
    });
    global.fetch = fetchMock as any;

    const client = new JsonRpcBitAssetsWalletClient('http://127.0.0.1:18443');
    await expect(client.getNewAddress()).resolves.toBe('txid');
    await expect(client.listUtxos()).resolves.toEqual([
      {
        txid: 'x',
        utreexo_leaf_hash: 'leaf-x',
        proof_refs: [
          {
            block_hash: 'block-x',
            sidechain_block_height: 42,
            bmm_inclusions: ['bmm-x'],
            best_main_verification: 'verified',
          },
        ],
      },
    ]);
    await expect(
      client.transfer({
        destinationAddress: 'dest',
        assetId: 'asset',
        amount: 5,
        feeSats: 0,
      }),
    ).resolves.toBe('txid');
    await expect(client.reserve({ name: 'NAME', feeSats: 0 })).resolves.toBe('txid');
    await expect(
      client.dutchAuctionCollect({
        auctionId: 'a',
        baseAsset: 'b',
        quoteAsset: 'q',
        amountBase: 1,
        amountQuote: 2,
      }),
    ).resolves.toBe('txid');

    expect(calls.map(call => call.method)).toEqual([
      'bitassets_getnewaddress',
      'bitassets_listutxos',
      'bitassets_transfer',
      'bitassets_reserve',
      'bitassets_dutch_auction_collect',
    ]);
    expect(calls[2].params).toEqual(['dest', 'asset', 5, 0, null]);
    expect(calls[4].params).toEqual(['a', 'b', 'q', 1, 2, 0]);
  });

  it('opens BitAssets wallets on the dedicated native wallet screen', () => {
    expect(
      walletOpenRouteFor({
        type: BitAssetsWallet.type,
        getID: () => 'bitassets-wallet-id',
      }),
    ).toEqual(['BitAssetsWallet', { walletID: 'bitassets-wallet-id' }]);
    expect(
      walletOpenRouteFor({
        type: 'HDsegwitBech32',
        getID: () => 'bitcoin-wallet-id',
      }),
    ).toEqual(['WalletTransactions', { walletID: 'bitcoin-wallet-id', walletType: 'HDsegwitBech32' }]);
  });

  it('builds typed form payloads and rejects invalid constructor input', () => {
    const forms = initialBitAssetsFormState();
    forms.transfer.destinationAddress = 'dest';
    forms.transfer.assetId = 'asset';
    forms.transfer.amount = '5';
    forms.transfer.memo = 'hello';
    expect(buildBitAssetsOperationParams('transfer', forms.transfer)).toEqual({
      destinationAddress: 'dest',
      assetId: 'asset',
      amount: 5,
      memo: 'hello',
      feeSats: 0,
    });

    forms.register.name = 'ASSET';
    forms.register.initialSupply = '1000';
    forms.register.bitassetData = '{"ticker":"ASSET"}';
    expect(buildBitAssetsOperationParams('register', forms.register)).toEqual({
      name: 'ASSET',
      initialSupply: 1000,
      bitassetData: { ticker: 'ASSET' },
      feeSats: 0,
    });

    expect(() => buildBitAssetsOperationParams('reserve', forms.reserve)).toThrow('Name is required');
    expect(() =>
      buildBitAssetsOperationParams('ammSwap', { assetSpend: 'a', assetReceive: 'b', amountSpend: '1.2', amountReceive: '1' }),
    ).toThrow('Amount to spend must be a whole number');
    expect(() => buildBitAssetsOperationParams('register', { name: 'BAD', initialSupply: '1', bitassetData: '{' })).toThrow(
      'Asset metadata JSON must be valid JSON',
    );
  });

  it('keeps BitAssets test defaults explicit and outside production form parsing', () => {
    expect(() => buildBitAssetsOperationParams('transfer', initialBitAssetsFormState().transfer)).toThrow(
      'Destination address is required',
    );
    expect(() => buildBitAssetsOperationParams('register', initialBitAssetsFormState().register)).toThrow('Reserved name is required');

    expect(applyBitAssetsE2ETestDefaults('reserve', { name: '' }, { now: 123 })).toEqual({ name: 'e2e-123' });
    expect(
      applyBitAssetsE2ETestDefaults('register', { name: '', initialSupply: '', bitassetData: '' }, { lastReserveName: 'RESERVED' }),
    ).toEqual({ name: 'RESERVED', initialSupply: '25', bitassetData: '{}' });
    expect(
      applyBitAssetsE2ETestDefaults(
        'transfer',
        { destinationAddress: '', assetId: '', amount: '', memo: '' },
        { walletAddress: 'wallet-address', spendableAssetId: 'asset-a', lastRegisterTxid: 'tx-register' },
      ),
    ).toEqual({ destinationAddress: 'wallet-address', assetId: 'asset-a', amount: '1', memo: '' });
  });

  it('defines a production form for every native constructor and normalizes common errors', () => {
    expect(BITASSETS_OPERATION_DEFINITIONS.map((definition: { key: string }) => definition.key)).toEqual([
      'transfer',
      'reserve',
      'register',
      'ammMint',
      'ammSwap',
      'ammBurn',
      'dutchAuctionCreate',
      'dutchAuctionBid',
      'dutchAuctionCollect',
    ]);
    expect(normalizeBitAssetsError(new Error('native constructors currently support fee_sats=0'))).toBe(
      'BitAssets mobile constructors currently support fee_sats = 0 only.',
    );
    expect(normalizeBitAssetsError(new Error('Network request failed'))).toBe(
      'Could not reach the BitAssets RPC endpoint. Check the RPC URL and local signet stack.',
    );
  });

  it('requires HTTPS for non-local BitAssets RPC endpoints', () => {
    expect(validateBitAssetsRpcUrl(' http://127.0.0.1:6004 ')).toBe('http://127.0.0.1:6004');
    expect(validateBitAssetsRpcUrl('http://10.0.2.2:6004')).toBe('http://10.0.2.2:6004');
    expect(validateBitAssetsRpcUrl('http://172.16.1.2:6004')).toBe('http://172.16.1.2:6004');
    expect(validateBitAssetsRpcUrl('http://192.168.1.2:6004')).toBe('http://192.168.1.2:6004');
    expect(validateBitAssetsRpcUrl('https://bitassets.example.com')).toBe('https://bitassets.example.com');
    expect(() => validateBitAssetsRpcUrl('http://bitassets.example.com')).toThrow('must use HTTPS');
    expect(() => validateBitAssetsRpcUrl('ftp://127.0.0.1:6004')).toThrow('must use http or https');
  });
});
