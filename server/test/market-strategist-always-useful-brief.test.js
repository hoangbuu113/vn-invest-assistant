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
  getCurrentPublishedStrategy,
  getStrategyVersionById,
  listStrategyAssessments
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
    assert.equal(resRefresh.brief.whatChanged.latestPublicationChanges.status, 'INITIAL_PUBLICATION');
    assert.equal(resRefresh.brief.whatChanged.sincePublicationStatus.status, 'NO_FURTHER_MATERIAL_CHANGE');
    assert.match(resRefresh.brief.whatChanged.summary, /chưa xuất hiện thay đổi đủ lớn để phát hành chiến lược mới/);
  });

  // =========================================================================
  // SCENARIO E: No material change -> brief explains unchanged view, not only "KEEP"
  // =========================================================================
  test('E. Initial publication and later KEEP are presented as separate concepts', () => {
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const briefResult = buildDeterministicMarketBrief({
      currentStrategy: {
        strategyId: 'strat_v1',
        previousStrategyId: null,
        publishedAt: '2026-09-06T09:00:00.000Z',
        executiveDecision: {
          stance: 'selective_risk_on',
          conviction: 'medium',
          confidence: 'MEDIUM'
        }
      },
      assessment: {
        result: 'KEEP',
        assessedAt: '2026-09-06T09:30:00.000Z',
        materialChanges: []
      },
      factPacket,
      now: NOW
    });

    const { brief } = briefResult;
    // Must NOT be only "KEEP"
    assert.notEqual(brief.whatChanged.summary.trim(), 'KEEP');
    assert.ok(brief.whatChanged.summary.length > 50);

    assert.equal(brief.whatChanged.latestPublicationChanges.status, 'INITIAL_PUBLICATION');
    assert.equal(brief.whatChanged.sincePublicationStatus.status, 'NO_FURTHER_MATERIAL_CHANGE');
    assert.match(brief.whatChanged.summary, /công bố lần đầu/);
    assert.match(brief.whatChanged.summary, /chưa xuất hiện thay đổi đủ lớn/);
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

  test('K. published strategy and current evidence use separate clocks without mixed numeric vintages', async () => {
    const publishedAt = new Date('2026-09-05T10:00:00.000Z');
    const currentAt = new Date('2026-09-08T10:00:00.000Z');
    const makeObservation = ({ factId, label, value, unit = 'điểm', date, change = null }) => ({
      id: `${factId}:${date}:pub_1`,
      observationId: `${factId}:${date}:pub_1`,
      factId,
      label,
      metric: label,
      value,
      unit,
      change,
      status: 'available',
      freshness: 'fresh',
      source: 'TEST_AUTHORITY',
      observedAt: `${date}T08:00:00.000Z`,
      publishedAt: `${date}T08:30:00.000Z`,
      firstSeenAt: `${date}T09:00:00.000Z`
    });
    const publishedObservations = [
      makeObservation({ factId: 'vn.market.vnindex.close', label: 'VN-Index', value: 1853.08, date: '2026-09-04', change: 25.4 }),
      makeObservation({ factId: 'vn.market.vn30.close', label: 'VN30', value: 1984.89, date: '2026-09-04', change: 23.5 }),
      makeObservation({ factId: 'vn.market.hnx.close', label: 'HNX', value: 284.11, date: '2026-09-04', change: 1.2 }),
      makeObservation({ factId: 'vn.monetary.fx.usd_vnd', label: 'USD/VND', value: 26070, unit: 'VND', date: '2026-09-04', change: 18 }),
      makeObservation({ factId: 'global.intermarket.dxy.quote', label: 'DXY', value: 99.16, date: '2026-09-04', change: 0.2 }),
      makeObservation({ factId: 'global.intermarket.brent.futures', label: 'Brent', value: 95.42, unit: 'USD/thùng', date: '2026-09-04', change: 1.1 }),
      makeObservation({ factId: 'global.intermarket.gold_spot.price', label: 'Gold', value: 4450.25, unit: 'USD/oz', date: '2026-09-04', change: 2.1 }),
      makeObservation({ factId: 'global.intermarket.us10y.yield', label: 'US10Y', value: 4.81, unit: '%', date: '2026-09-04', change: 0.03 }),
      makeObservation({ factId: 'vn.macro.cpi.yoy', label: 'CPI', value: 4.82, unit: '%', date: '2026-08-01' })
    ];
    const currentObservations = [
      makeObservation({ factId: 'vn.market.vnindex.close', label: 'VN-Index', value: 1821.64, date: '2026-09-07', change: -31.44 }),
      makeObservation({ factId: 'vn.market.vn30.close', label: 'VN30', value: 1963.01, date: '2026-09-07', change: -21.88 }),
      makeObservation({ factId: 'vn.market.hnx.close', label: 'HNX', value: 280.6, date: '2026-09-07', change: -3.51 }),
      makeObservation({ factId: 'vn.monetary.fx.usd_vnd', label: 'USD/VND', value: 26054, unit: 'VND', date: '2026-09-07', change: -16 }),
      makeObservation({ factId: 'global.intermarket.dxy.quote', label: 'DXY', value: 98.91, date: '2026-09-07', change: -0.76 }),
      makeObservation({ factId: 'global.intermarket.brent.futures', label: 'Brent', value: 96.28, unit: 'USD/thùng', date: '2026-09-07', change: 1.72 }),
      makeObservation({ factId: 'global.intermarket.gold_spot.price', label: 'Gold', value: 4476.6, unit: 'USD/oz', date: '2026-09-07', change: 2.96 }),
      makeObservation({ factId: 'global.intermarket.us10y.yield', label: 'US10Y', value: 4.78, unit: '%', date: '2026-09-07', change: -0.03 }),
      makeObservation({ factId: 'vn.macro.cpi.yoy', label: 'CPI', value: 4.89, unit: '%', date: '2026-09-01' })
    ];

    const publishedPacket = buildMarketStrategistFactPacket({
      marketObservations: publishedObservations,
      newsArticles: [],
      now: publishedAt
    });
    const initial = await evaluateAndApplyStrategyStability({
      factPacket: publishedPacket,
      now: publishedAt,
      client: null,
      isReadOnly: false,
      generateLlmFn: async () => {
        const candidate = generateDeterministicMarketStrategist({ factPacket: publishedPacket, now: publishedAt });
        return {
          ...candidate,
          assetStrategy: candidate.assetStrategy.map((item) => {
            if (item.assetClass === 'vietnam_equities') {
              return { ...item, rationale: 'VN-Index 1853.08 và VN30 1984.89 hỗ trợ định hướng đã công bố.' };
            }
            if (item.assetClass === 'usd') {
              return { ...item, rationale: 'DXY 99.16 là dữ kiện tại thời điểm công bố.' };
            }
            return item;
          }),
          preferredThemes: [{
            theme: 'Năng lượng',
            stance: 'prefer',
            rationale: 'Brent 95.42 USD/thùng là luận cứ tại thời điểm công bố.',
            evidenceIds: ['global.intermarket.brent.futures:2026-09-04:pub_1']
          }],
          avoidOrUnderweight: [{
            theme: 'Nhạy cảm USD',
            reason: 'DXY 99.16 là luận cứ tại thời điểm công bố.',
            evidenceIds: ['global.intermarket.dxy.quote:2026-09-04:pub_1']
          }],
          invalidationConditions: ['Rà soát nếu VN-Index rời mốc 1853.08 điểm.']
        };
      }
    });
    const keep = await evaluateAndApplyStrategyStability({
      factPacket: publishedPacket,
      now: new Date('2026-09-05T10:05:00.000Z'),
      client: null,
      isReadOnly: false,
      allowLlm: false
    });
    assert.equal(keep.latestAssessmentResult, 'KEEP');
    assert.equal(keep.strategyId, initial.strategyId);
    const beforeVersion = await getStrategyVersionById(initial.strategyId, null);
    const beforeAssessmentCount = (await listStrategyAssessments(initial.strategyId, null)).length;
    const publishedDecision = structuredClone(beforeVersion.executiveDecision);
    const publishedAssetDecisions = beforeVersion.assetStrategy.map(({ assetClass, stance, priority }) => ({ assetClass, stance, priority }));

    const currentPacket = buildMarketStrategistFactPacket({
      marketObservations: currentObservations,
      newsArticles: [],
      now: currentAt
    });
    let providerCalls = 0;
    const result = await evaluateAndApplyStrategyStability({
      factPacket: currentPacket,
      now: currentAt,
      client: null,
      isReadOnly: true,
      allowLlm: false,
      generateLlmFn: async () => {
        providerCalls += 1;
        throw new Error('read-only GET must not call Gemini');
      }
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.strategyId, initial.strategyId);
    assert.equal(result.latestAssessmentResult, 'KEEP');
    assert.equal(result.publishedStrategy.strategyId, initial.strategyId);
    assert.deepEqual(result.publishedStrategy.executiveDecision, publishedDecision);
    assert.deepEqual(
      result.publishedStrategy.assetStrategy.map(({ assetClass, stance, priority }) => ({ assetClass, stance, priority })),
      publishedAssetDecisions
    );
    assert.deepEqual(
      result.currentBrief.assetStrategy.map(({ assetClass, stance, priority }) => ({ assetClass, stance, priority })),
      publishedAssetDecisions
    );

    const currentJson = JSON.stringify(result.currentBrief);
    const publishedJson = JSON.stringify(result.publishedStrategy);
    for (const staleValue of ['1853.08', '1984.89', '284.11', '99.16', '26070', '95.42', '4450.25', '4.81', '4.82']) {
      assert.equal(currentJson.includes(staleValue), false, `stale publication value ${staleValue} leaked into currentBrief`);
    }
    for (const currentValue of ['1821.64', '1963.01', '280.6', '98.91', '26054', '96.28', '4476.6', '4.78', '4.89']) {
      assert.equal(currentJson.includes(currentValue), true, `current value ${currentValue} missing from currentBrief`);
    }
    assert.equal(publishedJson.includes('1853.08'), true);
    assert.equal(publishedJson.includes('1984.89'), true);
    assert.equal(publishedJson.includes('99.16'), true);

    const currentEvidenceIds = new Set(currentPacket.evidence.map((item) => item.id));
    for (const item of result.currentBrief.assetStrategy) {
      for (const evidenceId of item.evidenceIds || []) assert.equal(currentEvidenceIds.has(evidenceId), true);
    }
    for (const item of [...result.currentBrief.preferredThemes, ...result.currentBrief.avoidOrUnderweight]) {
      for (const evidenceId of item.evidenceIds || []) assert.equal(currentEvidenceIds.has(evidenceId), true);
    }

    assert.equal(result.strategyDataAsOf, publishedPacket.dataAsOf);
    assert.equal(result.currentEvidenceDataAsOf, currentPacket.dataAsOf);
    assert.notEqual(result.strategyDataAsOf, result.currentEvidenceDataAsOf);
    assert.equal(result.dataAsOf, result.currentEvidenceDataAsOf, 'legacy dataAsOf must mean current evidence cutoff');

    const view = buildMarketStrategistViewModel(result);
    assert.equal(view.currentEvidenceDataAsOf, result.currentEvidenceDataAsOf);
    assert.equal(view.dataAsOf, result.currentEvidenceDataAsOf);
    assert.match(view.dataAsOfLabel, /Bằng chứng hiện tại cập nhật đến:/);
    assert.match(view.strategyDataAsOfLabel, /Chiến lược công bố theo dữ liệu đến:/);
    assert.equal(JSON.stringify(view.assetStrategy).includes('1853.08'), false);

    const afterVersion = await getStrategyVersionById(initial.strategyId, null);
    const afterAssessmentCount = (await listStrategyAssessments(initial.strategyId, null)).length;
    assert.deepEqual(afterVersion, beforeVersion, 'read-only projection must not mutate the immutable StrategyVersion');
    assert.equal(afterAssessmentCount, beforeAssessmentCount, 'read-only projection must not create an assessment or StrategyVersion');
  });
});
