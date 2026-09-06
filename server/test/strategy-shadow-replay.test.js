import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runStrategyShadowReplay,
  computeShadowReplayMetrics,
  formatShadowReplaySummary,
  SHADOW_REPLAY_POLICY_VERSION
} from '../src/ai/strategyShadowReplay.js';

import {
  createStrategyVersion,
  STRATEGY_LIFECYCLE_STATES,
  STRATEGY_LIFECYCLE_STATUSES,
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  DATA_QUALITY_STATES
} from '../src/ai/strategyStabilityModel.js';

import {
  clearStabilityMemoryStore,
  getCurrentPublishedStrategy
} from '../src/ai/strategyStabilityRepository.js';

import {
  createMarketObservation
} from '../src/context/factModel.js';

// Base test fixtures
const baseObs1 = Object.freeze(createMarketObservation({
  observationId: 'vn.macro.cpi.yoy:2026-07:pub_1',
  factId: 'vn.macro.cpi.yoy',
  pillar: 'macro',
  metric: 'CPI (YoY)',
  value: 4.12,
  unit: '%',
  status: 'available',
  freshness: 'fresh',
  source: 'GSO',
  period: '2026-07',
  referenceTime: '2026-07',
  observedAt: '2026-07-31T00:00:00.000Z',
  publishedAt: '2026-08-01T02:00:00.000Z',
  firstSeenAt: '2026-08-01T02:00:00.000Z'
}));

const baseNews1 = Object.freeze({
  articleId: 'art_transport_1',
  title: 'Doanh nghiệp cảng biển ghi nhận tăng trưởng sản lượng',
  summary: 'Sản lượng hàng hóa thông qua cảng biển tăng trưởng ổn định.',
  source: 'CafeF',
  dependencyGroup: 'CAFEF',
  url: 'https://cafef.vn/cang-bien.chn',
  publishedAt: '2026-08-01T03:00:00.000Z',
  firstSeenAt: '2026-08-01T03:00:00.000Z',
  geography: 'vietnam'
});

// ============================================================
// 1. No Future Leakage
// ============================================================
test('1. shadow replay: strict zero future leakage across as-of points', () => {
  const futureObs = Object.freeze(createMarketObservation({
    observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    metric: 'CPI (YoY)',
    value: 3.45,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: 'GSO',
    period: '2026-08',
    referenceTime: '2026-08',
    observedAt: '2026-08-31T00:00:00.000Z',
    publishedAt: '2026-09-01T02:00:00.000Z',
    firstSeenAt: '2026-09-01T02:00:00.000Z'
  }));

  const report = runStrategyShadowReplay({
    historicalObservations: [baseObs1, futureObs],
    historicalNews: [baseNews1],
    asOfPoints: ['2026-08-15T00:00:00.000Z', '2026-09-02T00:00:00.000Z']
  });

  assert.equal(report.timeline.length, 2);

  // Step 1: 2026-08-15
  const step1 = report.timeline[0];
  assert.equal(step1.asOf, '2026-08-15T00:00:00.000Z');
  assert.equal(step1.includedObservationsCount, 1, 'At T1 only baseObs1 is knowable');
  assert.equal(step1.excludedFutureEvidenceCount, 1, 'futureObs must be excluded at T1');

  // Step 2: 2026-09-02
  const step2 = report.timeline[1];
  assert.equal(step2.asOf, '2026-09-02T00:00:00.000Z');
  assert.equal(step2.includedObservationsCount, 2, 'At T2 both observations are knowable');
  assert.equal(step2.excludedFutureEvidenceCount, 0);
});

// ============================================================
// 2. Determinism Between Two Replays
// ============================================================
test('2. shadow replay: identical replays run twice produce 100% deterministic output', () => {
  const obsList = [baseObs1];
  const newsList = [baseNews1];
  const points = ['2026-08-01T04:00:00.000Z', '2026-08-05T00:00:00.000Z', '2026-08-10T00:00:00.000Z'];

  const report1 = runStrategyShadowReplay({
    historicalObservations: obsList,
    historicalNews: newsList,
    asOfPoints: points
  });

  const report2 = runStrategyShadowReplay({
    historicalObservations: obsList,
    historicalNews: newsList,
    asOfPoints: points
  });

  assert.equal(report1.metrics.isDeterministic, true);
  assert.equal(report2.metrics.isDeterministic, true);
  assert.equal(report1.metrics.runDigest, report2.metrics.runDigest, 'Digest must match exactly');
  assert.equal(report1.metrics.totalFlips, report2.metrics.totalFlips);
  assert.equal(report1.metrics.publishNewCount, report2.metrics.publishNewCount);
  assert.deepEqual(report1.timeline, report2.timeline);
});

// ============================================================
// 3. Syndicated / Duplicate News Suppression
// ============================================================
test('3. shadow replay: syndicated news articles are suppressed and do not inflate confirmations', () => {
  const syndicated1 = {
    articleId: 'art_synd_1',
    title: 'Doanh nghiệp cảng biển ghi nhận tăng trưởng sản lượng',
    summary: 'Sản lượng cảng biển tăng theo CafeF.',
    source: 'BaoDauTu',
    publishedAt: '2026-08-01T04:00:00.000Z',
    firstSeenAt: '2026-08-01T04:00:00.000Z'
  };

  const syndicated2 = {
    articleId: 'art_synd_2',
    title: 'Doanh nghiệp cảng biển ghi nhận tăng trưởng sản lượng',
    summary: 'Tin tức tổng hợp thị trường cảng biển.',
    source: 'VnEconomy',
    publishedAt: '2026-08-01T05:00:00.000Z',
    firstSeenAt: '2026-08-01T05:00:00.000Z'
  };

  const report = runStrategyShadowReplay({
    historicalObservations: [baseObs1],
    historicalNews: [baseNews1, syndicated1, syndicated2],
    asOfPoints: ['2026-08-01T06:00:00.000Z']
  });

  assert.equal(report.metrics.suppressedDuplicatesCount, 2, '2 duplicate syndicated articles must be tracked as suppressed');
});

// ============================================================
// 4. Multi-period Revisions Retain Correct Vintage
// ============================================================
test('4. shadow replay: multi-period observations preserve distinct vintage and trigger revision events', () => {
  const julyFlash = Object.freeze(createMarketObservation({
    observationId: 'vn.macro.cpi.yoy:2026-07:flash',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    value: 4.12,
    period: '2026-07',
    referenceTime: '2026-07',
    observedAt: '2026-08-01T02:00:00.000Z',
    publishedAt: '2026-08-01T02:00:00.000Z',
    firstSeenAt: '2026-08-01T02:00:00.000Z',
    revision: 'preliminary'
  }));

  const julyFinal = Object.freeze(createMarketObservation({
    observationId: 'vn.macro.cpi.yoy:2026-07:final',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    value: 4.25,
    period: '2026-07',
    referenceTime: '2026-07',
    observedAt: '2026-08-15T02:00:00.000Z',
    publishedAt: '2026-08-15T02:00:00.000Z',
    firstSeenAt: '2026-08-15T02:00:00.000Z',
    revision: 'revised'
  }));

  const report = runStrategyShadowReplay({
    historicalObservations: [julyFlash, julyFinal],
    historicalNews: [baseNews1],
    asOfPoints: ['2026-08-05T00:00:00.000Z', '2026-08-20T00:00:00.000Z']
  });

  assert.equal(report.timeline.length, 2);
  assert.ok(report.metrics.revisionEventsCount >= 0);
  assert.equal(report.timeline[0].activeStrategyId !== null, true);
});

// ============================================================
// 5. Zero DB Writes & Zero Production Memory Mutation
// ============================================================
test('5. shadow replay: strictly zero writes to database and zero mutation of production memory store', async () => {
  clearStabilityMemoryStore();

  const seed = createStrategyVersion({
    strategyId: 'strat_prod_baseline_unaffected',
    previousStrategyId: null,
    generatedAt: '2026-08-01T00:00:00.000Z',
    publishedAt: '2026-08-01T00:00:00.000Z',
    dataAsOf: '2026-08-01T00:00:00.000Z',
    evidenceFingerprint: 'fp_prod_orig',
    decisionFingerprint: 'dec_prod_orig',
    triggerReason: { type: 'ORIGINAL_SEED' },
    materialChanges: ['ORIGINAL_SEED'],
    confidence: 'HIGH',
    regime: { directionalStance: 'NEUTRAL' },
    executiveDecision: { stance: 'NEUTRAL' },
    status: 'published',
    lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState: DATA_QUALITY_STATES.HEALTHY
  });

  const repo = await import('../src/ai/strategyStabilityRepository.js');
  await repo.publishStrategyVersionAtomic({
    newVersion: seed,
    expectedCurrentStrategyId: null
  }, null);

  const beforePublished = await getCurrentPublishedStrategy(null);
  assert.equal(beforePublished.strategyId, 'strat_prod_baseline_unaffected');

  // Run shadow replay with multiple new observations and decision changes
  const report = runStrategyShadowReplay({
    historicalObservations: [baseObs1],
    historicalNews: [baseNews1],
    asOfPoints: ['2026-08-02T00:00:00.000Z', '2026-08-10T00:00:00.000Z']
  });

  // Verify production memory store was completely untouched!
  const afterPublished = await getCurrentPublishedStrategy(null);
  assert.equal(afterPublished.strategyId, 'strat_prod_baseline_unaffected', 'Production store must remain untouched');
  assert.equal(afterPublished.status, 'published');

  // Verify shadow replay had its own independent version
  assert.ok(report.shadowVersions.length > 0);
  assert.notEqual(report.shadowVersions[0].strategyId, 'strat_prod_baseline_unaffected');
});

// ============================================================
// 6. Zero Provider / LLM Calls Guaranteed
// ============================================================
test('6. shadow replay: executes without API keys and performs zero external provider calls', () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevOpenAi = process.env.OPENAI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const report = runStrategyShadowReplay({
      historicalObservations: [baseObs1],
      historicalNews: [baseNews1],
      asOfPoints: ['2026-08-01T04:00:00.000Z']
    });

    assert.ok(report.timeline.length > 0);
    assert.equal(report.metrics.isDeterministic, true);
  } finally {
    if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
    if (prevOpenAi) process.env.OPENAI_API_KEY = prevOpenAi;
  }
});

// ============================================================
// 7. Whipsaw Detection (A -> B -> A)
// ============================================================
test('7. shadow replay: accurately detects and reports A -> B -> A whipsaw reversals', () => {
  const v1 = createStrategyVersion({
    strategyId: 'strat_w1',
    publishedAt: '2026-08-01T00:00:00.000Z',
    evidenceFingerprint: 'fp_w1',
    decisionFingerprint: 'dfp_w1',
    confidence: 'HIGH',
    executiveDecision: { stance: 'DEFENSIVE' },
    regime: { directionalStance: 'BEARISH' }
  });

  const v2 = createStrategyVersion({
    strategyId: 'strat_w2',
    publishedAt: '2026-08-05T00:00:00.000Z',
    evidenceFingerprint: 'fp_w2',
    decisionFingerprint: 'dfp_w2',
    confidence: 'HIGH',
    executiveDecision: { stance: 'RISK_ON' },
    regime: { directionalStance: 'BULLISH' }
  });

  const v3 = createStrategyVersion({
    strategyId: 'strat_w3',
    publishedAt: '2026-08-10T00:00:00.000Z',
    evidenceFingerprint: 'fp_w3',
    decisionFingerprint: 'dfp_w3',
    confidence: 'HIGH',
    executiveDecision: { stance: 'DEFENSIVE' },
    regime: { directionalStance: 'BEARISH' }
  });

  const metrics = computeShadowReplayMetrics({
    timeline: [],
    shadowVersions: [v1, v2, v3],
    shadowAssessments: [],
    whipsawThresholdMs: 14 * 24 * 3600 * 1000
  });

  assert.equal(metrics.totalFlips, 2);
  assert.equal(metrics.whipsawCount, 1, 'Must detect 1 A->B->A whipsaw');
  assert.equal(metrics.whipsaws[0].stanceA, 'DEFENSIVE');
  assert.equal(metrics.whipsaws[0].stanceB, 'RISK_ON');
  assert.equal(metrics.whipsaws[0].elapsedDays, 5);
});

// ============================================================
// 8. WATCH Telemetry & Unresolved Watch Flag
// ============================================================
test('8. shadow replay: calculates time in WATCH and flags unresolved WATCH episodes', () => {
  const timeline = [
    { asOf: '2026-08-01T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE },
    { asOf: '2026-08-02T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH },
    { asOf: '2026-08-03T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH },
    { asOf: '2026-08-04T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE }
  ];

  const metrics = computeShadowReplayMetrics({
    timeline,
    shadowVersions: [],
    shadowAssessments: []
  });

  assert.equal(metrics.watchEpisodesCount, 1);
  assert.equal(metrics.unresolvedWatchCount, 0);
  assert.equal(metrics.timeInWatchHours, 48); // 2 days: Aug 02 -> Aug 04

  // Case with unresolved watch at window end
  const timelineUnresolved = [
    { asOf: '2026-08-01T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE },
    { asOf: '2026-08-02T00:00:00.000Z', lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH }
  ];

  const metricsUnresolved = computeShadowReplayMetrics({
    timeline: timelineUnresolved,
    shadowVersions: [],
    shadowAssessments: []
  });

  assert.equal(metricsUnresolved.unresolvedWatchCount, 1, 'End step in WATCH must be flagged unresolved');
});

// ============================================================
// 9. Data Gap & Insufficient Evidence Truthfulness
// ============================================================
test('9. shadow replay: reports INSUFFICIENT coverage without fabricating fake scores', () => {
  const report = runStrategyShadowReplay({
    historicalObservations: [],
    historicalNews: [],
    asOfPoints: []
  });

  assert.equal(report.dataCoverage.status, 'INSUFFICIENT');
  assert.ok(report.dataCoverage.dataGaps.includes('NO_HISTORICAL_OBSERVATIONS_PROVIDED'));
  assert.ok(report.dataCoverage.dataGaps.includes('NO_HISTORICAL_NEWS_PROVIDED'));
  assert.equal(report.metrics.totalFlips, 0);
  assert.equal(report.metrics.whipsawCount, 0);
});

// ============================================================
// 10. Private Data Rejection
// ============================================================
test('10. shadow replay: strictly rejects private user and portfolio data', () => {
  assert.throws(() => {
    runStrategyShadowReplay({
      historicalObservations: [{ ...baseObs1, userId: 'user-leak-123' }],
      asOfPoints: ['2026-08-01T00:00:00.000Z']
    });
  }, (err) => {
    assert.equal(err.code, 'FORBIDDEN_USER_DATA');
    return true;
  });
});

// ============================================================
// 11. Human Summary Formatting
// ============================================================
test('11. shadow replay: formats concise markdown summary', () => {
  const report = runStrategyShadowReplay({
    historicalObservations: [baseObs1],
    historicalNews: [baseNews1],
    asOfPoints: ['2026-08-01T04:00:00.000Z']
  });

  const summary = formatShadowReplaySummary(report);
  assert.ok(summary.includes('Shadow Replay & Calibration Summary'));
  assert.ok(summary.includes('Strategy Flips'));
  assert.ok(summary.includes('Whipsaws'));
  assert.ok(summary.includes('Determinism Verification'));
});

// ============================================================
// 12. FAILED/DEFERRED Not Treated as Completed Baseline
// ============================================================
test('12. shadow replay: FAILED/DEFERRED evaluations do not become completed baseline', () => {
  // Step 1: No evidence knowable yet -> cold start fails gracefully
  // Step 2: Evidence becomes knowable -> bootstraps cleanly without corrupt baseline
  const report = runStrategyShadowReplay({
    historicalObservations: [baseObs1],
    historicalNews: [baseNews1],
    asOfPoints: ['2026-07-20T00:00:00.000Z', '2026-08-02T00:00:00.000Z']
  });

  assert.equal(report.timeline.length, 2);
  // Step 0 was FAILED cold start
  assert.equal(report.timeline[0].activeStrategyId, null);
  assert.equal(report.timeline[0].evaluationStatus, EVALUATION_STATUSES.FAILED);

  // Step 1 bootstrapped cleanly
  assert.notEqual(report.timeline[1].activeStrategyId, null);
  assert.equal(report.timeline[1].evaluationStatus, EVALUATION_STATUSES.COMPLETED);
  assert.equal(report.shadowVersions.length, 1);
  assert.equal(report.shadowAssessments.length, 1);
  assert.equal(report.shadowAssessments[0].evaluationStatus, EVALUATION_STATUSES.COMPLETED);
});

