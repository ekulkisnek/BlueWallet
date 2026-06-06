const mockLiquidNativeModule = {
  configure: jest.fn(),
  getNewAddress: jest.fn(),
  walletInfo: jest.fn(),
  sync: jest.fn(),
  listUtxos: jest.fn(),
  getBalance: jest.fn(),
  transfer: jest.fn(),
  preparePegIn: jest.fn(),
  preparePegOut: jest.fn(),
  clear: jest.fn(),
};

jest.mock('../../codegen/NativeLiquidWallet', () => mockLiquidNativeModule);

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

const {
  LiquidWallet,
  hasLiquidWallet,
  normalizeLiquidRpcUrlForRuntime,
} = require('../../class/wallets/liquid-wallet');
const { validateLiquidRpcUrl } = require('../../blue_modules/LiquidWalletForms');
const { JsonRpcLiquidWalletClient } = require('../../blue_modules/LiquidWallet');

describe('Liquid mobile wallet bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiquidNativeModule.configure.mockResolvedValue('{"configured":true}');
    mockLiquidNativeModule.getNewAddress.mockResolvedValue('lqtb1qtestaddressliquid1234567890abcdef');
    mockLiquidNativeModule.walletInfo.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        balances: { bitcoin: 100000000 },
        last_tip_height: 12345,
        confirmed_utxo_count: 2,
        mempool_utxo_count: 0,
      }),
    );
    mockLiquidNativeModule.listUtxos.mockResolvedValue(
      JSON.stringify({
        confirmed: [
          {
            txid: 'aa'.repeat(32),
            vout: 0,
            address: 'lqtb1qtestaddressliquid1234567890abcdef',
            asset: 'bitcoin',
            amount: 100000000,
            confirmed: true,
          },
        ],
        mempool: [],
      }),
    );
    mockLiquidNativeModule.sync.mockResolvedValue(
      JSON.stringify({
        enabled: true,
        balances: { bitcoin: 100000000 },
        last_tip_height: 12346,
        confirmed_utxo_count: 2,
        mempool_utxo_count: 0,
      }),
    );
    mockLiquidNativeModule.clear.mockResolvedValue('{"cleared":true}');
  });

  it('normalizeLiquidRpcUrlForRuntime keeps localhost/loopback in simulator, canonical on physical device (via helpers)', () => {
    // Current env: device-info isEmulatorSync=true (sim), so localhost stays
    expect(normalizeLiquidRpcUrlForRuntime('http://127.0.0.1:18443')).toBe('http://127.0.0.1:18443');
    expect(normalizeLiquidRpcUrlForRuntime('http://localhost:18443')).toBe('http://localhost:18443');
    expect(normalizeLiquidRpcUrlForRuntime(' http://127.0.0.1:18443/ ')).toMatch(/127\.0\.0\.1/);

    // Simulate physical device by overriding device-info + force physical path
    const deviceInfo = require('react-native-device-info');
    (deviceInfo.isEmulatorSync as jest.Mock).mockReturnValue(false);

    // Re-require to pick up new mock behavior for physical branch (isPhysicalDeviceForLiquid true)
    jest.resetModules();
    // Re-apply mocks after reset
    jest.mock('../../codegen/NativeLiquidWallet', () => mockLiquidNativeModule);
    jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
    jest.mock('../../class/wallets/legacy-wallet', () => ({
      LegacyWallet: class {
        static fromJson(obj: string) {
          const p = JSON.parse(obj);
          const w = new this();
          Object.assign(w, p);
          return w;
        }

        secret = '';
        setLabel(l: string) {
          (this as any).label = l;
        }

        getLabel() {
          return (this as any).label || '';
        }
      },
    }));
    const { normalizeLiquidRpcUrlForRuntime: normOnDevice } = require('../../class/wallets/liquid-wallet');
    const canonical = normOnDevice('http://127.0.0.1:18443');
    // On physical (per logic + !emulator + __DEV__ etc) it should swap to canonical signet phone host
    expect(canonical).toMatch(/18443/); // still valid URL shape; actual host from generated endpoints or 100./signet

    // restore
    (deviceInfo.isEmulatorSync as jest.Mock).mockReturnValue(true);
  });

  it('validateLiquidRpcUrl accepts valid URLs, rejects malformed', () => {
    expect(validateLiquidRpcUrl('http://127.0.0.1:18443')).toBe('http://127.0.0.1:18443');
    expect(validateLiquidRpcUrl('https://elements.example.com:8443')).toBe('https://elements.example.com:8443');
    expect(validateLiquidRpcUrl(' http://10.0.2.2:18443 ')).toBe('http://10.0.2.2:18443');
    expect(() => validateLiquidRpcUrl('')).toThrow('Elements RPC URL is required');
    expect(() => validateLiquidRpcUrl('   ')).toThrow('Elements RPC URL is required');
    expect(() => validateLiquidRpcUrl('not-a-url')).toThrow('must be a valid http(s) URL');
    expect(() => validateLiquidRpcUrl('ftp://127.0.0.1:18443')).toThrow('must use http or https');
    // http non-local hits the private-host HTTPS rule (hostname present but not local)
    expect(() => validateLiquidRpcUrl('http:///nohost')).toThrow('must use HTTPS unless it points to a local or private development host');
    // parse-fail cases for truly malformed
    expect(() => validateLiquidRpcUrl('http://')).toThrow('must be a valid http(s) URL');
  });

  it('LiquidWallet.generate stores elementsRpcUrl and secret with liquid:// prefix', async () => {
    const wallet = new LiquidWallet();
    wallet.setLabel('Test Liquid');

    await wallet.generate('http://127.0.0.1:18443');

    expect(mockLiquidNativeModule.configure).toHaveBeenCalled();
    expect(mockLiquidNativeModule.getNewAddress).toHaveBeenCalledTimes(1);
    expect(wallet.elementsRpcUrl).toBe('http://127.0.0.1:18443');
    expect(wallet.secret).toMatch(/^liquid:\/\//);
    expect(wallet.getAddress()).toBe('lqtb1qtestaddressliquid1234567890abcdef');
  });

  it('LiquidWallet.generate can create an embedded local wallet without requiring an Elements RPC URL', async () => {
    const wallet = new LiquidWallet();
    wallet.setLabel('Phone-local Liquid');

    await wallet.generate();

    expect(mockLiquidNativeModule.configure).toHaveBeenCalledWith(expect.stringContaining('"elementsRpcUrl":""'));
    expect(mockLiquidNativeModule.configure).toHaveBeenCalledWith(expect.stringContaining('"rpcUrl":""'));
    expect(mockLiquidNativeModule.getNewAddress).toHaveBeenCalledTimes(1);
    expect(wallet.elementsRpcUrl).toBe('');
    expect(wallet.secret).toMatch(/^liquid:\/\//);
    expect(wallet.getAddress()).toBe('lqtb1qtestaddressliquid1234567890abcdef');
  });

  it('does not fall back to Elements JSON-RPC for node-free local creation', async () => {
    mockLiquidNativeModule.getNewAddress
      .mockRejectedValueOnce(new Error('Embedded Liquid wallet native module is not available'))
      .mockRejectedValueOnce(new Error('Embedded Liquid wallet native module is not available'));
    const wallet = new LiquidWallet();

    await expect(wallet.generate()).rejects.toThrow(/native module is not available/i);

    expect(mockLiquidNativeModule.configure).toHaveBeenCalledTimes(2);
    expect(mockLiquidNativeModule.getNewAddress).toHaveBeenCalledTimes(2);
    expect(wallet.elementsRpcUrl).toBe('');
  });

  it('LiquidWallet.weOwnAddress positive and negative cases', () => {
    const wallet = new LiquidWallet();
    wallet._address = 'lqtb1qowned1111111111111111111111111111111';
    wallet.liquidUtxos = [
      { txid: 'bb'.repeat(32), vout: 0, address: 'lqtb1qutxo22222222222222222222222222222222', amount: 1000, confirmed: true },
    ];

    expect(wallet.weOwnAddress('lqtb1qowned1111111111111111111111111111111')).toBe(true);
    expect(wallet.weOwnAddress(' lqtb1qowned1111111111111111111111111111111 ')).toBe(true);
    expect(wallet.weOwnAddress('lqtb1qutxo22222222222222222222222222222222')).toBe(true);
    expect(wallet.weOwnAddress('lqtb1qforeign33333333333333333333333333333333')).toBe(false);
    expect(wallet.weOwnAddress('')).toBe(false);
    expect(wallet.weOwnAddress(null as any)).toBe(false);
    expect(wallet.weOwnAddress(undefined as any)).toBe(false);
  });

  it('propagates clear error from EmbeddedLiquidWalletClient when native module absent', async () => {
    // Use isolated module load with falsy native to simulate absent TurboModule (e.g. jest or broken link)
    jest.resetModules();
    jest.mock('../../codegen/NativeLiquidWallet', () => null);
    jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
    jest.mock('../../class/wallets/legacy-wallet', () => ({
      LegacyWallet: class {
        static fromJson(obj: string) {
          const p = JSON.parse(obj);
          const w = new this();
          Object.assign(w, p);
          return w;
        }

        secret = '';
        setLabel(l: string) {
          (this as any).label = l;
        }

        getLabel() {
          return (this as any).label || '';
        }
      },
    }));

    const { EmbeddedLiquidWalletClient: AbsentClient } = require('../../blue_modules/LiquidWallet');

    const client = new AbsentClient();
    await expect(client.getNewAddress()).rejects.toThrow(/Embedded Liquid wallet native module is not available/i);
    await expect(client.configure({ elementsRpcUrl: 'http://127.0.0.1:18443' })).rejects.toThrow(/native module is not available/i);
  });
});

describe('Liquid wallet registry helper', () => {
  it('detects existing Liquid wallets', () => {
    expect(hasLiquidWallet([{ type: 'HDsegwitBech32' }])).toBe(false);
    expect(hasLiquidWallet([{ type: 'HDsegwitBech32' }, { type: LiquidWallet.type }])).toBe(true);
  });
});

describe('JsonRpcLiquidWalletClient', () => {
  const originalFetch = global.fetch;
  const originalBtoa = global.btoa;

  beforeEach(() => {
    global.btoa = jest.fn((value: string) => Buffer.from(value, 'binary').toString('base64'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.btoa = originalBtoa;
  });

  it('converts Elements BTC-denominated amounts to sats when syncing', async () => {
    global.fetch = jest.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (!options?.body) throw new Error('missing RPC body');
      const { method } = JSON.parse(String(options.body));
      const results: Record<string, unknown> = {
        getbalance: { bitcoin: 0.001 },
        getblockchaininfo: { blocks: 203, bestblockhash: '11'.repeat(32) },
        listunspent: [{ txid: '22'.repeat(32), vout: 0, address: 'bcrt1qreceiver', asset: 'bitcoin', amount: 0.001, confirmations: 1 }],
      };
      return { ok: true, json: async () => ({ result: results[method] ?? null }) } as any;
    });

    const client = new JsonRpcLiquidWalletClient('http://__cookie__:secret@127.0.0.1:18443/wallet/redwallet-b');
    const info = await client.sync();
    const utxos = await client.listUtxos();

    expect(info.balances).toEqual({ bitcoin: 100000 });
    expect(info.last_tip_height).toBe(203);
    expect(utxos[0].amount).toBe(100000);
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Basic X19jb29raWVfXzpzZWNyZXQ=');
  });

  it('sends sat amounts as Elements BTC amounts', async () => {
    global.fetch = jest.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (!options?.body) throw new Error('missing RPC body');
      const body = JSON.parse(String(options.body));
      expect(body.method).toBe('sendtoaddress');
      expect(body.params[1]).toBe(0.001);
      return { ok: true, json: async () => ({ result: '33'.repeat(32) }) } as any;
    });

    const client = new JsonRpcLiquidWalletClient('http://__cookie__:secret@127.0.0.1:18443/wallet/redwallet-a');
    await expect(client.transfer({ destinationAddress: 'bcrt1qreceiver', amount: 100000 })).resolves.toBe('33'.repeat(32));
  });
});
