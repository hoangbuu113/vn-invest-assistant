import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { coingeckoProvider } from '../src/providers/coingecko.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260829010000_crypto_universe_expansion_seed.sql');
const seedPath = path.resolve(__dirname, '../db/seed.sql');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const seedSql = fs.readFileSync(seedPath, 'utf8');

const EXISTING_CRYPTO = [
  { symbol: 'BTC', name: 'Bitcoin', providerSymbol: 'bitcoin', id: '1aca9503-acf1-4450-9b75-4f8935324398' },
  { symbol: 'ETH', name: 'Ethereum', providerSymbol: 'ethereum', id: '66f2e0e6-e375-4693-8f9d-ea423f47e751' },
  { symbol: 'SOL', name: 'Solana', providerSymbol: 'solana', id: '8ea1c52b-a999-4d1e-8b02-f8e7e8042118' }
];

const NEW_CRYPTO = [
  { symbol: 'BNB', name: 'BNB', providerSymbol: 'binancecoin', id: '66c7d650-f440-4e84-9469-ce0d070ede6b' },
  { symbol: 'XRP', name: 'XRP', providerSymbol: 'ripple', id: '4bebf6d3-cf96-4a88-8474-d4a4e706989a' },
  { symbol: 'TRX', name: 'TRON', providerSymbol: 'tron', id: 'bdf8e845-dfe3-45a1-b852-642a0b886b7d' },
  { symbol: 'HYPE', name: 'Hyperliquid', providerSymbol: 'hyperliquid', id: '40bd9c87-9fdb-47d2-962d-96df16f58c00' },
  { symbol: 'ZEC', name: 'Zcash', providerSymbol: 'zcash', id: 'a9cdfcc6-1518-4087-bbcd-8ac4704474a4' },
  { symbol: 'DOGE', name: 'Dogecoin', providerSymbol: 'dogecoin', id: '44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54' },
  { symbol: 'RAIN', name: 'Rain', providerSymbol: 'rain', id: '98736587-f37d-42a9-9c22-237dbf82187f' },
  { symbol: 'XMR', name: 'Monero', providerSymbol: 'monero', id: 'f80f1162-2b13-4b2b-84dc-e208fc3fbedc' },
  { symbol: 'LINK', name: 'Chainlink', providerSymbol: 'chainlink', id: 'c2534c6b-9eb5-4a78-b93f-969bb8f7df65' },
  { symbol: 'WBT', name: 'WhiteBIT Coin', providerSymbol: 'whitebit', id: '8f755ede-0630-4055-aef5-84ecc2512c59' },
  { symbol: 'ADA', name: 'Cardano', providerSymbol: 'cardano', id: '5af019d9-3cc5-4904-8cd1-25389feec501' },
  { symbol: 'XLM', name: 'Stellar', providerSymbol: 'stellar', id: '5b3bea95-edd8-4a89-918b-d8c3b0156399' },
  { symbol: 'BCH', name: 'Bitcoin Cash', providerSymbol: 'bitcoin-cash', id: '11a31ef1-568f-4c10-8a13-5007e7d57a5b' },
  { symbol: 'GRAM', name: 'Gram (prev. Toncoin)', providerSymbol: 'the-open-network', id: '04c0ebd5-d104-4b82-a447-16a3903ec01c' },
  { symbol: 'LTC', name: 'Litecoin', providerSymbol: 'litecoin', id: '4cb6998d-3364-4734-ad73-d62ac3f47aff' },
  { symbol: 'HBAR', name: 'Hedera', providerSymbol: 'hedera-hashgraph', id: 'c3825936-a57f-4361-a4e5-9d7cd96d284c' },
  { symbol: 'AVAX', name: 'Avalanche', providerSymbol: 'avalanche-2', id: 'b0785af1-75d1-4fa3-99c1-d56985dfbade' },
  { symbol: 'SHIB', name: 'Shiba Inu', providerSymbol: 'shiba-inu', id: 'bdc8770f-7311-4621-9067-3c61b907238b' },
  { symbol: 'SUI', name: 'Sui', providerSymbol: 'sui', id: '81590371-79ba-44c3-8f48-31b86d53c3e3' },
  { symbol: 'UNI', name: 'Uniswap', providerSymbol: 'uniswap', id: '79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3' },
  { symbol: 'NEAR', name: 'NEAR Protocol', providerSymbol: 'near', id: '73b6f9b9-3b85-4c25-b1bf-6a34b4f18946' },
  { symbol: 'TAO', name: 'Bittensor', providerSymbol: 'bittensor', id: '9ec01b5e-84c9-46b7-899a-772425d334af' },
  { symbol: 'PUMP', name: 'Pump.fun', providerSymbol: 'pump-fun', id: 'c632abb3-22eb-49ea-ae63-c742c56f091f' },
  { symbol: 'AAVE', name: 'Aave', providerSymbol: 'aave', id: 'cc4c6bb6-3d5c-487e-961c-80a2eb89585c' },
  { symbol: 'ASTER', name: 'Aster', providerSymbol: 'aster-2', id: '9841e6e5-a8ff-4e71-b034-e7a4de3d6ded' },
  { symbol: 'WLFI', name: 'World Liberty Financial', providerSymbol: 'world-liberty-financial', id: '927dc869-7204-4d87-b744-fd6a03fc8c99' },
  { symbol: 'ONDO', name: 'Ondo', providerSymbol: 'ondo-finance', id: 'afa7bb4c-283a-4686-a570-c591b12cef66' },
  { symbol: 'ENA', name: 'Ethena', providerSymbol: 'ethena', id: 'f8a74dcd-71f6-42d1-a3e7-2e6208cba86c' },
  { symbol: 'MORPHO', name: 'Morpho', providerSymbol: 'morpho', id: 'b7abf464-981b-47c6-b587-1ac61cfe9e0e' },
  { symbol: 'PEPE', name: 'Pepe', providerSymbol: 'pepe', id: '821eace1-4edc-4d91-a2b3-a43e51ff49b7' },
  { symbol: 'DOT', name: 'Polkadot', providerSymbol: 'polkadot', id: 'e7c6ef68-a92f-4735-9d8b-aa3e7767f11f' },
  { symbol: 'WLD', name: 'Worldcoin', providerSymbol: 'worldcoin-wld', id: '4635d9d6-f30f-4dd4-9632-67873ce5e3b1' },
  { symbol: 'ETC', name: 'Ethereum Classic', providerSymbol: 'ethereum-classic', id: 'd9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7' },
  { symbol: 'POL', name: 'POL (ex-MATIC)', providerSymbol: 'polygon-ecosystem-token', id: '22deaafe-2849-4c75-980c-c0c8e3b42bc9' },
  { symbol: 'LIT', name: 'Lighter', providerSymbol: 'lighter', id: 'f64d16cc-1bce-4f81-a64b-e5acbbe1a07e' },
  { symbol: 'ATOM', name: 'Cosmos Hub', providerSymbol: 'cosmos', id: '9c8f9012-9973-406e-89a3-6350f095b59b' },
  { symbol: 'JUP', name: 'Jupiter', providerSymbol: 'jupiter-exchange-solana', id: '871267a7-954b-4d39-8299-3c0299fe8be8' }
];

const ALL_CRYPTO = [...EXISTING_CRYPTO, ...NEW_CRYPTO];

const seedCoinGeckoMappings = new Map(
  [...seedSql.matchAll(/SELECT assets\.id, 'coingecko', '([^']+)' FROM public\.assets WHERE symbol = '([^']+)'/g)]
    .map((match) => [match[2], match[1]])
);

const feature20bCandidatesMatch = migrationSql.match(/candidates CONSTANT jsonb := '(\[[\s\S]*?\])'::jsonb;/);
const feature20bCandidates = feature20bCandidatesMatch
  ? JSON.parse(feature20bCandidatesMatch[1])
  : [];

const EXISTING_NON_CRYPTO = ['VCB', 'FPT', 'HPG', 'VNM', 'E1VFVN30', 'FUEVFVND', 'FUESSVFL', 'XAU/USD', 'USD/VND'];

describe('Feature 20B — Controlled Crypto Universe Expansion', () => {
  // A. exactly 40 canonical crypto identities (3 existing + 37 new)
  it('A. expected crypto universe contains exactly 40 canonical crypto identities', () => {
    assert.equal(ALL_CRYPTO.length, 40);
  });

  // B. exact 37 new symbols are unique
  it('B. exact 37 new symbols are unique', () => {
    const symbols = NEW_CRYPTO.map(a => a.symbol);
    const uniqueSymbols = new Set(symbols);
    assert.equal(uniqueSymbols.size, 37);
    assert.equal(symbols.length, 37);
  });

  // C. all 40 canonical CoinGecko IDs are non-empty and normalized-unique
  it('C. all 40 canonical CoinGecko provider IDs are non-empty and normalized-unique', () => {
    const ids = ALL_CRYPTO.map((asset) => asset.providerSymbol.trim().toLowerCase());
    const uniqueIds = new Set(ids);
    assert.ok(ALL_CRYPTO.every((asset) => asset.providerSymbol.trim() !== ''));
    assert.equal(uniqueIds.size, 40);
    assert.equal(ids.length, 40);
  });

  // D. no symbol collision with existing non-crypto canonical assets
  it('D. no symbol collision with existing non-crypto canonical assets', () => {
    const allSymbols = [...EXISTING_CRYPTO, ...NEW_CRYPTO].map(a => a.symbol);
    for (const nonCrypto of EXISTING_NON_CRYPTO) {
      assert.ok(!allSymbols.includes(nonCrypto), `Collision detected for ${nonCrypto}`);
    }
  });

  // E. each new asset uses: crypto, USD, CONTINUOUS_24_7, UTC, coin, active
  it('E. migration defines canonical crypto semantics for all 37 new assets', () => {
    for (const asset of NEW_CRYPTO) {
      assert.ok(
        migrationSql.includes(`"symbol": "${asset.symbol}"`),
        `Migration missing symbol ${asset.symbol}`
      );
      assert.ok(
        migrationSql.includes(`"id": "${asset.id}"`),
        `Migration missing stable UUID for ${asset.symbol}`
      );
    }
    assert.ok(migrationSql.includes(`'crypto'`));
    assert.ok(migrationSql.includes(`'USD'`));
    assert.ok(migrationSql.includes(`'CONTINUOUS_24_7'`));
    assert.ok(migrationSql.includes(`'UTC'`));
    assert.ok(migrationSql.includes(`'coin'`));
    assert.ok(migrationSql.includes(`TRUE`));
  });

  // F. each new mapping uses provider = coingecko and exact approved CoinGecko ID
  it('F. migration defines explicit CoinGecko provider mappings for all 37 new assets', () => {
    for (const asset of NEW_CRYPTO) {
      assert.ok(
        migrationSql.includes(`"provider_symbol": "${asset.providerSymbol}"`),
        `Migration missing provider mapping for ${asset.providerSymbol}`
      );
    }
  });

  it('F2. all 37 exact symbol-to-provider associations match Feature 20B candidate tuples', () => {
    assert.equal(feature20bCandidates.length, 37);
    const feature20bBySymbol = new Map(feature20bCandidates.map((asset) => [asset.symbol, asset]));

    for (const asset of NEW_CRYPTO) {
      assert.ok(feature20bBySymbol.has(asset.symbol), `Missing candidate for ${asset.symbol}`);
      const candidate = feature20bBySymbol.get(asset.symbol);
      assert.deepEqual(candidate, {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        provider_symbol: asset.providerSymbol
      });
    }
  });

  // G. BTC/ETH/SOL are not recreated by Feature 20B migration
  it('G. BTC, ETH, and SOL are preserved and not recreated by Feature 20B migration', () => {
    const candidatesJson = migrationSql.split('candidates CONSTANT jsonb :=')[1]?.split(';')[0] || '';
    assert.ok(!candidatesJson.includes('"symbol": "BTC"'), 'Migration must not insert BTC');
    assert.ok(!candidatesJson.includes('"symbol": "ETH"'), 'Migration must not insert ETH');
    assert.ok(!candidatesJson.includes('"symbol": "SOL"'), 'Migration must not insert SOL');
  });

  // H. migration contains no stablecoin candidates
  it('H. migration contains no excluded stablecoin candidates', () => {
    const stablecoins = ['USDT', 'USDC', 'USDS', 'DAI', 'USDE', 'PYUSD', 'RLUSD', 'USDY'];
    for (const sc of stablecoins) {
      assert.ok(!migrationSql.includes(`"${sc}"`), `Migration must not contain stablecoin ${sc}`);
    }
  });

  // I. migration contains no gold-token duplicate (XAUT, PAXG)
  it('I. migration contains no duplicate gold tokens', () => {
    assert.ok(!migrationSql.includes('"XAUT"'));
    assert.ok(!migrationSql.includes('"PAXG"'));
    assert.ok(!migrationSql.includes('tether-gold'));
    assert.ok(!migrationSql.includes('pax-gold'));
  });

  // J. migration contains no FIGR_HELOC/BUIDL institutional assets
  it('J. migration contains no tokenized institutional fund or credit assets', () => {
    assert.ok(!migrationSql.includes('"FIGR_HELOC"'));
    assert.ok(!migrationSql.includes('"BUIDL"'));
    assert.ok(!migrationSql.includes('"USYC"'));
    assert.ok(!migrationSql.includes('figure-heloc'));
    assert.ok(!migrationSql.includes('blackrock-usd-institutional-digital-liquidity-fund'));
  });

  // K. migration contains no dynamic ranking/provider API logic
  it('K. migration is purely static SQL with zero runtime API or dynamic rank dependencies', () => {
    assert.ok(!migrationSql.includes('http'));
    assert.ok(!migrationSql.includes('fetch'));
    assert.ok(!migrationSql.includes('rank'));
  });

  // L. no holdings/transactions/cash mutation SQL exists in Feature 20B migration
  it('L. migration contains zero DML/mutations on financial tables', () => {
    const forbiddenTables = [
      'holdings',
      'portfolio_transactions',
      'cash_ledger_entries',
      'investor_profile',
      'position_opening_baselines'
    ];
    for (const table of forbiddenTables) {
      assert.ok(!migrationSql.includes(`INSERT INTO public.${table}`), `Forbidden insert into ${table}`);
      assert.ok(!migrationSql.includes(`UPDATE public.${table}`), `Forbidden update on ${table}`);
      assert.ok(!migrationSql.includes(`DELETE FROM public.${table}`), `Forbidden delete on ${table}`);
    }
  });

  // M. explicit stable UUID exists for every new canonical asset
  it('M. explicit stable UUID exists for every new canonical asset', () => {
    for (const asset of NEW_CRYPTO) {
      assert.ok(typeof asset.id === 'string' && asset.id.length === 36, `Invalid UUID format for ${asset.symbol}`);
      assert.ok(migrationSql.includes(asset.id), `UUID ${asset.id} missing from migration`);
    }
  });

  // N. no duplicate UUIDs
  it('N. all 37 new UUIDs are mutually unique and distinct from existing UUIDs', () => {
    const existingUuids = [
      '039f6974-626b-4145-ab57-b19f91bac2ca',
      '34ad7d87-9065-4111-b38d-ebc92c4a74dd',
      '5dc6426e-590e-4d9e-95cd-0fa584cc0b11',
      '059ff499-2297-4d88-96a0-a7e36be40edf',
      'a3625689-2620-410a-8c1c-9ebef3cf802d',
      '1aca9503-acf1-4450-9b75-4f8935324398',
      '66f2e0e6-e375-4693-8f9d-ea423f47e751',
      '8ea1c52b-a999-4d1e-8b02-f8e7e8042118',
      '9f0ffc4f-950f-4125-94b0-d5911cdfaad7',
      '557ba9ab-fca8-44ff-a230-4166796e3d62',
      '28f1c02e-9974-4d44-95ff-34837390ca74',
      'd18509bc-f7fa-47f1-9a90-7d347c7b4038'
    ];

    const newUuids = NEW_CRYPTO.map(a => a.id);
    const uniqueNew = new Set(newUuids);
    assert.equal(uniqueNew.size, 37);

    for (const id of newUuids) {
      assert.ok(!existingUuids.includes(id), `Collision with existing UUID: ${id}`);
    }
  });

  // O. Identity safety: DO UPDATE is absent and fail-fast preflight checks are present
  it('O. migration eliminates ON CONFLICT (symbol) DO UPDATE and enforces preflight identity assertions', () => {
    // 1. DO UPDATE must be absent on public.assets
    assert.ok(!migrationSql.includes('DO UPDATE'), 'Migration must not use ON CONFLICT DO UPDATE on canonical assets');

    // 2. Preflight assertion checks
    assert.ok(migrationSql.includes('Identity Conflict: Asset symbol % already exists with UUID %'));
    assert.ok(migrationSql.includes('Identity Conflict: Asset UUID % already exists with symbol %'));
    assert.ok(migrationSql.includes('Semantics Conflict: Existing asset % (%) has incompatible canonical semantics'));
    assert.ok(migrationSql.includes('Mapping Conflict: Asset % (%) already mapped to coingecko with provider_symbol %'));

    // 3. Exact matching insert uses DO NOTHING
    assert.ok(migrationSql.includes('ON CONFLICT (id) DO NOTHING'));
    assert.ok(migrationSql.includes('ON CONFLICT (asset_id, provider) DO NOTHING'));
  });

  // P. representative CoinGecko adapter resolves mock quotes for new crypto mappings
  it('P. representative CoinGecko adapter resolves mock quotes for new crypto mappings', async () => {
    const representative = [
      { symbol: 'BNB', providerSymbol: 'binancecoin' },
      { symbol: 'GRAM', providerSymbol: 'the-open-network' },
      { symbol: 'POL', providerSymbol: 'polygon-ecosystem-token' },
      { symbol: 'JUP', providerSymbol: 'jupiter-exchange-solana' }
    ];

    for (const item of representative) {
      const mockFetch = async (url) => {
        assert.ok(url.includes(item.providerSymbol));
        return {
          ok: true,
          json: async () => ({
            [item.providerSymbol]: {
              usd: 123.45,
              usd_24h_vol: 5000000,
              usd_24h_change: 2.5,
              last_updated_at: 1724850000
            }
          })
        };
      };

      const snapshot = await coingeckoProvider.getSnapshot(
        { symbol: item.symbol, quoteCurrency: 'USD' },
        { provider: 'coingecko', providerSymbol: item.providerSymbol },
        { fetchFn: mockFetch }
      );

      assert.equal(snapshot.symbol, item.symbol);
      assert.equal(snapshot.currency, 'USD');
      assert.equal(snapshot.price, 123.45);
      assert.equal(snapshot.priceSource, 'coingecko_market_snapshot');
    }
  });

  it('Q. all 40 exact mappings route through snapshot and completed-daily history without live calls', async () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    const completedPrices = [
      [Date.parse('2026-08-22T00:00:00.000Z'), 100.123456],
      [Date.parse('2026-08-28T00:00:00.000Z'), 101.654321],
      [Date.parse('2026-08-29T00:00:00.000Z'), 999]
    ];

    for (const asset of ALL_CRYPTO) {
      let snapshotUrl;
      const snapshot = await coingeckoProvider.getSnapshot(
        {
          id: asset.id,
          symbol: asset.symbol,
          quoteCurrency: 'USD'
        },
        { provider: 'coingecko', providerSymbol: asset.providerSymbol },
        {
          apiKey: 'test-key',
          fetchFn: async (url) => {
            snapshotUrl = new URL(url);
            return {
              ok: true,
              status: 200,
              json: async () => ({
                [asset.providerSymbol]: {
                  usd: 1.23456789,
                  usd_24h_vol: 5000000,
                  usd_24h_change: 0.32,
                  last_updated_at: 1788000000
                }
              })
            };
          }
        }
      );

      let historyUrl;
      const history = await coingeckoProvider.getHistory(
        {
          id: asset.id,
          symbol: asset.symbol,
          assetType: 'crypto',
          quoteCurrency: 'USD',
          marketPolicy: 'CONTINUOUS_24_7',
          marketTimezone: 'UTC'
        },
        { provider: 'coingecko', providerSymbol: asset.providerSymbol },
        {
          apiKey: 'test-key',
          now,
          range: '1W',
          fetchFn: async (url) => {
            historyUrl = new URL(url);
            return {
              ok: true,
              status: 200,
              json: async () => ({ prices: completedPrices, market_caps: [], total_volumes: [] })
            };
          }
        }
      );

      assert.equal(snapshotUrl.searchParams.get('ids'), asset.providerSymbol);
      assert.equal(snapshot.symbol, asset.symbol);
      assert.equal(snapshot.price, 1.23456789);
      assert.ok(historyUrl.pathname.endsWith(`/coins/${asset.providerSymbol}/market_chart/range`));
      assert.deepEqual(history.bars.map((bar) => bar.date), ['2026-08-22', '2026-08-28']);
      assert.equal(history.dataAsOf, '2026-08-28');
    }
  });
});
