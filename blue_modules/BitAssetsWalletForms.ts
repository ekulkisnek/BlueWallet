import {
  AmmBurnParams,
  AmmMintParams,
  AmmSwapParams,
  DutchAuctionBidParams,
  DutchAuctionCollectParams,
  DutchAuctionCreateParams,
  RegisterParams,
  ReserveParams,
  TransferParams,
} from './BitAssetsWallet';

export type BitAssetsOperation =
  | 'transfer'
  | 'reserve'
  | 'register'
  | 'ammMint'
  | 'ammSwap'
  | 'ammBurn'
  | 'dutchAuctionCreate'
  | 'dutchAuctionBid'
  | 'dutchAuctionCollect';

export type BitAssetsOperationParams =
  | TransferParams
  | ReserveParams
  | RegisterParams
  | AmmMintParams
  | AmmSwapParams
  | AmmBurnParams
  | DutchAuctionCreateParams
  | DutchAuctionBidParams
  | DutchAuctionCollectParams;

export type BitAssetsFieldType = 'text' | 'number' | 'json';

export interface BitAssetsFieldDefinition {
  key: string;
  label: string;
  type: BitAssetsFieldType;
  required?: boolean;
  multiline?: boolean;
}

export interface BitAssetsOperationDefinition {
  key: BitAssetsOperation;
  label: string;
  submitLabel: string;
  fields: BitAssetsFieldDefinition[];
  defaults: Record<string, string>;
}

export const BITASSETS_OPERATION_DEFINITIONS: BitAssetsOperationDefinition[] = [
  {
    key: 'transfer',
    label: 'Transfer',
    submitLabel: 'Send transfer',
    fields: [
      { key: 'destinationAddress', label: 'Destination address', type: 'text', required: true },
      { key: 'assetId', label: 'Asset ID', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'memo', label: 'Memo', type: 'text' },
    ],
    defaults: { destinationAddress: '', assetId: '', amount: '', memo: '' },
  },
  {
    key: 'reserve',
    label: 'Reserve',
    submitLabel: 'Reserve name',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    defaults: { name: '' },
  },
  {
    key: 'register',
    label: 'Register',
    submitLabel: 'Register asset',
    fields: [
      { key: 'name', label: 'Reserved name', type: 'text', required: true },
      { key: 'initialSupply', label: 'Initial supply', type: 'number', required: true },
      { key: 'bitassetData', label: 'Asset metadata JSON', type: 'json', required: true, multiline: true },
    ],
    defaults: { name: '', initialSupply: '', bitassetData: '{}' },
  },
  {
    key: 'ammMint',
    label: 'AMM mint',
    submitLabel: 'Mint LP',
    fields: [
      { key: 'asset0', label: 'Asset 0', type: 'text', required: true },
      { key: 'asset1', label: 'Asset 1', type: 'text', required: true },
      { key: 'amount0', label: 'Amount 0', type: 'number', required: true },
      { key: 'amount1', label: 'Amount 1', type: 'number', required: true },
      { key: 'lpTokenMint', label: 'LP tokens to mint', type: 'number', required: true },
    ],
    defaults: { asset0: '', asset1: '', amount0: '', amount1: '', lpTokenMint: '' },
  },
  {
    key: 'ammSwap',
    label: 'AMM swap',
    submitLabel: 'Swap',
    fields: [
      { key: 'assetSpend', label: 'Asset to spend', type: 'text', required: true },
      { key: 'assetReceive', label: 'Asset to receive', type: 'text', required: true },
      { key: 'amountSpend', label: 'Amount to spend', type: 'number', required: true },
      { key: 'amountReceive', label: 'Minimum receive', type: 'number', required: true },
    ],
    defaults: { assetSpend: '', assetReceive: '', amountSpend: '', amountReceive: '' },
  },
  {
    key: 'ammBurn',
    label: 'AMM burn',
    submitLabel: 'Burn LP',
    fields: [
      { key: 'asset0', label: 'Asset 0', type: 'text', required: true },
      { key: 'asset1', label: 'Asset 1', type: 'text', required: true },
      { key: 'amount0', label: 'Amount 0', type: 'number', required: true },
      { key: 'amount1', label: 'Amount 1', type: 'number', required: true },
      { key: 'lpTokenBurn', label: 'LP tokens to burn', type: 'number', required: true },
    ],
    defaults: { asset0: '', asset1: '', amount0: '', amount1: '', lpTokenBurn: '' },
  },
  {
    key: 'dutchAuctionCreate',
    label: 'Auction create',
    submitLabel: 'Create auction',
    fields: [
      { key: 'baseAsset', label: 'Base asset', type: 'text', required: true },
      { key: 'quoteAsset', label: 'Quote asset', type: 'text', required: true },
      { key: 'baseAmount', label: 'Base amount', type: 'number', required: true },
      { key: 'startPrice', label: 'Start price', type: 'number', required: true },
      { key: 'endPrice', label: 'End price', type: 'number', required: true },
      { key: 'duration', label: 'Duration', type: 'number', required: true },
    ],
    defaults: { baseAsset: '', quoteAsset: '', baseAmount: '', startPrice: '', endPrice: '', duration: '' },
  },
  {
    key: 'dutchAuctionBid',
    label: 'Auction bid',
    submitLabel: 'Bid',
    fields: [
      { key: 'auctionId', label: 'Auction ID', type: 'text', required: true },
      { key: 'baseAsset', label: 'Base asset', type: 'text', required: true },
      { key: 'quoteAsset', label: 'Quote asset', type: 'text', required: true },
      { key: 'bidSize', label: 'Bid size', type: 'number', required: true },
      { key: 'receiveQuantity', label: 'Receive quantity', type: 'number', required: true },
    ],
    defaults: { auctionId: '', baseAsset: '', quoteAsset: '', bidSize: '', receiveQuantity: '' },
  },
  {
    key: 'dutchAuctionCollect',
    label: 'Auction collect',
    submitLabel: 'Collect',
    fields: [
      { key: 'auctionId', label: 'Auction ID', type: 'text', required: true },
      { key: 'baseAsset', label: 'Base asset', type: 'text', required: true },
      { key: 'quoteAsset', label: 'Quote asset', type: 'text', required: true },
      { key: 'amountBase', label: 'Base amount', type: 'number', required: true },
      { key: 'amountQuote', label: 'Quote amount', type: 'number', required: true },
    ],
    defaults: { auctionId: '', baseAsset: '', quoteAsset: '', amountBase: '', amountQuote: '' },
  },
];

export const BITASSETS_OPERATION_BY_KEY = BITASSETS_OPERATION_DEFINITIONS.reduce<Record<BitAssetsOperation, BitAssetsOperationDefinition>>(
  (record, definition) => {
    record[definition.key] = definition;
    return record;
  },
  {} as Record<BitAssetsOperation, BitAssetsOperationDefinition>,
);

export function initialBitAssetsFormState(): Record<BitAssetsOperation, Record<string, string>> {
  return BITASSETS_OPERATION_DEFINITIONS.reduce(
    (record, definition) => {
      record[definition.key] = { ...definition.defaults };
      return record;
    },
    {} as Record<BitAssetsOperation, Record<string, string>>,
  );
}

function parsePositiveInteger(label: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a whole number`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

function parseJsonField(label: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

export function buildBitAssetsOperationParams(operation: BitAssetsOperation, values: Record<string, string>): BitAssetsOperationParams {
  const definition = BITASSETS_OPERATION_BY_KEY[operation];
  const params: Record<string, unknown> = {};

  for (const field of definition.fields) {
    const rawValue = values[field.key]?.trim() ?? '';
    if (field.required && rawValue.length === 0) {
      throw new Error(`${field.label} is required`);
    }
    if (rawValue.length === 0) continue;

    if (field.type === 'number') {
      params[field.key] = parsePositiveInteger(field.label, rawValue);
    } else if (field.type === 'json') {
      params[field.key] = parseJsonField(field.label, rawValue);
    } else {
      params[field.key] = rawValue;
    }
  }

  params.feeSats = 0;
  return params as unknown as BitAssetsOperationParams;
}

function isLocalBitAssetsRpcHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;

  const match = /^172\.(\d{1,2})\./.exec(host);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

export function validateBitAssetsRpcUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('BitAssets RPC URL must be a valid http(s) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('BitAssets RPC URL must use http or https.');
  }

  if (!parsed.hostname) {
    throw new Error('BitAssets RPC URL must include a host.');
  }

  if (parsed.protocol === 'http:' && !isLocalBitAssetsRpcHost(parsed.hostname)) {
    throw new Error('BitAssets RPC URL must use HTTPS unless it points to a local or private development host.');
  }

  return trimmed;
}

export function normalizeBitAssetsError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fee[_ ]?sats|nonzero fee|fee must be 0/i.test(message)) {
    return 'BitAssets mobile constructors currently support fee_sats = 0 only.';
  }
  if (/network request failed|failed to fetch|abort/i.test(message)) {
    return 'Could not reach the BitAssets RPC endpoint. Check the RPC URL and local signet stack.';
  }
  if (/not enough funds/i.test(message)) {
    return 'Not enough BitAssets wallet funds for this operation.';
  }
  return message;
}
