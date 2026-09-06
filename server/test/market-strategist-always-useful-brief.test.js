import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist,
  generateMarketStrategist,
  globalMarketStrategistRuntime
} from '../src/ai/marketStrategistEngine.js';
import {
  buildDeterministicMarketBrief,
  BRIEF_SECTIONS
} from '../src/ai/marketStrategistBrief.js';
import {
  evaluateAndApplyStrategyStability
} from '../src/ai/strategyStabilityService.js';
import {
  clearStabilityMemoryStore,
  getCurrentPublishedStrategy
} from '../src/ai/strategyStabilityRepository.js';
import {
  buildMarketStrategistViewModel
} from '../../client/src/utils/marketStrategistDisplay.js';

const NOW = new Date('2026-09-06T10:00:00.000Z');

const MOCK_OBSERVATIONS = [
  {
    id: 'vn.market.vnindex.close:2026-09-04:pub_1',
    observationId: 'vn.market.vnindex.close:2026-09-04:pub_1',
    factId: 'vn.market.vnindex.close',
    pillar: 'market',
    metric: 'Chỉ số VN-Index (đóng cửa phiên)',
    label: 'VN-Index',
    value: 1280.5,
    unit: 'điểm',
    change: 8.2,
    changeUnit: 'điểm',
    changePercent: 0.64,
    status: 'available',
    freshness: 'fresh',
    source: 'VNDIRECT'
  },
  {
    id: 'vn.macro.cpi.yoy:2026-08:pub_1',
    observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
    label: 'Lạm phát CPI (YoY)',
    value: 3.45,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: 'GSO'
  },
  {
    id: 'vn.monetary.fx.usd_vnd:2026-09-04:pub_1',
    observationId: 'vn.monetary.fx.usd_vnd:2026-09-04:pub_1',
    factId: 'vn.monetary.fx.usd_vnd',
    pillar: 'monetary',
    metric: 'Tỷ giá USD/VND liên ngân hàng',
    label: 'USD/VND',
    value: 25420,
    unit: 'VND',
    status: 'available',
    freshness: 'fresh',
    source: 'SBV'
  },
  {
    id: 'global.intermarket.dxy.quote:2026-09-04:pub_1',
    observationId: 'global.intermarket.dxy.quote:2026-09-04:pub_1',
    factId: 'global.intermarket.dxy.quote',
    pillar: 'global',
    metric: 'Chỉ số sức mạnh đồng USD (DXY)',
    label: 'DXY',
    value: 104.2,
    unit: 'điểm',
    status: 'available',
    freshness: 'fresh',
    source: 'MARKET_DIRECT'
  },
  {
    id: 'global.intermarket.us10y.yield:2026-09-04:pub_1',
    observationId: 'global.intermarket.us10y.yield:2026-09-04:pub_1',
    factId: 'global.intermarket.us10y.yield',
    pillar: 'global',
    metric: 'Lợi suất Trái phiếu Chính phủ Mỹ 10 năm',
    label: 'US 10Y Yield',
    value: 4.25,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: 'MARKET_DIRECT'
  }
];

const MOCK_NEWS = [
  {
    id: 'art_macro_1',
    articleId: 'art_macro_1',
    headline: 'Thị trường chứng khoán duy trì dòng tiền ổn định tại các nhóm cổ phiếu cơ bản',
    source: 'VnEconomy',
    publishedAt: '2026-09-05T08:00:00.000Z'
  }
];

describe('V1.4 — 01A Always-Useful Market Strategist Brief Test Suite', { concurrency: 1 }, () => {
  beforeEach(() => {
    clearStabilityMemoryStore();
    globalMarketStrategistRuntime.clear();
  });

  // =========================================================================
  // SCENARIO A: GET strategist with current strategy + no Gemini narrative
  // =========================================================================
  test('A. GET strategist with current strategy + no Gemini narrative returns meaningful deterministic brief', async () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    // 1. Initial review: publish initial strategy version using in-memory store (client: null)
    const initialResult = await evaluateAndApplyStrategyStability({
      factPacket,
      now: NOW,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now: NOW })
    });

    assert.equal(initialResult.latestAssessmentResult, 'PUBLISH_NEW');
    assert.ok(initialResult.strategyId);

    // 2. Read-only GET request (e.g. GET /api/market-strategist on initial page load)
    const getResult = await evaluateAndApplyStrategyStability({
      factPacket,
      now: new Date('2026-09-06T11:00:00.000Z'),
      client: null,
      isReadOnly: true
    });

    assert.equal(getResult.strategyId, initialResult.strategyId);
    assert.ok(getResult.brief, 'Expected full 7-section brief contract on GET');

    const { brief } = getResult;
    // Section A: marketView
    assert.ok(brief.marketView, 'Missing marketView');
    assert.ok(brief.marketView.headline.length > 20, 'marketView headline must be substantial');
    assert.ok(brief.marketView.explanation.length > 30, 'marketView explanation must be substantial');
    assert.match(brief.marketView.headline, /[a-zA-ZÀ-ỹ]/, 'marketView headline must be in Vietnamese');

    // Section B: why
    assert.ok(brief.why, 'Missing why');
    assert.ok(brief.why.factors.length >= 2, 'Expected at least 2 verified why factors');
    assert.ok(brief.why.summary.length > 20, 'why summary must be substantial');

    // Section C: whatChanged
    assert.ok(brief.whatChanged, 'Missing whatChanged');
    assert.ok(brief.whatChanged.summary.length > 20, 'whatChanged summary must explain stance');

    // Section D: risks
    assert.ok(brief.risks, 'Missing risks');
    assert.ok(brief.risks.keyRisks.length > 0, 'risks must have keyRisks');
    assert.ok(brief.risks.invalidationConditions.length > 0, 'risks must have invalidationConditions');

    // Section E: whatToWatch
    assert.ok(brief.whatToWatch, 'Missing whatToWatch');
    assert.ok(brief.whatToWatch.items.length > 0, 'whatToWatch must have items');

    // Section F: dataContext
    assert.ok(brief.dataContext, 'Missing dataContext');
    assert.ok(brief.dataContext.freshness, 'dataContext must report freshness');

    // Section G: sources
    assert.ok(brief.sources, 'Missing sources');
    assert.ok(brief.sources.citations.factObservationIds.length > 0, 'sources must have factObservationIds');
  });

  // =========================================================================
  // SCENARIO B: Gemini unavailable -> useful deterministic brief still returned
  // =========================================================================
  test('B. Gemini unavailable (network failure / 503) returns useful deterministic brief', async () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    // 1. Initial publication establishing current strategy
    const initialResult = await evaluateAndApplyStrategyStability({
      factPacket,
      now: NOW,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now: NOW })
    });
    assert.ok(initialResult.strategyId);

    // 2. Refresh/review cycle where Gemini provider is unavailable (e.g. HTTP 503)
    const reviewTime = new Date('2026-09-06T12:00:00.000Z');
    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      now: reviewTime,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => {
        const error = new Error('AI Provider Unavailable (HTTP 503)');
        error.status = 503;
        throw error;
      }
    });

    // Current strategyId is preserved, and a useful deterministic brief is returned
    assert.equal(result.strategyId, initialResult.strategyId);
    assert.ok(result.brief, 'Expected brief even when Gemini fails');
    assert.ok(result.brief.marketView.headline.length > 15);
    assert.ok(result.brief.why.factors.length > 0);
    assert.ok(result.brief.sources.citations.factObservationIds.length > 0);
    assert.ok(!result.brief.marketView.headline.includes('503'));
  });

  // =========================================================================
  // SCENARIO C: Gemini rejected -> useful deterministic brief still returned
  // =========================================================================
  test('C. Gemini rejected (invalid citation or schema violation) returns useful deterministic brief', async () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    // LLM produces output with hallucinated citation ID not in factPacket
    const result = await generateMarketStrategist({
      factPacket,
      now: NOW,
      allowLlm: true,
      generateLlmFn: async () => ({
        executiveDecision: {
          stance: 'selective_risk_on',
          conviction: 'high',
          confidence: 'HIGH',
          oneLineDecision: 'Mua mạnh cổ phiếu bất động sản',
          actionNow: 'Giải ngân toàn bộ'
        },
        assetStrategy: [
          {
            assetClass: 'vietnam_equities',
            stance: 'increase',
            priority: 'high',
            rationale: 'Kỳ vọng tăng mạnh',
            evidenceIds: ['hallucinated.fact.id.that.does.not.exist'],
            conclusionType: 'ASSET_BIAS',
            supportStatus: 'supported'
          }
        ],
        marketOverview: { vietnam: 'Tốt', global: 'Tốt' },
        keyDrivers: [{ driver: 'Dòng tiền', evidenceIds: ['hallucinated.fact.id'] }],
        risksAndInvalidation: { keyRisks: ['Rủi ro'], invalidationConditions: ['Khi giảm'] },
        citations: { factObservationIds: ['hallucinated.fact.id'] }
      })
    });

    // Should reject LLM and return deterministic fallback with full brief
    assert.equal(result.generationMode, 'deterministic_fallback');
    assert.ok(result.brief, 'Expected complete brief in fallback');
    assert.ok(result.brief.marketView.headline.length > 20);
    assert.ok(result.brief.why.factors.length >= 2);
    // Hallucinated ID must not be in sources
    assert.ok(!result.brief.sources.citations.factObservationIds.includes('hallucinated.fact.id.that.does.not.exist'));
  });

  // =========================================================================
  // SCENARIO D: Assessment KEEP -> strategyId unchanged, refreshed brief contains latest evidence/context
  // =========================================================================
  test('D. Assessment KEEP: strategyId unchanged, refreshed brief contains latest evidence and context', async () => {
    const factPacket1 = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    // 1. Initial publication
    const res1 = await evaluateAndApplyStrategyStability({
      factPacket: factPacket1,
      now: NOW,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket: factPacket1, now: NOW })
    });
    const strategyId1 = res1.strategyId;
    assert.ok(strategyId1);

    // 2. Refresh button clicked with identical market state -> triggers KEEP
    const laterTime = new Date('2026-09-06T14:30:00.000Z');
    const resRefresh = await evaluateAndApplyStrategyStability({
      factPacket: factPacket1,
      now: laterTime,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket: factPacket1, now: laterTime })
    });

    // Invariant: strategyId must remain UNCHANGED
    assert.equal(resRefresh.latestAssessmentResult, 'KEEP');
    assert.equal(resRefresh.strategyId, strategyId1, 'strategyId must remain unchanged on KEEP');

    // Invariant: brief is refreshed with context and data
    assert.ok(resRefresh.brief, 'KEEP response must include refreshed brief');
    assert.ok(resRefresh.brief.whatChanged.summary.length > 30, 'whatChanged summary must be substantive');
    assert.equal(resRefresh.brief.whatChanged.hasMaterialChange, false);
    assert.match(resRefresh.brief.whatChanged.summary, /Quan điểm thị trường hiện chưa thay đổi/);
  });

  // =========================================================================
  // SCENARIO E: No material change -> brief explains unchanged view, not only "KEEP"
  // =========================================================================
  test('E. No material change: brief explains unchanged view in Vietnamese, not merely "KEEP"', () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const briefResult = buildDeterministicMarketBrief({
      currentStrategy: {
        id: 'strat_v1',
        executiveDecision: {
          stance: 'selective_risk_on',
          conviction: 'medium',
          confidence: 'MEDIUM'
        }
      },
      assessment: {
        result: 'KEEP',
        materialChanges: []
      },
      factPacket,
      now: NOW
    });

    const { brief } = briefResult;
    // Must NOT be only "KEEP"
    assert.notEqual(brief.whatChanged.summary.trim(), 'KEEP');
    assert.ok(brief.whatChanged.summary.length > 50);

    // Must mention actual market metrics in Vietnamese
    assert.match(brief.whatChanged.summary, /Quan điểm thị trường hiện chưa thay đổi/);
    assert.match(brief.whatChanged.summary, /VN-Index/);
    assert.match(brief.whatChanged.summary, /CPI/);
    assert.match(brief.whatChanged.summary, /USD\/VND/);
  });

  // =========================================================================
  // SCENARIO F: Limited evidence -> brief remains truthful and useful (missing != 0)
  // =========================================================================
  test('F. Limited evidence: brief remains truthful and useful, missing != 0, no fabricated figures', () => {
    // Empty observation packet
    const emptyPacket = buildMarketStrategistFactPacket({
      marketObservations: [],
      newsArticles: [],
      now: NOW
    });

    const briefResult = buildDeterministicMarketBrief({
      factPacket: emptyPacket,
      now: NOW
    });

    const { brief } = briefResult;
    assert.ok(brief.marketView.headline.includes('chưa đầy đủ') || brief.marketView.headline.includes('thận trọng'));
    assert.ok(brief.whatChanged.summary.includes('chưa đủ bằng chứng'));
    assert.equal(brief.marketView.stance, 'neutral');
    assert.equal(brief.marketView.confidence, 'LOW');

    // Missing observations must NOT be converted to 0
    assert.ok(!brief.why.summary.includes('0 điểm'));
    assert.ok(!brief.why.summary.includes('0%'));
    assert.ok(!brief.why.summary.includes('0 VND'));

    // No allocation percentages fabricated in actionNow
    assert.doesNotMatch(briefResult.executiveDecision.actionNow, /\d+%/);
  });

  // =========================================================================
  // SCENARIO G: Every positive factual statement is grounded by supplied evidence
  // =========================================================================
  test('G. Every positive factual statement cites supplied evidence IDs', () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const briefResult = buildDeterministicMarketBrief({
      factPacket,
      now: NOW
    });

    const { brief } = briefResult;
    const suppliedObsIds = new Set(MOCK_OBSERVATIONS.map((o) => o.id));

    // Check why.factors
    for (const factor of brief.why.factors) {
      assert.ok(factor.evidenceIds.length > 0, `Factor "${factor.factor}" has no evidenceIds`);
      for (const evId of factor.evidenceIds) {
        assert.ok(suppliedObsIds.has(evId), `Evidence ID ${evId} was not in supplied observations`);
      }
    }

    // Check assetStrategy evidenceIds
    for (const asset of briefResult.assetStrategy) {
      if (asset.evidenceIds?.length > 0) {
        for (const evId of asset.evidenceIds) {
          assert.ok(suppliedObsIds.has(evId), `Asset evidence ID ${evId} was not in supplied observations`);
        }
      }
    }

    // Check sources citations
    for (const id of brief.sources.citations.factObservationIds) {
      assert.ok(suppliedObsIds.has(id), `Cited ID ${id} was not in supplied observations`);
    }
  });

  // =========================================================================
  // SCENARIO H: No forbidden words (no BUY/SELL/target/probability/opaque score)
  // =========================================================================
  test('H. No forbidden words: no BUY, SELL, target price, probabilities, or opaque proprietary scores', () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const briefResult = buildDeterministicMarketBrief({
      factPacket,
      now: NOW
    });

    const fullJson = JSON.stringify(briefResult).toLowerCase();

    // Forbidden investment command keywords
    assert.doesNotMatch(fullJson, /\bkhuyến nghị mua\b/);
    assert.doesNotMatch(fullJson, /\bkhuyến nghị bán\b/);
    assert.doesNotMatch(fullJson, /\bmục tiêu giá\b/);
    assert.doesNotMatch(fullJson, /\bgiá mục tiêu\b/);
    assert.doesNotMatch(fullJson, /\bxác suất tăng\b/);
    assert.doesNotMatch(fullJson, /\bđiểm số uy tín\b/);
  });

  // =========================================================================
  // SCENARIO I: UI view model never renders technical-only fallback as sole content
  // =========================================================================
  test('I. UI view model never renders technical-only fallback as sole content', () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const deterministicData = generateDeterministicMarketStrategist({ factPacket, now: NOW });
    const vm = buildMarketStrategistViewModel(deterministicData);

    assert.ok(vm, 'View model must be generated');
    assert.ok(vm.marketView, 'View model must include marketView');
    assert.ok(vm.marketView.headline.length > 20, 'marketView headline must be substantive');
    assert.ok(vm.marketView.explanation.length > 30, 'marketView explanation must be substantive');
    assert.ok(vm.why.summary.length > 20, 'why summary must be substantive');
    assert.ok(vm.whatChanged.summary.length > 20, 'whatChanged summary must be substantive');
    assert.ok(vm.risks.keyRisks.length > 0, 'risks must have keyRisks');
    assert.ok(vm.whatToWatch.items.length > 0, 'whatToWatch must have items');

    // Provenance is a secondary badge, NOT the sole content
    assert.equal(vm.generationBadge, 'Xác định');
  });

  // =========================================================================
  // SCENARIO J: Full stability and replay suites remain green
  // =========================================================================
  test('J. End-to-end strategist flow completes cleanly with brief contract attached', async () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const res = await evaluateAndApplyStrategyStability({
      factPacket,
      now: NOW,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now: NOW })
    });

    assert.ok(res.strategyId);
    assert.ok(res.brief);
    assert.equal(typeof res.brief.marketView.headline, 'string');
    assert.equal(typeof res.brief.why.summary, 'string');
    assert.equal(typeof res.brief.whatChanged.summary, 'string');
    assert.ok(Array.isArray(res.brief.risks.keyRisks));
    assert.ok(Array.isArray(res.brief.whatToWatch.items));
    assert.ok(typeof res.brief.dataContext.freshness === 'string');
    assert.ok(Array.isArray(res.brief.sources.citations.factObservationIds));
  });
});
