/**
 * Feature 24A — Binance Public Market Data WebSocket Service
 *
 * Provides realtime (≈1s update) Crypto snapshot observations from the
 * Binance public Spot WebSocket stream for the 35 verified canonical assets
 * that have an active BINANCE USDT TRADING pair.
 *
 * Architecture rules:
 * - ONE shared WebSocket connection per server process.
 * - NO API keys, NO user-data stream, NO trading.
 * - USDT observation is kept distinct from canonical USD quote currency.
 * - CoinGecko remains the sole history/analysis provider and snapshot fallback.
 * - Analysis MUST NOT consume Binance realtime prices.
 *
 * Currency policy (Option A — approved):
 *   The canonical asset quoteCurrency remains USD (from the assets table).
 *   Binance streams USDT prices. These are labelled with realtimeCurrency: 'USDT'
 *   and surfaced as a realtime market reference alongside the canonical quoteCurrency.
 *   USDT is NOT silently rewritten to USD.
 */

// ---------------------------------------------------------------------------
// Verified Binance USDT mapping (35/40 canonical Crypto assets)
// ---------------------------------------------------------------------------
// Source: GET /api/v3/exchangeInfo verified 2026-08-29 — all TRADING status.
// Keys are canonical asset UUIDs. Values carry binanceSymbol and canonicalSymbol.
//
// NOT included (no TRADING USDT pair):
//   HYPE  (not listed on Binance Spot)
//   RAIN  (not listed on Binance Spot)
//   XMR   (XMRUSDT is BREAK/delisted)
//   WBT   (not listed on Binance Spot)
//   LIT   (LITUSDT is BREAK/delisted)

export const BINANCE_USDT_MAPPING = Object.freeze({
  // BTC — Bitcoin
  '1aca9503-acf1-4450-9b75-4f8935324398': { binanceSymbol: 'BTCUSDT', canonicalSymbol: 'BTC' },
  // ETH — Ethereum
  '66f2e0e6-e375-4693-8f9d-ea423f47e751': { binanceSymbol: 'ETHUSDT', canonicalSymbol: 'ETH' },
  // SOL — Solana
  '8ea1c52b-a999-4d1e-8b02-f8e7e8042118': { binanceSymbol: 'SOLUSDT', canonicalSymbol: 'SOL' },
  // BNB — BNB
  '66c7d650-f440-4e84-9469-ce0d070ede6b': { binanceSymbol: 'BNBUSDT', canonicalSymbol: 'BNB' },
  // XRP — XRP
  '4bebf6d3-cf96-4a88-8474-d4a4e706989a': { binanceSymbol: 'XRPUSDT', canonicalSymbol: 'XRP' },
  // TRX — TRON
  'bdf8e845-dfe3-45a1-b852-642a0b886b7d': { binanceSymbol: 'TRXUSDT', canonicalSymbol: 'TRX' },
  // ZEC — Zcash
  'a9cdfcc6-1518-4087-bbcd-8ac4704474a4': { binanceSymbol: 'ZECUSDT', canonicalSymbol: 'ZEC' },
  // DOGE — Dogecoin
  '44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54': { binanceSymbol: 'DOGEUSDT', canonicalSymbol: 'DOGE' },
  // LINK — Chainlink
  'c2534c6b-9eb5-4a78-b93f-969bb8f7df65': { binanceSymbol: 'LINKUSDT', canonicalSymbol: 'LINK' },
  // ADA — Cardano
  '5af019d9-3cc5-4904-8cd1-25389feec501': { binanceSymbol: 'ADAUSDT', canonicalSymbol: 'ADA' },
  // XLM — Stellar
  '5b3bea95-edd8-4a89-918b-d8c3b0156399': { binanceSymbol: 'XLMUSDT', canonicalSymbol: 'XLM' },
  // BCH — Bitcoin Cash
  '11a31ef1-568f-4c10-8a13-5007e7d57a5b': { binanceSymbol: 'BCHUSDT', canonicalSymbol: 'BCH' },
  // GRAM — Gram (prev. Toncoin)
  '04c0ebd5-d104-4b82-a447-16a3903ec01c': { binanceSymbol: 'GRAMUSDT', canonicalSymbol: 'GRAM' },
  // LTC — Litecoin
  '4cb6998d-3364-4734-ad73-d62ac3f47aff': { binanceSymbol: 'LTCUSDT', canonicalSymbol: 'LTC' },
  // HBAR — Hedera
  'c3825936-a57f-4361-a4e5-9d7cd96d284c': { binanceSymbol: 'HBARUSDT', canonicalSymbol: 'HBAR' },
  // AVAX — Avalanche
  'b0785af1-75d1-4fa3-99c1-d56985dfbade': { binanceSymbol: 'AVAXUSDT', canonicalSymbol: 'AVAX' },
  // SHIB — Shiba Inu
  'bdc8770f-7311-4621-9067-3c61b907238b': { binanceSymbol: 'SHIBUSDT', canonicalSymbol: 'SHIB' },
  // SUI — Sui
  '81590371-79ba-44c3-8f48-31b86d53c3e3': { binanceSymbol: 'SUIUSDT', canonicalSymbol: 'SUI' },
  // UNI — Uniswap
  '79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3': { binanceSymbol: 'UNIUSDT', canonicalSymbol: 'UNI' },
  // NEAR — NEAR Protocol
  '73b6f9b9-3b85-4c25-b1bf-6a34b4f18946': { binanceSymbol: 'NEARUSDT', canonicalSymbol: 'NEAR' },
  // TAO — Bittensor
  '9ec01b5e-84c9-46b7-899a-772425d334af': { binanceSymbol: 'TAOUSDT', canonicalSymbol: 'TAO' },
  // PUMP — Pump.fun
  'c632abb3-22eb-49ea-ae63-c742c56f091f': { binanceSymbol: 'PUMPUSDT', canonicalSymbol: 'PUMP' },
  // AAVE — Aave
  'cc4c6bb6-3d5c-487e-961c-80a2eb89585c': { binanceSymbol: 'AAVEUSDT', canonicalSymbol: 'AAVE' },
  // ASTER — Aster
  '9841e6e5-a8ff-4e71-b034-e7a4de3d6ded': { binanceSymbol: 'ASTERUSDT', canonicalSymbol: 'ASTER' },
  // WLFI — World Liberty Financial
  '927dc869-7204-4d87-b744-fd6a03fc8c99': { binanceSymbol: 'WLFIUSDT', canonicalSymbol: 'WLFI' },
  // ONDO — Ondo
  'afa7bb4c-283a-4686-a570-c591b12cef66': { binanceSymbol: 'ONDOUSDT', canonicalSymbol: 'ONDO' },
  // ENA — Ethena
  'f8a74dcd-71f6-42d1-a3e7-2e6208cba86c': { binanceSymbol: 'ENAUSDT', canonicalSymbol: 'ENA' },
  // MORPHO — Morpho
  'b7abf464-981b-47c6-b587-1ac61cfe9e0e': { binanceSymbol: 'MORPHOUSDT', canonicalSymbol: 'MORPHO' },
  // PEPE — Pepe
  '821eace1-4edc-4d91-a2b3-a43e51ff49b7': { binanceSymbol: 'PEPEUSDT', canonicalSymbol: 'PEPE' },
  // DOT — Polkadot
  'e7c6ef68-a92f-4735-9d8b-aa3e7767f11f': { binanceSymbol: 'DOTUSDT', canonicalSymbol: 'DOT' },
  // WLD — Worldcoin
  '4635d9d6-f30f-4dd4-9632-67873ce5e3b1': { binanceSymbol: 'WLDUSDT', canonicalSymbol: 'WLD' },
  // ETC — Ethereum Classic
  'd9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7': { binanceSymbol: 'ETCUSDT', canonicalSymbol: 'ETC' },
  // POL — POL (ex-MATIC)
  '22deaafe-2849-4c75-980c-c0c8e3b42bc9': { binanceSymbol: 'POLUSDT', canonicalSymbol: 'POL' },
  // ATOM — Cosmos Hub
  '9c8f9012-9973-406e-89a3-6350f095b59b': { binanceSymbol: 'ATOMUSDT', canonicalSymbol: 'ATOM' },
  // JUP — Jupiter
  '871267a7-954b-4d39-8299-3c0299fe8be8': { binanceSymbol: 'JUPUSDT', canonicalSymbol: 'JUP' }
});

// Reverse index: binanceSymbol → assetId (for fast event routing)
const BINANCE_SYMBOL_TO_ASSET_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(BINANCE_USDT_MAPPING).map(([assetId, { binanceSymbol }]) => [binanceSymbol, assetId])
  )
);

// ---------------------------------------------------------------------------
// Stale-window policy
// ---------------------------------------------------------------------------
const BINANCE_FRESH_MS = 30_000;   // 30 s: observation considered fresh
const BINANCE_STALE_MS = 120_000;  // 2 min: observation considered expired → fallback

// Reconnect policy
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_MIN_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given assetId has a verified Binance USDT TRADING pair.
 * @param {string} assetId - Canonical asset UUID
 * @returns {boolean}
 */
export function isBinanceSupported(assetId) {
  return Object.prototype.hasOwnProperty.call(BINANCE_USDT_MAPPING, assetId);
}

// ---------------------------------------------------------------------------
// BinanceService singleton
// ---------------------------------------------------------------------------

let _serviceInstance = null;

/**
 * Creates (or returns the existing) singleton Binance WebSocket service.
 * Call once at server start. The service auto-connects and auto-reconnects.
 *
 * For testing, pass options.disabled = true to get a no-op stub.
 */
export function getBinanceService(options = {}) {
  if (_serviceInstance) return _serviceInstance;
  _serviceInstance = createBinanceService(options);
  return _serviceInstance;
}

/**
 * Resets the singleton (TEST USE ONLY).
 */
export function _resetBinanceService() {
  if (_serviceInstance) {
    _serviceInstance.destroy();
    _serviceInstance = null;
  }
}

/**
 * Creates a new Binance WebSocket service instance.
 * Internal; use getBinanceService() for production.
 */
export function createBinanceService(options = {}) {
  // In-memory observation cache keyed by assetId
  const cache = new Map(); // assetId → observation

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

  function getConnectionState() {
    return connectionState;
  }

  function setConnectionState(state) {
    connectionState = state;
  }

  /**
   * Handle an incoming miniTicker event array from Binance.
   * Each event: { e: '24hrMiniTicker', s: 'BTCUSDT', c: '67432.1', ... }
   */
  function handleMiniTickerArray(events) {
    if (!Array.isArray(events)) return;
    const now = Date.now();
    for (const event of events) {
      const binanceSymbol = event?.s;
      if (!binanceSymbol) continue;
      const assetId = BINANCE_SYMBOL_TO_ASSET_ID[binanceSymbol];
      if (!assetId) continue; // Not a mapped asset — skip

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
        // Currency policy: USDT is EXPLICITLY labelled, not silently cast to USD
        realtimeCurrency: 'USDT',
        price,
        rollingOpen,
        rollingHigh,
        rollingLow,
        // changeBasis is ROLLING_24H — NOT a previous session close
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

    // Anti-storm: enforce minimum interval between reconnect attempts
    const nowMs = Date.now();
    const msSinceLast = nowMs - lastReconnectAttemptMs;
    if (msSinceLast < RECONNECT_MIN_INTERVAL_MS && lastReconnectAttemptMs > 0) {
      const wait = RECONNECT_MIN_INTERVAL_MS - msSinceLast;
      reconnectTimer = setTimeout(connect, wait);
      return;
    }
    lastReconnectAttemptMs = nowMs;

    // Close any existing socket before creating a new one
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

    setConnectionState('CONNECTING');
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
      setConnectionState('CONNECTED');
      reconnectAttempt = 0;
      log('INFO', 'Connected to Binance !miniTicker@arr stream');
    };

    socket.onmessage = (event) => {
      if (destroyed || ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        // Binance sends the all-market ticker as a JSON array
        if (Array.isArray(data)) {
          handleMiniTickerArray(data);
        }
        // Ignore non-array frames (e.g. subscription confirmations, pong frames)
      } catch (err) {
        log('ERROR', 'Error parsing Binance WebSocket message', { message: err.message });
      }
    };

    socket.onerror = (err) => {
      if (destroyed || ws !== socket) return;
      log('ERROR', 'Binance WebSocket error', { message: err?.message });
      setConnectionState('RECONNECTING');
    };

    socket.onclose = (event) => {
      if (destroyed || ws !== socket) return;
      log('INFO', 'Binance WebSocket closed', { code: event?.code, reason: event?.reason });
      setConnectionState('RECONNECTING');
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
      setConnectionState('DISCONNECTED');
      // Reset attempts after a longer cooling period so future manual reconnects can work
      reconnectTimer = setTimeout(() => {
        reconnectAttempt = 0;
        if (!destroyed) connect();
      }, RECONNECT_MAX_MS * 2);
      return;
    }

    // Exponential backoff with full jitter
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

  /**
   * Returns the latest snapshot observation for an asset, or null if unavailable/expired.
   * @param {string} assetId - Canonical asset UUID
   * @param {Object} [options]
   * @param {number} [options.nowMs] - Current time for testing
   * @returns {Object|null}
   */
  function getSnapshot(assetId, opts = {}) {
    if (!isBinanceSupported(assetId)) return null;

    const obs = cache.get(assetId);
    if (!obs) return null;

    const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    const ageMs = nowMs - obs.cachedAtMs;

    // If connection is up, tolerate up to STALE_MS of no events (quiet market)
    // If connection is down, tolerate only FRESH_MS of age before returning null
    const maxAgeMs = connectionState === 'CONNECTED' ? BINANCE_STALE_MS : BINANCE_FRESH_MS;

    if (ageMs > maxAgeMs) return null;

    const freshness = ageMs <= BINANCE_FRESH_MS ? 'live' : 'stale';

    return {
      ...obs,
      freshness,
      connectionState
    };
  }

  /**
   * Tear down the service (test cleanup / server shutdown).
   */
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
    setConnectionState('DISCONNECTED');
    cache.clear();
  }

  // Start connecting unless disabled
  if (!disabled) {
    connect();
  }

  return Object.freeze({
    getSnapshot,
    isBinanceSupported,
    getConnectionState,
    destroy,
    // Expose for testing
    _handleMiniTickerArray: handleMiniTickerArray,
    _cache: cache
  });
}
