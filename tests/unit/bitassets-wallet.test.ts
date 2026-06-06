const mockBitAssetsNativeModule = {
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

jest.mock('../../codegen/NativeBitAssetsWallet', () => mockBitAssetsNativeModule);
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

const { BitAssetsWallet, hasBitAssetsWallet } = require('../../class/wallets/bitassets-wallet');
const {
  EmbeddedBitAssetsWalletClient,
  JsonRpcBitAssetsWalletClient,
  deriveBitAssetsLiteWalletQuicUrl,
  isProofBackedBitAssetsUtxo,
  summarizeBitAssetsProofState,
} = require('../../blue_modules/BitAssetsWallet');
const {
  BITASSETS_OPERATION_DEFINITIONS,
  applyBitAssetsE2ETestDefaults,
  buildBitAssetsOperationParams,
  initialBitAssetsFormState,
  isBitAssetsE2EControlsEnabled,
  normalizeBitAssetsError,
  redactSensitiveBitAssetsDetails,
  validateBitAssetsRpcUrl,
} = require('../../blue_modules/BitAssetsWalletForms');
const { walletOpenRouteFor } = require('../../screen/wallets/walletOpenRoute');

const TXID_RESERVE = '11'.repeat(32);
const TXID_REGISTER = '22'.repeat(32);
const TXID_TRANSFER = '33'.repeat(32);
const TXID_MINT = '44'.repeat(32);
const TXID_SWAP = '55'.repeat(32);
const TXID_BURN = '66'.repeat(32);
const TXID_AUCTION_CREATE = '77'.repeat(32);
const TXID_AUCTION_BID = '88'.repeat(32);
const TXID_AUCTION_COLLECT = '99'.repeat(32);

describe('BitAssets mobile wallet bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBitAssetsNativeModule.configure.mockResolvedValue('{"configured":true}');
    mockBitAssetsNativeModule.getNewAddress.mockResolvedValue('bitassets-address-1');
    mockBitAssetsNativeModule.walletInfo.mockResolvedValue(
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
    mockBitAssetsNativeModule.sync.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        address_count: 1,
        confirmed_utxo_count: 1,
        mempool_utxo_count: 0,
        balances: { asset_a: 25 },
      }),
    );
    mockBitAssetsNativeModule.listUtxos.mockResolvedValue(
      JSON.stringify({
        confirmed: [
          {
            txid: 'a',
            vout: 0,
            address: 'bitassets-change-address',
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
            address: 'bitassets-mempool-address',
            asset_id: 'asset_b',
            amount: 3,
            confirmed: false,
          },
        ],
      }),
    );
    mockBitAssetsNativeModule.getBalance.mockResolvedValue(JSON.stringify({ asset_a: 25 }));
    mockBitAssetsNativeModule.clear.mockResolvedValue('{"cleared":true}');
  });

  it('creates a native wallet, stores its address, and sums balances', async () => {
    const wallet = new BitAssetsWallet();
    wallet.setLabel('Mobile BitAssets');

    await wallet.generate('http://127.0.0.1:6004');
    await wallet.fetchBalance();

    expect(mockBitAssetsNativeModule.configure).toHaveBeenCalledWith(JSON.stringify({ rpcUrl: 'http://127.0.0.1:6004' }));
    expect(mockBitAssetsNativeModule.getNewAddress).toHaveBeenCalledTimes(1);
    expect(wallet.getAddress()).toBe('bitassets-address-1');
    expect(wallet.secret).toBe('bitassets://bitassets-address-1');
    expect(wallet.getBalance()).toBe(42);
  });

  it('keeps explicit BitAssets QUIC disablement through native configuration', async () => {
    const wallet = new BitAssetsWallet();

    await wallet.generate('http://127.0.0.1:6004', 'disabled');

    expect(mockBitAssetsNativeModule.configure).toHaveBeenCalledWith(
      JSON.stringify({ rpcUrl: 'http://127.0.0.1:6004', bitassetsLiteWalletQuicUrl: 'disabled' }),
    );
    expect(wallet.bitassetsLiteWalletQuicDisabled).toBe(true);
    expect(wallet.bitassetsLiteWalletQuicUrl).toBe('');
  });

  it('requires the persisted BitAssets RPC URL before native signer use', async () => {
    const wallet = new BitAssetsWallet();

    await expect(wallet.generate()).rejects.toThrow('BitAssets RPC URL is required');
    await expect(wallet.fetchBalance()).rejects.toThrow('BitAssets RPC URL is required');

    expect(mockBitAssetsNativeModule.configure).not.toHaveBeenCalled();
    expect(mockBitAssetsNativeModule.getNewAddress).not.toHaveBeenCalled();
  });

  it('detects existing BitAssets wallets before creating another native signer entry', () => {
    expect(hasBitAssetsWallet([{ type: 'HDsegwitBech32' }])).toBe(false);
    expect(hasBitAssetsWallet([{ type: 'HDsegwitBech32' }, { type: BitAssetsWallet.type }])).toBe(true);
  });

  it('rehydrates persisted BitAssets wallets and configures the native signer before every use', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';
    mockBitAssetsNativeModule.reserve.mockResolvedValue(TXID_RESERVE);

    await wallet.init();
    await wallet.fetchBalance();
    await expect(wallet.reserveBitAsset({ name: 'PERSISTED', feeSats: 0 })).resolves.toBe(TXID_RESERVE);

    expect(wallet.getAddress()).toBe('persisted-address');
    expect(mockBitAssetsNativeModule.configure).toHaveBeenCalledTimes(2);
    expect(mockBitAssetsNativeModule.configure).toHaveBeenCalledWith(JSON.stringify({ rpcUrl: 'http://127.0.0.1:6004' }));
    expect(mockBitAssetsNativeModule.reserve).toHaveBeenCalledWith(JSON.stringify({ name: 'PERSISTED', feeSats: 0 }));
  });

  it('keeps only persistent BitAssets wallet fields on the JS wallet', async () => {
    const wallet = new BitAssetsWallet();
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';

    await wallet.syncBitAssets();

    expect((wallet as any)._bitassetsConfiguredRpcUrl).toBeUndefined();
    expect(wallet.bitassetsRpcUrl).toBe('http://127.0.0.1:6004');
    expect(wallet.bitassetsLiteWalletQuicUrl).toBe('');
  });

  it('purges native signer persistence through the embedded bridge', async () => {
    const wallet = new BitAssetsWallet();

    await expect(wallet.clearNativeSigner()).resolves.toBeUndefined();

    expect(mockBitAssetsNativeModule.clear).toHaveBeenCalledTimes(1);
  });

  it('syncs and flattens confirmed and mempool UTXOs', async () => {
    const wallet = new BitAssetsWallet();
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';

    const info = await wallet.syncBitAssets();

    expect(info.balances.asset_a).toBe(25);
    expect(wallet.getBalance()).toBe(25);
    expect(wallet.bitassetsUtxos.map((utxo: { txid?: string }) => utxo.txid)).toEqual(['a', 'b']);
    expect(wallet.weOwnAddress('bitassets-change-address')).toBe(true);
    expect(wallet.weOwnAddress('bitassets-mempool-address')).toBe(true);
    expect(wallet.weOwnAddress('bitassets-foreign-address')).toBe(false);
    expect(wallet.weOwnAddress(false as any)).toBe(false);
  });

  it('does not restore BitAssets UTXO state from JS wallet JSON', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';

    await wallet.syncBitAssets();

    const persisted = JSON.stringify({ ...wallet, type: wallet.type });
    const restored = BitAssetsWallet.fromJson(persisted) as typeof wallet;
    await restored.init();

    expect(restored.getAddress()).toBe('persisted-address');
    expect(restored.bitassetsInfo).toBeUndefined();
    expect(restored.bitassetsUtxos).toEqual([]);
  });

  it('reloads proof-backed receive and change UTXOs from native Floresta state after asset creation and send flow', async () => {
    const wallet = new BitAssetsWallet();
    wallet.secret = 'bitassets://persisted-address';
    wallet.bitassetsRpcUrl = 'http://127.0.0.1:6004';
    mockBitAssetsNativeModule.reserve.mockResolvedValue(TXID_RESERVE);
    mockBitAssetsNativeModule.register.mockResolvedValue(TXID_REGISTER);
    mockBitAssetsNativeModule.transfer.mockResolvedValue(TXID_TRANSFER);
    mockBitAssetsNativeModule.sync.mockResolvedValue(
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
    mockBitAssetsNativeModule.listUtxos.mockResolvedValue(
      JSON.stringify({
        confirmed: [
          {
            txid: TXID_REGISTER,
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
            txid: TXID_TRANSFER,
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

    await expect(wallet.reserveBitAsset({ name: 'FLOW', feeSats: 0 })).resolves.toBe(TXID_RESERVE);
    await expect(wallet.registerBitAsset({ name: 'FLOW', initialSupply: 25, bitassetData: {}, feeSats: 0 })).resolves.toBe(TXID_REGISTER);
    await expect(
      wallet.transferBitAssets({ destinationAddress: 'persisted-address', assetId: 'asset_a', amount: 1, feeSats: 0 }),
    ).resolves.toBe(TXID_TRANSFER);
    await wallet.syncBitAssets();

    const persisted = JSON.stringify({ ...wallet, type: wallet.type });
    const restored = BitAssetsWallet.fromJson(persisted) as typeof wallet;
    await restored.init();

    expect(restored.bitassetsInfo).toBeUndefined();
    expect(restored.bitassetsUtxos).toEqual([]);

    await restored.syncBitAssets();

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

  it('summarizes proof-backed BitAssets UTXO state for audit UI', () => {
    const backed = {
      confirmed: true,
      utreexo_leaf_hash: 'leaf',
      proof_refs: [{ sidechain_block_height: 1, bmm_inclusions: ['bmm'], best_main_verification: 'verified' }],
    };
    const missingProof = { confirmed: true, utreexo_leaf_hash: '', proof_refs: [] };
    const mempool = { confirmed: false };

    expect(isProofBackedBitAssetsUtxo(backed)).toBe(true);
    expect(isProofBackedBitAssetsUtxo(missingProof)).toBe(false);
    expect(summarizeBitAssetsProofState([backed, missingProof, mempool])).toEqual({
      confirmed: 2,
      proofBacked: 1,
      missingProofs: 1,
      label: '1/2 proof-backed; sync incomplete',
    });
    expect(summarizeBitAssetsProofState([backed]).label).toBe('1/1 proof-backed');
    expect(summarizeBitAssetsProofState([mempool]).label).toBe('No confirmed UTXOs');
  });

  it('derives the private-signet BitAssets QUIC peer from the RPC endpoint', () => {
    expect(deriveBitAssetsLiteWalletQuicUrl('http://192.168.1.50:6004')).toBe('192.168.1.50:6104');
    expect(deriveBitAssetsLiteWalletQuicUrl('https://bitassets.local:18443/rpc')).toBe('bitassets.local:18543');
    expect(deriveBitAssetsLiteWalletQuicUrl('not a url')).toBeUndefined();
  });

  it('serializes every native constructor payload and parses txids', async () => {
    const client = new EmbeddedBitAssetsWalletClient();
    mockBitAssetsNativeModule.transfer.mockResolvedValue(JSON.stringify({ txid: TXID_TRANSFER }));
    mockBitAssetsNativeModule.reserve.mockResolvedValue(TXID_RESERVE);
    mockBitAssetsNativeModule.register.mockResolvedValue(JSON.stringify({ txid: TXID_REGISTER }));
    mockBitAssetsNativeModule.ammMint.mockResolvedValue(JSON.stringify({ txid: TXID_MINT }));
    mockBitAssetsNativeModule.ammSwap.mockResolvedValue(JSON.stringify({ txid: TXID_SWAP }));
    mockBitAssetsNativeModule.ammBurn.mockResolvedValue(JSON.stringify({ txid: TXID_BURN }));
    mockBitAssetsNativeModule.dutchAuctionCreate.mockResolvedValue(JSON.stringify({ txid: TXID_AUCTION_CREATE }));
    mockBitAssetsNativeModule.dutchAuctionBid.mockResolvedValue(JSON.stringify({ txid: TXID_AUCTION_BID }));
    mockBitAssetsNativeModule.dutchAuctionCollect.mockResolvedValue(JSON.stringify({ txid: TXID_AUCTION_COLLECT }));

    await expect(
      client.transfer({
        destinationAddress: 'dest',
        assetId: 'asset',
        amount: 1,
        feeSats: 0,
        memo: 'm',
      }),
    ).resolves.toBe(TXID_TRANSFER);
    await expect(client.reserve({ name: 'ASSET', feeSats: 0 })).resolves.toBe(TXID_RESERVE);
    await expect(
      client.register({
        name: 'ASSET',
        initialSupply: 100,
        bitassetData: { ticker: 'ASSET' },
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_REGISTER);
    await expect(
      client.ammMint({
        asset0: 'a',
        asset1: 'b',
        amount0: 1,
        amount1: 2,
        lpTokenMint: 3,
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_MINT);
    await expect(
      client.ammSwap({
        assetSpend: 'a',
        assetReceive: 'b',
        amountSpend: 1,
        amountReceive: 2,
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_SWAP);
    await expect(
      client.ammBurn({
        asset0: 'a',
        asset1: 'b',
        amount0: 1,
        amount1: 2,
        lpTokenBurn: 3,
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_BURN);
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
    ).resolves.toBe(TXID_AUCTION_CREATE);
    await expect(
      client.dutchAuctionBid({
        auctionId: 'auction',
        baseAsset: 'a',
        quoteAsset: 'b',
        bidSize: 1,
        receiveQuantity: 2,
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_AUCTION_BID);
    await expect(
      client.dutchAuctionCollect({
        auctionId: 'auction',
        baseAsset: 'a',
        quoteAsset: 'b',
        amountBase: 1,
        amountQuote: 2,
        feeSats: 0,
      }),
    ).resolves.toBe(TXID_AUCTION_COLLECT);

    expect(JSON.parse(mockBitAssetsNativeModule.ammMint.mock.calls[0][0])).toEqual({
      asset0: 'a',
      asset1: 'b',
      amount0: 1,
      amount1: 2,
      lpTokenMint: 3,
      feeSats: 0,
    });
  });

  it('rejects malformed native constructor txids before surfacing broadcast success', async () => {
    const client = new EmbeddedBitAssetsWalletClient();
    mockBitAssetsNativeModule.reserve.mockResolvedValue('not-a-txid');

    await expect(client.reserve({ name: 'ASSET', feeSats: 0 })).rejects.toThrow('expected 64-character hex txid');
  });

  it('rejects malformed JSON-RPC constructor txids before surfacing broadcast success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ result: { txid: 'not-a-txid' } }),
    })) as any;

    const client = new JsonRpcBitAssetsWalletClient('http://127.0.0.1:18443');

    await expect(client.reserve({ name: 'ASSET', feeSats: 0 })).rejects.toThrow('expected 64-character hex txid');
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
              : body.method === 'bitassets_getnewaddress'
                ? 'bitassets-jsonrpc-address'
                : TXID_TRANSFER,
        }),
      };
    });
    global.fetch = fetchMock as any;

    const client = new JsonRpcBitAssetsWalletClient('http://127.0.0.1:18443');
    await expect(client.getNewAddress()).resolves.toBe('bitassets-jsonrpc-address');
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
    ).resolves.toBe(TXID_TRANSFER);
    await expect(client.reserve({ name: 'NAME', feeSats: 0 })).resolves.toBe(TXID_TRANSFER);
    await expect(
      client.dutchAuctionCollect({
        auctionId: 'a',
        baseAsset: 'b',
        quoteAsset: 'q',
        amountBase: 1,
        amountQuote: 2,
      }),
    ).resolves.toBe(TXID_TRANSFER);

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

  it('keeps BitAssets E2E controls behind an explicit debug test gate', () => {
    expect(isBitAssetsE2EControlsEnabled({ BITASSETS_E2E: '1' }, true)).toBe(true);
    expect(isBitAssetsE2EControlsEnabled({ BITASSETS_E2E: '0' }, true)).toBe(false);
    expect(isBitAssetsE2EControlsEnabled({}, true)).toBe(false);
    expect(isBitAssetsE2EControlsEnabled({ BITASSETS_E2E: '1' }, false)).toBe(false);
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
    expect(normalizeBitAssetsError(new Error('native wallet rejected unproven Utreexo proof input'))).toBe(
      'BitAssets state is not proof-backed yet. Sync the wallet and wait for confirmed proof data before spending.',
    );
    expect(normalizeBitAssetsError(new Error('from_block_hash is no longer active; resync from snapshot'))).toBe(
      'BitAssets wallet state is stale or only partially synced. Sync again before creating a transaction.',
    );
  });

  it('redacts BitAssets seed material from surfaced errors and logs', () => {
    const seedHex = 'a'.repeat(128);
    expect(redactSensitiveBitAssetsDetails(`native config failed seed_hex=${seedHex}`)).toBe('native config failed seed_hex=[redacted]');
    expect(redactSensitiveBitAssetsDetails(`{"seedHex":"${seedHex}"}`)).toBe('{"seedHex":"[redacted]"}');
    expect(normalizeBitAssetsError(new Error(`wallet open failed with ${seedHex}`))).toBe('wallet open failed with [redacted-seed]');
  });

  it('requires HTTPS for non-local BitAssets RPC endpoints', () => {
    expect(() => validateBitAssetsRpcUrl('   ')).toThrow('BitAssets RPC URL is required');
    expect(validateBitAssetsRpcUrl(' http://127.0.0.1:6004 ')).toBe('http://127.0.0.1:6004');
    expect(validateBitAssetsRpcUrl('http://10.0.2.2:6004')).toBe('http://10.0.2.2:6004');
    expect(validateBitAssetsRpcUrl('http://172.16.1.2:6004')).toBe('http://172.16.1.2:6004');
    expect(validateBitAssetsRpcUrl('http://192.168.1.2:6004')).toBe('http://192.168.1.2:6004');
    expect(validateBitAssetsRpcUrl('http://100.76.117.106:6004')).toBe('http://100.76.117.106:6004');
    expect(validateBitAssetsRpcUrl('https://bitassets.example.com')).toBe('https://bitassets.example.com');
    expect(() => validateBitAssetsRpcUrl('http://bitassets.example.com')).toThrow('must use HTTPS');
    expect(() => validateBitAssetsRpcUrl('ftp://127.0.0.1:6004')).toThrow('must use http or https');
  });

  it('normalizeBitAssetsRpcUrlForRuntime preserves Tailscale and keeps loopback on simulator/dev (swaps on physical device via helpers)', () => {
    const { normalizeBitAssetsRpcUrlForRuntime } = require('../../class/wallets/bitassets-wallet');
    // Tailscale /100. range is preserved as dev LAN endpoint (never swapped to canonical)
    expect(normalizeBitAssetsRpcUrlForRuntime('http://100.76.117.106:6004')).toBe('http://100.76.117.106:6004');
    // In current test env (sim/dev, !physical) loopback/127 is kept; on physical device the normalize swaps to canonical
    const normalizedLoopback = normalizeBitAssetsRpcUrlForRuntime('http://127.0.0.1:6004');
    expect(normalizedLoopback).toMatch(/127\.0\.0\.1|localhost|100\.|signet/);
    // Exercise with trailing slash etc
    expect(normalizeBitAssetsRpcUrlForRuntime(' http://100.76.117.106:6004/ ')).toMatch(/100\.76\.117\.106/);
    // Extra edge cases: malformed still validated and rejected
    expect(() => normalizeBitAssetsRpcUrlForRuntime('')).toThrow('BitAssets RPC URL is required');
    expect(() => normalizeBitAssetsRpcUrlForRuntime('ftp://127.0.0.1:6004')).toThrow('must use http or https');
  });
});
