import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  STRATEGY_LIFECYCLE_STATUSES,
  STABILITY_POLICY_VERSION,
  computeDecisionFingerprint,
  createStrategyVersion,
  createStrategyAssessment,
  assertZeroPrivateData
} from '../src/ai/strategyStabilityModel.js';

import {
  assessStrategyMateriality,
  MATERIALITY_TRIGGER_TYPES
} from '../src/ai/strategyAssessmentGate.js';

import {
  getCurrentPublishedStrategy,
  getStrategyVersionById,
  persistStrategyVersion,
  supersedeStrategyVersion,
  getLatestStrategyAssessment,
  persistStrategyAssessment,
  listStrategyAssessments,
  clearStabilityMemoryStore
} from '../src/ai/strategyStabilityRepository.js';

import {
  evaluateAndApplyStrategyStability
} from '../src/ai/strategyStabilityService.js';

import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  generateDeterministicMarketStrategist
} from '../src/ai/marketStrategistEngine.js';

import { getMarketStrategist } from '../src/marketStrategist.js';
import { createApp } from '../index.js';

const NOW = new Date('2026-09-06T00:00:00.000Z');

const BASELINE_OBSERVATIONS = [
  {
    id: 'vn.market.vnindex.close:2026-09-04:pub_1',
    observationId: 'vn.market.vnindex.close:2026-09-04:pub_1',
    factId: 'vn.market.vnindex.close',
    pillar: 'market',
    metric: 'Chỉ số VN-Index (đóng cửa phiên)',
    label: 'VN-Index',
    value: 1853.08,
    unit: 'điểm',
    status: 'available',
    freshness: 'fresh',
    source: 'VNDIRECT',
    observedAt: '2026-09-04T08:00:00.000Z',
    publishedAt: '2026-09-04T08:05:00.000Z'
  },
  {
    id: 'vn.macro.cpi.yoy:2026-08:pub_1',
    observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
    label: 'Lạm phát CPI (YoY)',
    value: 4.89,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: 'NSO',
    observedAt: '2026-08-31T00:00:00.000Z',
    publishedAt: '2026-09-01T02:00:00.000Z'
  }
];

const BASELINE_NEWS = [
  {
    articleId: 'art_cpi_report_1',
    title: 'CPI tháng 8 tăng 4.89% so với cùng kỳ',
    summary: 'Tổng cục Thống kê công bố số liệu CPI chính thức',
    source: 'CafeF',
    url: 'https://cafef.vn/cpi-thang-8.chn',
    publishedAt: '2026-09-01T03:00:00.000Z',
    geography: 'vietnam'
  }
];

test('V1.3 Strategy Stability — Comprehensive 30-Scenario Specification Suite', async (suite) => {

  suite.beforeEach(() => {
    clearStabilityMemoryStore();
  });

  // 1. evidenceFingerprint unchanged -> KEEP -> no AI
  await suite.test('1. evidenceFingerprint unchanged -> KEEP -> no AI', async () => {
    let aiCalled = false;
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    // Establish initial published strategy
    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });
    assert.equal(initial.latestAssessmentResult, ASSESSMENT_RESULTS.PUBLISH_NEW);

    // Run again with identical packet
    const second = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:15:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        aiCalled = true;
        return {};
      },
      client: null
    });

    assert.equal(aiCalled, false, 'AI must not be called when evidenceFingerprint is unchanged');
    assert.equal(second.strategyId, initial.strategyId);
    assert.equal(second.latestAssessmentResult, ASSESSMENT_RESULTS.KEEP);
    assert.equal(second.latestAssessmentStatus, EVALUATION_STATUSES.COMPLETED);
  });

  // 2. evidenceFingerprint changes from non-material evidence -> KEEP -> same strategyId -> no AI
  await suite.test('2. evidenceFingerprint changes from non-material evidence -> KEEP -> same strategyId -> no AI', async () => {
    let aiCalled = false;
    const packet1 = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet1,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Add a copied/syndicated article from same source family with no new independent claims
    const nonMaterialArticle = {
      articleId: 'art_cpi_report_2',
      title: 'Chi tiết số liệu CPI tháng 8 theo báo cáo thống kê',
      summary: 'Tổng cục Thống kê công bố số liệu CPI chính thức',
      source: 'CafeF',
      url: 'https://cafef.vn/cpi-thang-8-chi-tiet.chn',
      publishedAt: '2026-09-01T03:30:00.000Z',
      geography: 'vietnam'
    };

    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: [...BASELINE_NEWS, nonMaterialArticle],
      now: new Date('2026-09-06T00:20:00.000Z')
    });

    assert.notEqual(
      computeStrategistFingerprint(packet1),
      computeStrategistFingerprint(packet2),
      'Evidence fingerprint must change due to new article version'
    );

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packet2,
      now: new Date('2026-09-06T00:20:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        aiCalled = true;
        return {};
      },
      client: null
    });

    assert.equal(aiCalled, false, 'AI must not be called for non-material syndicated news');
    assert.equal(result.strategyId, initial.strategyId);
    assert.equal(result.latestAssessmentResult, ASSESSMENT_RESULTS.KEEP);
  });

  // 3. evidence changes requiring review -> AI path allowed
  await suite.test('3. evidence changes requiring review -> AI path allowed', async () => {
    let aiCalled = false;
    const packet1 = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    await evaluateAndApplyStrategyStability({
      factPacket: packet1,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Introduce an official revision on the consumed CPI fact
    const revisedObservations = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        value: 5.12,
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1'
      }
    ];

    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: revisedObservations,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T00:30:00.000Z')
    });

    await evaluateAndApplyStrategyStability({
      factPacket: packet2,
      now: new Date('2026-09-06T00:30:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        aiCalled = true;
        return {
          marketOverview: 'Tỷ lệ lạm phát được điều chỉnh tăng.',
          regime: { status: 'DEFENSIVE', directionalStance: 'CAUTIOUS', marketPhase: 'CONTRACTION' },
          keyDrivers: [{ title: 'CPI điều chỉnh', impact: 'negative', citations: ['vn.macro.cpi.yoy:2026-08:pub_revised'] }],
          executiveDecision: { stance: 'CAUTIOUS', primaryAction: 'reduce_risk', oneLineDecision: 'Hạ tỷ trọng do lạm phát tăng.' },
          assetStrategy: [{ assetClass: 'VN_STOCK', posture: 'UNDERWEIGHT', primaryAction: 'reduce_risk', evidenceIds: ['vn.macro.cpi.yoy:2026-08:pub_revised'] }],
          preferredThemes: ['CASH_PRESERVATION'],
          avoidOrUnderweight: ['HIGH_BETA_EQUITY'],
          riskOverlay: { posture: 'DEFENSIVE', constraints: ['LIMIT_LEVERAGE'], riskBudget: 0.3 },
          horizon: 'medium',
          confidence: 'HIGH'
        };
      },
      client: null
    });

    assert.equal(aiCalled, true, 'AI path must be allowed when material revision arrives');
  });

  // 4. candidate decisionFingerprint unchanged -> no new strategy version
  await suite.test('4. candidate decisionFingerprint unchanged -> no new strategy version', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Material trigger introduced, but candidate produces identical decision posture
    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      { ...BASELINE_OBSERVATIONS[1], revision: 'revised', value: 4.90 }
    ];
    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T01:00:00.000Z')
    });

    const candidateSameDecision = {
      ...initial,
      // Different explanatory prose, but identical decision fields
      executiveDecision: {
        ...initial.executiveDecision,
        oneLineDecision: 'Đánh giá lại số liệu, quyết định hành động giữ nguyên hoàn toàn.'
      }
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packet2,
      now: new Date('2026-09-06T01:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => candidateSameDecision,
      client: null
    });

    assert.equal(result.strategyId, initial.strategyId, 'Strategy ID must not change when decisionFingerprint is identical');
    assert.equal(result.decisionFingerprint, initial.decisionFingerprint);
  });

  // 5. wording-only difference -> same decisionFingerprint
  await suite.test('5. wording-only difference -> same decisionFingerprint', async () => {
    const briefA = {
      regime: { status: 'NEUTRAL', directionalStance: 'BALANCED', marketPhase: 'CONSOLIDATION' },
      executiveDecision: { stance: 'BALANCED', primaryAction: 'accumulate_selectively', oneLineDecision: 'Duy trì tỷ trọng cổ phiếu phòng thủ.' },
      assetStrategy: [{ assetClass: 'VN_STOCK', posture: 'BALANCED', action: 'accumulate' }],
      preferredThemes: ['UTILITIES'],
      avoidOrUnderweight: ['SPECULATIVE'],
      riskOverlay: { posture: 'NEUTRAL', constraints: ['NO_MARGIN'] },
      horizon: 'medium',
      invalidationConditions: ['cpi > 5%']
    };

    const briefB = {
      ...briefA,
      // Completely different wording in prose fields that are non-decision
      commentary: 'Thị trường có nhiều tin tức mới nhưng các chỉ báo kỹ thuật vẫn trong biên độ hẹp.',
      summary: 'Tóm tắt chiến lược thị trường tuần này.',
      gateAudit: { valid: true, auditedAt: '2026-09-06T12:00:00.000Z' }
    };

    const fpA = computeDecisionFingerprint(briefA);
    const fpB = computeDecisionFingerprint(briefB);
    assert.equal(fpA, fpB, 'Wording differences must produce identical decisionFingerprint');
  });

  // 6. reordered themes/assets -> same fingerprint when semantic order is irrelevant
  await suite.test('6. reordered themes/assets -> same fingerprint when semantic order is irrelevant', async () => {
    const brief1 = {
      regime: { status: 'EXPANSION', directionalStance: 'BULLISH', marketPhase: 'ACCUMULATION' },
      executiveDecision: { stance: 'BULLISH', primaryAction: 'increase_exposure', oneLineDecision: 'Tăng tỷ trọng.' },
      assetStrategy: [
        { assetClass: 'VN_STOCK', posture: 'OVERWEIGHT', action: 'buy' },
        { assetClass: 'CRYPTO', posture: 'NEUTRAL', action: 'hold' }
      ],
      preferredThemes: ['Banking', 'ENERGY', 'Technology'],
      avoidOrUnderweight: ['REAL_ESTATE', 'Consumer'],
      invalidationConditions: ['fx > 26000', 'cpi > 4.5%']
    };

    const brief2 = {
      regime: { status: 'EXPANSION', directionalStance: 'BULLISH', marketPhase: 'ACCUMULATION' },
      executiveDecision: { stance: 'BULLISH', primaryAction: 'increase_exposure', oneLineDecision: 'Tăng tỷ trọng.' },
      assetStrategy: [
        { assetClass: 'CRYPTO', posture: 'NEUTRAL', action: 'hold' },
        { assetClass: 'VN_STOCK', posture: 'OVERWEIGHT', action: 'buy' }
      ],
      preferredThemes: ['TECHNOLOGY', 'banking', 'Energy'],
      avoidOrUnderweight: ['CONSUMER', 'real_estate'],
      invalidationConditions: ['cpi > 4.5%', 'fx > 26000']
    };

    const fp1 = computeDecisionFingerprint(brief1);
    const fp2 = computeDecisionFingerprint(brief2);
    assert.equal(fp1, fp2, 'Reordered arrays and case variants must produce identical decisionFingerprint');
  });

  // 7. confidence MEDIUM -> HIGH with identical decision -> CONFIDENCE -> same strategyId
  await suite.test('7. confidence MEDIUM -> HIGH with identical decision -> CONFIDENCE -> same strategyId', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Force gate trigger with official revision
    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        id: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
        value: 4.89
      }
    ];
    const packetRevised = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T02:00:00.000Z')
    });
    const baseCandidate7 = generateDeterministicMarketStrategist({ factPacket: packetRevised, now: new Date('2026-09-06T02:00:00.000Z') });
    const candidateHigherConfidence = {
      ...baseCandidate7,
      confidence: 'HIGH',
      executiveDecision: {
        ...baseCandidate7.executiveDecision,
        confidence: 'HIGH'
      }
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T02:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => candidateHigherConfidence,
      client: null
    });

    assert.equal(result.strategyId, initial.strategyId, 'Strategy ID must remain unchanged');
    assert.equal(result.latestAssessmentResult, ASSESSMENT_RESULTS.CONFIDENCE);
    assert.equal(result.currentConfidence, 'HIGH');
  });

  // 8. details change only -> DETAILS -> same strategyId
  await suite.test('8. details change only -> DETAILS -> same strategyId', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        id: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
        value: 4.89
      }
    ];
    const packetRevised = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T03:00:00.000Z')
    });
    const baseCandidate8 = generateDeterministicMarketStrategist({ factPacket: packetRevised, now: new Date('2026-09-06T03:00:00.000Z') });
    const candidateDetailsUpdated = {
      ...baseCandidate8,
      executiveDecision: {
        ...baseCandidate8.executiveDecision,
        oneLineDecision: 'Cập nhật giải trình chi tiết hơn sau báo cáo chính thức đã xác thực.'
      }
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T03:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => candidateDetailsUpdated,
      client: null
    });

    assert.equal(result.strategyId, initial.strategyId);
    assert.equal(result.latestAssessmentResult, ASSESSMENT_RESULTS.DETAILS);
  });

  // 9. decision-relevant asset strategy changes -> decisionFingerprint changes -> PUBLISH_NEW
  await suite.test('9. decision-relevant asset strategy changes -> decisionFingerprint changes -> PUBLISH_NEW', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        id: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
        value: 5.50
      }
    ];
    const packetRevised = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T04:00:00.000Z')
    });
    const baseCandidate9 = generateDeterministicMarketStrategist({ factPacket: packetRevised, now: new Date('2026-09-06T04:00:00.000Z') });
    const candidateNewPosture = {
      ...baseCandidate9,
      assetStrategy: [
        {
          ...baseCandidate9.assetStrategy[0],
          stance: 'reduce'
        },
        ...baseCandidate9.assetStrategy.slice(1)
      ],
      preferredThemes: [{
        theme: 'Hạ tầng số',
        stance: 'prefer',
        rationale: 'Chủ đề quyết định được kiểm thử bằng dữ kiện hiện có.',
        evidenceIds: [packetRevised.evidence[0].id],
        signalIds: [],
        conclusionType: 'THEME_PREFERENCE',
        supportStatus: 'supported',
        limitations: 'Chỉ dùng để kiểm thử thay đổi quyết định.'
      }]
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T04:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => candidateNewPosture,
      client: null
    });

    assert.notEqual(result.strategyId, initial.strategyId);
    assert.equal(result.previousStrategyId, initial.strategyId);
    assert.equal(result.latestAssessmentResult, ASSESSMENT_RESULTS.PUBLISH_NEW);
    assert.equal(result.currentBrief.whatChanged.latestPublicationChanges.status, 'CHANGED');
    assert.equal(result.currentBrief.whatChanged.sincePublicationStatus.status, 'NOT_ASSESSED');
    assert.equal(
      result.currentBrief.whatChanged.latestPublicationChanges.changes.some(
        (change) => change.type === 'ASSET_STRATEGY_CHANGED'
          && change.assetClass === candidateNewPosture.assetStrategy[0].assetClass.toUpperCase()
      ),
      true
    );
    assert.equal(
      result.currentBrief.whatChanged.latestPublicationChanges.changes.some(
        (change) => change.type === 'PREFERRED_THEME_CHANGED' && change.change === 'added'
      ),
      true
    );
    assert.doesNotMatch(result.materialChanges.join('|'), /UNKNOWN->UNKNOWN/);
    assert.doesNotMatch(result.materialChanges.join('|'), /selective_risk_on->selective_risk_on/i);

    const keep = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T04:15:00.000Z'),
      allowLlm: false,
      client: null
    });
    assert.equal(keep.latestAssessmentResult, ASSESSMENT_RESULTS.KEEP);
    assert.equal(keep.strategyId, result.strategyId);

    const assessmentCountBeforeGet = (await listStrategyAssessments(result.strategyId, null)).length;
    let providerCalls = 0;
    const readOnly = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T04:20:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        providerCalls += 1;
        throw new Error('read-only projection must not call Gemini');
      },
      isReadOnly: true,
      client: null
    });
    assert.equal(providerCalls, 0);
    assert.equal(readOnly.strategyId, result.strategyId);
    assert.equal(readOnly.latestAssessmentResult, ASSESSMENT_RESULTS.KEEP);
    assert.equal(readOnly.currentBrief.whatChanged.latestPublicationChanges.status, 'CHANGED');
    assert.equal(readOnly.currentBrief.whatChanged.latestPublicationChanges.hasMaterialChange, true);
    assert.equal(readOnly.currentBrief.whatChanged.sincePublicationStatus.status, 'NO_FURTHER_MATERIAL_CHANGE');
    assert.match(readOnly.currentBrief.whatChanged.summary, /Ở lần cập nhật chiến lược gần nhất/);
    assert.match(readOnly.currentBrief.whatChanged.summary, /chưa xuất hiện thay đổi đủ lớn để phát hành chiến lược mới/);
    assert.equal((await listStrategyAssessments(result.strategyId, null)).length, assessmentCountBeforeGet);
    assert.equal((await getCurrentPublishedStrategy(null)).strategyId, result.strategyId);
  });

  // 10. regime changes -> PUBLISH_NEW
  await suite.test('10. regime changes -> PUBLISH_NEW', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        id: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
        value: 5.50
      }
    ];
    const packetRevised = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T05:00:00.000Z')
    });
    const baseCandidate10 = generateDeterministicMarketStrategist({ factPacket: packetRevised, now: new Date('2026-09-06T05:00:00.000Z') });
    const candidateRegimeChange = {
      ...baseCandidate10,
      executiveDecision: {
        ...baseCandidate10.executiveDecision,
        stance: 'defensive',
        actionNow: 'Chủ động hạ tỷ trọng các nhóm nhạy cảm lãi suất và đòn bẩy cao; nâng tỷ trọng thanh khoản tiền mặt phòng thủ.'
      },
      regime: {
        ...baseCandidate10.regime,
        status: 'defensive',
        directionalStance: 'CAUTIOUS'
      }
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: packetRevised,
      now: new Date('2026-09-06T05:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => candidateRegimeChange,
      client: null
    });

    assert.notEqual(result.strategyId, initial.strategyId);
    assert.equal(result.latestAssessmentResult, ASSESSMENT_RESULTS.PUBLISH_NEW);
  });

  // 11. invalidation condition changes materially -> decisionFingerprint changes
  await suite.test('11. invalidation condition changes materially -> decisionFingerprint changes', async () => {
    const briefA = {
      regime: { status: 'NEUTRAL' },
      executiveDecision: { stance: 'BALANCED' },
      invalidationConditions: ['cpi_yoy > 4.5%']
    };
    const briefB = {
      regime: { status: 'NEUTRAL' },
      executiveDecision: { stance: 'BALANCED' },
      invalidationConditions: ['cpi_yoy > 5.5%']
    };

    assert.notEqual(
      computeDecisionFingerprint(briefA),
      computeDecisionFingerprint(briefB),
      'Material invalidation condition threshold difference must yield different decision fingerprint'
    );
  });

  // 12. evidence-only citation changes -> no new strategy
  await suite.test('12. evidence-only citation changes -> no new strategy', async () => {
    const brief1 = {
      regime: { status: 'EXPANSION', directionalStance: 'BULLISH' },
      executiveDecision: { stance: 'BULLISH', primaryAction: 'increase' },
      assetStrategy: [{ assetClass: 'VN_STOCK', posture: 'OVERWEIGHT', evidenceIds: ['obs_1'] }]
    };
    const brief2 = {
      regime: { status: 'EXPANSION', directionalStance: 'BULLISH' },
      executiveDecision: { stance: 'BULLISH', primaryAction: 'increase' },
      assetStrategy: [{ assetClass: 'VN_STOCK', posture: 'OVERWEIGHT', evidenceIds: ['obs_2', 'obs_3'] }]
    };

    assert.equal(
      computeDecisionFingerprint(brief1),
      computeDecisionFingerprint(brief2),
      'Evidence IDs must not enter decision fingerprint'
    );
  });

  // 13. copied news from same dependency does not trigger false materiality
  await suite.test('13. copied news from same dependency does not trigger false materiality', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Add 3 articles from CafeF that reiterate same CPI story without independent confirmation
    const copiedArticles = [
      { articleId: 'art_copy_1', title: 'CPI tháng 8: Chi tiết các nhóm ngành', summary: 'Tổng cục Thống kê công bố', source: 'CafeF' },
      { articleId: 'art_copy_2', title: 'Phân tích nhanh CPI tháng 8', summary: 'Tổng cục Thống kê công bố', source: 'CafeF' }
    ];

    const packetWithCopies = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: [...BASELINE_NEWS, ...copiedArticles],
      now: new Date('2026-09-06T06:00:00.000Z')
    });

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: packetWithCopies,
      now: new Date('2026-09-06T06:00:00.000Z')
    });

    assert.equal(gate.requiresReview, false, 'Copied news from same dependency must not trigger false materiality');
    assert.equal(gate.reasons[0].type, MATERIALITY_TRIGGER_TYPES.NON_MATERIAL_NEWS_ONLY);
  });

  // 14. claim becomes CORROBORATED -> deterministic review reason
  await suite.test('14. claim becomes CORROBORATED -> deterministic review reason', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Provide corroborated claim in factPacket
    const corroboratedClaimPacket = {
      ...initialPacket,
      evidenceFingerprint: 'new_fp_corroborated',
      claims: [
        {
          claimId: 'claim_fdi_disbursed',
          subject: 'vn.macro.fdi.disbursed',
          supportStatus: 'CORROBORATED',
          independentSourceCount: 2
        }
      ]
    };

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: corroboratedClaimPacket,
      now: new Date('2026-09-06T07:00:00.000Z')
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.CLAIM_CORROBORATED), true);
  });

  // 15. claim becomes CONTRADICTED -> deterministic review reason
  await suite.test('15. claim becomes CONTRADICTED -> deterministic review reason', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const contradictedClaimPacket = {
      ...initialPacket,
      evidenceFingerprint: 'new_fp_contradicted',
      claims: [
        {
          claimId: 'claim_cpi_dispute',
          subject: 'vn.macro.cpi.yoy',
          supportStatus: 'CONTRADICTED',
          contradictionCount: 1
        }
      ]
    };

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: contradictedClaimPacket,
      now: new Date('2026-09-06T08:00:00.000Z')
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.CLAIM_CONTRADICTED), true);
  });

  // 16. contradiction resolved -> deterministic review reason
  await suite.test('16. contradiction resolved -> deterministic review reason', async () => {
    // When a contradictory claim is resolved into corroborated or supported state
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const resolvedPacket = {
      ...initialPacket,
      evidenceFingerprint: 'new_fp_resolved',
      claims: [
        {
          claimId: 'claim_cpi_dispute',
          subject: 'vn.macro.cpi.yoy',
          supportStatus: 'CORROBORATED',
          independentSourceCount: 3,
          contradictionCount: 0
        }
      ]
    };

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: resolvedPacket,
      now: new Date('2026-09-06T08:30:00.000Z')
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.CLAIM_CORROBORATED), true);
  });

  // 17. official revision captured as structured trigger
  await suite.test('17. official revision captured as structured trigger', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const packetWithRevision = {
      ...initialPacket,
      evidenceFingerprint: 'rev_fp_1',
      evidence: [
        {
          id: 'vn.macro.cpi.yoy:2026-08:pub_2',
          observationId: 'vn.macro.cpi.yoy:2026-08:pub_2',
          factId: 'vn.macro.cpi.yoy',
          revision: 'revised',
          revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
          value: 4.95
        }
      ]
    };

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: packetWithRevision,
      now: new Date('2026-09-06T09:00:00.000Z')
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED), true);
  });

  // 18. freshness degrades to INSUFFICIENT -> review/assessment -> not auto NEUTRAL
  await suite.test('18. freshness degrades to INSUFFICIENT -> review/assessment -> not auto NEUTRAL', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const degradedPacket = {
      ...initialPacket,
      evidenceFingerprint: 'degraded_fp_1',
      evidence: [
        {
          id: 'vn.market.vnindex.close:2026-09-04:pub_1',
          factId: 'vn.market.vnindex.close',
          status: 'unavailable',
          freshness: 'stale'
        }
      ]
    };

    const gate = assessStrategyMateriality({
      currentStrategy: initial,
      lastAssessment: initial.lastAssessment,
      factPacket: degradedPacket,
      now: new Date('2026-09-06T10:00:00.000Z')
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.EVIDENCE_QUALITY_DEGRADATION), true);
  });

  // 19. Gemini failure during required review -> current published strategy remains
  await suite.test('19. Gemini failure during required review -> current published strategy remains', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const revisedPacket = {
      ...initialPacket,
      evidenceFingerprint: 'fp_with_revision',
      evidence: [
        {
          id: 'vn.macro.cpi.yoy:revised',
          factId: 'vn.macro.cpi.yoy',
          revision: 'revised',
          value: 6.0
        }
      ]
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: revisedPacket,
      now: new Date('2026-09-06T11:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        throw new Error('GEMINI_TIMEOUT_SIMULATED');
      },
      client: null
    });

    assert.equal(result.strategyId, initial.strategyId, 'Published strategy must be preserved on LLM failure');
    assert.equal(result.decisionFingerprint, initial.decisionFingerprint);
  });

  // 20. failed review is not recorded as successful KEEP
  await suite.test('20. failed review is not recorded as successful KEEP', async () => {
    const initialPacket = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: initialPacket,
      now: NOW,
      allowLlm: false,
      client: null
    });

    const revisedPacket = {
      ...initialPacket,
      evidenceFingerprint: 'fp_with_revision_2',
      evidence: [
        {
          id: 'vn.macro.cpi.yoy:revised',
          factId: 'vn.macro.cpi.yoy',
          revision: 'revised',
          value: 6.0
        }
      ]
    };

    const result = await evaluateAndApplyStrategyStability({
      factPacket: revisedPacket,
      now: new Date('2026-09-06T11:30:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        throw new Error('PROVIDER_503_UNAVAILABLE');
      },
      client: null
    });

    assert.equal(result.latestAssessmentStatus, EVALUATION_STATUSES.FAILED, 'Evaluation status must be FAILED, never COMPLETED');
    assert.notEqual(result.latestAssessmentStatus, EVALUATION_STATUSES.COMPLETED);
  });

  // 21. GET does not call AI/provider
  await suite.test('21. GET does not call AI/provider', async () => {
    let providerCalled = false;
    const res = await getMarketStrategist({
      now: NOW,
      getMarketContextFabricFn: async () => ({ facts: BASELINE_OBSERVATIONS }),
      getNewsFeedFn: async () => ({ data: BASELINE_NEWS }),
      allowLlm: false,
      generateLlmFn: async () => {
        providerCalled = true;
        return {};
      },
      client: null
    });

    assert.equal(providerCalled, false, 'Provider must never be called on allowLlm=false / GET path');
    assert.ok(res.strategyId);
    assert.ok(res.publishedAt);
    assert.ok(res.latestAssessmentAt);
    assert.ok(res.latestAssessmentResult);
  });

  // 22. server restart/persistence still retrieves current published strategy
  await suite.test('22. server restart/persistence still retrieves current published strategy', async () => {
    const version = createStrategyVersion({
      strategyId: 'strat_persisted_1',
      evidenceFingerprint: 'ev_123',
      decisionFingerprint: 'dec_123',
      confidence: 'MEDIUM',
      publishedAt: NOW,
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED
    });

    await persistStrategyVersion(version, null);

    const retrieved = await getCurrentPublishedStrategy(null);
    assert.ok(retrieved);
    assert.equal(retrieved.strategyId, 'strat_persisted_1');
    assert.equal(retrieved.decisionFingerprint, 'dec_123');
  });

  // 23. KEEP assessment is append-only
  await suite.test('23. KEEP assessment is append-only', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // 3 successive evaluations with same evidence
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: new Date('2026-09-06T00:10:00.000Z'), allowLlm: false, client: null });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: new Date('2026-09-06T00:20:00.000Z'), allowLlm: false, client: null });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: new Date('2026-09-06T00:30:00.000Z'), allowLlm: false, client: null });

    const assessments = await listStrategyAssessments(initial.strategyId, null);
    assert.equal(assessments.length, 4, 'All 4 evaluations must be preserved in append-only audit trail');
    const ids = new Set(assessments.map((a) => a.assessmentId));
    assert.equal(ids.size, 4, 'Each assessment must have a distinct identifier');
  });

  // 24. confidence assessment does not mutate historic StrategyVersion confidence
  await suite.test('24. confidence assessment does not mutate historic StrategyVersion confidence', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });
    assert.equal(initial.confidence, 'MEDIUM');

    // Run assessment resulting in CONFIDENCE (HIGH)
    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      { ...BASELINE_OBSERVATIONS[1], revision: 'revised', value: 4.89 }
    ];
    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T01:00:00.000Z')
    });

    await evaluateAndApplyStrategyStability({
      factPacket: packet2,
      now: new Date('2026-09-06T01:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => ({ ...initial, confidence: 'HIGH' }),
      client: null
    });

    // Verify historic version record in repository was NOT mutated
    const historicVersion = await getStrategyVersionById(initial.strategyId, null);
    assert.equal(historicVersion.confidence, 'MEDIUM', 'Historic StrategyVersion record must not be mutated');
  });

  // 25. published StrategyVersion remains immutable
  await suite.test('25. published StrategyVersion remains immutable', async () => {
    const version = createStrategyVersion({
      strategyId: 'strat_frozen_1',
      evidenceFingerprint: 'ev_1',
      decisionFingerprint: 'dec_1',
      confidence: 'HIGH',
      publishedAt: NOW,
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED
    });

    assert.throws(() => {
      version.confidence = 'LOW';
    }, /TypeError: Cannot assign to read only property/);
  });

  // 26. no private user/profile/portfolio data
  await suite.test('26. no private user/profile/portfolio data', async () => {
    assert.throws(() => {
      assertZeroPrivateData({ portfolio: { id: 'p1' } });
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      createStrategyVersion({
        strategyId: 'strat_bad',
        evidenceFingerprint: 'ev',
        decisionFingerprint: 'dec',
        confidence: 'HIGH',
        regime: { portfolio: 'leaked' }
      });
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      createStrategyAssessment({
        assessmentId: 'asmt_bad',
        strategyId: 'strat_ok',
        evidenceFingerprint: 'ev',
        decisionFingerprint: 'dec',
        confidence: 'HIGH',
        result: 'KEEP',
        triggerReason: { userId: '123' }
      });
    }, /FORBIDDEN_USER_DATA/);
  });

  // 27. same input ordering variants produce deterministic fingerprints
  await suite.test('27. same input ordering variants produce deterministic fingerprints', async () => {
    const a = {
      regime: { status: 'A' },
      executiveDecision: { stance: 'B' },
      preferredThemes: ['tech', 'FINANCE'],
      avoidOrUnderweight: ['RETAIL', 'energy']
    };
    const b = {
      regime: { status: 'A' },
      executiveDecision: { stance: 'B' },
      preferredThemes: ['FINANCE', 'tech'],
      avoidOrUnderweight: ['energy', 'RETAIL']
    };

    assert.equal(computeDecisionFingerprint(a), computeDecisionFingerprint(b));
  });

  // 28. assessment policyVersion persisted
  await suite.test('28. assessment policyVersion persisted', async () => {
    const asmt = createStrategyAssessment({
      assessmentId: 'asmt_test_policy',
      strategyId: 'strat_test',
      evidenceFingerprint: 'ev_1',
      decisionFingerprint: 'dec_1',
      confidence: 'HIGH',
      result: 'KEEP'
    });

    assert.equal(asmt.policyVersion, STABILITY_POLICY_VERSION);
    assert.ok(asmt.policyVersion === 'strategy-stability-v1' || asmt.policyVersion === 'strategy-stability-v2');
  });

  // 29. evidenceFingerprint and decisionFingerprint remain distinct
  await suite.test('29. evidenceFingerprint and decisionFingerprint remain distinct', async () => {
    const packetA = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    const packetB = buildMarketStrategistFactPacket({
      marketObservations: [
        BASELINE_OBSERVATIONS[0],
        { ...BASELINE_OBSERVATIONS[1], value: 4.88 }
      ],
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const evFpA = computeStrategistFingerprint(packetA);
    const evFpB = computeStrategistFingerprint(packetB);
    assert.notEqual(evFpA, evFpB, 'Different values must change evidenceFingerprint');

    // But decision posture can remain identical
    const decFpA = computeDecisionFingerprint({ regime: { status: 'STABLE' } });
    const decFpB = computeDecisionFingerprint({ regime: { status: 'STABLE' } });
    assert.equal(decFpA, decFpB, 'Identical decisions have identical decisionFingerprint');
    assert.notEqual(evFpA, decFpA, 'evidenceFingerprint and decisionFingerprint must have distinct identities');
  });

  // 30. old strategy preserved after new strategy publication
  await suite.test('30. old strategy preserved after new strategy publication', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const initial = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      client: null
    });

    // Publish second version
    const revisedObs = [
      BASELINE_OBSERVATIONS[0],
      {
        ...BASELINE_OBSERVATIONS[1],
        id: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_revised',
        revision: 'revised',
        revisionOf: 'vn.macro.cpi.yoy:2026-08:pub_1',
        value: 7.00
      }
    ];
    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: revisedObs,
      newsArticles: BASELINE_NEWS,
      now: new Date('2026-09-06T12:00:00.000Z')
    });

    const baseCandidate30 = generateDeterministicMarketStrategist({ factPacket: packet2, now: new Date('2026-09-06T12:00:00.000Z') });
    const second = await evaluateAndApplyStrategyStability({
      factPacket: packet2,
      now: new Date('2026-09-06T12:00:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => ({
        ...baseCandidate30,
        executiveDecision: {
          ...baseCandidate30.executiveDecision,
          stance: 'defensive',
          actionNow: 'Chủ động hạ tỷ trọng các nhóm nhạy cảm lãi suất và đòn bẩy cao; nâng tỷ trọng thanh khoản tiền mặt phòng thủ.'
        },
        assetStrategy: [
          {
            ...baseCandidate30.assetStrategy[0],
            stance: 'reduce'
          },
          ...baseCandidate30.assetStrategy.slice(1)
        ]
      }),
      client: null
    });

    assert.notEqual(second.strategyId, initial.strategyId);

    // Verify historic version is preserved as superseded in repository
    const oldVersion = await getStrategyVersionById(initial.strategyId, null);
    assert.ok(oldVersion, 'Old strategy must still exist in repository');
    assert.equal(oldVersion.status, STRATEGY_LIFECYCLE_STATUSES.SUPERSEDED);
    assert.equal(second.previousStrategyId, initial.strategyId);
  });

});
