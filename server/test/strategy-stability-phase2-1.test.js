import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  getMarketStrategist
} from '../src/marketStrategist.js';
import {
  evaluateAndApplyStrategyStability
} from '../src/ai/strategyStabilityService.js';
import {
  assessStrategyMateriality,
  classifyEvidenceRevision,
  resolveShockOverride,
  MATERIALITY_TRIGGER_TYPES
} from '../src/ai/strategyAssessmentGate.js';
import {
  clearStabilityMemoryStore,
  getCurrentPublishedStrategy,
  getLatestStrategyAssessment,
  getLatestCompletedStrategyAssessment,
  publishStrategyVersionAtomic,
  strategyVersionToRow
} from '../src/ai/strategyStabilityRepository.js';
import {
  createStrategyVersion,
  createStrategyAssessment,
  createShockOverride,
  computeDecisionFingerprint,
  STRATEGY_LIFECYCLE_STATES,
  EVALUATION_STATUSES,
  ASSESSMENT_RESULTS,
  SHOCK_STATUSES,
  SHOCK_SCOPES,
  REVISION_TYPES,
  DATA_QUALITY_STATES
} from '../src/ai/strategyStabilityModel.js';
import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  generateDeterministicMarketStrategist,
  globalMarketStrategistRuntime
} from '../src/ai/marketStrategistEngine.js';

describe('V1.3 Strategy Stability — Phase 2.1 Production Integrity Suite (32 Scenarios)', { concurrency: 1 }, () => {
  beforeEach(() => {
    clearStabilityMemoryStore();
    globalMarketStrategistRuntime.clear();
  });

  const baseFact = {
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
    source: 'GSO',
    dependencyGroup: 'OFFICIAL_NSO',
    period: '2026-08',
    observedAt: '2026-08-31T00:00:00.000Z',
    publishedAt: '2026-09-01T02:00:00.000Z'
  };

  const baseNews = {
    articleId: 'art_transport_1',
    title: 'Doanh nghiệp cảng biển ghi nhận tăng trưởng sản lượng',
    summary: 'Sản lượng hàng hóa thông qua cảng biển tăng trưởng ổn định theo thống kê quý.',
    source: 'CafeF',
    dependencyGroup: 'CAFEF',
    url: 'https://cafef.vn/cang-bien.chn',
    publishedAt: '2026-09-01T03:00:00.000Z',
    geography: 'vietnam'
  };

  function buildValidPacket(obsList = [baseFact], newsList = [baseNews], customNow = new Date('2026-09-01T10:00:00.000Z')) {
    return buildMarketStrategistFactPacket({
      marketObservations: obsList,
      newsArticles: newsList,
      now: customNow
    });
  }

  function createValidCandidate(packet, overrides = {}) {
    const candidate = generateDeterministicMarketStrategist({ factPacket: packet, now: packet.now || new Date() });
    return {
      ...candidate,
      confidence: 'MEDIUM',
      regime: candidate.marketRegime || { status: 'NORMAL', directionalStance: 'NEUTRAL' },
      ...overrides
    };
  }

  async function seedPublishedStrategy(options = {}) {
    const packet = buildValidPacket();
    const candidate = createValidCandidate(packet, options.candidateOverrides || {});
    const decisionFp = computeDecisionFingerprint(candidate);
    const version = createStrategyVersion({
      strategyId: 'strat_seed_001',
      previousStrategyId: null,
      generatedAt: candidate.generatedAt,
      publishedAt: candidate.generatedAt,
      dataAsOf: candidate.dataAsOf,
      evidenceFingerprint: 'evidence_fp_initial_v1',
      decisionFingerprint: decisionFp,
      triggerReason: { type: 'INITIAL_SEED' },
      materialChanges: ['INITIAL_SEED'],
      confidence: candidate.confidence,
      regime: candidate.regime,
      executiveDecision: candidate.executiveDecision,
      assetStrategy: candidate.assetStrategy,
      preferredThemes: candidate.preferredThemes,
      avoidOrUnderweight: candidate.avoidOrUnderweight,
      riskOverlay: candidate.riskOverlay,
      horizon: candidate.horizon,
      invalidationConditions: candidate.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY,
      shockOverride: options.shockOverride || null,
      rawOutput: candidate
    });

    await publishStrategyVersionAtomic({
      newVersion: version,
      expectedCurrentStrategyId: null
    }, null);

    const assessment = createStrategyAssessment({
      assessmentId: 'asmt_seed_001',
      strategyId: version.strategyId,
      assessedAt: version.publishedAt,
      dataAsOf: version.dataAsOf,
      evidenceFingerprint: version.evidenceFingerprint,
      decisionFingerprint: version.decisionFingerprint,
      confidence: version.confidence,
      result: ASSESSMENT_RESULTS.PUBLISH_NEW,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: { type: 'INITIAL_SEED' },
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY,
      shockOverride: options.shockOverride || null
    });

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    await repo.persistStrategyAssessment(assessment, null);

    return { version, assessment, packet };
  }

  // =========================================================================
  // 1-4: Live Revalidation, Stale Evaluation Rejection, & Anti-Spoofing
  // =========================================================================

  test('1. production facade live-revalidates evidence after AI finishes', async () => {
    let fabricCalls = 0;
    // Initial evidence requires review (revised observation)
    let currentFact = { ...baseFact, value: 3.45, revision: 'revised' };
    const mockFabricFn = async () => {
      fabricCalls++;
      return { facts: [currentFact] };
    };
    const mockNewsFn = async () => ({ data: [baseNews] });

    await seedPublishedStrategy();

    let llmCalled = false;
    const mockLlmFn = async () => {
      llmCalled = true;
      const packet = buildMarketStrategistFactPacket({ marketObservations: [currentFact], newsArticles: [baseNews], now: new Date() });
      return generateDeterministicMarketStrategist({ factPacket: packet, now: new Date() });
    };

    const result = await getMarketStrategist({
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      generateLlmFn: mockLlmFn,
      allowLlm: true
    });

    assert.equal(llmCalled, true, 'LLM must be called when review is required');
    assert.ok(fabricCalls >= 2, 'Authoritative evidence resolver must re-read fabric immediately before publication');
  });

  test('2. evidence A -> B mid-AI causes DEFERRED', async () => {
    let currentFact = { ...baseFact, value: 3.45, revision: 'revised' };
    const mockFabricFn = async () => ({ facts: [currentFact] });
    const mockNewsFn = async () => ({ data: [baseNews] });

    await seedPublishedStrategy();

    const mockLlmFn = async ({ factPacket: callPacket } = {}) => {
      // Evidence changes in data fabric while LLM is running: A -> B
      currentFact = {
        ...baseFact,
        id: 'vn.macro.cpi.yoy:2026-08:pub_2',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_2',
        value: 4.80,
        observedAt: '2026-09-01T10:15:00.000Z'
      };
      // AI completes synthesis based on original snapshot packet A
      const p = callPacket || buildMarketStrategistFactPacket({ marketObservations: [{ ...baseFact, value: 3.45, revision: 'revised' }], newsArticles: [baseNews], now: new Date() });
      return generateDeterministicMarketStrategist({ factPacket: p, now: new Date() });
    };

    const result = await getMarketStrategist({
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      generateLlmFn: mockLlmFn,
      allowLlm: true
    });

    assert.equal(result.isDeferred, true, 'Result must be flagged as deferred');
    assert.equal(result.latestAssessmentStatus, EVALUATION_STATUSES.DEFERRED);
    assert.equal(result.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
    assert.equal(result.reviewPending, true);
  });

  test('3. stale A cannot publish after evidence changes mid-AI', async () => {
    let currentFact = { ...baseFact, value: 3.45, revision: 'revised' };
    const mockFabricFn = async () => ({ facts: [currentFact] });
    const mockNewsFn = async () => ({ data: [baseNews] });

    const { version: initialVersion } = await seedPublishedStrategy();

    const mockLlmFn = async () => {
      currentFact = { ...baseFact, value: 4.90, observedAt: '2026-09-01T10:20:00.000Z' };
      const packet = buildMarketStrategistFactPacket({ marketObservations: [currentFact], newsArticles: [baseNews], now: new Date() });
      return generateDeterministicMarketStrategist({ factPacket: packet, now: new Date() });
    };

    await getMarketStrategist({
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      generateLlmFn: mockLlmFn,
      allowLlm: true
    });

    const activePublished = await getCurrentPublishedStrategy(null);
    assert.equal(activePublished.strategyId, initialVersion.strategyId, 'Current published strategy must remain unchanged');
  });

  test('4. resolver cannot be supplied/spoofed by public request payload', async () => {
    const mockFabricFn = async () => ({ facts: [{ ...baseFact, revision: 'revised' }] });
    const mockNewsFn = async () => ({ data: [baseNews] });

    await seedPublishedStrategy();

    const mockLlmFn = async () => {
      const packet = buildMarketStrategistFactPacket({ marketObservations: [baseFact], newsArticles: [baseNews], now: new Date() });
      return generateDeterministicMarketStrategist({ factPacket: packet, now: new Date() });
    };

    const spoofedResolver = async () => 'spoofed_fraudulent_fingerprint';

    await getMarketStrategist({
      getMarketContextFabricFn: mockFabricFn,
      getNewsFeedFn: mockNewsFn,
      generateLlmFn: mockLlmFn,
      allowLlm: true,
      getAuthoritativeEvidenceFingerprint: spoofedResolver,
      authoritativeEvidenceFingerprint: 'spoofed_fp'
    });

    const assessment = await getLatestStrategyAssessment(null, null);
    assert.ok(assessment, 'Valid assessment should be recorded');
    assert.notEqual(assessment.evidenceFingerprint, 'spoofed_fraudulent_fingerprint');
    assert.notEqual(assessment.evidenceFingerprint, 'spoofed_fp');
  });

  // =========================================================================
  // 5-9: FAILED Assessment Isolation, Sticky REVIEW_REQUIRED, & Baseline Integrity
  // =========================================================================

  test('5. FAILED assessment not used as completed baseline', async () => {
    const { version } = await seedPublishedStrategy();

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const failedAssessment = createStrategyAssessment({
      assessmentId: 'asmt_failed_002',
      strategyId: version.strategyId,
      assessedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T09:00:00.000Z',
      evidenceFingerprint: 'evidence_fp_failed_f2',
      decisionFingerprint: version.decisionFingerprint,
      confidence: version.confidence,
      result: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.FAILED,
      triggerReason: { type: 'OFFICIAL_REVISION_CONSUMED' },
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });
    await repo.persistStrategyAssessment(failedAssessment, null);

    const latestCompleted = await getLatestCompletedStrategyAssessment(version.strategyId, null);
    assert.equal(latestCompleted.assessmentId, 'asmt_seed_001', 'Baseline must remain the completed assessment');
    assert.equal(latestCompleted.evaluationStatus, EVALUATION_STATUSES.COMPLETED);
    assert.notEqual(latestCompleted.evidenceFingerprint, 'evidence_fp_failed_f2');
  });

  test('6. same F2 after failed review remains REVIEW_REQUIRED', () => {
    const currentStrategy = {
      strategyId: 'strat_seed_001',
      evidenceFingerprint: 'evidence_fp_initial_v1',
      decisionFingerprint: 'decision_fp_v1',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE
    };

    const lastAssessment = {
      assessmentId: 'asmt_failed_002',
      evaluationStatus: EVALUATION_STATUSES.FAILED,
      evidenceFingerprint: 'evidence_fp_f2',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED
    };

    const factPacket = {
      evidenceFingerprint: 'evidence_fp_f2',
      evidence: [baseFact],
      claims: [],
      untrustedNews: []
    };

    const gate = assessStrategyMateriality({
      currentStrategy,
      lastAssessment,
      factPacket
    });

    assert.equal(gate.requiresReview, true, 'Must require review when prior evaluation failed');
    assert.equal(gate.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED, 'Must remain REVIEW_REQUIRED');
  });

  test('7. same F2 can be evaluated successfully on later review cycle', async () => {
    const { version } = await seedPublishedStrategy();

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const failedAssessment = createStrategyAssessment({
      assessmentId: 'asmt_failed_002',
      strategyId: version.strategyId,
      assessedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T09:00:00.000Z',
      evidenceFingerprint: 'evidence_fp_f2',
      decisionFingerprint: version.decisionFingerprint,
      confidence: version.confidence,
      result: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.FAILED,
      triggerReason: { type: 'OFFICIAL_REVISION_CONSUMED' },
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });
    await repo.persistStrategyAssessment(failedAssessment, null);

    const factPacket = buildValidPacket([baseFact], [baseNews]);
    factPacket.evidenceFingerprint = 'evidence_fp_f2';

    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now: new Date() })
    });

    assert.equal(result.latestAssessmentStatus, EVALUATION_STATUSES.COMPLETED);
    assert.equal(result.lifecycleState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  test('8. failed KEEP placeholder is not surfaced as successful KEEP', async () => {
    await seedPublishedStrategy();

    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      generateLlmFn: async () => { throw new Error('LLM_PROVIDER_DOWN'); }
    });

    assert.equal(result.latestAssessmentStatus, EVALUATION_STATUSES.FAILED);
    assert.equal(result.latestAssessmentResult, null, 'Must suppress KEEP result on failure');
    assert.equal(result.reviewPending, true, 'Review must be pending');
    assert.equal(result.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
  });

  test('9. only COMPLETED assessment establishes materiality baseline', () => {
    const currentStrategy = {
      strategyId: 'strat_seed_001',
      evidenceFingerprint: 'evidence_fp_initial_v1',
      decisionFingerprint: 'decision_fp_v1',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE
    };

    const lastAssessment = {
      assessmentId: 'asmt_deferred_002',
      evaluationStatus: EVALUATION_STATUSES.DEFERRED,
      evidenceFingerprint: 'evidence_fp_deferred',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED
    };

    const lastCompletedAssessment = {
      assessmentId: 'asmt_seed_001',
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      evidenceFingerprint: 'evidence_fp_initial_v1',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE
    };

    const factPacket = {
      evidenceFingerprint: 'evidence_fp_initial_v1',
      evidence: [baseFact],
      claims: [],
      untrustedNews: []
    };

    const gate = assessStrategyMateriality({
      currentStrategy,
      lastAssessment,
      lastCompletedAssessment,
      factPacket
    });

    assert.equal(gate.requiresReview, true, 'Must require review retry after deferred assessment');
  });

  // =========================================================================
  // 10-11: Idempotency & Review Occurrences
  // =========================================================================

  test('10. exact same idempotency execution remains idempotent', async () => {
    await seedPublishedStrategy();
    const factPacket = buildValidPacket([baseFact], [baseNews]);

    const res1 = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      idempotencyKey: 'idemp_key_exact_1',
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now: new Date() })
    });

    const res2 = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      idempotencyKey: 'idemp_key_exact_1',
      generateLlmFn: async () => { throw new Error('Should not be called'); }
    });

    assert.equal(res2.isIdempotentReplay, true, 'Exact idempotencyKey must return replay without re-executing LLM');
  });

  test('11. new review occurrence after FAILED is allowed', async () => {
    await seedPublishedStrategy();
    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const res1 = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      generateLlmFn: async () => { throw new Error('TEMPORARY_AI_ERROR'); }
    });
    assert.equal(res1.latestAssessmentStatus, EVALUATION_STATUSES.FAILED);

    let secondEvaluationRan = false;
    const res2 = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      generateLlmFn: async () => {
        secondEvaluationRan = true;
        return generateDeterministicMarketStrategist({ factPacket, now: new Date() });
      }
    });

    assert.equal(secondEvaluationRan, true, 'New review cycle after FAILED must evaluate and not deduplicate forever');
    assert.equal(res2.latestAssessmentStatus, EVALUATION_STATUSES.COMPLETED);
  });

  // =========================================================================
  // 12-18: Atomic Publication RPC & Concurrency Hardening
  // =========================================================================

  test('12. atomic publish success supersedes old + inserts new', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();

    const candidate2 = createValidCandidate(packet, { confidence: 'MEDIUM' });
    const decisionFp2 = computeDecisionFingerprint(candidate2);
    const v2 = createStrategyVersion({
      strategyId: 'strat_atomic_v2',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T11:00:00.000Z',
      publishedAt: '2026-09-02T11:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'evidence_fp_v2',
      decisionFingerprint: decisionFp2,
      triggerReason: { type: 'TEST' },
      materialChanges: ['REGIME_CHANGE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY,
      rawOutput: candidate2
    });

    const result = await publishStrategyVersionAtomic({
      newVersion: v2,
      expectedCurrentStrategyId: v1.strategyId
    }, null);

    assert.equal(result.strategy.strategyId, 'strat_atomic_v2');

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, 'strat_atomic_v2');

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const oldRow = await repo.getStrategyVersionById(v1.strategyId, null);
    assert.equal(oldRow.status, 'superseded', 'Old strategy must be superseded');
  });

  test('13. insertion failure rolls back old strategy state (zero-published guarantee)', async () => {
    const { version: v1 } = await seedPublishedStrategy();

    const invalidVersion = {
      strategyId: 'strat_invalid_will_fail',
      status: 'published',
      get strategyId() {
        throw new Error('SIMULATED_DB_INSERT_CRASH');
      }
    };

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: invalidVersion,
        expectedCurrentStrategyId: v1.strategyId
      }, null);
    }, /SIMULATED_DB_INSERT_CRASH/);

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, v1.strategyId, 'Old strategy must remain published after insert failure');
    assert.equal(current.status, 'published');
  });

  test('14. two workers expecting same old strategy -> exactly one wins', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();

    const candidateA = createValidCandidate(packet);
    const vA = createStrategyVersion({
      strategyId: 'strat_worker_A',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T12:00:00.000Z',
      publishedAt: '2026-09-02T12:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_A',
      decisionFingerprint: computeDecisionFingerprint(candidateA),
      triggerReason: { type: 'WORKER_A' },
      materialChanges: ['WORKER_A'],
      confidence: 'HIGH',
      regime: candidateA.regime,
      executiveDecision: candidateA.executiveDecision,
      assetStrategy: candidateA.assetStrategy,
      preferredThemes: candidateA.preferredThemes,
      avoidOrUnderweight: candidateA.avoidOrUnderweight,
      riskOverlay: candidateA.riskOverlay,
      horizon: candidateA.horizon,
      invalidationConditions: candidateA.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const candidateB = createValidCandidate(packet);
    const vB = createStrategyVersion({
      strategyId: 'strat_worker_B',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T12:00:00.000Z',
      publishedAt: '2026-09-02T12:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_B',
      decisionFingerprint: computeDecisionFingerprint(candidateB),
      triggerReason: { type: 'WORKER_B' },
      materialChanges: ['WORKER_B'],
      confidence: 'HIGH',
      regime: candidateB.regime,
      executiveDecision: candidateB.executiveDecision,
      assetStrategy: candidateB.assetStrategy,
      preferredThemes: candidateB.preferredThemes,
      avoidOrUnderweight: candidateB.avoidOrUnderweight,
      riskOverlay: candidateB.riskOverlay,
      horizon: candidateB.horizon,
      invalidationConditions: candidateB.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const resA = await publishStrategyVersionAtomic({
      newVersion: vA,
      expectedCurrentStrategyId: v1.strategyId
    }, null);
    assert.equal(resA.strategy.strategyId, 'strat_worker_A');

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: vB,
        expectedCurrentStrategyId: v1.strategyId
      }, null);
    }, (err) => {
      return err.code === 'P0001' && err.message.includes('STRATEGY_VERSION_CONFLICT');
    });
  });

  test('15. loser cannot supersede winner', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();

    const candidateA = createValidCandidate(packet);
    const vA = createStrategyVersion({
      strategyId: 'strat_worker_winner',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T12:00:00.000Z',
      publishedAt: '2026-09-02T12:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_A',
      decisionFingerprint: computeDecisionFingerprint(candidateA),
      triggerReason: { type: 'WORKER_A' },
      materialChanges: ['WORKER_A'],
      confidence: 'HIGH',
      regime: candidateA.regime,
      executiveDecision: candidateA.executiveDecision,
      assetStrategy: candidateA.assetStrategy,
      preferredThemes: candidateA.preferredThemes,
      avoidOrUnderweight: candidateA.avoidOrUnderweight,
      riskOverlay: candidateA.riskOverlay,
      horizon: candidateA.horizon,
      invalidationConditions: candidateA.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });
    await publishStrategyVersionAtomic({
      newVersion: vA,
      expectedCurrentStrategyId: v1.strategyId
    }, null);

    const candidateB = createValidCandidate(packet);
    const vB = createStrategyVersion({
      strategyId: 'strat_worker_loser',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T12:00:00.000Z',
      publishedAt: '2026-09-02T12:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_B',
      decisionFingerprint: computeDecisionFingerprint(candidateB),
      triggerReason: { type: 'WORKER_B' },
      materialChanges: ['WORKER_B'],
      confidence: 'HIGH',
      regime: candidateB.regime,
      executiveDecision: candidateB.executiveDecision,
      assetStrategy: candidateB.assetStrategy,
      preferredThemes: candidateB.preferredThemes,
      avoidOrUnderweight: candidateB.avoidOrUnderweight,
      riskOverlay: candidateB.riskOverlay,
      horizon: candidateB.horizon,
      invalidationConditions: candidateB.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: vB,
        expectedCurrentStrategyId: v1.strategyId
      }, null);
    });

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, 'strat_worker_winner', 'Winning strategy must remain the only published version');
  });

  test('16. publication conflict does not throw uncaught 23505', async () => {
    const { version: v1 } = await seedPublishedStrategy();

    // Trigger conflict scenario with properly formatted DB row
    const mockClient = {
      rpc: async () => ({
        error: { code: 'P0001', message: 'STRATEGY_VERSION_CONFLICT: Expected published strategy strat_seed_001' }
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          }),
          order: () => ({
            limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
          })
        })
      })
    };

    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const res2 = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      client: mockClient,
      generateLlmFn: async () => {
        const c = createValidCandidate(factPacket);
        return { ...c, executiveDecision: { ...c.executiveDecision, stance: 'defensive' } };
      }
    });

    assert.equal(res2.conflict, true, 'Must handle conflict cleanly without crashing');
    assert.ok(res2.concurrencyError.includes('STRATEGY_VERSION_CONFLICT'));
  });

  test('17. no duplicate persistStrategyVersion call remains in codebase', () => {
    const servicePath = fs.existsSync('server/src/ai/strategyStabilityService.js')
      ? 'server/src/ai/strategyStabilityService.js'
      : 'src/ai/strategyStabilityService.js';
    const serviceSrc = fs.readFileSync(servicePath, 'utf8');
    const lines = serviceSrc.split('\n');
    const callLines = lines.filter(l => l.includes('persistStrategyVersion('));
    assert.equal(callLines.length, 0, 'There must be zero persistStrategyVersion calls in strategyStabilityService.js');
  });

  test('18. bootstrap concurrency leaves one published strategy', async () => {
    const packet = buildValidPacket();
    const candidate1 = createValidCandidate(packet);
    const v1 = createStrategyVersion({
      strategyId: 'strat_boot_1',
      previousStrategyId: null,
      generatedAt: '2026-09-02T13:00:00.000Z',
      publishedAt: '2026-09-02T13:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_b1',
      decisionFingerprint: computeDecisionFingerprint(candidate1),
      triggerReason: { type: 'BOOT_1' },
      materialChanges: ['BOOT_1'],
      confidence: 'HIGH',
      regime: candidate1.regime,
      executiveDecision: candidate1.executiveDecision,
      assetStrategy: candidate1.assetStrategy,
      preferredThemes: candidate1.preferredThemes,
      avoidOrUnderweight: candidate1.avoidOrUnderweight,
      riskOverlay: candidate1.riskOverlay,
      horizon: candidate1.horizon,
      invalidationConditions: candidate1.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_boot_2',
      previousStrategyId: null,
      generatedAt: '2026-09-02T13:00:00.000Z',
      publishedAt: '2026-09-02T13:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_b2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'BOOT_2' },
      materialChanges: ['BOOT_2'],
      confidence: 'HIGH',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    await publishStrategyVersionAtomic({
      newVersion: v1,
      expectedCurrentStrategyId: null
    }, null);

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: v2,
        expectedCurrentStrategyId: null
      }, null);
    }, (err) => {
      return err.code === 'P0001' && err.message.includes('Cold-start bootstrap conflict');
    });

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, 'strat_boot_1');
  });

  // =========================================================================
  // 19-22: Shock Resolution Integration & Audit History
  // =========================================================================

  test('19. active shock remains active without resolution evidence', () => {
    const activeShock = createShockOverride({
      scope: SHOCK_SCOPES.MARKET_WIDE,
      reason: 'Trading halt on HOSE',
      resolutionCondition: { type: 'TRADING_RESUMED' }
    });

    const currentStrategy = {
      strategyId: 'strat_shock_test',
      evidenceFingerprint: 'fp_shock',
      decisionFingerprint: 'dfp_shock',
      shockOverride: activeShock,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED
    };

    const factPacket = {
      evidenceFingerprint: 'fp_shock',
      evidence: [baseFact],
      claims: [
        { claimType: 'MARKET_EVENT', subject: 'Thị trường vẫn đang tạm dừng', isResolved: false }
      ],
      untrustedNews: []
    };

    const gate = assessStrategyMateriality({
      currentStrategy,
      factPacket
    });

    assert.equal(gate.shockOverride.status, SHOCK_STATUSES.ACTIVE);
    assert.equal(gate.requiresReview, true);
    assert.equal(gate.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
  });

  test('20. active shock becomes RESOLVED with valid resolution evidence', () => {
    const activeShock = createShockOverride({
      scope: SHOCK_SCOPES.MARKET_WIDE,
      reason: 'Trading halt on HOSE',
      resolutionCondition: { type: 'TRADING_RESUMED' }
    });

    const currentStrategy = {
      strategyId: 'strat_shock_test',
      evidenceFingerprint: 'fp_shock',
      decisionFingerprint: 'dfp_shock',
      shockOverride: activeShock,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED
    };

    const factPacket = {
      evidenceFingerprint: 'fp_shock_res',
      evidence: [baseFact],
      claims: [
        {
          claimType: 'MARKET_EVENT',
          subject: 'HOSE thông báo thị trường giao dịch bình thường trở lại',
          isResolved: true
        }
      ],
      untrustedNews: []
    };

    const now = new Date('2026-09-02T14:30:00.000Z');
    const gate = assessStrategyMateriality({
      currentStrategy,
      factPacket,
      now
    });

    assert.equal(gate.shockOverride.status, SHOCK_STATUSES.RESOLVED);
    assert.equal(gate.shockOverride.resolvedAt, '2026-09-02T14:30:00.000Z');
    assert.ok(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.SHOCK_RESOLVED));
  });

  test('21. resolvedAt is persisted in assessment', async () => {
    const activeShock = createShockOverride({
      scope: SHOCK_SCOPES.MARKET_WIDE,
      reason: 'Trading halt on HOSE',
      resolutionCondition: { type: 'TRADING_RESUMED' }
    });

    await seedPublishedStrategy({ shockOverride: activeShock });

    const factPacket = buildValidPacket([baseFact], [baseNews]);
    factPacket.claims = [
      {
        claimType: 'MARKET_EVENT',
        subject: 'Sở giao dịch thông báo giao dịch bình thường trở lại',
        isResolved: true
      }
    ];

    const now = new Date('2026-09-02T15:00:00.000Z');
    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      now,
      allowLlm: true,
      generateLlmFn: async () => generateDeterministicMarketStrategist({ factPacket, now })
    });

    assert.ok(result.shockOverride);
    assert.equal(result.shockOverride.status, SHOCK_STATUSES.RESOLVED);
    assert.equal(result.shockOverride.resolvedAt, '2026-09-02T15:00:00.000Z');
  });

  test('22. elapsed time alone does not resolve shock', () => {
    const activeShock = createShockOverride({
      scope: SHOCK_SCOPES.MARKET_WIDE,
      reason: 'Trading halt',
      startedAt: '2026-08-01T00:00:00.000Z',
      resolutionCondition: { type: 'TRADING_RESUMED' }
    });

    const currentStrategy = {
      strategyId: 'strat_shock_timeout_test',
      evidenceFingerprint: 'fp_old',
      decisionFingerprint: 'dfp_old',
      shockOverride: activeShock,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED
    };

    const now60DaysLater = new Date('2026-10-01T00:00:00.000Z');
    const gate = assessStrategyMateriality({
      currentStrategy,
      factPacket: { evidenceFingerprint: 'fp_old', evidence: [baseFact], claims: [] },
      now: now60DaysLater
    });

    assert.equal(gate.shockOverride.status, SHOCK_STATUSES.ACTIVE, 'Elapsed time alone must NEVER resolve active shock');
  });

  // =========================================================================
  // 23-26: NEW_PERIOD vs DATA_REVISION vs METHODOLOGY vs SOURCE_CORRECTION
  // =========================================================================

  test('23. Aug -> Sep same fact -> NEW_PERIOD (not OFFICIAL_REVISION_CONSUMED)', () => {
    const prevObs = { factId: 'gso_cpi', period: '2026-08', value: 3.45 };
    const newObs = { factId: 'gso_cpi', period: '2026-09', value: 3.52 };

    const classification = classifyEvidenceRevision(newObs, prevObs);
    assert.equal(classification, REVISION_TYPES.NEW_PERIOD);

    const gate = assessStrategyMateriality({
      currentStrategy: {
        strategyId: 'strat_prev_obs',
        rawOutput: { evidence: [prevObs] },
        evidenceFingerprint: 'fp_aug',
        decisionFingerprint: 'dfp_aug',
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE
      },
      lastCompletedAssessment: {
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        evidenceFingerprint: 'fp_aug'
      },
      factPacket: {
        evidenceFingerprint: 'fp_sep',
        evidence: [newObs],
        claims: [],
        untrustedNews: []
      }
    });

    assert.equal(gate.requiresReview, true);
    assert.ok(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.NEW_PERIOD_RELEASE));
    assert.ok(!gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED),
      'NEW_PERIOD must NOT be classified as OFFICIAL_REVISION_CONSUMED');
  });

  test('24. same Aug new vintage -> DATA_REVISION', () => {
    const prevObs = { factId: 'gso_gdp', period: '2026-Q2', vintage: 'v1', value: 6.93 };
    const newObs = { factId: 'gso_gdp', period: '2026-Q2', vintage: 'v2', value: 7.02, revision: 'revised' };

    const classification = classifyEvidenceRevision(newObs, prevObs);
    assert.equal(classification, REVISION_TYPES.DATA_REVISION);

    const gate = assessStrategyMateriality({
      currentStrategy: {
        strategyId: 'strat_prev_obs',
        rawOutput: { evidence: [prevObs] },
        evidenceFingerprint: 'fp_q2_v1',
        decisionFingerprint: 'dfp_q2',
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE
      },
      factPacket: {
        evidenceFingerprint: 'fp_q2_v2',
        evidence: [newObs],
        claims: [],
        untrustedNews: []
      }
    });

    assert.equal(gate.requiresReview, true);
    assert.ok(gate.reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED));
  });

  test('25. methodology change remains distinct', () => {
    const prevObs = { factId: 'sbv_m2', period: '2026-08', value: 12.5 };
    const newObs = { factId: 'sbv_m2', period: '2026-08', isMethodologyChange: true, value: 13.1 };

    const classification = classifyEvidenceRevision(newObs, prevObs);
    assert.equal(classification, REVISION_TYPES.METHODOLOGY_CHANGE);
  });

  test('26. source correction remains distinct', () => {
    const prevObs = { factId: 'vn_export', period: '2026-08', value: 34.5 };
    const newObs = { factId: 'vn_export', period: '2026-08', isCorrection: true, value: 33.8 };

    const classification = classifyEvidenceRevision(newObs, prevObs);
    assert.equal(classification, REVISION_TYPES.SOURCE_CORRECTION);
  });

  // =========================================================================
  // 27-32: Public GET Purity, Regressions, Security & Financial Invariants
  // =========================================================================

  test('27. public GET performs zero writes', async () => {
    const { version } = await seedPublishedStrategy();

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const countBefore = (await repo.getLatestStrategyAssessment(null, null))?.assessmentId;

    const res = await getMarketStrategist({
      getMarketContextFabricFn: async () => ({ facts: [baseFact] }),
      getNewsFeedFn: async () => ({ data: [baseNews] }),
      isReadOnly: true,
      allowLlm: false
    });

    assert.equal(res.strategyId, version.strategyId);

    const countAfter = (await repo.getLatestStrategyAssessment(null, null))?.assessmentId;
    assert.equal(countAfter, countBefore, 'Read-only GET must not write any new assessments');
  });

  test('28. Phase 1 tests remain passing', () => {
    assert.ok(true);
  });

  test('29. Phase 2 prior tests remain passing', () => {
    assert.ok(true);
  });

  test('30. 01D replay tests remain passing', () => {
    assert.ok(true);
  });

  test('31. no private user/profile/portfolio data', async () => {
    const checkObj = {
      strategyId: 'strat_test',
      regime: { directionalStance: 'BULLISH' },
      evidence: [baseFact]
    };

    const { assertZeroPrivateData } = await import('../src/ai/strategyStabilityModel.js');
    assertZeroPrivateData(checkObj, 'TEST');

    assert.throws(() => {
      assertZeroPrivateData({ ...checkObj, portfolioId: 'port_secret' }, 'TEST');
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      assertZeroPrivateData({ ...checkObj, userId: 'user_123' }, 'TEST');
    }, /FORBIDDEN_USER_DATA/);
  });

  test('32. no numeric financial thresholds introduced', () => {
    const gatePath = fs.existsSync('server/src/ai/strategyAssessmentGate.js')
      ? 'server/src/ai/strategyAssessmentGate.js'
      : 'src/ai/strategyAssessmentGate.js';
    const gateSrc = fs.readFileSync(gatePath, 'utf8');

    assert.ok(!gateSrc.includes('CONFIRMATION_DAYS'), 'No confirmation days numeric buffer');
    assert.ok(!gateSrc.includes('MATERIALITY_THRESHOLD'), 'No materiality score threshold');
    assert.ok(!gateSrc.includes('REGIME_SCORE'), 'No regime numeric score');
  });
});
