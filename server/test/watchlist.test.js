import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../index.js';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist
} from '../src/supabase.js';

process.env.OWNER_ACCESS_TOKEN = TEST_OWNER_ACCESS_TOKEN;

describe('Feature 08 — Watchlist / Danh sách theo dõi (Isolated Automated Tests)', () => {
  const SINGLETON_PROFILE_ID = '11111111-1111-1111-1111-111111111111';
  const FOREIGN_PROFILE_ID = '22222222-2222-2222-2222-222222222222';

  // ==========================================================
  // HELPER: SPY SUPABASE CLIENT FOR TESTING PRODUCTION DATA ACCESS
  // ==========================================================
  function createSpySupabaseClient({
    profile = { id: SINGLETON_PROFILE_ID, singleton_key: 1, cash_available: 0, risk_tolerance: 'moderate', investment_horizon: 'medium' },
    asset = { id: 'asset-fpt-uuid', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' },
    assetError = null,
    existingWatchlistItem = null,
    existingWatchlistError = null,
    watchlistData = [],
    insertResult = null,
    insertError = null,
    deleteError = null
  } = {}) {
    const queryLog = [];

    const client = {
      from(tableName) {
        const queryState = {
          table: tableName,
          action: null,
          selectFields: null,
          insertPayload: null,
          updatePayload: null,
          eqFilters: [],
          orFilters: [],
          orderClause: null,
          limitClause: null
        };
        queryLog.push(queryState);

        const builder = {
          select(fields) {
            queryState.action = queryState.action || 'select';
            queryState.selectFields = fields;
            return builder;
          },
          insert(payload) {
            queryState.action = 'insert';
            queryState.insertPayload = payload;
            return builder;
          },
          delete() {
            queryState.action = 'delete';
            return builder;
          },
          eq(column, value) {
            queryState.eqFilters.push({ column, value });
            return builder;
          },
          or(expression) {
            queryState.orFilters.push(expression);
            return builder;
          },
          order(col, opts) {
            queryState.orderClause = { col, opts };
            return builder;
          },
          limit(n) {
            queryState.limitClause = n;
            return builder;
          },
          async single() {
            if (tableName === 'investor_profile') {
              return { data: { ...profile }, error: null };
            }
            if (tableName === 'watchlist_items' && queryState.action === 'insert') {
              if (insertError) return { data: null, error: insertError };
              const inserted = queryState.insertPayload[0];
              return {
                data: insertResult || {
                  id: 'wl-inserted-123',
                  ...inserted,
                  created_at: new Date().toISOString(),
                  assets: asset
                },
                error: null
              };
            }
            return { data: null, error: null };
          },
          async maybeSingle() {
            if (tableName === 'investor_profile') {
              return { data: { ...profile }, error: null };
            }
            if (tableName === 'assets') {
              if (assetError) return { data: null, error: assetError };
              return { data: asset ? { ...asset } : null, error: null };
            }
            if (tableName === 'watchlist_items') {
              if (existingWatchlistError) return { data: null, error: existingWatchlistError };
              return { data: existingWatchlistItem ? { ...existingWatchlistItem } : null, error: null };
            }
            return { data: null, error: null };
          },
          then(resolve) {
            if (tableName === 'watchlist_items' && queryState.action === 'select') {
              resolve({ data: watchlistData, error: null });
            } else if (tableName === 'watchlist_items' && queryState.action === 'delete') {
              if (deleteError) resolve({ data: null, error: deleteError });
              else resolve({ data: null, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          }
        };

        return builder;
      }
    };

    return { client, queryLog };
  }

  // ==========================================================
  // SECTION 1: PRODUCTION DATA-ACCESS PREDICATE & SCOPING TESTS
  // ==========================================================
  describe('Production Data-Access Functions & Ownership Predicates', () => {
    test('1. getWatchlist() applies profile_id = singletonProfileId predicate to production query', async () => {
      const { client, queryLog } = createSpySupabaseClient({
        watchlistData: [
          {
            id: 'wl-1',
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: 'asset-fpt-uuid',
            created_at: '2026-08-28T00:00:00.000Z',
            assets: { id: 'asset-fpt-uuid', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' }
          }
        ]
      });

      const result = await getWatchlist(client);

      assert.equal(result.length, 1);
      assert.equal(result[0].profile_id, SINGLETON_PROFILE_ID);
      assert.equal(result[0].asset?.symbol, 'FPT');

      // Verify query predicates
      const wlQuery = queryLog.find(q => q.table === 'watchlist_items' && q.action === 'select');
      assert.ok(wlQuery, 'Must query watchlist_items table');
      const profileFilter = wlQuery.eqFilters.find(f => f.column === 'profile_id');
      assert.ok(profileFilter, 'Must include profile_id filter');
      assert.equal(profileFilter.value, SINGLETON_PROFILE_ID, 'Must filter strictly by singleton profile ID');
    });

    test('1b. getWatchlist() exposes canonical market metadata without VND or HOSE fallbacks', async () => {
      const { client } = createSpySupabaseClient({
        watchlistData: [
          {
            id: 'wl-btc',
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: 'asset-btc',
            created_at: '2026-08-28T00:00:00.000Z',
            assets: {
              id: 'asset-btc',
              symbol: 'BTC',
              name: 'Bitcoin',
              asset_type: 'crypto',
              exchange: null,
              market_code: null,
              quote_currency: 'USD',
              base_currency: null,
              market_policy: 'CONTINUOUS_24_7',
              market_timezone: 'UTC',
              quantity_unit: 'coin'
            }
          },
          {
            id: 'wl-missing-meta',
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: 'asset-missing-meta',
            created_at: '2026-08-28T00:00:01.000Z',
            assets: {
              id: 'asset-missing-meta',
              symbol: 'TEST',
              name: 'Metadata Test',
              asset_type: 'fund',
              exchange: null,
              market_code: null,
              quote_currency: null,
              market_policy: null,
              market_timezone: null,
              quantity_unit: null
            }
          }
        ]
      });

      const result = await getWatchlist(client);

      assert.equal(result[0].assetId, 'asset-btc');
      assert.equal(result[0].assetType, 'crypto');
      assert.equal(result[0].quoteCurrency, 'USD');
      assert.equal(result[0].marketPolicy, 'CONTINUOUS_24_7');
      assert.equal(result[0].marketTimezone, 'UTC');
      assert.equal(result[0].exchange, null);
      assert.equal(result[1].quoteCurrency, null);
      assert.equal(result[1].exchange, null);
      assert.notEqual(result[1].quoteCurrency, 'VND');
      assert.notEqual(result[1].exchange, 'HOSE');
    });

    test('2. addToWatchlist() forces singleton profile_id and discards foreign profile_id in payload', async () => {
      const { client, queryLog } = createSpySupabaseClient({
        asset: { id: 'asset-vcb-uuid', symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock', exchange: 'HOSE' }
      });

      const result = await addToWatchlist(
        {
          asset_id: 'asset-vcb-uuid',
          profile_id: FOREIGN_PROFILE_ID // client attempt to inject foreign profile_id
        },
        client
      );

      assert.ok(result);
      assert.equal(result.profile_id, SINGLETON_PROFILE_ID);

      const insertQuery = queryLog.find(q => q.table === 'watchlist_items' && q.action === 'insert');
      assert.ok(insertQuery, 'Must issue insert query');
      assert.equal(insertQuery.insertPayload[0].profile_id, SINGLETON_PROFILE_ID, 'Payload MUST contain singleton profile ID');
      assert.notEqual(insertQuery.insertPayload[0].profile_id, FOREIGN_PROFILE_ID, 'Must NOT contain foreign profile ID');
    });

    test('3. addToWatchlist() is idempotent: returns existing item without duplicate insert when already saved', async () => {
      const existingItem = {
        id: 'wl-existing-1',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-fpt-uuid',
        created_at: '2026-08-28T00:00:00.000Z',
        assets: { id: 'asset-fpt-uuid', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' }
      };

      const { client, queryLog } = createSpySupabaseClient({
        existingWatchlistItem: existingItem
      });

      const result = await addToWatchlist({ symbol: 'FPT' }, client);

      assert.equal(result.id, 'wl-existing-1');
      assert.equal(result.asset?.symbol, 'FPT');

      const insertQuery = queryLog.find(q => q.table === 'watchlist_items' && q.action === 'insert');
      assert.equal(insertQuery, undefined, 'Must NOT issue insert query when item already exists');
    });

    test('4. addToWatchlist() throws client 400 when asset does not exist', async () => {
      const { client } = createSpySupabaseClient({ asset: null });

      await assert.rejects(
        async () => {
          await addToWatchlist({ symbol: 'NONEXISTENT' }, client);
        },
        err => {
          assert.equal(err.statusCode, 400);
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    test('5. addToWatchlist() throws server 500 (NOT 400) on database query failure', async () => {
      const dbErr = new Error('Database connection failed (code: 57P01)');
      const { client } = createSpySupabaseClient({ assetError: dbErr });

      await assert.rejects(
        async () => {
          await addToWatchlist({ symbol: 'FPT' }, client);
        },
        err => {
          assert.notEqual(err.statusCode, 400);
          assert.ok(err.message.includes('Database query error'));
          return true;
        }
      );
    });

    test('6. removeFromWatchlist() applies BOTH id/asset_id AND profile_id = singletonProfileId predicates', async () => {
      const targetWlId = 'wl-target-789';
      const { client, queryLog } = createSpySupabaseClient({
        existingWatchlistItem: { id: targetWlId, profile_id: SINGLETON_PROFILE_ID, asset_id: 'asset-fpt-uuid' }
      });

      const result = await removeFromWatchlist(targetWlId, client);

      assert.equal(result.deleted, true);
      assert.equal(result.removed, true);

      const deleteQuery = queryLog.find(q => q.table === 'watchlist_items' && q.action === 'delete');
      assert.ok(deleteQuery, 'Must issue delete query');
      const idFilter = deleteQuery.eqFilters.find(f => f.column === 'id');
      const profileFilter = deleteQuery.eqFilters.find(f => f.column === 'profile_id');
      assert.equal(idFilter.value, targetWlId);
      assert.equal(profileFilter.value, SINGLETON_PROFILE_ID);
    });

    test('7. removeFromWatchlist() returns sensible deterministic response when item not in watchlist', async () => {
      const { client } = createSpySupabaseClient({
        existingWatchlistItem: null,
        asset: null
      });

      const result = await removeFromWatchlist('nonexistent-asset-id', client);

      assert.equal(result.deleted, false);
      assert.equal(result.removed, false);
      assert.ok(result.message.includes('was not in watchlist'));
    });
  });

  // ==========================================================
  // SECTION 2: PRODUCTION ROUTE INTEGRATION VIA createApp()
  // ==========================================================
  describe('Production Express Route Layer Integration (createApp)', () => {
    let appInstance;
    let serverInstance;
    let baseUrl;

    let watchlistStore;
    let dbErrorActive = false;

    before(async () => {
      watchlistStore = [
        {
          id: 'wl-singleton-fpt',
          profile_id: SINGLETON_PROFILE_ID,
          asset_id: 'asset-fpt',
          created_at: '2026-08-28T01:00:00.000Z',
          asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' }
        },
        {
          id: 'wl-foreign-vcb',
          profile_id: FOREIGN_PROFILE_ID,
          asset_id: 'asset-vcb',
          created_at: '2026-08-28T01:00:00.000Z',
          asset: { id: 'asset-vcb', symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock', exchange: 'HOSE' }
        }
      ];

      // Instantiate ACTUAL production routes via createApp factory
      appInstance = createApp({
        getInvestorProfileFn: async () => ({ id: SINGLETON_PROFILE_ID, singleton_key: 1 }),
        getWatchlistFn: async () => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          return watchlistStore.filter(w => w.profile_id === SINGLETON_PROFILE_ID);
        },
        addToWatchlistFn: async ({ asset_id, symbol }) => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const targetSym = symbol || (asset_id === 'asset-hpg' ? 'HPG' : null);
          if (!targetSym || targetSym === 'NONEXISTENT') {
            const err = new Error(`Asset '${asset_id || symbol}' not found`);
            err.statusCode = 400;
            throw err;
          }

          const existing = watchlistStore.find(
            w => w.profile_id === SINGLETON_PROFILE_ID && (w.asset?.symbol === targetSym || w.asset_id === asset_id)
          );
          if (existing) return existing;

          const newItem = {
            id: 'wl-new-' + Date.now(),
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: asset_id || 'asset-' + targetSym.toLowerCase(),
            created_at: new Date().toISOString(),
            asset: { id: asset_id || 'asset-' + targetSym.toLowerCase(), symbol: targetSym, name: targetSym + ' Corp', asset_type: 'stock', exchange: 'HOSE' }
          };
          watchlistStore.push(newItem);
          return newItem;
        },
        removeFromWatchlistFn: async assetId => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const index = watchlistStore.findIndex(
            w => w.profile_id === SINGLETON_PROFILE_ID && (w.id === assetId || w.asset_id === assetId || w.asset?.symbol === assetId.toUpperCase())
          );
          if (index === -1) {
            return { removed: false, deleted: false, message: `Asset '${assetId}' was not in watchlist` };
          }
          const removed = watchlistStore.splice(index, 1)[0];
          return { id: removed.id, asset_id: removed.asset_id, deleted: true, removed: true };
        }
      });

      serverInstance = http.createServer(appInstance);
      await new Promise(resolve => serverInstance.listen(0, resolve));
      const port = serverInstance.address().port;
      baseUrl = 'http://localhost:' + port;
    });

    after(async () => {
      if (serverInstance) {
        await new Promise(resolve => serverInstance.close(resolve));
      }
    });

    test('8. GET /api/watchlist returns 200 with only singleton profile watchlist items', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist');
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.count, 1);
      assert.equal(json.data[0].id, 'wl-singleton-fpt');
      assert.ok(!json.data.some(w => w.id === 'wl-foreign-vcb'), 'Foreign profile item must NOT be returned');
    });

    test('9. POST /api/watchlist adds valid asset and returns 201', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'HPG' })
      });
      const json = await res.json();

      assert.equal(res.status, 201);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.asset?.symbol, 'HPG');
      assert.equal(json.data.profile_id, SINGLETON_PROFILE_ID);
    });

    test('10. POST /api/watchlist duplicate add is conflict-safe and idempotent', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'HPG' })
      });
      const json = await res.json();

      assert.equal(res.status, 201);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.asset?.symbol, 'HPG');
    });

    test('11. POST /api/watchlist rejects empty payload with 400', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();

      assert.equal(res.status, 400);
      assert.equal(json.status, 'error');
      assert.ok(json.errors || json.message);
    });

    test('12. POST /api/watchlist returns 400 for nonexistent asset', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'NONEXISTENT' })
      });
      const json = await res.json();

      assert.equal(res.status, 400);
      assert.equal(json.status, 'error');
      assert.ok(json.message.includes('not found'));
    });

    test('13. POST /api/watchlist returns 500 when database error occurs', async () => {
      dbErrorActive = true;
      const res = await ownerFetch(baseUrl + '/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'HPG' })
      });
      dbErrorActive = false;

      const json = await res.json();
      assert.equal(res.status, 500);
      assert.equal(json.status, 'error');
    });

    test('14. DELETE /api/watchlist/:assetId removes asset from watchlist', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist/HPG', {
        method: 'DELETE'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.deleted, true);

      // Verify it was removed
      const checkRes = await ownerFetch(baseUrl + '/api/watchlist');
      const checkJson = await checkRes.json();
      assert.ok(!checkJson.data.some(w => w.asset?.symbol === 'HPG'));
    });

    test('15. DELETE /api/watchlist/:assetId for nonexistent item returns sensible 200 response', async () => {
      const res = await ownerFetch(baseUrl + '/api/watchlist/NONEXISTENT', {
        method: 'DELETE'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.removed, false);
    });
  });
});
