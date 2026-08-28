import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createApp,
  isValidFinancialNumber,
  ALLOWED_RISK_TOLERANCE,
  ALLOWED_INVESTMENT_HORIZON
} from '../index.js';
import {
  getHoldings,
  addHolding,
  updateHolding,
  deleteHolding
} from '../src/supabase.js';

describe('Patch B3 - Production-Path Profile & Holdings Integrity Hardening', () => {
  const SINGLETON_PROFILE_ID = '11111111-1111-1111-1111-111111111111';
  const FOREIGN_PROFILE_ID = '22222222-2222-2222-2222-222222222222';

  // ==========================================================
  // HELPER: SPY SUPABASE CLIENT FOR TESTING PRODUCTION DATA ACCESS
  // ==========================================================
  function createSpySupabaseClient({
    profile = { id: SINGLETON_PROFILE_ID, singleton_key: 1, cash_available: 0, risk_tolerance: 'moderate', investment_horizon: 'medium' },
    asset = { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' },
    assetError = null,
    existingHolding = null,
    existingHoldingError = null,
    holdingsData = [],
    updateResult = null,
    updateError = null,
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
          update(payload) {
            queryState.action = 'update';
            queryState.updatePayload = payload;
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
            if (tableName === 'holdings' && queryState.action === 'insert') {
              const inserted = queryState.insertPayload[0];
              return {
                data: {
                  id: 'h-inserted',
                  ...inserted,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  assets: asset
                },
                error: null
              };
            }
            if (tableName === 'holdings' && queryState.action === 'update') {
              if (updateError) return { data: null, error: updateError };
              return {
                data: {
                  id: 'h-updated',
                  profile_id: SINGLETON_PROFILE_ID,
                  ...queryState.updatePayload,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
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
            if (tableName === 'holdings') {
              if (queryState.action === 'select') {
                if (existingHoldingError) return { data: null, error: existingHoldingError };
                return { data: existingHolding ? { ...existingHolding } : null, error: null };
              }
              if (queryState.action === 'update') {
                if (updateError) return { data: null, error: updateError };
                if (updateResult === false) return { data: null, error: null };
                return {
                  data: {
                    id: 'h-updated',
                    profile_id: SINGLETON_PROFILE_ID,
                    ...queryState.updatePayload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    assets: asset
                  },
                  error: null
                };
              }
            }
            return { data: null, error: null };
          },
          then(resolve, reject) {
            if (tableName === 'holdings' && queryState.action === 'select') {
              resolve({ data: holdingsData, error: null });
            } else if (tableName === 'holdings' && queryState.action === 'delete') {
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
  // SECTION 1: PRODUCTION DATA-ACCESS PREDICATE TESTS
  // ==========================================================
  describe('Production Data-Access Functions Ownership Predicates', () => {
    test('GET getHoldings() applies profile_id = singletonProfileId predicate to production query', async () => {
      const { client, queryLog } = createSpySupabaseClient({
        holdingsData: [
          {
            id: 'h-1',
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: 'asset-fpt',
            quantity: 100,
            average_cost: 60000,
            assets: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock', exchange: 'HOSE' }
          }
        ]
      });

      // Call ACTUAL production function from server/src/supabase.js
      const result = await getHoldings(client);

      assert.equal(result.length, 1);
      assert.equal(result[0].profile_id, SINGLETON_PROFILE_ID);

      // Inspect query issued to Supabase by production getHoldings()
      const holdingsQuery = queryLog.find(q => q.table === 'holdings');
      assert.ok(holdingsQuery, 'Must query holdings table');
      assert.equal(holdingsQuery.action, 'select');

      const profileFilter = holdingsQuery.eqFilters.find(f => f.column === 'profile_id');
      assert.ok(profileFilter, 'Production query MUST include profile_id filter');
      assert.equal(profileFilter.value, SINGLETON_PROFILE_ID, 'Must filter strictly by singleton profile ID');
    });

    test('POST addHolding() forces singleton profile_id and discards foreign profile_id in production payload', async () => {
      const { client, queryLog } = createSpySupabaseClient();

      // Call ACTUAL production function from server/src/supabase.js with client-supplied foreign profile_id
      const result = await addHolding(
        {
          asset_id: 'asset-fpt',
          quantity: 100,
          average_cost: 60000,
          profile_id: FOREIGN_PROFILE_ID
        },
        client
      );

      assert.ok(result);

      // Inspect insert query issued by production addHolding()
      const insertQuery = queryLog.find(q => q.table === 'holdings' && q.action === 'insert');
      assert.ok(insertQuery, 'Must issue insert query to holdings table');
      assert.ok(Array.isArray(insertQuery.insertPayload));
      assert.equal(insertQuery.insertPayload.length, 1);

      const insertedRow = insertQuery.insertPayload[0];
      assert.equal(insertedRow.profile_id, SINGLETON_PROFILE_ID, 'Production payload MUST contain singleton profile ID');
      assert.notEqual(insertedRow.profile_id, FOREIGN_PROFILE_ID, 'Production payload MUST NOT contain foreign profile ID');
    });

    test('PUT updateHolding() applies BOTH id AND profile_id = singletonProfileId predicates in production query', async () => {
      const targetHoldingId = 'h-target-123';
      const { client, queryLog } = createSpySupabaseClient();

      // Call ACTUAL production function from server/src/supabase.js
      const result = await updateHolding(
        targetHoldingId,
        { quantity: 200, average_cost: 65000 },
        client
      );

      assert.ok(result);

      // Inspect update query issued by production updateHolding()
      const updateQuery = queryLog.find(q => q.table === 'holdings' && q.action === 'update');
      assert.ok(updateQuery, 'Must issue update query to holdings table');

      const idFilter = updateQuery.eqFilters.find(f => f.column === 'id');
      const profileFilter = updateQuery.eqFilters.find(f => f.column === 'profile_id');

      assert.ok(idFilter, 'Production update query MUST contain id predicate');
      assert.equal(idFilter.value, targetHoldingId);

      assert.ok(profileFilter, 'Production update query MUST contain profile_id predicate');
      assert.equal(profileFilter.value, SINGLETON_PROFILE_ID, 'Production update query MUST scope by singleton profile ID');
    });

    test('DELETE deleteHolding() applies BOTH id AND profile_id = singletonProfileId predicates in production query', async () => {
      const targetHoldingId = 'h-target-456';
      const { client, queryLog } = createSpySupabaseClient({
        existingHolding: { id: targetHoldingId, profile_id: SINGLETON_PROFILE_ID }
      });

      // Call ACTUAL production function from server/src/supabase.js
      const result = await deleteHolding(targetHoldingId, client);

      assert.equal(result.deleted, true);

      // Inspect delete query issued by production deleteHolding()
      const deleteQuery = queryLog.find(q => q.table === 'holdings' && q.action === 'delete');
      assert.ok(deleteQuery, 'Must issue delete query to holdings table');

      const idFilter = deleteQuery.eqFilters.find(f => f.column === 'id');
      const profileFilter = deleteQuery.eqFilters.find(f => f.column === 'profile_id');

      assert.ok(idFilter, 'Production delete query MUST contain id predicate');
      assert.equal(idFilter.value, targetHoldingId);

      assert.ok(profileFilter, 'Production delete query MUST contain profile_id predicate');
      assert.equal(profileFilter.value, SINGLETON_PROFILE_ID, 'Production delete query MUST scope by singleton profile ID');
    });
  });

  // ==========================================================
  // SECTION 2: ASSET ERROR SEMANTICS IN PRODUCTION DATA ACCESS
  // ==========================================================
  describe('Asset Lookup Error Semantics (Production Function & Error Mapping)', () => {
    test('addHolding() throws client 400 when asset query succeeds but asset does not exist', async () => {
      const { client } = createSpySupabaseClient({ asset: null });

      await assert.rejects(
        async () => {
          await addHolding({ asset_id: 'non-existent-asset', quantity: 10, average_cost: 10000 }, client);
        },
        err => {
          assert.equal(err.statusCode, 400, 'Expected 400 for non-existent asset');
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    test('addHolding() throws server 500 (NOT 400) when asset query itself encounters database error', async () => {
      const dbError = new Error('connection timeout (code: 57P01)');
      dbError.code = '57P01';
      const { client } = createSpySupabaseClient({ assetError: dbError });

      await assert.rejects(
        async () => {
          await addHolding({ asset_id: 'asset-fpt', quantity: 10, average_cost: 10000 }, client);
        },
        err => {
          assert.notEqual(err.statusCode, 400, 'Must NOT be converted to client 400');
          assert.ok(err.message.includes('Database query error'));
          assert.ok(!err.message.includes('not found'));
          return true;
        }
      );
    });
  });

  // ==========================================================
  // SECTION 3: PRODUCTION ROUTE INTEGRATION VIA createApp()
  // ==========================================================
  describe('Production Express Route Layer Integration (createApp)', () => {
    let appInstance;
    let serverInstance;
    let baseUrl;

    let profilesStore;
    let holdingsStore;
    let dbErrorOnAsset = false;

    before(async () => {
      profilesStore = [
        {
          id: SINGLETON_PROFILE_ID,
          singleton_key: 1,
          cash_available: 0,
          risk_tolerance: 'moderate',
          investment_horizon: 'medium',
          created_at: '2026-08-27T00:00:00.000Z',
          updated_at: '2026-08-27T00:00:00.000Z'
        },
        {
          id: FOREIGN_PROFILE_ID,
          singleton_key: 2,
          cash_available: 100000000,
          risk_tolerance: 'high',
          investment_horizon: 'long',
          created_at: '2026-08-27T00:00:00.000Z',
          updated_at: '2026-08-27T00:00:00.000Z'
        }
      ];

      holdingsStore = [
        {
          id: 'holding-singleton-fpt',
          profile_id: SINGLETON_PROFILE_ID,
          asset_id: 'asset-fpt',
          quantity: 100,
          average_cost: 60000,
          asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp' }
        },
        {
          id: 'holding-foreign-vcb',
          profile_id: FOREIGN_PROFILE_ID,
          asset_id: 'asset-vcb',
          quantity: 200,
          average_cost: 85000,
          asset: { id: 'asset-vcb', symbol: 'VCB', name: 'Vietcombank' }
        }
      ];

      // Instantiate ACTUAL production routes via createApp factory
      appInstance = createApp({
        getInvestorProfileFn: async () => profilesStore[0],
        updateInvestorProfileFn: async ({ cash_available, risk_tolerance, investment_horizon }) => {
          profilesStore[0].cash_available = cash_available;
          profilesStore[0].risk_tolerance = risk_tolerance;
          profilesStore[0].investment_horizon = investment_horizon;
          return profilesStore[0];
        },
        getHoldingsFn: async () => {
          return holdingsStore.filter(h => h.profile_id === SINGLETON_PROFILE_ID);
        },
        addHoldingFn: async ({ asset_id, quantity, average_cost }) => {
          if (dbErrorOnAsset) {
            const err = new Error('Database query error: Connection terminated');
            throw err;
          }
          if (asset_id === 'nonexistent') {
            const err = new Error("Asset with ID '" + asset_id + "' not found");
            err.statusCode = 400;
            throw err;
          }
          const newHolding = {
            id: 'h-new-' + Date.now(),
            profile_id: SINGLETON_PROFILE_ID,
            asset_id,
            quantity,
            average_cost,
            asset: { id: asset_id, symbol: 'HPG', name: 'Hoa Phat' }
          };
          holdingsStore.push(newHolding);
          return newHolding;
        },
        updateHoldingFn: async (id, { quantity, average_cost }) => {
          const holding = holdingsStore.find(h => h.id === id && h.profile_id === SINGLETON_PROFILE_ID);
          if (!holding) {
            const err = new Error("Holding with ID '" + id + "' not found");
            err.statusCode = 404;
            throw err;
          }
          holding.quantity = quantity;
          holding.average_cost = average_cost;
          return holding;
        },
        deleteHoldingFn: async id => {
          const index = holdingsStore.findIndex(h => h.id === id && h.profile_id === SINGLETON_PROFILE_ID);
          if (index === -1) {
            const err = new Error("Holding with ID '" + id + "' not found");
            err.statusCode = 404;
            throw err;
          }
          holdingsStore.splice(index, 1);
          return { id, deleted: true };
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

    // --- Financial Input Validation on Real Routes ---
    test('PUT /api/profile validates valid input', async () => {
      const res = await fetch(baseUrl + '/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cash_available: 50000000,
          risk_tolerance: 'moderate',
          investment_horizon: 'medium'
        })
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.status, 'ok');
      assert.equal(data.data.cash_available, 50000000);
    });

    test('PUT /api/profile strictly rejects invalid financial numbers and enums (400)', async () => {
      const invalidBodies = [
        { cash_available: -1000, risk_tolerance: 'moderate', investment_horizon: 'medium' },
        { cash_available: '50000000', risk_tolerance: 'moderate', investment_horizon: 'medium' },
        { cash_available: true, risk_tolerance: 'moderate', investment_horizon: 'medium' },
        { cash_available: [50000000], risk_tolerance: 'moderate', investment_horizon: 'medium' },
        { cash_available: 50000000, risk_tolerance: 'invalid_enum', investment_horizon: 'medium' },
        { cash_available: 50000000, risk_tolerance: 'moderate', investment_horizon: 'invalid_horizon' }
      ];

      for (const body of invalidBodies) {
        const res = await fetch(baseUrl + '/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        assert.equal(res.status, 400, 'Expected 400 for invalid body ' + JSON.stringify(body));
      }
    });

    test('POST /api/holdings strictly rejects invalid financial numbers (400)', async () => {
      const invalidBodies = [
        { asset_id: 'a-1', quantity: 0, average_cost: 1000 },
        { asset_id: 'a-1', quantity: -10, average_cost: 1000 },
        { asset_id: 'a-1', quantity: '10', average_cost: 1000 },
        { asset_id: 'a-1', quantity: true, average_cost: 1000 },
        { asset_id: 'a-1', quantity: 10, average_cost: -1000 },
        { asset_id: 'a-1', quantity: 10, average_cost: '1000' }
      ];

      for (const body of invalidBodies) {
        const res = await fetch(baseUrl + '/api/holdings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        assert.equal(res.status, 400, 'Expected 400 for invalid body ' + JSON.stringify(body));
      }
    });

    test('POST /api/holdings returns 400 when asset does not exist', async () => {
      const res = await fetch(baseUrl + '/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: 'nonexistent', quantity: 10, average_cost: 1000 })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.ok(data.message.includes('not found'));
    });

    test('POST /api/holdings returns 500 when database error occurs during asset lookup', async () => {
      dbErrorOnAsset = true;
      const res = await fetch(baseUrl + '/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: 'asset-fpt', quantity: 10, average_cost: 1000 })
      });
      dbErrorOnAsset = false;

      const data = await res.json();
      assert.equal(res.status, 500);
      assert.ok(data.message.includes('Database query error'));
      assert.ok(!data.message.includes('not found'));
    });

    test('GET /api/holdings returns only singleton holdings through real route', async () => {
      const res = await fetch(baseUrl + '/api/holdings');
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.ok(data.data.some(h => h.id === 'holding-singleton-fpt'));
      assert.ok(!data.data.some(h => h.id === 'holding-foreign-vcb'));
    });

    test('PUT /api/holdings/:id returns 404 when attempting to mutate foreign profile holding', async () => {
      const res = await fetch(baseUrl + '/api/holdings/holding-foreign-vcb', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 999, average_cost: 1000 })
      });
      assert.equal(res.status, 404);
    });

    test('DELETE /api/holdings/:id returns 404 when attempting to delete foreign profile holding', async () => {
      const res = await fetch(baseUrl + '/api/holdings/holding-foreign-vcb', {
        method: 'DELETE'
      });
      assert.equal(res.status, 404);
    });
  });

  // ==========================================================
  // SECTION 4: FINANCIAL NUMBER VALIDATION LOGIC
  // ==========================================================
  describe('isValidFinancialNumber Unit Logic', () => {
    test('accepts valid finite positive numbers', () => {
      assert.equal(isValidFinancialNumber(100), true);
      assert.equal(isValidFinancialNumber(0.0001), true);
      assert.equal(isValidFinancialNumber(123456789.99), true);
    });

    test('respects allowZero option', () => {
      assert.equal(isValidFinancialNumber(0, { allowZero: true }), true);
      assert.equal(isValidFinancialNumber(0, { allowZero: false }), false);
    });

    test('rejects non-numbers and invalid numbers', () => {
      assert.equal(isValidFinancialNumber('100'), false);
      assert.equal(isValidFinancialNumber(true), false);
      assert.equal(isValidFinancialNumber(false), false);
      assert.equal(isValidFinancialNumber([100]), false);
      assert.equal(isValidFinancialNumber(null), false);
      assert.equal(isValidFinancialNumber(undefined), false);
      assert.equal(isValidFinancialNumber(NaN), false);
      assert.equal(isValidFinancialNumber(Infinity), false);
      assert.equal(isValidFinancialNumber(-1, { allowZero: true }), false);
    });
  });
});
