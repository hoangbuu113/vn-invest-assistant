/**
 * Feature 26A — Binance Market Data Provider & Resilience Architecture V2
 *
 * Provides:
 * 1. 40-asset Binance Spot/USDT canonical universe mapping.
 * 2. Shared resilient WebSocket realtime stream (!miniTicker@arr).
 * 3. Daily WebSocket API Kline history with OHLCV for CONTINUOUS_24_7 crypto.
 * 4. Shared history cache across consumers with in-flight request coalescing.
 * 5. Provider circuit breaker with CLOSED, OPEN, HALF_OPEN states and backoff cooldown.
 * 6. Stale-while-revalidate fallback for completed history during upstream outages.
 * 7. Reference-only current price ≈VND conversion (isolated from historical valuation).
 * 8. Machine-readable health signals without triggering live provider calls.
 *
 * Rules:
 * - NO private/trading API calls, NO API keys required.
 * - Quote currency is strictly USDT (never silently cast to USD).
 * - Current UTC day is incomplete -> strictly excluded from completed daily history.
 * - Weekends are valid 24/7 trading days -> preserved without gaps.
 * - Failure isolation: realtime failure != history failure != FX failure.
 */

import {
  getCanonicalDate,
  getHistoryRangeStart,
  normalizeDailyHistory
} from '../history.js';
import { getFxRate } from '../fx.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; vn-invest-assistant/2.0)';
const REST_TIMEOUT_MS = 8000;
const WS_API_URL = 'wss://ws-api.binance.com:443/ws-api/v3';
const WS_API_REQUEST_TIMEOUT_MS = 10_000;
const WS_API_RECONNECT_BASE_MS = 1_000;
const WS_API_RECONNECT_MAX_MS = 30_000;

// ---------------------------------------------------------------------------
// 1. Authoritative 40 Binance-Supported Crypto Universe
// ---------------------------------------------------------------------------
// All 40 assets are verified active Spot USDT TRADING pairs on Binance.
// Preserves existing 35 UUIDs and adds 5 high-liquidity Spot/USDT pairs (APT, ARB, FET, INJ, FIL).

export const BINANCE_USDT_MAPPING = Object.freeze({
  // 1. BTC — Bitcoin
  '1aca9503-acf1-4450-9b75-4f8935324398': Object.freeze({ binanceSymbol: 'BTCUSDT', canonicalSymbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteCurrency: 'USDT' }),
  // 2. ETH — Ethereum
  '66f2e0e6-e375-4693-8f9d-ea423f47e751': Object.freeze({ binanceSymbol: 'ETHUSDT', canonicalSymbol: 'ETH', name: 'Ethereum', baseAsset: 'ETH', quoteCurrency: 'USDT' }),
  // 3. SOL — Solana
  '8ea1c52b-a999-4d1e-8b02-f8e7e8042118': Object.freeze({ binanceSymbol: 'SOLUSDT', canonicalSymbol: 'SOL', name: 'Solana', baseAsset: 'SOL', quoteCurrency: 'USDT' }),
  // 4. BNB — BNB
  '66c7d650-f440-4e84-9469-ce0d070ede6b': Object.freeze({ binanceSymbol: 'BNBUSDT', canonicalSymbol: 'BNB', name: 'BNB', baseAsset: 'BNB', quoteCurrency: 'USDT' }),
  // 5. XRP — XRP
  '4bebf6d3-cf96-4a88-8474-d4a4e706989a': Object.freeze({ binanceSymbol: 'XRPUSDT', canonicalSymbol: 'XRP', name: 'XRP', baseAsset: 'XRP', quoteCurrency: 'USDT' }),
  // 6. TRX — TRON
  'bdf8e845-dfe3-45a1-b852-642a0b886b7d': Object.freeze({ binanceSymbol: 'TRXUSDT', canonicalSymbol: 'TRX', name: 'TRON', baseAsset: 'TRX', quoteCurrency: 'USDT' }),
  // 7. ZEC — Zcash
  'a9cdfcc6-1518-4087-bbcd-8ac4704474a4': Object.freeze({ binanceSymbol: 'ZECUSDT', canonicalSymbol: 'ZEC', name: 'Zcash', baseAsset: 'ZEC', quoteCurrency: 'USDT' }),
  // 8. DOGE — Dogecoin
  '44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54': Object.freeze({ binanceSymbol: 'DOGEUSDT', canonicalSymbol: 'DOGE', name: 'Dogecoin', baseAsset: 'DOGE', quoteCurrency: 'USDT' }),
  // 9. LINK — Chainlink
  'c2534c6b-9eb5-4a78-b93f-969bb8f7df65': Object.freeze({ binanceSymbol: 'LINKUSDT', canonicalSymbol: 'LINK', name: 'Chainlink', baseAsset: 'LINK', quoteCurrency: 'USDT' }),
  // 10. ADA — Cardano
  '5af019d9-3cc5-4904-8cd1-25389feec501': Object.freeze({ binanceSymbol: 'ADAUSDT', canonicalSymbol: 'ADA', name: 'Cardano', baseAsset: 'ADA', quoteCurrency: 'USDT' }),
  // 11. XLM — Stellar
  '5b3bea95-edd8-4a89-918b-d8c3b0156399': Object.freeze({ binanceSymbol: 'XLMUSDT', canonicalSymbol: 'XLM', name: 'Stellar', baseAsset: 'XLM', quoteCurrency: 'USDT' }),
  // 12. BCH — Bitcoin Cash
  '11a31ef1-568f-4c10-8a13-5007e7d57a5b': Object.freeze({ binanceSymbol: 'BCHUSDT', canonicalSymbol: 'BCH', name: 'Bitcoin Cash', baseAsset: 'BCH', quoteCurrency: 'USDT' }),
  // 13. GRAM — Gram (prev. Toncoin)
  '04c0ebd5-d104-4b82-a447-16a3903ec01c': Object.freeze({ binanceSymbol: 'GRAMUSDT', canonicalSymbol: 'GRAM', name: 'Gram (prev. Toncoin)', baseAsset: 'GRAM', quoteCurrency: 'USDT' }),
  // 14. LTC — Litecoin
  '4cb6998d-3364-4734-ad73-d62ac3f47aff': Object.freeze({ binanceSymbol: 'LTCUSDT', canonicalSymbol: 'LTC', name: 'Litecoin', baseAsset: 'LTC', quoteCurrency: 'USDT' }),
  // 15. HBAR — Hedera
  'c3825936-a57f-4361-a4e5-9d7cd96d284c': Object.freeze({ binanceSymbol: 'HBARUSDT', canonicalSymbol: 'HBAR', name: 'Hedera', baseAsset: 'HBAR', quoteCurrency: 'USDT' }),
  // 16. AVAX — Avalanche
  'b0785af1-75d1-4fa3-99c1-d56985dfbade': Object.freeze({ binanceSymbol: 'AVAXUSDT', canonicalSymbol: 'AVAX', name: 'Avalanche', baseAsset: 'AVAX', quoteCurrency: 'USDT' }),
  // 17. SHIB — Shiba Inu
  'bdc8770f-7311-4621-9067-3c61b907238b': Object.freeze({ binanceSymbol: 'SHIBUSDT', canonicalSymbol: 'SHIB', name: 'Shiba Inu', baseAsset: 'SHIB', quoteCurrency: 'USDT' }),
  // 18. SUI — Sui
  '81590371-79ba-44c3-8f48-31b86d53c3e3': Object.freeze({ binanceSymbol: 'SUIUSDT', canonicalSymbol: 'SUI', name: 'Sui', baseAsset: 'SUI', quoteCurrency: 'USDT' }),
  // 19. UNI — Uniswap
  '79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3': Object.freeze({ binanceSymbol: 'UNIUSDT', canonicalSymbol: 'UNI', name: 'Uniswap', baseAsset: 'UNI', quoteCurrency: 'USDT' }),
  // 20. NEAR — NEAR Protocol
  '73b6f9b9-3b85-4c25-b1bf-6a34b4f18946': Object.freeze({ binanceSymbol: 'NEARUSDT', canonicalSymbol: 'NEAR', name: 'NEAR Protocol', baseAsset: 'NEAR', quoteCurrency: 'USDT' }),
  // 21. TAO — Bittensor
  '9ec01b5e-84c9-46b7-899a-772425d334af': Object.freeze({ binanceSymbol: 'TAOUSDT', canonicalSymbol: 'TAO', name: 'Bittensor', baseAsset: 'TAO', quoteCurrency: 'USDT' }),
  // 22. PUMP — Pump.fun
  'c632abb3-22eb-49ea-ae63-c742c56f091f': Object.freeze({ binanceSymbol: 'PUMPUSDT', canonicalSymbol: 'PUMP', name: 'Pump.fun', baseAsset: 'PUMP', quoteCurrency: 'USDT' }),
  // 23. AAVE — Aave
  'cc4c6bb6-3d5c-487e-961c-80a2eb89585c': Object.freeze({ binanceSymbol: 'AAVEUSDT', canonicalSymbol: 'AAVE', name: 'Aave', baseAsset: 'AAVE', quoteCurrency: 'USDT' }),
  // 24. ASTER — Aster
  '9841e6e5-a8ff-4e71-b034-e7a4de3d6ded': Object.freeze({ binanceSymbol: 'ASTERUSDT', canonicalSymbol: 'ASTER', name: 'Aster', baseAsset: 'ASTER', quoteCurrency: 'USDT' }),
  // 25. WLFI — World Liberty Financial
  '927dc869-7204-4d87-b744-fd6a03fc8c99': Object.freeze({ binanceSymbol: 'WLFIUSDT', canonicalSymbol: 'WLFI', name: 'World Liberty Financial', baseAsset: 'WLFI', quoteCurrency: 'USDT' }),
  // 26. ONDO — Ondo
  'afa7bb4c-283a-4686-a570-c591b12cef66': Object.freeze({ binanceSymbol: 'ONDOUSDT', canonicalSymbol: 'ONDO', name: 'Ondo', baseAsset: 'ONDO', quoteCurrency: 'USDT' }),
  // 27. ENA — Ethena
  'f8a74dcd-71f6-42d1-a3e7-2e6208cba86c': Object.freeze({ binanceSymbol: 'ENAUSDT', canonicalSymbol: 'ENA', name: 'Ethena', baseAsset: 'ENA', quoteCurrency: 'USDT' }),
  // 28. MORPHO — Morpho
  'b7abf464-981b-47c6-b587-1ac61cfe9e0e': Object.freeze({ binanceSymbol: 'MORPHOUSDT', canonicalSymbol: 'MORPHO', name: 'Morpho', baseAsset: 'MORPHO', quoteCurrency: 'USDT' }),
  // 29. PEPE — Pepe
  '821eace1-4edc-4d91-a2b3-a43e51ff49b7': Object.freeze({ binanceSymbol: 'PEPEUSDT', canonicalSymbol: 'PEPE', name: 'Pepe', baseAsset: 'PEPE', quoteCurrency: 'USDT' }),
  // 30. DOT — Polkadot
  'e7c6ef68-a92f-4735-9d8b-aa3e7767f11f': Object.freeze({ binanceSymbol: 'DOTUSDT', canonicalSymbol: 'DOT', name: 'Polkadot', baseAsset: 'DOT', quoteCurrency: 'USDT' }),
  // 31. WLD — Worldcoin
  '4635d9d6-f30f-4dd4-9632-67873ce5e3b1': Object.freeze({ binanceSymbol: 'WLDUSDT', canonicalSymbol: 'WLD', name: 'Worldcoin', baseAsset: 'WLD', quoteCurrency: 'USDT' }),
  // 32. ETC — Ethereum Classic
  'd9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7': Object.freeze({ binanceSymbol: 'ETCUSDT', canonicalSymbol: 'ETC', name: 'Ethereum Classic', baseAsset: 'ETC', quoteCurrency: 'USDT' }),
  // 33. POL — POL (ex-MATIC)
  '22deaafe-2849-4c75-980c-c0c8e3b42bc9': Object.freeze({ binanceSymbol: 'POLUSDT', canonicalSymbol: 'POL', name: 'POL (ex-MATIC)', baseAsset: 'POL', quoteCurrency: 'USDT' }),
  // 34. ATOM — Cosmos Hub
  '9c8f9012-9973-406e-89a3-6350f095b59b': Object.freeze({ binanceSymbol: 'ATOMUSDT', canonicalSymbol: 'ATOM', name: 'Cosmos Hub', baseAsset: 'ATOM', quoteCurrency: 'USDT' }),
  // 35. JUP — Jupiter
  '871267a7-954b-4d39-8299-3c0299fe8be8': Object.freeze({ binanceSymbol: 'JUPUSDT', canonicalSymbol: 'JUP', name: 'Jupiter', baseAsset: 'JUP', quoteCurrency: 'USDT' }),
  // 36. APT — Aptos (replacement for HYPE)
  'd3c678a1-5801-4475-8025-aa80e5572bb1': Object.freeze({ binanceSymbol: 'APTUSDT', canonicalSymbol: 'APT', name: 'Aptos', baseAsset: 'APT', quoteCurrency: 'USDT' }),
  // 37. ARB — Arbitrum (replacement for RAIN)
  'b6e3f422-9214-4a27-a169-d75fa6319c52': Object.freeze({ binanceSymbol: 'ARBUSDT', canonicalSymbol: 'ARB', name: 'Arbitrum', baseAsset: 'ARB', quoteCurrency: 'USDT' }),
  // 38. FET — Artificial Superintelligence Alliance (replacement for XMR)
  'c5a89233-1498-4d62-97ec-08e62d471e43': Object.freeze({ binanceSymbol: 'FETUSDT', canonicalSymbol: 'FET', name: 'Artificial Superintelligence Alliance', baseAsset: 'FET', quoteCurrency: 'USDT' }),
  // 39. INJ — Injective (replacement for WBT)
  'e9712a44-f655-4683-9b88-51829e1db874': Object.freeze({ binanceSymbol: 'INJUSDT', canonicalSymbol: 'INJ', name: 'Injective', baseAsset: 'INJ', quoteCurrency: 'USDT' }),
  // 40. FIL — Filecoin (replacement for LIT)
  'a8471b55-e7d9-4820-b0c3-f26e3c15aa65': Object.freeze({ binanceSymbol: 'FILUSDT', canonicalSymbol: 'FIL', name: 'Filecoin', baseAsset: 'FIL', quoteCurrency: 'USDT' })
});

// Reverse lookup maps
export const BINANCE_SYMBOL_TO_ASSET_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(BINANCE_USDT_MAPPING).map(([assetId, { binanceSymbol }]) => [binanceSymbol, assetId])
  )
);

export const CANONICAL_SYMBOL_TO_ASSET_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(BINANCE_USDT_MAPPING).map(([assetId, { canonicalSymbol }]) => [canonicalSymbol, assetId])
  )
);

export function isBinanceSupported(assetId) {
  return typeof assetId === 'string' && Object.prototype.hasOwnProperty.call(BINANCE_USDT_MAPPING, assetId);
}

export function getBinanceMappingBySymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const assetId = CANONICAL_SYMBOL_TO_ASSET_ID[symbol.trim().toUpperCase()];
  return assetId ? { assetId, ...BINANCE_USDT_MAPPING[assetId] } : null;
}

function resolveExplicitBinanceSymbol(asset, mapping) {
  const symbol = asset?.symbol || mapping?.canonicalSymbol;
  const providerSymbol = mapping?.providerSymbol || mapping?.provider_symbol || mapping?.binanceSymbol;
  const expected = asset?.id && BINANCE_USDT_MAPPING[asset.id]
    ? BINANCE_USDT_MAPPING[asset.id]
    : getBinanceMappingBySymbol(symbol);

  if (!providerSymbol || !expected || providerSymbol !== expected.binanceSymbol) {
    throw createBinanceError(
      `No valid explicit Binance mapping available for '${symbol || 'asset'}'`,
      'UNSUPPORTED_PROVIDER',
      422
    );
  }
  return providerSymbol;
}

// ---------------------------------------------------------------------------
// 2. Circuit Breaker for Binance Upstream Calls
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 30000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.nextAttemptMs = 0;
  }

  getState() {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  canAttempt() {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    this.nextAttemptMs = 0;
  }

  recordFailure(cooldownOverrideMs = null) {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      const cooldown = typeof cooldownOverrideMs === 'number' && cooldownOverrideMs > 0
        ? cooldownOverrideMs
        : this.cooldownMs;
      this.nextAttemptMs = Date.now() + cooldown;
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttemptMs = 0;
  }
}

export const defaultCircuitBreaker = new CircuitBreaker();

// ---------------------------------------------------------------------------
// 3. Shared History Cache & In-Flight Request Coalescing
// ---------------------------------------------------------------------------

export class BinanceHistoryCache {
  constructor() {
    this.entries = new Map(); // key -> { bars, cachedAtMs, completedBoundaryDate }
    this.inFlight = new Map(); // key -> Promise
  }

  makeKey(symbol, range, todayDate) {
    return `${symbol}::${range}::${todayDate}`;
  }

  get(key) {
    const entry = this.entries.get(key);
    return entry ? entry.bars : null;
  }

  getStale(symbol, range, requiredStartDate) {
    // Find latest cached completed history for this symbol and range
    let best = null;
    for (const [k, entry] of this.entries.entries()) {
      const payload = entry.bars;
      const hasCompleteCoverage = payload?.dataCompleteness === 'complete'
        && typeof entry.coverageStartDate === 'string'
        && entry.coverageStartDate <= requiredStartDate;
      if (k.startsWith(`${symbol}::${range}::`) && hasCompleteCoverage) {
        if (!best || entry.cachedAtMs > best.cachedAtMs) {
          best = entry;
        }
      }
    }
    return best ? best.bars : null;
  }

  set(key, bars, completedBoundaryDate, coverageStartDate) {
    this.entries.set(key, {
      bars,
      cachedAtMs: Date.now(),
      completedBoundaryDate,
      coverageStartDate
    });
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const defaultHistoryCache = new BinanceHistoryCache();

// ---------------------------------------------------------------------------
// 4. Shared Binance WebSocket API Client (Historical Requests)
// ---------------------------------------------------------------------------

let _wsApiClientInstance = null;

export function getBinanceWsApiClient(options = {}) {
  if (_wsApiClientInstance) return _wsApiClientInstance;
  _wsApiClientInstance = createBinanceWsApiClient(options);
  return _wsApiClientInstance;
}

export function _resetBinanceWsApiClient() {
  if (_wsApiClientInstance) {
    _wsApiClientInstance.destroy();
    _wsApiClientInstance = null;
  }
}

function createWsApiClientError(message, code, status = 502) {
  return createBinanceError(message, code, status);
}

function responseErrorFromPayload(payload) {
  const responseStatus = Number.isInteger(payload?.status) ? payload.status : null;
  const providerCode = Number.isInteger(payload?.error?.code) ? payload.error.code : null;

  if (responseStatus === 418 || responseStatus === 429) {
    const error = createWsApiClientError(
      'Binance WebSocket API rate limit exceeded',
      'PROVIDER_RATE_LIMITED',
      503
    );
    const retryAfter = Number(payload?.retryAfter ?? payload?.error?.data?.retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > Date.now()) {
      error.retryAfterMs = retryAfter - Date.now();
    }
    return error;
  }

  if (providerCode === -1121) {
    return createWsApiClientError(
      'Historical data not found on Binance',
      'HISTORY_NOT_FOUND',
      404
    );
  }

  return createWsApiClientError(
    responseStatus === null
      ? 'Malformed Binance WebSocket API response'
      : `Binance WebSocket API returned status ${responseStatus}`,
    responseStatus === null ? 'MALFORMED_PROVIDER_RESPONSE' : 'PROVIDER_ERROR',
    502
  );
}

/**
 * Creates one persistent, multiplexed public Binance WebSocket API client.
 * Requests are never replayed after a connection failure; callers retain
 * cache, stale-fallback, and circuit-breaker authority.
 */
export function createBinanceWsApiClient(options = {}) {
  const isNodeTest = typeof process !== 'undefined' && Boolean(process.env?.NODE_TEST_CONTEXT);
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;
  const wsUrl = options.wsUrl || WS_API_URL;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
    ? options.requestTimeoutMs
    : WS_API_REQUEST_TIMEOUT_MS;
  const reconnectBaseMs = Number.isFinite(options.reconnectBaseMs) && options.reconnectBaseMs >= 0
    ? options.reconnectBaseMs
    : WS_API_RECONNECT_BASE_MS;
  const reconnectMaxMs = Number.isFinite(options.reconnectMaxMs) && options.reconnectMaxMs >= reconnectBaseMs
    ? options.reconnectMaxMs
    : WS_API_RECONNECT_MAX_MS;
  const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
  const closeWhenIdle = options.closeWhenIdle === true ||
    (options.closeWhenIdle !== false && isNodeTest);
  const pending = new Map();
  const connectionWaiters = new Set();

  let socket = null;
  let connectionState = 'DISCONNECTED';
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let requestSequence = 0;
  let destroyed = false;

  function log(level, message) {
    if (options.silent || isNodeTest) return;
    console[level === 'ERROR' ? 'error' : 'log'](`[BinanceWsApi] [${level}]`, message);
  }

  function clearWaiter(waiter) {
    clearTimeout(waiter.timer);
    connectionWaiters.delete(waiter);
  }

  function resolveConnectionWaiters() {
    for (const waiter of [...connectionWaiters]) {
      clearWaiter(waiter);
      waiter.resolve();
    }
  }

  function rejectConnectionWaiters(error) {
    for (const waiter of [...connectionWaiters]) {
      clearWaiter(waiter);
      waiter.reject(error);
    }
  }

  function rejectPending(error) {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  }

  function closeIdleTestSocket() {
    if (!closeWhenIdle || pending.size > 0 || connectionWaiters.size > 0 || !socket) {
      return;
    }

    const currentSocket = socket;
    socket = null;
    connectionState = 'DISCONNECTED';
    currentSocket.onopen = null;
    currentSocket.onmessage = null;
    currentSocket.onerror = null;
    currentSocket.onclose = null;
    try {
      currentSocket.close();
    } catch {
      // Test-only idle shutdown must not alter request results.
    }
  }

  function scheduleReconnect() {
    if (destroyed || reconnectTimer) return;

    connectionState = 'RECONNECTING';
    const baseDelay = Math.min(
      reconnectBaseMs * (2 ** reconnectAttempt),
      reconnectMaxMs
    );
    const jitter = reconnectBaseMs === 0
      ? 0
      : Math.round(baseDelay * (0.5 + randomFn()));
    const delay = Math.min(jitter, reconnectMaxMs);
    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  function handleDisconnect(currentSocket) {
    if (socket !== currentSocket) return;

    socket = null;
    connectionState = 'DISCONNECTED';
    rejectPending(createWsApiClientError(
      'Binance WebSocket API connection closed before response',
      'PROVIDER_UNAVAILABLE',
      503
    ));

    if (!destroyed) {
      scheduleReconnect();
    }
  }

  function connect() {
    if (destroyed || connectionState === 'CONNECTING' || connectionState === 'CONNECTED') {
      return;
    }

    if (!WebSocketImpl) {
      const error = createWsApiClientError(
        'WebSocket is unavailable for Binance history',
        'PROVIDER_UNAVAILABLE',
        503
      );
      rejectConnectionWaiters(error);
      return;
    }

    connectionState = 'CONNECTING';
    let nextSocket;
    try {
      nextSocket = new WebSocketImpl(wsUrl);
    } catch {
      connectionState = 'DISCONNECTED';
      scheduleReconnect();
      return;
    }

    socket = nextSocket;

    nextSocket.onopen = () => {
      if (destroyed || socket !== nextSocket) return;
      connectionState = 'CONNECTED';
      reconnectAttempt = 0;
      resolveConnectionWaiters();
      log('INFO', 'Connected to Binance WebSocket API');
    };

    nextSocket.onmessage = (event) => {
      if (destroyed || socket !== nextSocket) return;

      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const id = typeof payload?.id === 'string' ? payload.id : null;
      const entry = id ? pending.get(id) : null;
      if (!entry) return;

      clearTimeout(entry.timer);
      pending.delete(id);

      if (payload.status !== 200) {
        entry.reject(responseErrorFromPayload(payload));
        closeIdleTestSocket();
        return;
      }

      if (!Array.isArray(payload.result)) {
        entry.reject(createWsApiClientError(
          'Malformed Binance WebSocket API Kline response',
          'MALFORMED_PROVIDER_RESPONSE',
          502
        ));
        closeIdleTestSocket();
        return;
      }

      entry.resolve(payload.result);
      closeIdleTestSocket();
    };

    nextSocket.onerror = () => {
      if (destroyed || socket !== nextSocket) return;
      handleDisconnect(nextSocket);
      try {
        nextSocket.close();
      } catch {
        // The failed socket may already be closed.
      }
    };

    nextSocket.onclose = () => {
      if (destroyed || socket !== nextSocket) return;
      handleDisconnect(nextSocket);
    };
  }

  function ensureConnected(timeoutMs) {
    if (destroyed) {
      return Promise.reject(createWsApiClientError(
        'Binance WebSocket API client is shut down',
        'PROVIDER_UNAVAILABLE',
        503
      ));
    }
    if (connectionState === 'CONNECTED' && socket) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: null
      };
      waiter.timer = setTimeout(() => {
        connectionWaiters.delete(waiter);
        reject(createWsApiClientError(
          'Binance WebSocket API connection timed out',
          'PROVIDER_TIMEOUT',
          504
        ));
      }, timeoutMs);
      connectionWaiters.add(waiter);

      if (!reconnectTimer) {
        connect();
      }
    });
  }

  async function request(method, params, requestOptions = {}) {
    const timeoutMs = Number.isFinite(requestOptions.timeoutMs) && requestOptions.timeoutMs > 0
      ? requestOptions.timeoutMs
      : requestTimeoutMs;
    await ensureConnected(timeoutMs);

    if (destroyed || connectionState !== 'CONNECTED' || !socket) {
      throw createWsApiClientError(
        'Binance WebSocket API is unavailable',
        'PROVIDER_UNAVAILABLE',
        503
      );
    }

    const id = `history-${Date.now().toString(36)}-${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(createWsApiClientError(
          'Binance WebSocket API request timed out',
          'PROVIDER_TIMEOUT',
          504
        ));
        closeIdleTestSocket();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });

      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(createWsApiClientError(
          'Binance WebSocket API request could not be sent',
          'PROVIDER_UNAVAILABLE',
          503
        ));
        closeIdleTestSocket();
      }
    });
  }

  function requestKlines(symbol, requestOptions = {}) {
    return request('klines', {
      symbol,
      interval: '1d',
      limit: 1000
    }, requestOptions);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const error = createWsApiClientError(
      'Binance WebSocket API client was shut down',
      'PROVIDER_UNAVAILABLE',
      503
    );
    rejectConnectionWaiters(error);
    rejectPending(error);

    const currentSocket = socket;
    socket = null;
    connectionState = 'DESTROYED';
    if (currentSocket) {
      currentSocket.onopen = null;
      currentSocket.onmessage = null;
      currentSocket.onerror = null;
      currentSocket.onclose = null;
      try {
        currentSocket.close();
      } catch {
        // Ignore shutdown failures.
      }
    }
  }

  return Object.freeze({
    request,
    requestKlines,
    getConnectionState: () => connectionState,
    getPendingCount: () => pending.size,
    destroy
  });
}

// ---------------------------------------------------------------------------
// 5. Binance Daily Kline Normalization & Validation
// ---------------------------------------------------------------------------

function createBinanceError(message, code, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Validates and extracts a single Binance raw Kline row.
 * Format: [ openTime, open, high, low, close, volume, closeTime, ... ]
 */
export function parseBinanceKline(rawKline) {
  if (!Array.isArray(rawKline) || rawKline.length < 6) {
    return null;
  }

  const openTime = Number(rawKline[0]);
  if (!Number.isFinite(openTime) || openTime <= 0) return null;

  const open = Number(rawKline[1]);
  const high = Number(rawKline[2]);
  const low = Number(rawKline[3]);
  const close = Number(rawKline[4]);
  const volume = Number(rawKline[5]);

  if (!Number.isFinite(open) || open <= 0) return null;
  if (!Number.isFinite(high) || high <= 0) return null;
  if (!Number.isFinite(low) || low <= 0) return null;
  if (!Number.isFinite(close) || close <= 0) return null;
  if (!Number.isFinite(volume) || volume < 0) return null;

  if (high < low || high < close || high < open || low > close || low > open) {
    return null; // Contradictory OHLC
  }

  const dateObj = new Date(openTime);
  const timestamp = dateObj.toISOString();

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume
  };
}

/**
 * Normalizes raw Binance Klines into completed canonical daily bars.
 */
export function normalizeHistoricalData(rawKlines, symbol, range, options = {}) {
  if (!Array.isArray(rawKlines)) {
    throw createBinanceError(`Malformed Binance historical response for '${symbol}'`, 'MALFORMED_PROVIDER_RESPONSE', 502);
  }

  const records = [];
  for (const item of rawKlines) {
    const bar = parseBinanceKline(item);
    if (bar) {
      records.push(bar);
    }
  }

  const asset = options.asset || {
    symbol,
    assetType: 'crypto',
    quoteCurrency: 'USDT',
    marketPolicy: 'CONTINUOUS_24_7',
    marketTimezone: 'UTC'
  };

  return normalizeDailyHistory({
    asset,
    provider: 'binance',
    range,
    records,
    now: options.now || new Date(),
    freshness: options.freshness || 'delayed',
    historyCapabilities: {
      close: true,
      ohlc: true,
      volume: true
    },
    applyRangeFilter: options.applyRangeFilter !== false,
    excludeIncomplete: true
  });
}

// ---------------------------------------------------------------------------
// 6. Binance History Fetcher (getHistory)
// ---------------------------------------------------------------------------

export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || mapping?.canonicalSymbol;
  const binanceSymbol = resolveExplicitBinanceSymbol(asset, mapping);

  const requestedRange = (options.range || '1M').toString().trim().toUpperCase();
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();

  const todayUtc = getCanonicalDate(now, 'UTC');
  const startDateUtc = getHistoryRangeStart(todayUtc, requestedRange);
  const cache = options.cache || defaultHistoryCache;
  const circuit = options.circuitBreaker || defaultCircuitBreaker;

  const cacheKey = cache.makeKey(binanceSymbol, requestedRange, todayUtc);

  // 1. Check in-memory fresh cache
  const cached = cache.get(cacheKey);
  if (cached && options.bypassCache !== true) {
    return cached;
  }

  // 2. Check in-flight request coalescing
  if (cache.inFlight.has(cacheKey) && options.bypassCache !== true) {
    return cache.inFlight.get(cacheKey);
  }

  // 3. Circuit breaker check
  if (!circuit.canAttempt() && options.bypassCircuit !== true) {
    // If circuit is open, attempt stale fallback
    const staleBars = cache.getStale(binanceSymbol, requestedRange, startDateUtc);
    if (staleBars && staleBars.bars && staleBars.bars.length > 0) {
      return {
        ...staleBars,
        stale: true,
        providerStatus: 'circuit_open_stale_fallback'
      };
    }
    throw createBinanceError('Binance market provider temporarily unavailable (circuit open)', 'PROVIDER_UNAVAILABLE', 503);
  }

  // 4. Execute fetch pipeline with coalescing
  const fetchPromise = (async () => {
    let failureCooldownMs = null;
    try {
      const wsApiClient = options.wsApiClient || getBinanceWsApiClient();
      const rawKlines = await wsApiClient.requestKlines(binanceSymbol, {
        timeoutMs: options.requestTimeoutMs
      });
      if (!Array.isArray(rawKlines)) {
        throw createBinanceError(`Binance returned non-array history for '${symbol}'`, 'MALFORMED_PROVIDER_RESPONSE', 502);
      }

      const normalized = normalizeHistoricalData(rawKlines, symbol, requestedRange, {
        asset: {
          symbol,
          assetType: 'crypto',
          quoteCurrency: 'USDT',
          marketPolicy: 'CONTINUOUS_24_7',
          marketTimezone: 'UTC'
        },
        now
      });

      // Successful fetch -> record success on circuit breaker & store in cache
      circuit.recordSuccess();
      cache.set(cacheKey, normalized, todayUtc, startDateUtc);
      return normalized;
    } catch (err) {
      failureCooldownMs = Number.isFinite(err?.retryAfterMs) ? err.retryAfterMs : null;
      circuit.recordFailure(failureCooldownMs);
      // Try stale cache fallback if available
      const stale = cache.getStale(binanceSymbol, requestedRange, startDateUtc);
      if (stale && stale.bars && stale.bars.length > 0) {
        return {
          ...stale,
          stale: true,
          providerStatus: 'stale_fallback'
        };
      }
      if (err?.code && Number.isInteger(err?.status)) {
        throw err;
      }
      throw createBinanceError(
        `Error fetching Binance history for '${symbol}'`,
        'PROVIDER_ERROR',
        502
      );
    } finally {
      cache.inFlight.delete(cacheKey);
    }
  })();

  cache.inFlight.set(cacheKey, fetchPromise);
  return fetchPromise;
}

// ---------------------------------------------------------------------------
// 7. Binance Snapshot Provider (getSnapshot)
// ---------------------------------------------------------------------------

export function normalizeMarketSnapshot(raw, symbol) {
  if (!raw || typeof raw !== 'object') {
    throw createBinanceError(`No market quote available for '${symbol}'`, 'SNAPSHOT_NOT_FOUND', 404);
  }

  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0
    ? raw.price
    : (typeof raw.lastPrice === 'string' && Number(raw.lastPrice) > 0 ? Number(raw.lastPrice) : null);

  const previousClose = typeof raw.previousClose === 'number' && Number.isFinite(raw.previousClose) && raw.previousClose > 0
    ? raw.previousClose
    : (typeof raw.prevClosePrice === 'string' && Number(raw.prevClosePrice) > 0 ? Number(raw.prevClosePrice) : null);

  const rollingOpen = typeof raw.rollingOpen === 'number' && Number.isFinite(raw.rollingOpen) && raw.rollingOpen > 0
    ? raw.rollingOpen
    : (typeof raw.openPrice === 'string' && Number(raw.openPrice) > 0 ? Number(raw.openPrice) : null);

  const dayHigh = typeof raw.dayHigh === 'number' && Number.isFinite(raw.dayHigh) && raw.dayHigh > 0
    ? raw.dayHigh
    : (typeof raw.highPrice === 'string' && Number(raw.highPrice) > 0 ? Number(raw.highPrice) : null);

  const dayLow = typeof raw.dayLow === 'number' && Number.isFinite(raw.dayLow) && raw.dayLow > 0
    ? raw.dayLow
    : (typeof raw.lowPrice === 'string' && Number(raw.lowPrice) > 0 ? Number(raw.lowPrice) : null);

  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) && raw.volume >= 0
    ? raw.volume
    : (typeof raw.volume === 'string' && Number(raw.volume) >= 0 ? Number(raw.volume) : null);

  let change = null;
  let changePercent = null;
  if (price !== null && rollingOpen !== null && rollingOpen > 0) {
    change = price - rollingOpen;
    changePercent = ((price / rollingOpen) - 1) * 100;
  }

  const priceAsOf = raw.observedAt || (typeof raw.closeTime === 'number' ? new Date(raw.closeTime).toISOString() : new Date().toISOString());

  return {
    symbol,
    currency: 'USDT',
    exchange: 'Binance Spot',
    price,
    previousClose: null, // Rolling 24h does not use previous session close
    change,
    changePercent,
    dayHigh,
    dayLow,
    volume,
    updatedAt: priceAsOf,
    priceAsOf,
    priceSource: raw.priceSource || 'binance_spot',
    freshness: raw.freshness || 'live',
    changeBasis: 'ROLLING_24H',
    volumeSemantics: 'ROLLING_24H_BASE_UNITS'
  };
}

export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || mapping?.canonicalSymbol;
  const assetId = asset?.id || mapping?.assetId || mapping?.asset_id || CANONICAL_SYMBOL_TO_ASSET_ID[symbol];
  const binanceSymbol = resolveExplicitBinanceSymbol(asset, mapping);

  // 1. Try WebSocket service observation if available
  const binanceSvc = options.binanceService
    || (options.useRealtimeService === true && typeof getBinanceService === 'function'
      ? getBinanceService()
      : null);
  if (binanceSvc && assetId) {
    const wsObs = binanceSvc.getSnapshot(assetId, options);
    if (wsObs && wsObs.price !== null) {
      const snapshot = normalizeMarketSnapshot(wsObs, symbol);
      // Attach optional reference priceVnd if FX is available
      return attachApproximateVndReference(snapshot, options);
    }
  }

  // 2. Fallback to 24hr ticker REST endpoint
  const fetchFn = options.fetchFn || fetch;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(binanceSymbol)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) {
        throw createBinanceError(`Market quote for '${symbol}' not found on Binance`, 'SNAPSHOT_NOT_FOUND', 404);
      }
      if (response.status === 429) {
        throw createBinanceError(`Binance rate limit exceeded for '${symbol}'`, 'PROVIDER_RATE_LIMITED', 503);
      }
      throw createBinanceError(`Binance ticker returned HTTP ${response.status}`, 'PROVIDER_ERROR', 502);
    }

    const data = await response.json();
    const snapshot = normalizeMarketSnapshot({
      price: Number(data.lastPrice),
      rollingOpen: Number(data.openPrice),
      dayHigh: Number(data.highPrice),
      dayLow: Number(data.lowPrice),
      volume: Number(data.volume),
      observedAt: typeof data.closeTime === 'number' ? new Date(data.closeTime).toISOString() : new Date().toISOString(),
      priceSource: 'binance_rest_24hr'
    }, symbol);

    return attachApproximateVndReference(snapshot, options);
  } catch (err) {
    if (err.status) throw err;
    if (err.name === 'AbortError') {
      throw createBinanceError(`Market quote request timed out for '${symbol}'`, 'PROVIDER_TIMEOUT', 504);
    }
    throw createBinanceError(`Error fetching market quote for '${symbol}'`, 'PROVIDER_ERROR', 502);
  }
}

/**
 * Attaches approximate reference VND conversion to crypto snapshot using existing FX resolver.
 * If FX is unavailable, priceVnd remains null without breaking USDT quote.
 */
export async function attachApproximateVndReference(snapshot, options = {}) {
  const getFxRateFn = options.getFxRateFn || getFxRate;
  try {
    const fx = await getFxRateFn('USD', 'VND', options);
    if (fx && fx.availability === 'available' && typeof fx.rate === 'number' && fx.rate > 0) {
      const approximateValue = snapshot.price !== null ? snapshot.price * fx.rate : null;
      return {
        ...snapshot,
        priceVnd: approximateValue,
        priceVndSemantics: 'APPROXIMATE_REFERENCE_ONLY',
        referenceFxRate: fx.rate,
        referenceFxProvider: fx.provider,
        referenceVnd: {
          value: approximateValue,
          currency: 'VND',
          sourcePriceCurrency: 'USDT',
          conversionRateBaseCurrency: 'USD',
          conversionRateQuoteCurrency: 'VND',
          conversionRate: fx.rate,
          conversionProvider: fx.provider,
          conversionAsOf: fx.sourceTimestamp || null,
          approximate: true,
          referenceOnly: true,
          accountingEligible: false,
          historicalEligible: false
        }
      };
    }
  } catch (_) {
    // FX failure is strictly isolated — price in USDT remains valid
  }
  return {
    ...snapshot,
    priceVnd: null,
    priceVndSemantics: 'APPROXIMATE_REFERENCE_ONLY',
    referenceFxRate: null,
    referenceFxProvider: null,
    referenceVnd: {
      value: null,
      currency: 'VND',
      sourcePriceCurrency: 'USDT',
      conversionRateBaseCurrency: 'USD',
      conversionRateQuoteCurrency: 'VND',
      conversionRate: null,
      conversionProvider: null,
      conversionAsOf: null,
      approximate: true,
      referenceOnly: true,
      accountingEligible: false,
      historicalEligible: false
    }
  };
}

// ---------------------------------------------------------------------------
// 8. Binance WebSocket Service (Shared Realtime Connection)
// ---------------------------------------------------------------------------

const BINANCE_FRESH_MS = 30_000;   // 30 s: observation considered live
const BINANCE_STALE_MS = 120_000;  // 2 min: observation considered stale but usable before fallback

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_MIN_INTERVAL_MS = 1_000;

let _serviceInstance = null;

export function getBinanceService(options = {}) {
  if (_serviceInstance) return _serviceInstance;
  _serviceInstance = createBinanceService(options);
  return _serviceInstance;
}

export function _resetBinanceService() {
  if (_serviceInstance) {
    _serviceInstance.destroy();
    _serviceInstance = null;
  }
  _resetBinanceWsApiClient();
}

export function createBinanceService(options = {}) {
  const cache = new Map(); // assetId -> observation

  let ws = null;
  let connectionState = 'DISCONNECTED';
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let lastReconnectAttemptMs = 0;
  let destroyed = false;

  const WS_URL = options.wsUrl || 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;
  const disabled = options.disabled === true;

  function log(level, msg, extra = {}) {
    if (options.silent) return;
    const prefix = `[BinanceService] [${level}]`;
    if (Object.keys(extra).length > 0) {
      console[level === 'ERROR' ? 'error' : 'log'](prefix, msg, extra);
    } else {
      console[level === 'ERROR' ? 'error' : 'log'](prefix, msg);
    }
  }

  function handleMiniTickerArray(events) {
    if (!Array.isArray(events)) return;
    const now = Date.now();
    for (const event of events) {
      const binanceSymbol = event?.s;
      if (!binanceSymbol) continue;
      const assetId = BINANCE_SYMBOL_TO_ASSET_ID[binanceSymbol];
      if (!assetId) continue;

      const mapping = BINANCE_USDT_MAPPING[assetId];
      const rawClose = Number(event.c);
      const price = Number.isFinite(rawClose) && rawClose > 0 ? rawClose : null;
      if (price === null) continue;

      const rawOpen = Number(event.o);
      const rollingOpen = Number.isFinite(rawOpen) && rawOpen > 0 ? rawOpen : null;

      const rawHigh = Number(event.h);
      const rollingHigh = Number.isFinite(rawHigh) && rawHigh > 0 ? rawHigh : null;

      const rawLow = Number(event.l);
      const rollingLow = Number.isFinite(rawLow) && rawLow > 0 ? rawLow : null;

      const rawBaseVol = Number(event.v);
      const baseVolume = Number.isFinite(rawBaseVol) && rawBaseVol >= 0 ? rawBaseVol : null;

      const rawQuoteVol = Number(event.q);
      const quoteVolume = Number.isFinite(rawQuoteVol) && rawQuoteVol >= 0 ? rawQuoteVol : null;

      const rawEventTime = typeof event.E === 'number' ? event.E : null;
      const observedAt = rawEventTime !== null && Number.isFinite(rawEventTime)
        ? new Date(rawEventTime).toISOString()
        : new Date(now).toISOString();
      const cachedAtMs = rawEventTime !== null && Number.isFinite(rawEventTime)
        ? rawEventTime
        : now;

      cache.set(assetId, {
        assetId,
        symbol: mapping.canonicalSymbol,
        binanceSymbol,
        realtimeCurrency: 'USDT',
        currency: 'USDT',
        price,
        rollingOpen,
        rollingHigh,
        rollingLow,
        changeBasis: 'ROLLING_24H',
        baseVolume,
        quoteVolume,
        observedAt,
        cachedAtMs,
        connectionState: 'CONNECTED',
        priceSource: 'binance_websocket'
      });
    }
  }

  function connect() {
    if (disabled || destroyed) return;
    if (!WebSocketImpl) {
      log('ERROR', 'WebSocket not available in this runtime');
      return;
    }

    const nowMs = Date.now();
    const msSinceLast = nowMs - lastReconnectAttemptMs;
    if (msSinceLast < RECONNECT_MIN_INTERVAL_MS && lastReconnectAttemptMs > 0) {
      const wait = RECONNECT_MIN_INTERVAL_MS - msSinceLast;
      reconnectTimer = setTimeout(connect, wait);
      return;
    }
    lastReconnectAttemptMs = nowMs;

    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch (_) { /* ignore */ }
      ws = null;
    }

    connectionState = 'CONNECTING';
    log('INFO', `Connecting to Binance stream (attempt ${reconnectAttempt + 1})`, { url: WS_URL });

    let socket;
    try {
      socket = new WebSocketImpl(WS_URL);
    } catch (err) {
      log('ERROR', 'Failed to create WebSocket', { message: err.message });
      scheduleReconnect();
      return;
    }

    ws = socket;

    socket.onopen = () => {
      if (destroyed || ws !== socket) return;
      connectionState = 'CONNECTED';
      reconnectAttempt = 0;
      log('INFO', 'Connected to Binance !miniTicker@arr stream');
    };

    socket.onmessage = (event) => {
      if (destroyed || ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          handleMiniTickerArray(data);
        }
      } catch (err) {
        log('ERROR', 'Error parsing Binance WebSocket message', { message: err.message });
      }
    };

    socket.onerror = (err) => {
      if (destroyed || ws !== socket) return;
      log('ERROR', 'Binance WebSocket error', { message: err?.message });
      connectionState = 'RECONNECTING';
    };

    socket.onclose = (event) => {
      if (destroyed || ws !== socket) return;
      log('INFO', 'Binance WebSocket closed', { code: event?.code, reason: event?.reason });
      connectionState = 'RECONNECTING';
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (destroyed || disabled) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      log('ERROR', `Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Service degraded.`);
      connectionState = 'DISCONNECTED';
      reconnectTimer = setTimeout(() => {
        reconnectAttempt = 0;
        if (!destroyed) connect();
      }, RECONNECT_MAX_MS * 2);
      return;
    }

    const base = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
    const jitter = base * (0.5 + Math.random());
    const delay = Math.min(Math.round(jitter), RECONNECT_MAX_MS);

    reconnectAttempt++;
    log('INFO', `Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!destroyed) connect();
    }, delay);
  }

  function getSnapshotObs(assetId, opts = {}) {
    if (!isBinanceSupported(assetId)) return null;

    const obs = cache.get(assetId);
    if (!obs) return null;

    const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    const ageMs = nowMs - obs.cachedAtMs;
    const maxAgeMs = connectionState === 'CONNECTED' ? BINANCE_STALE_MS : BINANCE_FRESH_MS;

    if (ageMs > maxAgeMs) return null;

    const freshness = ageMs <= BINANCE_FRESH_MS ? 'live' : 'stale';

    return {
      ...obs,
      freshness,
      connectionState
    };
  }

  function destroy() {
    destroyed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch (_) { /* ignore */ }
      ws = null;
    }
    connectionState = 'DISCONNECTED';
    cache.clear();
  }

  if (!disabled) {
    connect();
  }

  return Object.freeze({
    getSnapshot: getSnapshotObs,
    isBinanceSupported,
    getConnectionState: () => connectionState,
    destroy,
    _handleMiniTickerArray: handleMiniTickerArray,
    _cache: cache
  });
}

// ---------------------------------------------------------------------------
// 9. Health Signals
// ---------------------------------------------------------------------------

export function getBinanceHealth() {
  const svc = _serviceInstance;
  const wsState = svc ? svc.getConnectionState() : 'DISABLED';
  const historyWsState = _wsApiClientInstance
    ? _wsApiClientInstance.getConnectionState()
    : 'IDLE';
  const circuitState = defaultCircuitBreaker.getState();

  const realtime = wsState === 'CONNECTED' ? 'healthy' : (wsState === 'RECONNECTING' || wsState === 'CONNECTING' ? 'degraded' : 'unavailable');
  const history = circuitState === 'OPEN'
    ? 'unavailable'
    : (circuitState === 'HALF_OPEN' || ['CONNECTING', 'RECONNECTING'].includes(historyWsState)
      ? 'degraded'
      : 'healthy');

  return {
    binanceRealtime: realtime,
    binanceHistory: history,
    circuitBreaker: circuitState
  };
}

// ---------------------------------------------------------------------------
// 10. Exported Provider Adapter
// ---------------------------------------------------------------------------

export const binanceProvider = Object.freeze({
  name: 'binance',
  role: 'native_usdt_realtime_and_history',
  capabilities: Object.freeze({
    snapshot: false,
    history: true,
    analysis: true,
    ohlcHistory: true,
    snapshotChangeBasis: 'ROLLING_24H'
  }),
  getSnapshot,
  getHistory,
  normalizeMarketSnapshot,
  normalizeHistoricalData
});
