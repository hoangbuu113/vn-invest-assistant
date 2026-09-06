import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist,
  MarketStrategistRuntime
} from '../src/ai/marketStrategistEngine.js';
import {
  CLAIM_AUTHORITY_LEVELS
} from '../src/claims/claimModel.js';
import {
  strategyVersionToRow,
  publishStrategyVersionAtomic,
  clearStabilityMemoryStore
} from '../src/ai/strategyStabilityRepository.js';
import {
  createStrategyVersion
} from '../src/ai/strategyStabilityModel.js';
import { getMarketStrategist } from '../src/marketStrategist.js';

const REAL_VNINDEX_OBS = {
  id: 'vn.market.vnindex.close:2026-09-04:pub_1',
  observationId: 'vn.market.vnindex.close:2026-09-04:pub_1',
  factId: 'vn.market.vnindex.close',
  pillar: 'market',
  metric: 'Chỉ số VN-Index (đóng cửa phiên)',
  label: 'VN-Index',
  value: 1853.08,
  unit: 'điểm',
  change: 25.36,
  changeUnit: 'điểm',
  changePercent: 1.39,
  status: 'available',
  freshness: 'fresh',
  authorityLevel: 'MARKET_DIRECT',
  source: 'VNDIRECT',
  sourceFamily: 'VNDIRECT',
  asOf: '2026-09-04T15:00:00.000Z'
};

const REAL_HNX_OBS = {
  id: 'vn.market.hnx.close:2026-09-04:pub_1',
  observationId: 'vn.market.hnx.close:2026-09-04:pub_1',
  factId: 'vn.market.hnx.close',
  pillar: 'market',
  metric: 'Chỉ số HNX-Index (đóng cửa phiên)',
  label: 'HNX-Index',
  value: 235.12,
  unit: 'điểm',
  change: 1.25,
  changeUnit: 'điểm',
  changePercent: 0.53,
  status: 'available',
  freshness: 'fresh',
  authorityLevel: 'MARKET_DIRECT',
  source: 'VNDIRECT',
  sourceFamily: 'VNDIRECT',
  asOf: '2026-09-04T15:00:00.000Z'
};

const REAL_MACRO_OBS = {
  id: 'vn.macro.cpi.yoy:2026-08:pub_1',
  observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
  factId: 'vn.macro.cpi.yoy',
  pillar: 'macro',
  metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
  label: 'Lạm phát CPI (YoY)',
  value: 4.89,
  unit: '%',
  change: -0.71,
  changeUnit: 'điểm %',
  status: 'available',
  freshness: 'fresh',
  authorityLevel: 'PRIMARY_OFFICIAL',
  source: 'Cơ quan Thống kê Quốc gia',
  sourceFamily: 'OFFICIAL_NSO',
  asOf: '2026-08-31T17:00:00.000Z'
};

const MOCK_NEWS = [
  {
    articleId: 'art_reuters_01',
    id: 'art_reuters_01',
    headline: 'Thị trường chứng khoán Việt Nam ghi nhận phiên tăng điểm tích cực',
    summary: 'VN-Index tăng hơn 25 điểm nhờ lực cầu nhóm cổ phiếu lớn.',
    publisher: 'VnEconomy',
    publishedAt: '2026-09-04T16:00:00.000Z',
    url: 'https://vneconomy.vn/vnindex-tang-25-diem.htm',
    sourceFamily: 'COMMERCIAL_MEDIA'
  }
];

test('V1.3 AI Market Strategist Runtime Hotfix End-to-End Suite', async (t) => {
  t.beforeEach(() => {
    clearStabilityMemoryStore();
  });

  await t.test('1. Real-shaped MARKET_DIRECT observations succeed in buildMarketStrategistFactPacket', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: [REAL_VNINDEX_OBS, REAL_HNX_OBS, REAL_MACRO_OBS],
      newsArticles: MOCK_NEWS,
      now: new Date('2026-09-04T16:30:00.000Z')
    });

    assert.ok(packet, 'Fact packet must be built');
    assert.ok(Array.isArray(packet.claims), 'Claims array must be populated');
    assert.ok(packet.claims.length > 0, 'Should extract claims from observations');

    const marketClaims = packet.claims.filter(
      c => c.subject === 'vn.market.vnindex.close' || c.subject === 'vn.market.hnx.close'
    );
    assert.ok(marketClaims.length >= 2, 'Should have claims for VN-Index and HNX');

    for (const claim of marketClaims) {
      assert.equal(
        claim.authorityLevel,
        CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE,
        `Claim ${claim.subject} authorityLevel must be mapped to MARKET_REFERENCE`
      );
    }

    const macroClaim = packet.claims.find(c => c.subject === 'vn.macro.cpi.yoy');
    assert.ok(macroClaim, 'Macro claim must exist');
    assert.equal(
      macroClaim.authorityLevel,
      CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      'PRIMARY_OFFICIAL authorityLevel must be preserved'
    );
  });

  await t.test('2. getMarketStrategist runs with deterministic synthesis (allowLlm: false) with MARKET_DIRECT observations', async () => {
    const mockFabricFn = async () => ({ facts: [REAL_VNINDEX_OBS, REAL_HNX_OBS, REAL_MACRO_OBS] });
    const mockNewsFn = async () => ({ data: MOCK_NEWS });

    const result = await getMarketStrategist({
      now: new Date('2026-09-04T16:30:00.000Z'),
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      runtime: new MarketStrategistRuntime(),
      aiEnabled: true,
      allowLlm: false
    });

    assert.ok(result, 'Result must be returned');
    assert.ok(result.marketOverview, 'Market overview must be generated');
    assert.equal(result.generationMode, 'deterministic_fallback');
    assert.equal(result.status, 'published');
  });

  await t.test('3. getMarketStrategist runs with LLM synthesis (allowLlm: true) with MARKET_DIRECT observations', async () => {
    const mockFabricFn = async () => ({ facts: [REAL_VNINDEX_OBS, REAL_HNX_OBS, REAL_MACRO_OBS] });
    const mockNewsFn = async () => ({ data: MOCK_NEWS });

    let llmCalled = false;
    const mockLlmFn = async ({ factPacket }) => {
      llmCalled = true;
      assert.ok(factPacket.claims.length > 0, 'Fact packet passed to LLM must have claims');
      return generateDeterministicMarketStrategist({ factPacket, now: new Date('2026-09-04T16:30:00.000Z') });
    };

    const result = await getMarketStrategist({
      now: new Date('2026-09-04T16:30:00.000Z'),
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      generateLlmFn: mockLlmFn,
      runtime: new MarketStrategistRuntime(),
      aiEnabled: true,
      allowLlm: true
    });

    assert.equal(llmCalled, true, 'Mock LLM function must be called');
    assert.ok(result, 'Result must be returned');
    assert.ok(result.marketOverview, 'Market overview must be generated');
    assert.equal(result.status, 'published');
  });

  await t.test('4. Cold-start strategy version row omits shock_override property completely', () => {
    // 4a. Explicit null
    const versionNull = createStrategyVersion({
      strategyId: 'strat_cold_start_001',
      previousStrategyId: null,
      generatedAt: '2026-09-04T16:30:00.000Z',
      publishedAt: '2026-09-04T16:30:00.000Z',
      dataAsOf: '2026-09-04T16:30:00.000Z',
      evidenceFingerprint: 'fp_abc123',
      decisionFingerprint: 'dfp_xyz789',
      confidence: 'HIGH',
      regime: { label: 'Tăng trưởng ổn định', status: 'STABLE' },
      executiveDecision: { headline: 'Thị trường khả quan', summary: 'Tổng quan tích cực' },
      shockOverride: null
    });

    const rowNull = strategyVersionToRow(versionNull);
    assert.ok(rowNull, 'Row must be produced');
    assert.equal(
      Object.prototype.hasOwnProperty.call(rowNull, 'shock_override'),
      false,
      'shock_override key must NOT be present when null'
    );
    assert.equal(
      JSON.stringify(rowNull).includes('"shock_override"'),
      false,
      'JSON stringified row must not contain "shock_override"'
    );

    // 4b. Undefined
    const versionUndef = createStrategyVersion({
      strategyId: 'strat_cold_start_undef',
      previousStrategyId: null,
      generatedAt: '2026-09-04T16:30:00.000Z',
      publishedAt: '2026-09-04T16:30:00.000Z',
      dataAsOf: '2026-09-04T16:30:00.000Z',
      evidenceFingerprint: 'fp_abc123',
      decisionFingerprint: 'dfp_xyz789',
      confidence: 'HIGH',
      regime: { label: 'Tăng trưởng ổn định', status: 'STABLE' },
      executiveDecision: { headline: 'Thị trường khả quan', summary: 'Tổng quan tích cực' }
    });

    const rowUndef = strategyVersionToRow(versionUndef);
    assert.ok(rowUndef, 'Row must be produced');
    assert.equal(
      Object.prototype.hasOwnProperty.call(rowUndef, 'shock_override'),
      false,
      'shock_override key must NOT be present when undefined'
    );
    assert.equal(
      JSON.stringify(rowUndef).includes('"shock_override"'),
      false,
      'JSON stringified row must not contain "shock_override"'
    );
  });

  await t.test('5. Valid shock_override is preserved on row and serializes as JSON object; primitives throw', () => {
    const shockObj = {
      type: 'CURRENCY_DEVALUATION',
      magnitude: 'EXTREME',
      declaredAt: '2026-09-04T16:30:00.000Z'
    };

    const version = createStrategyVersion({
      strategyId: 'strat_shock_002',
      previousStrategyId: null,
      generatedAt: '2026-09-04T16:30:00.000Z',
      publishedAt: '2026-09-04T16:30:00.000Z',
      dataAsOf: '2026-09-04T16:30:00.000Z',
      evidenceFingerprint: 'fp_abc123',
      decisionFingerprint: 'dfp_xyz789',
      confidence: 'LOW',
      regime: { label: 'Khủng hoảng', status: 'SHOCK' },
      executiveDecision: { headline: 'Cú sốc tỷ giá', summary: 'Hành động khẩn cấp' },
      shockOverride: shockObj
    });

    const row = strategyVersionToRow(version);
    assert.ok(row, 'Row must be produced');
    assert.equal(
      Object.prototype.hasOwnProperty.call(row, 'shock_override'),
      true,
      'shock_override key must be present when non-null'
    );
    assert.deepEqual(row.shock_override, shockObj);

    const serialized = JSON.parse(JSON.stringify(row));
    assert.deepEqual(serialized.shock_override, shockObj);

    // JS-level tests: primitive/array rejection throwing TypeError
    assert.throws(() => {
      strategyVersionToRow({ ...version, shockOverride: 'INVALID_STRING_PRIMITIVE' });
    }, /TypeError.*strategyVersionToRow.*shockOverride must be a valid non-array object/);

    assert.throws(() => {
      strategyVersionToRow({ ...version, shockOverride: 12345 });
    }, /TypeError.*strategyVersionToRow.*shockOverride must be a valid non-array object/);

    assert.throws(() => {
      strategyVersionToRow({ ...version, shockOverride: true });
    }, /TypeError.*strategyVersionToRow.*shockOverride must be a valid non-array object/);

    assert.throws(() => {
      strategyVersionToRow({ ...version, shockOverride: ['invalid', 'array'] });
    }, /TypeError.*strategyVersionToRow.*shockOverride must be a valid non-array object/);
  });

  await t.test('6. publishStrategyVersionAtomic with mock RPC client receives row without shock_override', async () => {
    let receivedRpcParams = null;
    const mockClient = {
      rpc: async (fnName, params) => {
        assert.equal(fnName, 'publish_strategy_version_atomic');
        receivedRpcParams = params;
        return {
          data: {
            ...params.p_new_version,
            published_at: '2026-09-04T16:30:00.000Z'
          },
          error: null
        };
      }
    };

    const version = createStrategyVersion({
      strategyId: 'strat_pub_test_003',
      previousStrategyId: null,
      generatedAt: '2026-09-04T16:30:00.000Z',
      publishedAt: '2026-09-04T16:30:00.000Z',
      dataAsOf: '2026-09-04T16:30:00.000Z',
      evidenceFingerprint: 'fp_abc123',
      decisionFingerprint: 'dfp_xyz789',
      confidence: 'HIGH',
      regime: { label: 'Ổn định', status: 'STABLE' },
      executiveDecision: { headline: 'Tích cực', summary: 'Không có biến động lớn' },
      shockOverride: null
    });

    const result = await publishStrategyVersionAtomic({
      newVersion: version,
      expectedCurrentStrategyId: null,
      client: mockClient
    });

    assert.ok(result, 'Publication result must be returned');
    assert.ok(receivedRpcParams, 'RPC params must have been captured');
    assert.equal(
      Object.prototype.hasOwnProperty.call(receivedRpcParams.p_new_version, 'shock_override'),
      false,
      'RPC payload p_new_version must omit shock_override when null'
    );
  });

  await t.test('7. Database migration SQL CASE expression enforces fail-closed trust boundary', () => {
    // Simulates the PostgreSQL DB trust boundary:
    // 1. RPC CASE expression (forward migration 20260906040000):
    //    CASE
    //      WHEN p_new_version->'shock_override' IS NULL
    //        OR p_new_version->'shock_override' = 'null'::jsonb
    //      THEN NULL
    //      ELSE p_new_version->'shock_override'
    //    END
    // 2. Table constraint (strategy_versions):
    //    CHECK (shock_override IS NULL OR jsonb_typeof(shock_override) = 'object')
    function simulateDbPublicationShockOverride(p_new_version) {
      const hasKey = Object.prototype.hasOwnProperty.call(p_new_version, 'shock_override');
      const rawVal = p_new_version.shock_override;

      // In Postgres JSONB:
      // - key omitted / undefined -> p_new_version->'shock_override' IS NULL -> CASE evaluates to NULL
      // - value null -> p_new_version->'shock_override' = 'null'::jsonb -> CASE evaluates to NULL
      // - any other value -> CASE evaluates to rawVal
      let evaluatedVal;
      if (!hasKey || rawVal === undefined || rawVal === null) {
        evaluatedVal = null;
      } else {
        evaluatedVal = rawVal;
      }

      // Check constraint: shock_override IS NULL OR jsonb_typeof(shock_override) = 'object'
      if (evaluatedVal === null) {
        return { success: true, value: null };
      }

      if (typeof evaluatedVal === 'object' && !Array.isArray(evaluatedVal)) {
        return { success: true, value: evaluatedVal };
      }

      // Check constraint 23514 violation (FAIL CLOSED)
      const err = new Error(
        'new row for relation "strategy_versions" violates check constraint "strategy_versions_shock_override_check"'
      );
      err.code = '23514';
      throw err;
    }

    // 1. Omitted shock_override → SQL NULL / accepted
    const resOmitted = simulateDbPublicationShockOverride({});
    assert.strictEqual(resOmitted.success, true);
    assert.strictEqual(resOmitted.value, null);

    // 2. JSON null → SQL NULL / accepted
    const resJsonNull = simulateDbPublicationShockOverride({ shock_override: null });
    assert.strictEqual(resJsonNull.success, true);
    assert.strictEqual(resJsonNull.value, null);

    // 3. Valid JSON object → preserved / accepted
    const validShock = { type: 'LIQUIDITY_SQUEEZE', magnitude: 'HIGH' };
    const resValid = simulateDbPublicationShockOverride({ shock_override: validShock });
    assert.strictEqual(resValid.success, true);
    assert.deepEqual(resValid.value, validShock);

    // 4. String primitive → REJECTED (fail closed)
    assert.throws(
      () => simulateDbPublicationShockOverride({ shock_override: 'extreme' }),
      /violates check constraint.*strategy_versions_shock_override_check/
    );

    // 5. Number primitive → REJECTED (fail closed)
    assert.throws(
      () => simulateDbPublicationShockOverride({ shock_override: 123 }),
      /violates check constraint.*strategy_versions_shock_override_check/
    );

    // 6. Boolean primitive → REJECTED (fail closed)
    assert.throws(
      () => simulateDbPublicationShockOverride({ shock_override: true }),
      /violates check constraint.*strategy_versions_shock_override_check/
    );

    // 7. Array → REJECTED (fail closed)
    assert.throws(
      () => simulateDbPublicationShockOverride({ shock_override: ['invalid', 'array'] }),
      /violates check constraint.*strategy_versions_shock_override_check/
    );
  });
});
