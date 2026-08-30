export const ASSET_TYPES = Object.freeze(['stock', 'etf', 'fund', 'gold', 'fx', 'crypto']);

export const MARKET_POLICIES = Object.freeze([
  'VN_EXCHANGE',
  'CONTINUOUS_24_7',
  'GLOBAL_24_5',
  'NAV_SCHEDULED',
  'INSTRUMENT_DEFINED'
]);

const CURRENCY_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PROVIDER_CAPABILITIES = new Set(['snapshot', 'history', 'analysis', 'realtime']);

function firstDefined(object, camelName, snakeName) {
  if (Object.prototype.hasOwnProperty.call(object, camelName)) return object[camelName];
  return object[snakeName];
}

function optionalTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assetContractError(message) {
  const error = new Error(message);
  error.code = 'INVALID_ASSET_CONTRACT';
  error.status = 500;
  return error;
}

export function isValidCurrencyCode(value) {
  return typeof value === 'string' && CURRENCY_CODE_PATTERN.test(value);
}

export function normalizeAsset(row) {
  if (!row || typeof row !== 'object') {
    throw assetContractError('Asset metadata is unavailable');
  }

  const assetType = firstDefined(row, 'assetType', 'asset_type');
  const marketCode = optionalTrimmedString(firstDefined(row, 'marketCode', 'market_code'));
  const quoteCurrency = optionalTrimmedString(firstDefined(row, 'quoteCurrency', 'quote_currency'));
  const baseCurrency = optionalTrimmedString(firstDefined(row, 'baseCurrency', 'base_currency'));
  const marketPolicy = optionalTrimmedString(firstDefined(row, 'marketPolicy', 'market_policy'));
  const marketTimezone = optionalTrimmedString(firstDefined(row, 'marketTimezone', 'market_timezone'));
  const quantityUnit = optionalTrimmedString(firstDefined(row, 'quantityUnit', 'quantity_unit'));
  const isActiveValue = firstDefined(row, 'isActive', 'is_active');
  const isActive = typeof isActiveValue === 'boolean' ? isActiveValue : true;
  const symbol = optionalTrimmedString(row.symbol)?.toUpperCase() || null;

  if (!symbol) throw assetContractError('Asset symbol must be a non-empty string');
  if (!ASSET_TYPES.includes(assetType)) {
    throw assetContractError(`Unsupported asset type '${assetType ?? ''}'`);
  }
  if (quoteCurrency !== null && !isValidCurrencyCode(quoteCurrency)) {
    throw assetContractError(`Invalid quote currency '${quoteCurrency}'`);
  }
  if (isActive && quoteCurrency === null) {
    throw assetContractError('Active assets require a quote currency');
  }
  if (baseCurrency !== null && !isValidCurrencyCode(baseCurrency)) {
    throw assetContractError(`Invalid base currency '${baseCurrency}'`);
  }
  if (baseCurrency !== null && baseCurrency === quoteCurrency) {
    throw assetContractError('Base currency must differ from quote currency');
  }
  if (marketPolicy !== null && !MARKET_POLICIES.includes(marketPolicy)) {
    throw assetContractError(`Unsupported market policy '${marketPolicy}'`);
  }

  return {
    id: row.id,
    symbol,
    name: row.name,
    asset_type: assetType,
    exchange: row.exchange ?? null,
    market_code: marketCode,
    quote_currency: quoteCurrency,
    base_currency: baseCurrency,
    market_policy: marketPolicy,
    market_timezone: marketTimezone,
    quantity_unit: quantityUnit,
    is_active: isActive,
    created_at: row.created_at,
    assetType,
    marketCode,
    quoteCurrency,
    baseCurrency,
    marketPolicy,
    marketTimezone,
    quantityUnit,
    isActive
  };
}

export function normalizeProviderMapping(row) {
  if (!row || typeof row !== 'object') {
    throw assetContractError('Provider mapping is unavailable');
  }

  const provider = optionalTrimmedString(row.provider);
  const providerSymbol = optionalTrimmedString(row.providerSymbol ?? row.provider_symbol);
  const providerMarket = optionalTrimmedString(row.providerMarket ?? row.provider_market);

  if (!provider || !PROVIDER_PATTERN.test(provider)) {
    throw assetContractError(`Invalid provider identifier '${provider ?? ''}'`);
  }
  if (!providerSymbol) {
    throw assetContractError('Provider symbol must be a non-empty string');
  }

  return {
    id: row.id,
    assetId: row.assetId ?? row.asset_id,
    provider,
    providerSymbol,
    providerMarket,
    createdAt: row.createdAt ?? row.created_at
  };
}

function unavailableError(message, code, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function defaultProviderForAsset(asset, capability) {
  if (asset.assetType === 'crypto') {
    return capability === 'history' || capability === 'analysis' || capability === 'realtime'
      ? 'binance'
      : 'coingecko';
  }
  if (asset.assetType === 'gold') return 'alphavantage';
  if (asset.assetType === 'fx') return 'twelvedata';
  return 'yahoo';
}

export async function resolveProviderMapping(assetOrSymbol, provider, options = {}) {
  let getAssetBySymbolFn = options.getAssetBySymbolFn;
  let getAssetProviderMappingFn = options.getAssetProviderMappingFn;
  if (!getAssetBySymbolFn || !getAssetProviderMappingFn) {
    const repository = await import('./supabase.js');
    getAssetBySymbolFn ||= repository.getAssetBySymbol;
    getAssetProviderMappingFn ||= repository.getAssetProviderMapping;
  }

  const asset = typeof assetOrSymbol === 'object' && assetOrSymbol !== null
    ? normalizeAsset(assetOrSymbol)
    : await getAssetBySymbolFn(assetOrSymbol);

  if (!asset) {
    const symbol = typeof assetOrSymbol === 'string' ? assetOrSymbol.trim().toUpperCase() : '';
    throw unavailableError(`Asset '${symbol}' not found`, 'ASSET_NOT_FOUND', 404);
  }

  const normalizedAsset = asset.assetType ? asset : normalizeAsset(asset);
  if (!normalizedAsset.isActive) {
    throw unavailableError(`Asset '${normalizedAsset.symbol}' is inactive`, 'ASSET_INACTIVE');
  }

  const capability = typeof options.capability === 'string'
    ? options.capability.trim().toLowerCase()
    : 'snapshot';
  if (!PROVIDER_CAPABILITIES.has(capability)) {
    throw unavailableError(`Invalid provider capability '${options.capability}'`, 'INVALID_PROVIDER_CAPABILITY', 400);
  }

  const resolvedProvider = typeof provider === 'string' && provider.trim()
    ? provider.trim().toLowerCase()
    : defaultProviderForAsset(normalizedAsset, capability);

  if (!PROVIDER_PATTERN.test(resolvedProvider)) {
    throw unavailableError('Invalid provider identifier', 'INVALID_PROVIDER', 400);
  }

  const mappingRow = await getAssetProviderMappingFn(normalizedAsset.id, resolvedProvider);
  if (!mappingRow) {
    throw unavailableError(
      `Provider '${resolvedProvider}' is unsupported for asset '${normalizedAsset.symbol}'`,
      'UNSUPPORTED_PROVIDER'
    );
  }

  return {
    asset: normalizedAsset,
    mapping: normalizeProviderMapping(mappingRow)
  };
}
