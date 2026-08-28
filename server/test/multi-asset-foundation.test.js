import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeAsset,
  resolveProviderMapping
} from '../src/assets.js';
import { getMarketHistory, getMarketSnapshot } from '../src/market.js';
import {
  getAssetBySymbol,
  getAssetProviderMapping,
  getAssets
} from '../src/supabase.js';

const FPT_ID = '34ad7d87-9065-4111-b38d-ebc92c4a74dd';
const ETF_ID = '039f6974-626b-4145-ab57-b19f91bac2ca';

function assetFixture(overrides = {}) {
  return {
    id: FPT_ID,
    symbol: 'FPT',
    name: 'FPT Corporation',
    asset_type: 'stock',
    exchange: 'HOSE',
    market_code: 'HOSE',
    quote_currency: 'VND',
    base_currency: null,
    market_policy: 'VN_EXCHANGE',
    market_timezone: 'Asia/Ho_Chi_Minh',
    quantity_unit: 'share',
    is_active: true,
    created_at: '2026-08-27T07:37:40.05645+00:00',
    ...overrides
  };
}

function yahooMapping(assetId = FPT_ID, providerSymbol = 'FPT.VN') {
  return {
    id: 'mapping-fpt-yahoo',
    asset_id: assetId,
    provider: 'yahoo',
    provider_symbol: providerSymbol,
    provider_market: null,
    created_at: '2026-08-28T00:00:00.000Z'
  };
}

function snapshotResponse() {
  return {
    ok: true,
    json: async () => ({
      chart: {
        result: [{
          meta: {
            regularMarketPrice: 72200,
            previousClose: 71000,
            regularMarketTime: 1787191200,
            currency: 'VND',
            exchangeName: 'HOSE'
          }
        }]
      }
    })
  };
}

function createAssetReadClient(assetRows, mappingRows) {
  return {
    from(table) {
      const rows = table === 'assets' ? assetRows : mappingRows;
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(field, value) {
          filters.push([field, value]);
          return this;
        },
        async order() {
          return {
            data: [...rows].sort((left, right) => left.symbol.localeCompare(right.symbol)),
            error: null
          };
        },
        async maybeSingle() {
          const data = rows.find(row => filters.every(([field, value]) => row[field] === value)) || null;
          return { data, error: null };
        }
      };
    }
  };
}

describe('Feature 16 — canonical asset domain and provider identity', () => {
  test('A/B. existing VN stock and ETF metadata preserve canonical IDs and compatibility fields', () => {
    const stock = normalizeAsset(assetFixture());
    const etf = normalizeAsset(assetFixture({
      id: ETF_ID,
      symbol: 'E1VFVN30',
      name: 'Dragon Capital VFMVN30 ETF',
      asset_type: 'etf'
    }));

    assert.equal(stock.id, FPT_ID);
    assert.equal(stock.symbol, 'FPT');
    assert.equal(stock.asset_type, 'stock');
    assert.equal(stock.assetType, 'stock');
    assert.equal(stock.exchange, 'HOSE');
    assert.equal(stock.marketCode, 'HOSE');
    assert.equal(stock.quoteCurrency, 'VND');
    assert.equal(stock.marketPolicy, 'VN_EXCHANGE');
    assert.equal(stock.marketTimezone, 'Asia/Ho_Chi_Minh');
    assert.equal(stock.quantityUnit, 'share');
    assert.equal(stock.isActive, true);
    assert.equal(etf.id, ETF_ID);
    assert.equal(etf.assetType, 'etf');
  });

  test('asset data access exposes canonical camelCase metadata and compatibility fields', async () => {
    const rows = [assetFixture()];
    const mappings = [yahooMapping()];
    const client = createAssetReadClient(rows, mappings);

    const all = await getAssets(client);
    const single = await getAssetBySymbol('fpt', client);
    const mapping = await getAssetProviderMapping(FPT_ID, 'YAHOO', client);

    assert.equal(all.length, 1);
    assert.equal(all[0].asset_type, 'stock');
    assert.equal(all[0].assetType, 'stock');
    assert.equal(all[0].marketCode, 'HOSE');
    assert.equal(all[0].quoteCurrency, 'VND');
    assert.equal(single.id, FPT_ID);
    assert.equal(single.marketPolicy, 'VN_EXCHANGE');
    assert.equal(mapping.assetId, FPT_ID);
    assert.equal(mapping.providerSymbol, 'FPT.VN');
  });

  test('C. canonical FPT resolves only through its explicit FPT.VN Yahoo mapping', async () => {
    const calls = [];
    const providerResolverOptions = {
      getAssetBySymbolFn: async symbol => {
        calls.push(['asset', symbol]);
        return normalizeAsset(assetFixture());
      },
      getAssetProviderMappingFn: async (assetId, provider) => {
        calls.push(['mapping', assetId, provider]);
        return yahooMapping();
      }
    };
    let requestedUrl;

    const snapshot = await getMarketSnapshot('fpt', {
      providerResolverOptions,
      fetchFn: async url => {
        requestedUrl = url;
        return snapshotResponse();
      }
    });

    assert.deepEqual(calls, [
      ['asset', 'FPT'],
      ['mapping', FPT_ID, 'yahoo']
    ]);
    assert.match(requestedUrl, /\/FPT\.VN\?/);
    assert.equal(snapshot.symbol, 'FPT');
  });

  test('D. absent provider mapping returns unsupported without requesting an inferred symbol', async () => {
    let fetchCount = 0;

    await assert.rejects(
      getMarketSnapshot('UNKNOWN', {
        providerResolverOptions: {
          getAssetBySymbolFn: async () => normalizeAsset(assetFixture({
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            symbol: 'UNKNOWN'
          })),
          getAssetProviderMappingFn: async () => null
        },
        fetchFn: async () => {
          fetchCount += 1;
          return snapshotResponse();
        }
      }),
      error => error.status === 422 && error.code === 'UNSUPPORTED_PROVIDER'
    );

    assert.equal(fetchCount, 0);
  });

  test('E. USD/VND FX fixture is represented with explicit base, quote, and 24/5 policy', () => {
    const fx = normalizeAsset(assetFixture({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      symbol: 'USD/VND',
      name: 'US Dollar / Vietnamese Dong',
      asset_type: 'fx',
      exchange: null,
      market_code: 'GLOBAL',
      base_currency: 'USD',
      quote_currency: 'VND',
      market_policy: 'GLOBAL_24_5',
      market_timezone: null,
      quantity_unit: null
    }));

    assert.equal(fx.baseCurrency, 'USD');
    assert.equal(fx.quoteCurrency, 'VND');
    assert.equal(fx.marketPolicy, 'GLOBAL_24_5');
  });

  test('F. BTC/USD supports fractional identity and cannot enter Vietnam history normalization', async () => {
    const crypto = normalizeAsset(assetFixture({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      symbol: 'BTC/USD',
      name: 'Bitcoin / US Dollar',
      asset_type: 'crypto',
      exchange: null,
      market_code: 'GLOBAL',
      base_currency: 'BTC',
      quote_currency: 'USD',
      market_policy: 'CONTINUOUS_24_7',
      market_timezone: null,
      quantity_unit: null
    }));
    let fetchCount = 0;

    await assert.rejects(
      getMarketHistory('BTC/USD', '1M', {
        resolveProviderMappingFn: async () => ({
          asset: crypto,
          mapping: { provider: 'yahoo', providerSymbol: 'BTC-USD' }
        }),
        fetchFn: async () => {
          fetchCount += 1;
          throw new Error('must not fetch');
        }
      }),
      error => error.status === 422 && error.code === 'UNSUPPORTED_MARKET_POLICY'
    );

    assert.equal(crypto.baseCurrency, 'BTC');
    assert.equal(crypto.quoteCurrency, 'USD');
    assert.equal(crypto.marketPolicy, 'CONTINUOUS_24_7');
    assert.equal(fetchCount, 0);
  });

  test('G/H. NAV fund and undecided gold fixtures remain representable without exchange-session claims', () => {
    const fund = normalizeAsset(assetFixture({
      id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      symbol: 'FUND-DEMO',
      asset_type: 'fund',
      exchange: null,
      market_code: null,
      market_policy: 'NAV_SCHEDULED',
      market_timezone: null,
      quantity_unit: null
    }));
    const gold = normalizeAsset(assetFixture({
      id: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      symbol: 'GOLD-DEMO',
      asset_type: 'gold',
      exchange: null,
      market_code: null,
      market_policy: 'INSTRUMENT_DEFINED',
      market_timezone: null,
      quantity_unit: null
    }));

    assert.equal(fund.marketPolicy, 'NAV_SCHEDULED');
    assert.equal(fund.marketCode, null);
    assert.equal(gold.marketPolicy, 'INSTRUMENT_DEFINED');
    assert.equal(gold.quantityUnit, null);
  });

  test('I/J. invalid types and invalid active currency contracts are rejected', () => {
    assert.throws(
      () => normalizeAsset(assetFixture({ asset_type: 'bond' })),
      /Unsupported asset type/
    );
    assert.throws(
      () => normalizeAsset(assetFixture({ quote_currency: 'vnd' })),
      /Invalid quote currency/
    );
    assert.throws(
      () => normalizeAsset(assetFixture({ quote_currency: null })),
      /Active assets require a quote currency/
    );
    assert.throws(
      () => normalizeAsset(assetFixture({ base_currency: 'VND' })),
      /Base currency must differ/
    );
    assert.doesNotThrow(() => normalizeAsset(assetFixture({
      asset_type: 'crypto',
      base_currency: 'BTC',
      quote_currency: 'USDT',
      market_policy: 'CONTINUOUS_24_7'
    })));
  });

  test('provider resolver rejects an inactive asset before provider lookup', async () => {
    let mappingLookups = 0;

    await assert.rejects(
      resolveProviderMapping('FPT', 'yahoo', {
        getAssetBySymbolFn: async () => normalizeAsset(assetFixture({ is_active: false })),
        getAssetProviderMappingFn: async () => {
          mappingLookups += 1;
          return yahooMapping();
        }
      }),
      error => error.code === 'ASSET_INACTIVE'
    );

    assert.equal(mappingLookups, 0);
  });

  test('M/O. migration is additive, preserves asset IDs/FKs, and creates no financial records', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260828210000_canonical_multi_asset_foundation.sql',
      import.meta.url
    ));
    const migration = readFileSync(migrationPath, 'utf8');

    assert.match(migration, /ALTER TABLE public\.assets[\s\S]*ADD COLUMN IF NOT EXISTS market_code/);
    assert.match(migration, /REFERENCES public\.assets\(id\) ON DELETE CASCADE/);
    assert.match(migration, /assets\.symbol \|\| '\.VN'/);
    assert.match(migration, /ON CONFLICT \(asset_id, provider\) DO NOTHING/);
    assert.doesNotMatch(migration, /(?:DROP TABLE|TRUNCATE|DELETE FROM) public\.assets/);
    assert.doesNotMatch(migration, /UPDATE public\.assets[\s\S]*SET\s+(?:id|symbol|name)\s*=/);
    assert.doesNotMatch(migration, /INSERT INTO public\.(?:holdings|portfolio_transactions|cash_ledger_entries)/);
  });
});
