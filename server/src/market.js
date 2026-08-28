import { resolveProviderMapping } from './assets.js';
import { getProviderAdapter, MARKET_PROVIDERS } from './providers/index.js';
import {
  getCanonicalDate,
  getHistoryRangeStart,
  getHistoryWindow,
  normalizeDailyHistory,
  PUBLIC_HISTORY_RANGES
} from './history.js';
import {
  getVietnamSessionKey,
  normalizeHistoricalData,
  normalizeMarketSnapshot
} from './providers/yahoo.js';

export {
  getProviderAdapter,
  getCanonicalDate,
  getHistoryRangeStart,
  getHistoryWindow,
  getVietnamSessionKey,
  MARKET_PROVIDERS,
  normalizeDailyHistory,
  normalizeHistoricalData,
  normalizeMarketSnapshot
};

const PUBLIC_RANGES = PUBLIC_HISTORY_RANGES;

function assertSupportedHistoryPolicy(asset) {
  if (!['VN_EXCHANGE', 'CONTINUOUS_24_7', 'GLOBAL_24_5'].includes(asset.marketPolicy)) {
    const err = new Error(`Historical market data policy '${asset.marketPolicy || 'unavailable'}' is unsupported for '${asset.symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
}

function assertVietnamHistoryPolicy(asset) {
  if (asset.marketPolicy !== 'VN_EXCHANGE') {
    const err = new Error(`Historical market data policy '${asset.marketPolicy || 'unavailable'}' is unsupported for '${asset.symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
}

function resolveAdapter(mapping, asset, options = {}) {
  const getAdapterFn = options.getProviderAdapterFn || getProviderAdapter;
  const adapter = options.providerAdapter || getAdapterFn(mapping.provider);
  if (!adapter || typeof adapter !== 'object') {
    const err = new Error(`Provider '${mapping.provider}' is unsupported for asset '${asset.symbol}'`);
    err.code = 'UNSUPPORTED_PROVIDER';
    err.status = 422;
    throw err;
  }
  return adapter;
}

function resolveHistoryNow(options) {
  if (options.now === undefined) return new Date();
  if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
    const err = new TypeError('History now must be a valid Date object');
    err.status = 400;
    err.code = 'INVALID_TIME_CONTEXT';
    throw err;
  }
  return options.now;
}

/**
 * Fetches and normalizes a delayed market snapshot for a canonical asset symbol.
 * Dispatches to the resolved provider adapter according to asset_provider_mappings.
 *
 * @param {string} rawSymbol - Canonical asset symbol (e.g. 'FPT')
 * @param {Object} [options] - Optional overrides for testing/injection
 * @returns {Promise<Object>} Normalized market snapshot payload
 */
export async function getMarketSnapshot(rawSymbol, options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const resolver = options.resolveProviderMappingFn || resolveProviderMapping;
  const { asset, mapping } = await resolver(symbol, options.provider || null, options.providerResolverOptions || {});

  const adapter = resolveAdapter(mapping, asset, options);
  if (typeof adapter.getSnapshot !== 'function') {
    const err = new Error(`Provider '${mapping.provider}' does not support market snapshots`);
    err.code = 'UNSUPPORTED_PROVIDER';
    err.status = 422;
    throw err;
  }

  return adapter.getSnapshot(asset, mapping, options);
}

/**
 * Fetches and normalizes daily historical market data and calculates period metrics.
 * Supported ranges: '1W', '1M', '3M', '6M', '1Y'
 *
 * @param {string} rawSymbol - The asset symbol (e.g. 'FPT')
 * @param {string} rawRange - Requested range (defaults to '1M')
 * @param {Object} [options] - Optional overrides for testing/injection
 * @returns {Promise<Object>} Normalized historical data payload
 */
export async function getMarketHistory(rawSymbol, rawRange = '1M', options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const range = (rawRange || '1M').toString().trim().toUpperCase();

  if (!PUBLIC_RANGES.includes(range)) {
    const err = new Error(`Invalid range '${rawRange}'. Supported ranges: 1W, 1M, 3M, 6M, 1Y`);
    err.status = 400;
    throw err;
  }

  const resolver = options.resolveProviderMappingFn || resolveProviderMapping;
  const { asset, mapping } = await resolver(symbol, options.provider || null, options.providerResolverOptions || {});

  assertSupportedHistoryPolicy(asset);

  const adapter = resolveAdapter(mapping, asset, options);
  if (typeof adapter.getHistory !== 'function') {
    const err = new Error(`Provider '${mapping.provider}' does not support market history`);
    err.code = 'UNSUPPORTED_PROVIDER';
    err.status = 422;
    throw err;
  }

  const now = resolveHistoryNow(options);
  return adapter.getHistory(asset, mapping, { ...options, range, now });
}

/**
 * Internal helper to fetch 2y daily historical bars for Feature 07 analysis superset.
 * Normalizes via provider adapter into canonical historical payload.
 * Does not alter Feature 06 public API range constraints on getMarketHistory.
 *
 * @param {string} rawSymbol - Asset symbol
 * @param {Object} [options] - Optional overrides (e.g. fetchFn)
 * @returns {Promise<Object>} Normalized historical data payload
 */
export async function getAnalysisHistory(rawSymbol, options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const resolver = options.resolveProviderMappingFn || resolveProviderMapping;
  const { asset, mapping } = await resolver(symbol, options.provider || null, options.providerResolverOptions || {});

  assertVietnamHistoryPolicy(asset);

  const adapter = resolveAdapter(mapping, asset, options);
  if (typeof adapter.getHistory !== 'function') {
    const err = new Error(`Provider '${mapping.provider}' does not support market history`);
    err.code = 'UNSUPPORTED_PROVIDER';
    err.status = 422;
    throw err;
  }

  const now = resolveHistoryNow(options);
  return adapter.getHistory(asset, mapping, { ...options, range: '2y', normalizedRange: '1Y', now });
}
