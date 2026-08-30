import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssetAnalysis } from '../src/analysis.js';
import { resolveProviderMapping } from '../src/assets.js';
import { calculatePortfolioValuation, getPortfolioOverview } from '../src/portfolio.js';
import { getMarketHistory, getMarketRealtime, getMarketSnapshot } from '../src/market.js';
import { BinanceHistoryCache, BINANCE_USDT_MAPPING } from '../src/providers/binance.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '20260830000000_feature_26a_hybrid_crypto_authority.sql'
);
const seedPath = path.join(repoRoot, 'server', 'db', 'seed.sql');
const appPath = path.join(repoRoot, 'client', 'src', 'App.jsx');
const analysisSectionPath = path.join(repoRoot, 'client', 'src', 'components', 'AssetAnalysisSection.jsx');

const BTC = Object.freeze({
  id: '1aca9503-acf1-4450-9b75-4f8935324398',
  symbol: 'BTC',
  name: 'Bitcoin',
  assetType: 'crypto',
  quoteCurrency: 'USD',
  marketPolicy: 'CONTINUOUS_24_7',
  marketTimezone: 'UTC',
  quantityUnit: 'coin',
  isActive: true
});

const APT = Object.freeze({
  id: 'd3c678a1-5801-4475-8025-aa80e5572bb1',
  symbol: 'APT',
  name: 'Aptos',
  assetType: 'crypto',
  quoteCurrency: 'USD',
  marketPolicy: 'CONTINUOUS_24_7',
  marketTimezone: 'UTC',
  quantityUnit: 'coin',
  isActive: true
});

const providerMappings = Object.freeze({
  BTC: Object.freeze({
    coingecko: { id: 'btc-cg', assetId: BTC.id, provider: 'coingecko', providerSymbol: 'bitcoin' },
    binance: { id: 'btc-binance', assetId: BTC.id, provider: 'binance', providerSymbol: 'BTCUSDT', providerMarket: 'SPOT' }
  }),
  APT: Object.freeze({
    coingecko: { id: 'apt-cg', assetId: APT.id, provider: 'coingecko', providerSymbol: 'aptos' },
    binance: { id: 'apt-binance', assetId: APT.id, provider: 'binance', providerSymbol: 'APTUSDT', providerMarket: 'SPOT' }
  })
});

function resolverOptions(asset) {
  return {
    getAssetBySymbolFn: async (symbol) => symbol === asset.symbol ? asset : null,
    getAssetProviderMappingFn: async (_assetId, provider) => providerMappings[asset.symbol][provider] || null
  };
}

function rawDailyKlines() {
  return Array.from({ length: 12 }, (_, index) => {
    const day = 18 + index;
    const open = 60000.125 + index * 100.25;
    return [
      Date.parse(`2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`),
      String(open),
      String(open + 250.5),
      String(open - 200.25),
      String(open + 100.125),
      String(1000.5 + index),
      0, 0, 0, 0, 0, '0'
    ];
  });
}

describe('Feature 26A.1 — hybrid Crypto quote authority', () => {
  it('routes Crypto valuation snapshots to CoinGecko and history/analysis to Binance', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const observedUrls = [];
    let wsRequestCount = 0;
    const cache = new BinanceHistoryCache();
    const fetchFn = async (url) => {
      observedUrls.push(url);
      if (url.includes('api.coingecko.com/api/v3/simple/price')) {
        return {
          ok: true,
          json: async () => ({
            bitcoin: {
              usd: 65000.123456,
              usd_24h_change: 1.25,
              usd_24h_vol: 123456789,
              last_updated_at: Date.parse('2026-08-30T09:59:00.000Z') / 1000
            }
          })
        };
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    };
    const wsApiClient = {
      requestKlines: async (symbol) => {
        wsRequestCount += 1;
        assert.equal(symbol, 'BTCUSDT');
        return rawDailyKlines();
      }
    };

    const providerResolverOptions = resolverOptions(BTC);
    const snapshot = await getMarketSnapshot('BTC', { fetchFn, providerResolverOptions });
    assert.equal(snapshot.provider, 'coingecko');
    assert.equal(snapshot.currency, 'USD');
    assert.equal(snapshot.quoteCurrency, 'USD');

    const history = await getMarketHistory('BTC', '1W', {
      now,
      wsApiClient,
      cache,
      providerResolverOptions
    });
    assert.equal(history.provider, 'binance');
    assert.equal(history.quoteCurrency, 'USDT');
    assert.equal(history.historyCapabilities.ohlc, true);
    assert.ok(history.bars.every((bar) => bar.isComplete && bar.open && bar.high && bar.low));

    const analysis = await getAssetAnalysis('BTC', {
      now,
      range: '1W',
      getMarketHistoryFn: (symbol, range, options) => getMarketHistory(symbol, range, {
        ...options,
        wsApiClient,
        cache,
        providerResolverOptions
      }),
      getMarketSnapshotFn: (symbol) => getMarketSnapshot(symbol, { fetchFn, providerResolverOptions })
    });
    assert.equal(analysis.methodologyVersion, 'v2');
    assert.equal(analysis.quoteCurrency, 'USDT');
    assert.equal(analysis.snapshot.currency, 'USD');
    assert.equal(analysis.snapshot.analysisEligible, false);
    assert.equal(analysis.periods['1W'].status, 'available');
    assert.equal(wsRequestCount, 1);
    assert.equal(observedUrls.some((url) => url.includes('/api/v3/klines')), false);
    assert.equal(observedUrls.some((url) => url.includes('/market_chart')), false);
  });

  it('resolves BTC and APT by capability without inferred provider symbols', async () => {
    for (const asset of [BTC, APT]) {
      const options = resolverOptions(asset);
      const snapshot = await resolveProviderMapping(asset.symbol, null, { ...options, capability: 'snapshot' });
      const history = await resolveProviderMapping(asset.symbol, null, { ...options, capability: 'history' });
      assert.equal(snapshot.mapping.provider, 'coingecko');
      assert.equal(history.mapping.provider, 'binance');
      assert.equal(history.mapping.providerSymbol, `${asset.symbol}USDT`);
    }

    await assert.rejects(
      () => resolveProviderMapping('APT', null, {
        ...resolverOptions(APT),
        capability: 'history',
        getAssetProviderMappingFn: async () => null
      }),
      (error) => error.code === 'UNSUPPORTED_PROVIDER'
    );
  });

  it('marks current VND conversion as approximate/reference-only and excludes it from accounting inputs', async () => {
    const realtime = await getMarketRealtime('BTC', {
      providerResolverOptions: resolverOptions(BTC),
      binanceService: {
        getSnapshot: () => ({
          price: 2.125,
          rollingOpen: 2,
          rollingHigh: 2.2,
          rollingLow: 1.9,
          baseVolume: 100,
          quoteVolume: 210,
          observedAt: '2026-08-30T10:00:00.000Z',
          freshness: 'live',
          connectionState: 'CONNECTED'
        })
      },
      getFxRateFn: async () => ({
        availability: 'available',
        rate: 25000.5,
        provider: 'controlled-usd-vnd',
        sourceTimestamp: '2026-08-30T09:59:00.000Z'
      })
    });

    assert.equal(realtime.currency, 'USDT');
    assert.equal(realtime.canonicalQuoteCurrency, 'USD');
    assert.equal(realtime.priceVndSemantics, 'APPROXIMATE_REFERENCE_ONLY');
    assert.equal(realtime.referenceVnd.approximate, true);
    assert.equal(realtime.referenceVnd.referenceOnly, true);
    assert.equal(realtime.referenceVnd.accountingEligible, false);
    assert.equal(realtime.referenceVnd.historicalEligible, false);
    assert.equal(realtime.referenceVnd.sourcePriceCurrency, 'USDT');

    const valuation = calculatePortfolioValuation(
      { cash_available: 0 },
      [{
        id: 'holding-btc',
        asset_id: BTC.id,
        quantity: 2,
        average_cost: 60000,
        asset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', quote_currency: 'USD' }
      }],
      { BTC: { price: 65000, currency: 'USD', priceVnd: realtime.priceVnd, referenceVnd: realtime.referenceVnd } },
      { USD: {
        baseCurrency: 'USD', quoteCurrency: 'VND', rate: 25000, provider: 'controlled-usd-vnd',
        sourceTimestamp: '2026-08-30T09:59:00.000Z', availability: 'available', freshness: 'current', reason: null
      } }
    );
    assert.equal(valuation.holdings[0].nativePrice, 65000);
    assert.equal(valuation.holdings[0].reportingMarketValue, 2 * 65000 * 25000);

    const fxRequests = [];
    const overview = await getPortfolioOverview({
      getCashOverviewFn: async () => ({ currentCash: 0 }),
      getHoldingsFn: async () => [{
        id: 'holding-btc',
        asset_id: BTC.id,
        quantity: 2,
        average_cost: 60000,
        asset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', quote_currency: 'USD' }
      }],
      getMarketSnapshotFn: async () => ({
        symbol: 'BTC',
        price: 65000,
        currency: 'USD',
        priceSource: 'coingecko_market_snapshot',
        priceVnd: realtime.priceVnd,
        referenceVnd: realtime.referenceVnd
      }),
      getFxRateFn: async (baseCurrency, quoteCurrency) => {
        fxRequests.push([baseCurrency, quoteCurrency]);
        return {
          baseCurrency: 'USD',
          quoteCurrency: 'VND',
          rate: 25000,
          provider: 'controlled-usd-vnd',
          sourceTimestamp: '2026-08-30T09:59:00.000Z',
          availability: 'available',
          freshness: 'current',
          reason: null
        };
      }
    });

    assert.deepEqual(fxRequests, [['USD', 'VND']]);
    assert.equal(overview.holdings[0].nativeCurrency, 'USD');
    assert.equal(overview.holdings[0].reportingCurrency, 'VND');
    assert.equal(overview.holdings[0].reportingMarketValue, 2 * 65000 * 25000);
    assert.notEqual(overview.holdings[0].reportingMarketValue, 2 * realtime.priceVnd);
  });

  it('migration preserves hybrid authority, guarded retirement, exact mappings, and universe counts', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const seed = fs.readFileSync(seedPath, 'utf8');

    assert.equal(Object.keys(BINANCE_USDT_MAPPING).length, 40);
    for (const [assetId, mapping] of Object.entries(BINANCE_USDT_MAPPING)) {
      assert.match(migration, new RegExp(`'${mapping.canonicalSymbol}', '${mapping.binanceSymbol}'`));
      assert.ok(migration.includes(assetId), `Migration must preserve/install UUID ${assetId}`);
      assert.match(seed, new RegExp(`'${mapping.canonicalSymbol}', '${mapping.binanceSymbol}'`));
    }

    for (const table of ['holdings', 'portfolio_transactions', 'position_opening_baselines', 'watchlist_items', 'price_alerts']) {
      assert.ok(migration.includes(`public.${table}`), `Retirement guard missing ${table}`);
    }
    for (const symbol of ['HYPE', 'RAIN', 'XMR', 'WBT', 'LIT']) {
      assert.match(migration, new RegExp(`DELETE[\\s\\S]*'${symbol}'`));
    }
    for (const [symbol, providerSymbol] of [
      ['APT', 'aptos'], ['ARB', 'arbitrum'],
      ['FET', 'fetch-ai'],
      ['INJ', 'injective-protocol'], ['FIL', 'filecoin']
    ]) {
      assert.match(migration, new RegExp(`'${symbol}', '${providerSymbol}'`));
      assert.match(
        seed,
        new RegExp(`'coingecko', '${providerSymbol}' FROM public\\.assets WHERE symbol = '${symbol}'`)
      );
    }

    assert.doesNotMatch(seed, /assets\.symbol\s*\|\|\s*'USDT'/);
    assert.match(migration, /quote_currency\s*=\s*'USD'/);
    assert.match(migration, /exactly 40 active Crypto assets/);
    assert.match(migration, /exactly 49 active investable assets/);
    assert.match(seed, /INSERT INTO public\.investor_profile/);
  });

  it('keeps provider and HTTP internals out of history and analysis error states', () => {
    const app = fs.readFileSync(appPath, 'utf8');
    const analysisSection = fs.readFileSync(analysisSectionPath, 'utf8');

    assert.match(app, /const HISTORY_UNAVAILABLE_MESSAGE = 'Dữ liệu lịch sử tạm thời chưa khả dụng\. Vui lòng thử lại sau\.';/);
    assert.match(app, /const ANALYSIS_UNAVAILABLE_MESSAGE = 'Phân tích tạm thời chưa khả dụng vì dữ liệu lịch sử chưa tải được\.';/);
    assert.match(app, /setHistoryError\(HISTORY_UNAVAILABLE_MESSAGE\)/);
    assert.match(app, /setAnalysisError\(ANALYSIS_UNAVAILABLE_MESSAGE\)/);
    assert.doesNotMatch(app, /setHistoryError\(err\.message/);
    assert.doesNotMatch(app, /setAnalysisError\(err\.message/);
    assert.match(app, /<span>\{historyError\}<\/span>/);
    assert.match(analysisSection, /<span>\{error\}<\/span>/);
  });

  it('renders the backend VND reference only when it is explicitly approximate and non-accounting', () => {
    const app = fs.readFileSync(appPath, 'utf8');

    assert.match(app, /const referenceVnd = isRealtime \? realtimeData\.referenceVnd : null/);
    assert.match(app, /referenceVnd\?\.approximate === true/);
    assert.match(app, /referenceVnd\?\.referenceOnly === true/);
    assert.match(app, /referenceVnd\?\.accountingEligible === false/);
    assert.match(app, /Number\.isFinite\(referenceVnd\.value\)/);
    assert.match(app, /formatNativeAmount\(referenceVnd\.value, 'VND'\)/);
    assert.match(app, /Giá tham chiếu · không dùng cho định giá danh mục/);
    assert.doesNotMatch(app, /referenceVnd\.value\s*=|priceVnd\s*=|displayData\.price\s*\*\s*reference/);
  });
});
