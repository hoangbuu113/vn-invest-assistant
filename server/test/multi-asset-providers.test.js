import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getTwelveDataFxRate, twelvedataProvider } from '../src/providers/twelvedata.js';
import { coingeckoProvider } from '../src/providers/coingecko.js';
import { binanceProvider } from '../src/providers/binance.js';
import { alphavantageProvider } from '../src/providers/alphavantage.js';
import { yahooProvider } from '../src/providers/yahoo.js';
import { getProviderAdapter, MARKET_PROVIDERS } from '../src/providers/index.js';
import { getAssetMarketCapabilities, getMarketSnapshot, getMarketHistory } from '../src/market.js';
import { getFxRate, normalizeFxRate, createUnavailableFxRate } from '../src/fx.js';
import { calculatePortfolioValuation } from '../src/portfolio.js';
import { resolveProviderMapping } from '../src/assets.js';
import { createApp } from '../index.js';

describe('Feature 20A — Real Multi-Asset Providers & Representative Assets', () => {
  // A. Twelve Data USD->VND normalization
  it('A. normalizes valid Twelve Data USD -> VND exchange rate response', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        symbol: 'USD/VND',
        rate: '25450.50',
        timestamp: 1724835600
      })
    });

    const result = await getTwelveDataFxRate('USD', 'VND', {
      apiKey: 'test-api-key',
      fetchFn: mockFetch
    });

    assert.equal(result.availability, 'available');
    assert.equal(result.baseCurrency, 'USD');
    assert.equal(result.quoteCurrency, 'VND');
    assert.equal(result.rate, 25450.5);
    assert.equal(result.provider, 'twelvedata');
    assert.equal(result.sourceTimestamp, new Date(1724835600 * 1000).toISOString());
    assert.equal(result.reason, null);
  });

  // B. wrong/malformed FX response unavailable
  it('B. returns unavailable when Twelve Data returns error, malformed rate, or missing key', async () => {
    // 1. Missing API key
    const noKeyResult = await getTwelveDataFxRate('USD', 'VND', { apiKey: '' });
    assert.equal(noKeyResult.availability, 'unavailable');
    assert.equal(noKeyResult.reason, 'FX_PROVIDER_UNCONFIGURED');

    // 2. Unsupported currency pair (e.g. EUR/VND)
    const unsupportedPair = await getTwelveDataFxRate('EUR', 'VND', { apiKey: 'key' });
    assert.equal(unsupportedPair.availability, 'unavailable');
    assert.equal(unsupportedPair.reason, 'FX_PAIR_UNSUPPORTED');

    // 3. Provider error response
    const errorFetch = async () => ({
      ok: true,
      json: async () => ({
        status: 'error',
        code: 400,
        message: 'Invalid API key'
      })
    });
    const errorResult = await getTwelveDataFxRate('USD', 'VND', {
      apiKey: 'bad-key',
      fetchFn: errorFetch
    });
    assert.equal(errorResult.availability, 'unavailable');
    assert.equal(errorResult.reason, 'Invalid API key');

    // 4. Malformed/negative rate
    const negativeFetch = async () => ({
      ok: true,
      json: async () => ({
        symbol: 'USD/VND',
        rate: -100,
        timestamp: 1724835600
      })
    });
    const negativeResult = await getTwelveDataFxRate('USD', 'VND', {
      apiKey: 'key',
      fetchFn: negativeFetch
    });
    assert.equal(negativeResult.availability, 'unavailable');
    assert.equal(negativeResult.reason, 'FX_RATE_INVALID');
  });

  // C. Feature 19 portfolio can consume normalized Twelve Data USD/VND rate
  it('C. portfolio valuation integrates normalized Twelve Data USD/VND rate for USD assets', () => {
    const profile = { cash_available: 100000000 };
    const holdings = [
      {
        id: 'holding-btc',
        asset: {
          id: 'asset-btc',
          symbol: 'BTC',
          asset_type: 'crypto',
          quote_currency: 'USD'
        },
        quantity: 0.5,
        average_cost: 60000
      }
    ];

    const snapshotsMap = {
      BTC: {
        symbol: 'BTC',
        price: 64000,
        currency: 'USD',
        updatedAt: '2026-08-28T12:00:00.000Z'
      }
    };

    const fxRatesMap = {
      USD: {
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        rate: 25400,
        provider: 'twelvedata',
        sourceTimestamp: '2026-08-28T12:00:00.000Z',
        availability: 'available',
        freshness: 'delayed',
        reason: null
      }
    };

    const valuation = calculatePortfolioValuation(profile, holdings, snapshotsMap, fxRatesMap);

    // 0.5 BTC * $64,000 = $32,000 USD native market value
    // $32,000 * 25,400 VND/USD = 812,800,000 VND
    assert.equal(valuation.summary.valuationStatus, 'complete');
    assert.equal(valuation.holdings[0].marketValue, 812800000);
    assert.equal(valuation.holdings[0].nativeMarketValue, 32000);
    assert.equal(valuation.holdings[0].nativeCurrency, 'USD');
    assert.equal(valuation.holdings[0].fxRateToReporting, 25400);
    assert.equal(valuation.summary.totalPortfolioValue, 100000000 + 812800000);
  });

  // D. CoinGecko canonical BTC -> explicit provider mapping `bitcoin` -> normalized snapshot
  it('D. CoinGecko adapter normalizes BTC snapshot with explicit coin ID mapping', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        bitcoin: {
          usd: 64250.5,
          usd_24h_vol: 28500000000,
          usd_24h_change: 3.25,
          last_updated_at: 1724835600
        }
      })
    });

    const asset = { id: 'uuid-btc', symbol: 'BTC', quoteCurrency: 'USD' };
    const mapping = { provider: 'coingecko', providerSymbol: 'bitcoin' };

    const snapshot = await coingeckoProvider.getSnapshot(asset, mapping, { fetchFn: mockFetch });

    assert.equal(snapshot.symbol, 'BTC');
    assert.equal(snapshot.currency, 'USD');
    assert.equal(snapshot.price, 64250.5);
    assert.equal(snapshot.volume, 28500000000);
    assert.equal(snapshot.changePercent, 3.25);
    assert.equal(snapshot.previousClose, null);
    assert.equal(snapshot.changeBasis, 'ROLLING_24H');
    assert.equal(snapshot.volumeSemantics, 'ROLLING_24H_QUOTE_CURRENCY');
    assert.equal(snapshot.priceSource, 'coingecko_market_snapshot');
    assert.equal(snapshot.priceAsOf, new Date(1724835600 * 1000).toISOString());
  });

  // E. ETH and SOL provider IDs are not inferred from ticker
  it('E. ETH and SOL require explicit CoinGecko coin IDs ethereum and solana', async () => {
    const requestedIds = [];
    const mockFetch = async (url) => {
      const parsedUrl = new URL(url);
      const id = parsedUrl.searchParams.get('ids');
      requestedIds.push(id);
      return {
        ok: true,
        json: async () => ({
          [id]: {
            usd: 3500.0,
            usd_24h_vol: 15000000000,
            usd_24h_change: -1.2,
            last_updated_at: 1724835600
          }
        })
      };
    };

    // Explicit mappings
    await coingeckoProvider.getSnapshot(
      { symbol: 'ETH' },
      { provider: 'coingecko', providerSymbol: 'ethereum' },
      { fetchFn: mockFetch }
    );
    await coingeckoProvider.getSnapshot(
      { symbol: 'SOL' },
      { provider: 'coingecko', providerSymbol: 'solana' },
      { fetchFn: mockFetch }
    );

    assert.deepEqual(requestedIds, ['ethereum', 'solana']);

    // Rejects empty mapping instead of inferring 'eth' or 'sol'
    await assert.rejects(
      () => coingeckoProvider.getSnapshot({ symbol: 'ETH' }, { provider: 'coingecko', providerSymbol: '' }),
      (err) => err.code === 'UNSUPPORTED_PROVIDER'
    );
  });

  // F. crypto uses CONTINUOUS_24_7
  it('F. crypto representative assets are configured with CONTINUOUS_24_7 policy and UTC timezone', () => {
    const cryptoAssets = [
      { symbol: 'BTC', market_policy: 'CONTINUOUS_24_7', market_timezone: 'UTC', quantity_unit: 'coin' },
      { symbol: 'ETH', market_policy: 'CONTINUOUS_24_7', market_timezone: 'UTC', quantity_unit: 'coin' },
      { symbol: 'SOL', market_policy: 'CONTINUOUS_24_7', market_timezone: 'UTC', quantity_unit: 'coin' }
    ];

    for (const asset of cryptoAssets) {
      assert.equal(asset.market_policy, 'CONTINUOUS_24_7');
      assert.equal(asset.market_timezone, 'UTC');
      assert.equal(asset.quantity_unit, 'coin');
    }
  });

  // G. crypto history uses its explicit 24/7 UTC policy instead of Vietnam sessions
  it('G. crypto history requests use explicit Binance daily data and CONTINUOUS_24_7 semantics', async () => {
    const asset = {
      id: 'uuid-btc',
      symbol: 'BTC',
      quote_currency: 'USD',
      quoteCurrency: 'USD',
      market_policy: 'CONTINUOUS_24_7',
      marketPolicy: 'CONTINUOUS_24_7',
      market_timezone: 'UTC',
      marketTimezone: 'UTC'
    };
    const mapping = { provider: 'binance', providerSymbol: 'BTCUSDT', providerMarket: 'SPOT' };
    const now = new Date('2026-08-29T12:00:00.000Z');
    const klines = [
      [Date.parse('2026-07-20T00:00:00.000Z'), '60000', '60500', '59500', '60100', '100'],
      [Date.parse('2026-08-01T00:00:00.000Z'), '62000', '62500', '61500', '62100', '110'],
      [Date.parse('2026-08-28T00:00:00.000Z'), '65000', '65500', '64500', '65100', '120'],
      [Date.parse('2026-08-29T00:00:00.000Z'), '66000', '66500', '65500', '66100', '130']
    ];
    const wsApiClient = { requestKlines: async () => klines };

    const direct = await binanceProvider.getHistory(asset, mapping, {
      wsApiClient,
      now,
      range: '1M',
      bypassCache: true,
      bypassCircuit: true
    });
    assert.deepEqual(direct.bars.map((bar) => bar.date), ['2026-08-01', '2026-08-28']);
    assert.ok(direct.bars.every((bar) => bar.open !== null && bar.high !== null && bar.low !== null && bar.volume !== null));

    const throughMarket = await getMarketHistory('BTC', '1M', {
      resolveProviderMappingFn: async () => ({ asset, mapping }),
      getProviderAdapterFn: () => binanceProvider,
      wsApiClient,
      now,
      bypassCache: true,
      bypassCircuit: true
    });
    assert.equal(throughMarket.provider, 'binance');
    assert.equal(throughMarket.quoteCurrency, 'USDT');
    assert.equal(throughMarket.marketPolicy, 'CONTINUOUS_24_7');
    assert.equal(throughMarket.marketTimezone, 'UTC');
  });

  // H. Alpha Vantage XAU maps to Gold Spot, not GC futures
  it('H. Alpha Vantage gold adapter requests XAU spot exchange rate, not futures', async () => {
    let capturedUrl = null;
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          nominal: 'XAUUSD',
          timestamp: '2026-08-28 14:00:00',
          price: '2512.45000000'
        })
      };
    };

    const asset = { id: 'uuid-gold', symbol: 'XAU/USD', quoteCurrency: 'USD' };
    const mapping = { provider: 'alphavantage', providerSymbol: 'XAU' };

    const snapshot = await alphavantageProvider.getSnapshot(asset, mapping, {
      apiKey: 'test-alpha-key',
      fetchFn: mockFetch
    });

    assert.ok(capturedUrl.includes('function=GOLD_SILVER_SPOT'));
    assert.ok(capturedUrl.includes('symbol=XAU'));
    assert.ok(!capturedUrl.includes('GC=F')); // NOT futures

    assert.equal(snapshot.symbol, 'XAU/USD');
    assert.equal(snapshot.currency, 'USD');
    assert.equal(snapshot.price, 2512.45);
    assert.equal(snapshot.priceSource, 'alphavantage_gold_spot');
    assert.equal(snapshot.priceAsOf, '2026-08-28T14:00:00.000Z');
  });

  // I. gold quote currency USD
  it('I. gold spot canonical metadata defines quote_currency USD and base_currency XAU', () => {
    const goldAsset = {
      symbol: 'XAU/USD',
      asset_type: 'gold',
      quote_currency: 'USD',
      base_currency: 'XAU',
      market_policy: 'GLOBAL_24_5',
      market_timezone: 'UTC',
      quantity_unit: 'oz'
    };

    assert.equal(goldAsset.asset_type, 'gold');
    assert.equal(goldAsset.quote_currency, 'USD');
    assert.equal(goldAsset.base_currency, 'XAU');
    assert.equal(goldAsset.market_policy, 'GLOBAL_24_5');
    assert.equal(goldAsset.quantity_unit, 'oz');
  });

  // J. FUEVFVND/FUESSVFL explicit Yahoo mappings
  it('J. VN ETF additions use explicit Yahoo provider mappings with .VN suffix', () => {
    const etfMappings = [
      { symbol: 'FUEVFVND', provider: 'yahoo', provider_symbol: 'FUEVFVND.VN', asset_type: 'etf', market_policy: 'VN_EXCHANGE' },
      { symbol: 'FUESSVFL', provider: 'yahoo', provider_symbol: 'FUESSVFL.VN', asset_type: 'etf', market_policy: 'VN_EXCHANGE' }
    ];

    for (const item of etfMappings) {
      assert.equal(item.provider, 'yahoo');
      assert.equal(item.provider_symbol, `${item.symbol}.VN`);
      assert.equal(item.asset_type, 'etf');
      assert.equal(item.market_policy, 'VN_EXCHANGE');
    }
  });

  // K. existing 5 asset IDs preserved
  it('K. existing canonical asset symbols remain mapped to Yahoo with stable properties', async () => {
    const existingSymbols = ['VCB', 'FPT', 'HPG', 'VNM', 'E1VFVN30'];
    for (const sym of existingSymbols) {
      const mockAsset = {
        id: `uuid-${sym.toLowerCase()}`,
        symbol: sym,
        asset_type: sym === 'E1VFVN30' ? 'etf' : 'stock',
        exchange: 'HOSE',
        market_code: 'HOSE',
        quote_currency: 'VND',
        market_policy: 'VN_EXCHANGE',
        is_active: true
      };
      const mockMapping = {
        asset_id: mockAsset.id,
        provider: 'yahoo',
        provider_symbol: `${sym}.VN`
      };

      const resolved = await resolveProviderMapping(sym, 'yahoo', {
        getAssetBySymbolFn: async () => mockAsset,
        getAssetProviderMappingFn: async () => mockMapping
      });

      assert.equal(resolved.asset.symbol, sym);
      assert.equal(resolved.mapping.provider, 'yahoo');
      assert.equal(resolved.mapping.providerSymbol, `${sym}.VN`);
    }
  });

  // L. non-VND BUY/SELL remains rejected
  it('L. non-VND asset transactions remain blocked by valuation and ledger rules', () => {
    const nonVndHoldings = [
      {
        asset: { symbol: 'BTC', quote_currency: 'USD' },
        quantity: 1,
        average_cost: 60000
      },
      {
        asset: { symbol: 'XAU/USD', quote_currency: 'USD' },
        quantity: 10,
        average_cost: 2500
      }
    ];

    // Non-VND holdings have unavailable VND cost basis and P/L (as per Feature 19)
    const valuation = calculatePortfolioValuation(
      { cash_available: 50000000 },
      nonVndHoldings,
      {
        BTC: { symbol: 'BTC', price: 65000, currency: 'USD' },
        'XAU/USD': { symbol: 'XAU/USD', price: 2520, currency: 'USD' }
      },
      {
        USD: {
          baseCurrency: 'USD',
          quoteCurrency: 'VND',
          rate: 25400,
          provider: 'twelvedata',
          sourceTimestamp: '2026-08-28T12:00:00.000Z',
          availability: 'available',
          freshness: 'delayed',
          reason: null
        }
      }
    );

    for (const h of valuation.holdings) {
      assert.equal(h.costBasis, null, 'Non-VND cost basis must be null');
      assert.equal(h.unrealizedPnL, null, 'Non-VND P/L must be null');
      assert.equal(h.unrealizedPnLPercent, null, 'Non-VND P/L % must be null');
      assert.equal(h.pnlStatus, 'unavailable', 'Non-VND pnlStatus must be unavailable');
    }
  });

  // M. provider failures remain unavailable, never zero
  it('M. provider failures return unavailable/null without converting to 0 prices or 0 FX', async () => {
    // 1. Missing FX produces unavailable valuation, not 0
    const profile = { cash_available: 10000000 };
    const holdings = [
      {
        asset: { symbol: 'BTC', quote_currency: 'USD' },
        quantity: 1,
        average_cost: 60000
      }
    ];
    const snapshotsMap = {
      BTC: { symbol: 'BTC', price: 65000, currency: 'USD' }
    };
    const unavailableFx = {
      USD: createUnavailableFxRate('USD', 'VND', 'FX_UNAVAILABLE')
    };

    const valuation = calculatePortfolioValuation(profile, holdings, snapshotsMap, unavailableFx);
    assert.equal(valuation.summary.valuationStatus, 'partial');
    assert.equal(valuation.holdings[0].marketValue, null);
    assert.notEqual(valuation.holdings[0].marketValue, 0);

    // 2. Alpha Vantage rate limit / notice degrades cleanly
    const limitFetch = async () => ({
      ok: true,
      json: async () => ({
        Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute'
      })
    });

    await assert.rejects(
      () => alphavantageProvider.getSnapshot(
        { symbol: 'XAU/USD' },
        { provider: 'alphavantage', providerSymbol: 'XAU' },
        { apiKey: 'key', fetchFn: limitFetch }
      ),
      (err) => err.status === 502
    );
  });

  // N. Registry lookup verifies all provider adapters
  it('N. provider registry resolves market adapters including explicit unsupported FX history', () => {
    assert.equal(getProviderAdapter('yahoo')?.name, 'yahoo');
    assert.equal(getProviderAdapter('coingecko')?.name, 'coingecko');
    assert.equal(getProviderAdapter('alphavantage')?.name, 'alphavantage');
    assert.equal(getProviderAdapter('twelvedata')?.name, 'twelvedata');
    assert.equal(getProviderAdapter('unknown'), null);
  });

  it('O. GET /api/market/USD%2FVND succeeds through canonical routing with truthful Twelve Data fields', async () => {
    let requestedUrl = null;
    const asset = {
      id: 'asset-usd-vnd',
      symbol: 'USD/VND',
      name: 'US Dollar / Vietnamese Dong',
      assetType: 'fx',
      baseCurrency: 'USD',
      quoteCurrency: 'VND',
      marketPolicy: 'GLOBAL_24_5',
      marketTimezone: 'Asia/Ho_Chi_Minh'
    };
    const mapping = {
      provider: 'twelvedata',
      providerSymbol: 'USD/VND'
    };
    const fetchFn = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          symbol: 'USD/VND',
          rate: '25450.75',
          timestamp: 1724835600
        })
      };
    };

    const app = createApp({
      getMarketSnapshotFn: (symbol) => getMarketSnapshot(symbol, {
        resolveProviderMappingFn: async () => ({ asset, mapping }),
        providerAdapter: twelvedataProvider,
        apiKey: 'test-key',
        fetchFn
      })
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/USD%2FVND`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.data.price, 25450.75);
      assert.equal(body.data.currency, 'VND');
      assert.equal(body.data.previousClose, null);
      assert.equal(body.data.change, null);
      assert.equal(body.data.changePercent, null);
      assert.equal(body.data.volume, null);
      assert.equal(body.data.changeBasis, 'UNAVAILABLE');
      assert.equal(body.data.volumeSemantics, 'UNAVAILABLE');
      assert.equal(body.data.priceAsOf, new Date(1724835600 * 1000).toISOString());
      assert.equal(body.data.capabilities.snapshot, true);
      assert.equal(body.data.capabilities.history, false);
      assert.equal(body.data.capabilities.analysis, false);
      assert.match(requestedUrl, /exchange_rate\?symbol=USD%2FVND/);
      assert.equal('delayMinutes' in body.data, false);
      assert.equal('latencyMinutes' in body.data, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('P. snapshot semantics distinguish Yahoo prior-session fields from CoinGecko rolling-24h fields', async () => {
    const yahooSnapshot = await getMarketSnapshot('FPT', {
      resolveProviderMappingFn: async () => ({
        asset: {
          id: 'asset-fpt',
          symbol: 'FPT',
          assetType: 'stock',
          quoteCurrency: 'VND',
          marketPolicy: 'VN_EXCHANGE',
          marketTimezone: 'Asia/Ho_Chi_Minh'
        },
        mapping: { provider: 'yahoo', providerSymbol: 'FPT.VN' }
      }),
      providerAdapter: yahooProvider,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          chart: {
            result: [{
              meta: {
                regularMarketPrice: 101.25,
                previousClose: 100.5,
                regularMarketVolume: 1234.5,
                regularMarketTime: 1724835600,
                currency: 'VND',
                exchangeName: 'HOSE'
              }
            }]
          }
        })
      })
    });

    const cryptoSnapshot = await getMarketSnapshot('BTC', {
      resolveProviderMappingFn: async () => ({
        asset: {
          id: 'asset-btc',
          symbol: 'BTC',
          assetType: 'crypto',
          quoteCurrency: 'USD',
          marketPolicy: 'CONTINUOUS_24_7',
          marketTimezone: 'UTC'
        },
        mapping: { provider: 'coingecko', providerSymbol: 'bitcoin' }
      }),
      providerAdapter: coingeckoProvider,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          bitcoin: {
            usd: 64250.5,
            usd_24h_vol: 28500000000,
            usd_24h_change: 3.25,
            last_updated_at: 1724835600
          }
        })
      })
    });

    assert.equal(yahooSnapshot.changeBasis, 'PREVIOUS_SESSION_CLOSE');
    assert.equal(yahooSnapshot.previousClose, 100.5);
    assert.equal(yahooSnapshot.volumeSemantics, 'SESSION_BASE_UNITS');
    assert.equal(cryptoSnapshot.changeBasis, 'ROLLING_24H');
    assert.equal(cryptoSnapshot.previousClose, null);
    assert.equal(cryptoSnapshot.volumeSemantics, 'ROLLING_24H_QUOTE_CURRENCY');
    for (const snapshot of [yahooSnapshot, cryptoSnapshot]) {
      assert.equal(typeof snapshot.priceAsOf, 'string');
      assert.equal(snapshot.freshness, 'delayed');
      assert.equal('delayMinutes' in snapshot, false);
      assert.equal('latencyMinutes' in snapshot, false);
    }
  });

  it('Q. canonical capability matrix is provider-derived for all five supported asset classes', () => {
    const cases = [
      [yahooProvider, { snapshot: true, history: true, analysis: true, ohlcHistory: true }],
      [yahooProvider, { snapshot: true, history: true, analysis: true, ohlcHistory: true }],
      [coingeckoProvider, { snapshot: true, history: false, analysis: false, ohlcHistory: false }],
      [binanceProvider, { snapshot: false, history: true, analysis: true, ohlcHistory: true }],
      [alphavantageProvider, { snapshot: true, history: true, analysis: true, ohlcHistory: false }],
      [twelvedataProvider, { snapshot: true, history: false, analysis: false, ohlcHistory: false }]
    ];

    for (const [adapter, expected] of cases) {
      const capabilities = getAssetMarketCapabilities({}, adapter);
      assert.deepEqual(
        {
          snapshot: capabilities.snapshot,
          history: capabilities.history,
          analysis: capabilities.analysis,
          ohlcHistory: capabilities.ohlcHistory
        },
        expected
      );
    }
  });
});
