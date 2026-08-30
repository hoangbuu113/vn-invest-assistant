import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BINANCE_USDT_MAPPING,
  isBinanceSupported,
  createBinanceService,
  _resetBinanceService
} from '../src/providers/binance.js';

import { getMarketSnapshot, getMarketRealtime } from '../src/market.js';
import { coingeckoProvider } from '../src/providers/coingecko.js';

// ---------------------------------------------------------------------------
// Canonical UUIDs for the 40 crypto assets (from Feature 20B migration)
// ---------------------------------------------------------------------------
const EXISTING_CRYPTO = [
  { symbol: 'BTC', id: '1aca9503-acf1-4450-9b75-4f8935324398' },
  { symbol: 'ETH', id: '66f2e0e6-e375-4693-8f9d-ea423f47e751' },
  { symbol: 'SOL', id: '8ea1c52b-a999-4d1e-8b02-f8e7e8042118' }
];

const NEW_CRYPTO = [
  { symbol: 'BNB',   id: '66c7d650-f440-4e84-9469-ce0d070ede6b' },
  { symbol: 'XRP',   id: '4bebf6d3-cf96-4a88-8474-d4a4e706989a' },
  { symbol: 'TRX',   id: 'bdf8e845-dfe3-45a1-b852-642a0b886b7d' },
  { symbol: 'ZEC',   id: 'a9cdfcc6-1518-4087-bbcd-8ac4704474a4' },
  { symbol: 'DOGE',  id: '44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54' },
  { symbol: 'LINK',  id: 'c2534c6b-9eb5-4a78-b93f-969bb8f7df65' },
  { symbol: 'ADA',   id: '5af019d9-3cc5-4904-8cd1-25389feec501' },
  { symbol: 'XLM',   id: '5b3bea95-edd8-4a89-918b-d8c3b0156399' },
  { symbol: 'BCH',   id: '11a31ef1-568f-4c10-8a13-5007e7d57a5b' },
  { symbol: 'GRAM',  id: '04c0ebd5-d104-4b82-a447-16a3903ec01c' },
  { symbol: 'LTC',   id: '4cb6998d-3364-4734-ad73-d62ac3f47aff' },
  { symbol: 'HBAR',  id: 'c3825936-a57f-4361-a4e5-9d7cd96d284c' },
  { symbol: 'AVAX',  id: 'b0785af1-75d1-4fa3-99c1-d56985dfbade' },
  { symbol: 'SHIB',  id: 'bdc8770f-7311-4621-9067-3c61b907238b' },
  { symbol: 'SUI',   id: '81590371-79ba-44c3-8f48-31b86d53c3e3' },
  { symbol: 'UNI',   id: '79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3' },
  { symbol: 'NEAR',  id: '73b6f9b9-3b85-4c25-b1bf-6a34b4f18946' },
  { symbol: 'TAO',   id: '9ec01b5e-84c9-46b7-899a-772425d334af' },
  { symbol: 'PUMP',  id: 'c632abb3-22eb-49ea-ae63-c742c56f091f' },
  { symbol: 'AAVE',  id: 'cc4c6bb6-3d5c-487e-961c-80a2eb89585c' },
  { symbol: 'ASTER', id: '9841e6e5-a8ff-4e71-b034-e7a4de3d6ded' },
  { symbol: 'WLFI',  id: '927dc869-7204-4d87-b744-fd6a03fc8c99' },
  { symbol: 'ONDO',  id: 'afa7bb4c-283a-4686-a570-c591b12cef66' },
  { symbol: 'ENA',   id: 'f8a74dcd-71f6-42d1-a3e7-2e6208cba86c' },
  { symbol: 'MORPHO',id: 'b7abf464-981b-47c6-b587-1ac61cfe9e0e' },
  { symbol: 'PEPE',  id: '821eace1-4edc-4d91-a2b3-a43e51ff49b7' },
  { symbol: 'DOT',   id: 'e7c6ef68-a92f-4735-9d8b-aa3e7767f11f' },
  { symbol: 'WLD',   id: '4635d9d6-f30f-4dd4-9632-67873ce5e3b1' },
  { symbol: 'ETC',   id: 'd9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7' },
  { symbol: 'POL',   id: '22deaafe-2849-4c75-980c-c0c8e3b42bc9' },
  { symbol: 'ATOM',  id: '9c8f9012-9973-406e-89a3-6350f095b59b' },
  { symbol: 'JUP',   id: '871267a7-954b-4d39-8299-3c0299fe8be8' },
  { symbol: 'APT',   id: 'd3c678a1-5801-4475-8025-aa80e5572bb1' },
  { symbol: 'ARB',   id: 'b6e3f422-9214-4a27-a169-d75fa6319c52' },
  { symbol: 'FET',   id: 'c5a89233-1498-4d62-97ec-08e62d471e43' },
  { symbol: 'INJ',   id: 'e9712a44-f655-4683-9b88-51829e1db874' },
  { symbol: 'FIL',   id: 'a8471b55-e7d9-4820-b0c3-f26e3c15aa65' }
];

const ALL_CRYPTO = [...EXISTING_CRYPTO, ...NEW_CRYPTO];

// Non-crypto or retired assets NOT in Binance 40
const NON_BINANCE_ASSETS = [
  { symbol: 'HYPE', id: '40bd9c87-9fdb-47d2-962d-96df16f58c00' },
  { symbol: 'RAIN', id: '98736587-f37d-42a9-9c22-237dbf82187f' },
  { symbol: 'XMR',  id: 'f80f1162-2b13-4b2b-84dc-e208fc3fbedc' },
  { symbol: 'WBT',  id: '8f755ede-0630-4055-aef5-84ecc2512c59' },
  { symbol: 'LIT',  id: 'f64d16cc-1bce-4f81-a64b-e5acbbe1a07e' }
];

class MockWebSocket {
  constructor() {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  close() {}
}

function makeDisabledService() {
  return createBinanceService({ disabled: true, silent: true });
}

describe('Feature 24A — Binance Realtime & Canonical Separation', () => {

  // ---------------------------------------------------------------------------
  // A. Mapping completeness
  // ---------------------------------------------------------------------------
  it('A. BINANCE_USDT_MAPPING contains exactly 40 entries with valid UUID keys', () => {
    assert.equal(Object.keys(BINANCE_USDT_MAPPING).length, 40);
    for (const assetId of Object.keys(BINANCE_USDT_MAPPING)) {
      assert.match(assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('A2. all 40 mapping UUIDs exist in canonical crypto universe', () => {
    const allIds = new Set(ALL_CRYPTO.map(a => a.id));
    for (const assetId of Object.keys(BINANCE_USDT_MAPPING)) {
      assert.ok(allIds.has(assetId), `Mapping UUID ${assetId} not in canonical universe`);
    }
  });

  it('A3. all 40 mapped assets correspond to the correct canonicalSymbol', () => {
    const idToSymbol = new Map(ALL_CRYPTO.map(a => [a.id, a.symbol]));
    for (const [assetId, entry] of Object.entries(BINANCE_USDT_MAPPING)) {
      const expected = idToSymbol.get(assetId);
      assert.equal(entry.canonicalSymbol, expected);
    }
  });

  // ---------------------------------------------------------------------------
  // B. Unsupported assets
  // ---------------------------------------------------------------------------
  it('B. HYPE, RAIN, XMR, WBT, LIT are NOT in Binance Spot universe', () => {
    for (const { symbol, id } of NON_BINANCE_ASSETS) {
      assert.equal(isBinanceSupported(id), false, `${symbol} should not be Binance supported`);
      assert.ok(!Object.prototype.hasOwnProperty.call(BINANCE_USDT_MAPPING, id));
    }
  });

  it('B2. isBinanceSupported returns false for non-crypto assets (VN stocks, Gold, FX)', () => {
    const nonCryptoIds = [
      '039f6974-626b-4145-ab57-b19f91bac2ca', // VCB
      '9f0ffc4f-950f-4125-94b0-d5911cdfaad7', // XAU/USD
      '557ba9ab-fca8-44ff-a230-4166796e3d62'  // USD/VND
    ];
    for (const id of nonCryptoIds) {
      assert.equal(isBinanceSupported(id), false);
    }
  });

  // ---------------------------------------------------------------------------
  // C. One service covers all 40 mapped assets
  // ---------------------------------------------------------------------------
  it('C. one service instance handles all 40 supported assets', () => {
    const svc = makeDisabledService();
    let count = 0;
    for (const assetId of Object.keys(BINANCE_USDT_MAPPING)) {
      if (svc.isBinanceSupported(assetId)) count++;
    }
    assert.equal(count, 40);
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // D. miniTicker event routing
  // ---------------------------------------------------------------------------
  it('D. BTCUSDT miniTicker event maps to BTC assetId and stores observation', () => {
    const svc = makeDisabledService();
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const eventMs = 1788000000000;

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker',
      s: 'BTCUSDT',
      c: '67432.1',
      o: '66000.0',
      h: '68000.0',
      l: '65500.0',
      v: '12345.678',
      q: '830000000',
      E: eventMs
    }]);

    const obs = svc.getSnapshot(btcId, { nowMs: eventMs + 1000 });
    assert.ok(obs !== null);
    assert.equal(obs.assetId, btcId);
    assert.equal(obs.symbol, 'BTC');
    assert.equal(obs.binanceSymbol, 'BTCUSDT');
    assert.equal(obs.realtimeCurrency, 'USDT');
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // E. Price precision
  // ---------------------------------------------------------------------------
  it('E. price is stored with full floating-point precision (not rounded)', () => {
    const svc = makeDisabledService();
    const ethId = '66f2e0e6-e375-4693-8f9d-ea423f47e751';
    const precisePrice = '3247.123456789';

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker',
      s: 'ETHUSDT',
      c: precisePrice,
      o: '3200.0',
      h: '3300.0',
      l: '3150.0',
      v: '5000',
      q: '16000000',
      E: Date.now()
    }]);

    const obs = svc.getSnapshot(ethId, { nowMs: Date.now() + 100 });
    assert.ok(obs !== null);
    assert.equal(obs.price, Number(precisePrice));
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // F. Rolling 24h semantics
  // ---------------------------------------------------------------------------
  it('F. Binance snapshot uses changeBasis ROLLING_24H, not PREVIOUS_SESSION_CLOSE', () => {
    const svc = makeDisabledService();
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const nowMs = Date.now();

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker', s: 'BTCUSDT',
      c: '67432.1', o: '66000.0', h: '68000.0', l: '65500.0',
      v: '12345', q: '830000000', E: nowMs
    }]);

    const obs = svc.getSnapshot(btcId, { nowMs: nowMs + 100 });
    assert.equal(obs.changeBasis, 'ROLLING_24H');
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // G. No previousClose fabrication
  // ---------------------------------------------------------------------------
  it('G. Binance observation does not fabricate previousClose', () => {
    const svc = makeDisabledService();
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const nowMs = Date.now();

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker', s: 'BTCUSDT',
      c: '67432.1', o: '66000.0', h: '68000.0', l: '65500.0',
      v: '12345', q: '830000000', E: nowMs
    }]);

    const obs = svc.getSnapshot(btcId, { nowMs: nowMs + 100 });
    assert.ok(!Object.prototype.hasOwnProperty.call(obs, 'previousClose'));
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // H. Dedicated Realtime Endpoint Contract (referenceOnly: true, currency: USDT)
  // ---------------------------------------------------------------------------
  it('H. getMarketRealtime returns dedicated USDT reference with referenceOnly: true', async () => {
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const nowMs = Date.now();
    const svc = makeDisabledService();

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker', s: 'BTCUSDT',
      c: '67432.1', o: '66000.0', h: '68000.0', l: '65500.0',
      v: '12345', q: '830000000', E: nowMs
    }]);

    const realtime = await getMarketRealtime('BTC', {
      binanceService: svc,
      resolveProviderMappingFn: async () => ({
        asset: {
          id: btcId, symbol: 'BTC', assetType: 'crypto',
          quoteCurrency: 'USD', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC'
        },
        mapping: { provider: 'coingecko', provider_symbol: 'bitcoin' }
      })
    });

    assert.equal(realtime.symbol, 'BTC');
    assert.equal(realtime.price, 67432.1);
    assert.equal(realtime.currency, 'USDT');
    assert.equal(realtime.canonicalQuoteCurrency, 'USD');
    assert.equal(realtime.referenceOnly, true);
    assert.equal(realtime.priceSource, 'binance_websocket');
    assert.equal(realtime.changeBasis, 'ROLLING_24H');
    assert.equal(realtime.change, 67432.1 - 66000.0);
    assert.equal(realtime.dayHigh, 68000.0);
    assert.equal(realtime.dayLow, 65500.0);
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // I. Canonical Snapshot Invariant (ALWAYS CoinGecko USD, NEVER Binance USDT)
  // ---------------------------------------------------------------------------
  it('I. getMarketSnapshot for Crypto ALWAYS returns canonical CoinGecko USD snapshot', async () => {
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    let coinGeckoCalled = false;

    const mockCoinGeckoAdapter = {
      capabilities: { snapshot: true, history: true, analysis: true, ohlcHistory: false, snapshotChangeBasis: 'ROLLING_24H' },
      getSnapshot: async () => {
        coinGeckoCalled = true;
        return {
          symbol: 'BTC',
          currency: 'USD',
          exchange: null,
          price: 65000,
          previousClose: null,
          change: 1000,
          changePercent: 1.56,
          dayHigh: null,
          dayLow: null,
          volume: 1000000,
          updatedAt: new Date().toISOString(),
          priceAsOf: new Date().toISOString(),
          priceSource: 'coingecko_market_snapshot',
          freshness: 'delayed',
          changeBasis: 'ROLLING_24H',
          volumeSemantics: 'ROLLING_24H_QUOTE_CURRENCY'
        };
      }
    };

    const snapshot = await getMarketSnapshot('BTC', {
      resolveProviderMappingFn: async () => ({
        asset: {
          id: btcId, symbol: 'BTC', assetType: 'crypto',
          quoteCurrency: 'USD', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC'
        },
        mapping: { provider: 'coingecko', provider_symbol: 'bitcoin' }
      }),
      providerAdapter: mockCoinGeckoAdapter
    });

    assert.ok(coinGeckoCalled, 'CoinGecko adapter must be called');
    assert.equal(snapshot.currency, 'USD', 'Canonical currency must be USD');
    assert.equal(snapshot.priceSource, 'coingecko_market_snapshot');
    assert.notEqual(snapshot.priceSource, 'binance_websocket', 'Canonical snapshot must not be Binance');
  });

  // ---------------------------------------------------------------------------
  // J. Valuation & Analysis Isolation
  // ---------------------------------------------------------------------------
  it('J. getMarketRealtime throws 404 REALTIME_UNSUPPORTED for non-crypto or unsupported crypto', async () => {
    // Non-crypto (FPT)
    await assert.rejects(
      () => getMarketRealtime('FPT', {
        resolveProviderMappingFn: async () => ({
          asset: { id: 'some-id', symbol: 'FPT', marketPolicy: 'VN_EXCHANGE' }
        })
      }),
      (err) => err.code === 'REALTIME_UNSUPPORTED' && err.status === 404
    );

    // Unsupported crypto (HYPE)
    await assert.rejects(
      () => getMarketRealtime('HYPE', {
        resolveProviderMappingFn: async () => ({
          asset: { id: '40bd9c87-9fdb-47d2-962d-96df16f58c00', symbol: 'HYPE', marketPolicy: 'CONTINUOUS_24_7' }
        })
      }),
      (err) => err.code === 'REALTIME_UNSUPPORTED' && err.status === 404
    );
  });

  it('J2. getMarketRealtime throws 404 REALTIME_UNAVAILABLE when Binance cache is empty', async () => {
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const emptySvc = makeDisabledService();

    await assert.rejects(
      () => getMarketRealtime('BTC', {
        binanceService: emptySvc,
        resolveProviderMappingFn: async () => ({
          asset: { id: btcId, symbol: 'BTC', marketPolicy: 'CONTINUOUS_24_7' }
        })
      }),
      (err) => err.code === 'REALTIME_UNAVAILABLE' && err.status === 404
    );
    emptySvc.destroy();
  });

  // ---------------------------------------------------------------------------
  // K. Shared WebSocket & No Duplicate Connections
  // ---------------------------------------------------------------------------
  it('K. createBinanceService produces one distinct instance with clean lifecycle', () => {
    const svc1 = makeDisabledService();
    const svc2 = makeDisabledService();
    assert.ok(svc1 !== svc2);
    svc1.destroy();
    svc2.destroy();
  });

  // ---------------------------------------------------------------------------
  // L. No live Binance calls in default tests
  // ---------------------------------------------------------------------------
  it('L. disabled service creates zero network sockets', () => {
    let socketCount = 0;
    class SpySocket {
      constructor() { socketCount++; }
      close() {}
    }
    const svc = createBinanceService({ disabled: true, WebSocket: SpySocket, silent: true });
    assert.equal(socketCount, 0);
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // M. No DB writes
  // ---------------------------------------------------------------------------
  it('M. Binance provider exposes zero database write methods', () => {
    const svc = makeDisabledService();
    const keys = Object.keys(svc);
    for (const forbidden of ['insert', 'update', 'delete', 'upsert', 'write', 'save', 'mutate']) {
      assert.ok(!keys.includes(forbidden));
    }
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // N. Unique binanceSymbol values in mapping
  // ---------------------------------------------------------------------------
  it('N. all 40 mapping entries have unique binanceSymbol values', () => {
    const symbols = Object.values(BINANCE_USDT_MAPPING).map(e => e.binanceSymbol);
    assert.equal(new Set(symbols).size, 40);
  });

  // ---------------------------------------------------------------------------
  // O. CoinGecko 1Y 366-day leap year multi-chunk support
  // ---------------------------------------------------------------------------
  it('O. CoinGecko 1Y history on a 366-day leap year window fetches in legal chunks <= 365 days', async () => {
    // 2025-02-28 looking back 1 calendar year = 2024-02-28 (spans 366 days because 2024 was a leap year)
    const now = new Date('2025-02-28T12:00:00.000Z');
    const requestedUrls = [];

    const history = await coingeckoProvider.getHistory(
      {
        id: '1aca9503-acf1-4450-9b75-4f8935324398',
        symbol: 'BTC',
        assetType: 'crypto',
        quoteCurrency: 'USD',
        marketPolicy: 'CONTINUOUS_24_7',
        marketTimezone: 'UTC'
      },
      { provider: 'coingecko', providerSymbol: 'bitcoin' },
      {
        now,
        range: '1Y',
        fetchFn: async (url) => {
          requestedUrls.push(new URL(url));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              prices: [
                [Date.parse('2024-02-28T00:00:00.000Z'), 60000],
                [Date.parse('2025-02-20T00:00:00.000Z'), 90000],
                [Date.parse('2025-02-27T00:00:00.000Z'), 91000]
              ],
              market_caps: [],
              total_volumes: []
            })
          };
        }
      }
    );

    // Verify chunking: each chunk must span <= 365 days
    assert.ok(requestedUrls.length >= 1, 'At least one request chunk');
    for (const reqUrl of requestedUrls) {
      const from = Number(reqUrl.searchParams.get('from'));
      const to = Number(reqUrl.searchParams.get('to'));
      assert.ok(to - from <= 365 * 86400 + 1, `Chunk span ${to - from}s exceeds 365 days`);
    }

    assert.equal(history.provider, 'coingecko');
    assert.equal(history.range, '1Y');
    assert.ok(history.bars.length >= 2);
  });

  // ---------------------------------------------------------------------------
  // P. Expired observation returns null
  // ---------------------------------------------------------------------------
  it('P. expired observation (> STALE_MS when DISCONNECTED) returns null', () => {
    const svc = makeDisabledService();
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const oldMs = Date.now() - 200_000;

    svc._handleMiniTickerArray([{
      e: '24hrMiniTicker', s: 'BTCUSDT',
      c: '67432.1', o: '66000.0', h: '68000.0', l: '65500.0',
      v: '12345', q: '830000000', E: oldMs
    }]);

    const obs = svc.getSnapshot(btcId, { nowMs: oldMs + 200_000 });
    assert.equal(obs, null);
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // Q. Unknown symbols and invalid prices are safely ignored
  // ---------------------------------------------------------------------------
  it('Q. unknown binance symbols and invalid prices are ignored without crash', () => {
    const svc = makeDisabledService();

    svc._handleMiniTickerArray([
      { e: '24hrMiniTicker', s: 'UNMAPPED123USDT', c: '10.0', o: '9.0', h: '11.0', l: '8.0', v: '1', q: '10', E: Date.now() },
      { e: '24hrMiniTicker', s: 'BTCUSDT', c: 'not-a-number', o: '66000', h: '68000', l: '65500', v: '1', q: '10', E: Date.now() }
    ]);

    assert.equal(svc._cache.size, 0);
    svc.destroy();
  });

  // ---------------------------------------------------------------------------
  // R. Portfolio / Watchlist / Alerts / Analysis Consumer Boundary Invariants
  // ---------------------------------------------------------------------------
  it('R. portfolio valuation receives canonical CoinGecko USD price and never Binance USDT reference', async () => {
    const { getPortfolioOverview } = await import('../src/portfolio.js');
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';

    // Mock holdings with 1 BTC
    const mockHoldings = [
      {
        id: 'h-1',
        asset_id: btcId,
        quantity: 1,
        average_buy_price: 50000,
        asset: { id: btcId, symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', quote_currency: 'USD' }
      }
    ];

    let snapshotProvider = null;
    const mockGetMarketSnapshot = async (symbol) => {
      snapshotProvider = 'coingecko';
      return {
        symbol: 'BTC',
        currency: 'USD',
        quoteCurrency: 'USD',
        price: 65000,
        priceSource: 'coingecko_market_snapshot'
      };
    };

    const mockGetFxRate = async () => ({
      baseCurrency: 'USD',
      quoteCurrency: 'VND',
      rate: 25000,
      availability: 'available',
      sourceTimestamp: '2026-08-29T12:00:00.000Z',
      freshness: 'current',
      provider: 'twelvedata'
    });
    const mockGetCashOverview = async () => ({ currentCash: 0 });

    const overview = await getPortfolioOverview({
      getHoldingsFn: async () => mockHoldings,
      getMarketSnapshotFn: mockGetMarketSnapshot,
      getFxRateFn: mockGetFxRate,
      getCashOverviewFn: mockGetCashOverview
    });

    assert.equal(snapshotProvider, 'coingecko', 'Portfolio valuation must use CoinGecko canonical snapshot');
    assert.equal(overview.summary.totalMarketValue, 65000 * 25000, 'Valuation computed from canonical USD price');
  });

  // ---------------------------------------------------------------------------
  // S. HTTP Route GET /api/market/:symbol/realtime integration
  // ---------------------------------------------------------------------------
  it('S. createApp mounts GET /api/market/:symbol/realtime correctly', async () => {
    const { createApp } = await import('../index.js');
    const btcId = '1aca9503-acf1-4450-9b75-4f8935324398';

    const mockRealtimeFn = async (sym) => ({
      assetId: btcId,
      symbol: sym,
      price: 67432.1,
      currency: 'USDT',
      canonicalQuoteCurrency: 'USD',
      referenceOnly: true,
      priceSource: 'binance_websocket'
    });

    const app = createApp({
      getMarketRealtimeFn: mockRealtimeFn
    });

    // Test with mock req/res
    let responseStatus = null;
    let responseJson = null;

    const req = { params: { symbol: 'BTC' } };
    const res = {
      status: (code) => { responseStatus = code; return res; },
      json: (data) => { responseJson = data; return res; }
    };

    // Find the handler for /api/market/:symbol/realtime
    const route = app._router.stack.find(
      (layer) => layer.route && layer.route.path === '/api/market/:symbol/realtime'
    );
    assert.ok(route, 'Route /api/market/:symbol/realtime must be registered');

    await route.route.stack[0].handle(req, res);

    assert.equal(responseJson.status, 'ok');
    assert.equal(responseJson.data.symbol, 'BTC');
    assert.equal(responseJson.data.price, 67432.1);
    assert.equal(responseJson.data.currency, 'USDT');
    assert.equal(responseJson.data.referenceOnly, true);
  });
});

