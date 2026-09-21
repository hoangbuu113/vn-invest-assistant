import { resolveProviderMapping } from './assets.js';
import {
  attachApproximateVndReference,
  binanceProvider,
  getProviderAdapter,
  MARKET_PROVIDERS,
  isBinanceSupported,
  getBinanceService
} from './providers/index.js';
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

export const SNAPSHOT_CHANGE_BASES = Object.freeze({
  PREVIOUS_SESSION_CLOSE: 'PREVIOUS_SESSION_CLOSE',
  ROLLING_24H: 'ROLLING_24H',
  UNAVAILABLE: 'UNAVAILABLE'
});

export const SNAPSHOT_VOLUME_SEMANTICS = Object.freeze({
  SESSION_BASE_UNITS: 'SESSION_BASE_UNITS',
  ROLLING_24H_QUOTE_CURRENCY: 'ROLLING_24H_QUOTE_CURRENCY',
  UNAVAILABLE: 'UNAVAILABLE'
});

const VALID_CHANGE_BASES = new Set(Object.values(SNAPSHOT_CHANGE_BASES));
const VALID_VOLUME_SEMANTICS = new Set(Object.values(SNAPSHOT_VOLUME_SEMANTICS));

export function getAssetMarketCapabilities(asset, adapter) {
  const declared = adapter?.capabilities && typeof adapter.capabilities === 'object'
    ? adapter.capabilities
    : {};
  const snapshot = declared.snapshot === true ||
    (declared.snapshot !== false && typeof adapter?.getSnapshot === 'function');
  const history = declared.history === true ||
    (declared.history !== false && typeof adapter?.getHistory === 'function');
  const analysis = declared.analysis === true ||
    (declared.analysis !== false && history);

  return {
    snapshot,
    history,
    analysis,
    ohlcHistory: history && declared.ohlcHistory === true,
    snapshotChangeBasis: VALID_CHANGE_BASES.has(declared.snapshotChangeBasis)
      ? declared.snapshotChangeBasis
      : SNAPSHOT_CHANGE_BASES.UNAVAILABLE
  };
}

function normalizeSnapshotContract(snapshot, asset, mapping, adapter) {
  if (!snapshot || typeof snapshot !== 'object') {
    const err = new Error(`No market quote available for '${asset.symbol}'`);
    err.status = 404;
    throw err;
  }

  const capabilities = getAssetMarketCapabilities(asset, adapter);
  const changeBasis = VALID_CHANGE_BASES.has(snapshot.changeBasis)
    ? snapshot.changeBasis
    : capabilities.snapshotChangeBasis;
  const volumeSemantics = VALID_VOLUME_SEMANTICS.has(snapshot.volumeSemantics)
    ? snapshot.volumeSemantics
    : SNAPSHOT_VOLUME_SEMANTICS.UNAVAILABLE;
  const changeUnavailable = changeBasis === SNAPSHOT_CHANGE_BASES.UNAVAILABLE;
  const rollingChange = changeBasis === SNAPSHOT_CHANGE_BASES.ROLLING_24H;

  return {
    ...snapshot,
    assetId: asset.id ?? null,
    assetType: asset.assetType ?? asset.asset_type ?? null,
    quoteCurrency: asset.quoteCurrency ?? asset.quote_currency ?? null,
    marketPolicy: asset.marketPolicy ?? asset.market_policy ?? null,
    marketTimezone: asset.marketTimezone ?? asset.market_timezone ?? null,
    provider: mapping.provider,
    currency: typeof snapshot.currency === 'string' && snapshot.currency.trim()
      ? snapshot.currency.trim()
      : null,
    exchange: typeof snapshot.exchange === 'string' && snapshot.exchange.trim()
      ? snapshot.exchange.trim()
      : null,
    previousClose: rollingChange || changeUnavailable ? null : (snapshot.previousClose ?? null),
    change: changeUnavailable ? null : (snapshot.change ?? null),
    changePercent: changeUnavailable ? null : (snapshot.changePercent ?? null),
    volume: snapshot.volume ?? null,
    changeBasis,
    volumeSemantics,
    freshness: typeof snapshot.freshness === 'string' && snapshot.freshness.trim()
      ? snapshot.freshness.trim()
      : null,
    capabilities
  };
}

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

function providerResolverOptions(options, capability) {
  return {
    ...(options.providerResolverOptions || {}),
    capability
  };
}

/**
 * Fetches and normalizes a delayed market snapshot for a canonical asset symbol.
 * Dispatches to the resolved provider adapter according to asset_provider_mappings.
 *
 * Crypto snapshots use the canonical CoinGecko USD valuation authority. Binance
 * USDT observations remain history/realtime inputs and never replace accounting quotes.
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
  const { asset, mapping } = await resolver(
    symbol,
    options.provider || null,
    providerResolverOptions(options, 'snapshot')
  );

  const adapter = resolveAdapter(mapping, asset, options);
  if (!getAssetMarketCapabilities(asset, adapter).snapshot || typeof adapter.getSnapshot !== 'function') {
    const err = new Error(`Provider '${mapping.provider}' does not support market snapshots`);
    err.code = 'UNSUPPORTED_PROVIDER';
    err.status = 422;
    throw err;
  }

  const snapshot = await adapter.getSnapshot(asset, mapping, options);
  return normalizeSnapshotContract(snapshot, asset, mapping, adapter);
}

/**
 * Fetches a realtime market reference observation for an asset (currently Binance USDT for CONTINUOUS_24_7).
 * This is explicitly a reference-only observation and MUST NOT be used for valuation or accounting.
 *
 * @param {string} rawSymbol - Canonical asset symbol (e.g. 'BTC')
 * @param {Object} [options] - Optional overrides for testing/injection
 * @param {Object} [options.binanceService] - Injected Binance service (testing)
 * @returns {Promise<Object>} Realtime market reference payload
 */
export async function getMarketRealtime(rawSymbol, options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const resolver = options.resolveProviderMappingFn || resolveProviderMapping;
  const { asset, mapping } = await resolver(
    symbol,
    options.provider || null,
    providerResolverOptions(options, 'realtime')
  );

  const assetId = asset?.id ?? asset?.assetId;
  const marketPolicy = asset?.marketPolicy ?? asset?.market_policy;

  if (marketPolicy !== 'CONTINUOUS_24_7' || !assetId || !isBinanceSupported(assetId)) {
    const err = new Error(`Realtime market reference is not supported for '${asset?.symbol || symbol}'`);
    err.code = 'REALTIME_UNSUPPORTED';
    err.status = 404;
    throw err;
  }

  const binanceSvc = options.binanceService || getBinanceService();
  let obs = binanceSvc ? binanceSvc.getSnapshot(assetId, options) : null;

  if (!obs || obs.price === null) {
    // Attempt Binance REST fallback before declaring unavailable
    if (mapping && options.enableRestFallback !== false) {
      try {
        const binanceAdapter = options.binanceAdapter || binanceProvider;
        const restSnapshot = await binanceAdapter.getSnapshot(asset, mapping, options);
        if (restSnapshot && typeof restSnapshot.price === 'number' && Number.isFinite(restSnapshot.price) && restSnapshot.price > 0) {
          obs = {
            assetId,
            symbol: asset.symbol,
            binanceSymbol: restSnapshot.symbol || mapping?.providerSymbol,
            realtimeCurrency: 'USDT',
            currency: 'USDT',
            price: restSnapshot.price,
            rollingOpen: restSnapshot.rollingOpen ?? (
              typeof restSnapshot.change === 'number' && restSnapshot.change !== null
                ? restSnapshot.price - restSnapshot.change
                : null
            ),
            rollingHigh: restSnapshot.dayHigh ?? null,
            rollingLow: restSnapshot.dayLow ?? null,
            changeBasis: restSnapshot.changeBasis || 'ROLLING_24H',
            baseVolume: restSnapshot.volume ?? null,
            quoteVolume: null,
            observedAt: restSnapshot.priceAsOf || restSnapshot.updatedAt || new Date().toISOString(),
            cachedAtMs: Date.now(),
            connectionState: 'REST_FALLBACK',
            priceSource: restSnapshot.priceSource || 'binance_rest_24hr',
            freshness: restSnapshot.freshness || 'live'
          };
        }
      } catch {
        // Fallback unavailable
      }
    }
  }

  if (!obs || obs.price === null) {
    const err = new Error(`No realtime market observation available for '${asset?.symbol || symbol}'`);
    err.code = 'REALTIME_UNAVAILABLE';
    err.status = 404;
    throw err;
  }

  return attachApproximateVndReference({
    assetId,
    symbol: asset.symbol,
    assetType: asset.assetType ?? asset.asset_type ?? 'crypto',
    price: obs.price,
    currency: 'USDT',
    canonicalQuoteCurrency: asset.quoteCurrency ?? asset.quote_currency ?? null,
    source: obs.priceSource || 'binance_websocket',
    priceSource: obs.priceSource || 'binance_websocket',
    observedAt: obs.observedAt,
    change: obs.rollingOpen !== null ? obs.price - obs.rollingOpen : null,
    changePercent: obs.rollingOpen !== null && obs.rollingOpen > 0
      ? ((obs.price - obs.rollingOpen) / obs.rollingOpen) * 100
      : null,
    changeBasis: obs.changeBasis || 'ROLLING_24H',
    dayHigh: obs.rollingHigh ?? null,
    dayLow: obs.rollingLow ?? null,
    volume: obs.baseVolume ?? null,
    volumeSemantics: 'ROLLING_24H_BASE_UNITS',
    quoteVolume: obs.quoteVolume ?? null,
    referenceOnly: true,
    freshness: obs.freshness,
    connectionState: obs.connectionState
  }, options);
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
  const { asset, mapping } = await resolver(
    symbol,
    options.provider || null,
    providerResolverOptions(options, 'history')
  );

  assertSupportedHistoryPolicy(asset);

  const adapter = resolveAdapter(mapping, asset, options);
  if (adapter.role === 'canonical_usd_valuation_snapshot') {
    const err = new Error(`Provider '${mapping.provider}' is valuation-snapshot-only and does not support market history`);
    err.code = 'UNSUPPORTED_HISTORY';
    err.status = 422;
    throw err;
  }
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
  const { asset, mapping } = await resolver(
    symbol,
    options.provider || null,
    providerResolverOptions(options, 'analysis')
  );

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
