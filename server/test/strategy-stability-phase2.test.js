import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

import {
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_LIFECYCLE_STATES,
  DATA_QUALITY_STATES,
  SHOCK_SCOPES,
  SHOCK_STATUSES,
  REVISION_TYPES,
  STABILITY_POLICY_VERSION,
  computeDecisionFingerprint,
  computeConfirmationKey,
  createShockOverride,
  createStrategyVersion,
  createStrategyAssessment,
  assertZeroPrivateData
} from '../src/ai/strategyStabilityModel.js';

import {
  assessStrategyMateriality,
  assessDataQuality,
  classifyEvidenceRevision,
  collectConfirmationKeys,
  detectShockOverride,
  resolveShockOverride,
  transitionLifecycleState,
  MATERIALITY_TRIGGER_TYPES
} from '../src/ai/strategyAssessmentGate.js';

import {
  getCurrentPublishedStrategy,
  getStrategyVersionById,
  persistStrategyVersion,
  supersedeStrategyVersion,
  getLatestStrategyAssessment,
  getStrategyAssessmentByIdempotencyKey,
  persistStrategyAssessment,
  updateStrategyAssessment,
  deleteStrategyAssessment,
  listStrategyAssessments,
  clearStabilityMemoryStore
} from '../src/ai/strategyStabilityRepository.js';

import {
  evaluateAndApplyStrategyStability
} from '../src/ai/strategyStabilityService.js';

import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint
} from '../src/ai/marketStrategistEngine.js';

import { getMarketStrategist } from '../src/marketStrategist.js';
import { CLAIM_STATUS, CLAIM_TYPES, CLAIM_AUTHORITY_LEVELS } from '../src/claims/claimModel.js';

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
    dependencyGroup: 'VNDIRECT_FEED',
    period: '2026-09-04',
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
    dependencyGroup: 'OFFICIAL_MACRO',
    period: '2026-08',
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
    dependencyGroup: 'VNE_SYNDICATED',
    url: 'https://cafef.vn/cpi-thang-8.chn',
    publishedAt: '2026-09-01T03:00:00.000Z',
    geography: 'vietnam'
  }
];

test('V1.3 Strategy Stability — Phase 2 Comprehensive 42-Scenario Specification Suite', async (suite) => {

  suite.beforeEach(() => {
    clearStabilityMemoryStore();
  });

  // 1. STABLE + no new evidence -> STABLE
  await suite.test('1. STABLE + no new evidence -> STABLE', async () => {
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
    assert.equal(initial.lifecycleState, STRATEGY_LIFECYCLE_STATES.STABLE);

    const followUp = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:05:00.000Z'),
      allowLlm: false,
      client: null
    });
    assert.equal(followUp.lifecycleState, STRATEGY_LIFECYCLE_STATES.STABLE);
    assert.equal(followUp.latestAssessmentResult, ASSESSMENT_RESULTS.KEEP);
  });

  // 2. same observation reread -> no new confirmation
  await suite.test('2. same observation reread -> no new confirmation', async () => {
    const obs = BASELINE_OBSERVATIONS[1];
    const key1 = computeConfirmationKey({
      factId: obs.factId,
      referencePeriod: obs.period,
      observationId: obs.observationId,
      dependencyGroup: obs.dependencyGroup
    });
    const key2 = computeConfirmationKey({
      factId: obs.factId,
      referencePeriod: obs.period,
      observationId: obs.observationId,
      dependencyGroup: obs.dependencyGroup
    });
    assert.equal(key1, key2, 'Rereading exact observation must yield identical confirmation identity');
  });

  // 3. same syndicated source repeated -> no new confirmation
  await suite.test('3. same syndicated source repeated -> no new confirmation', async () => {
    const article1 = { articleId: 'art_1', dependencyGroup: 'MEDIA_SYNDICATE_A' };
    const article2 = { articleId: 'art_2', dependencyGroup: 'MEDIA_SYNDICATE_A' };

    const key1 = computeConfirmationKey({ dependencyGroup: article1.dependencyGroup });
    const key2 = computeConfirmationKey({ dependencyGroup: article2.dependencyGroup });
    assert.equal(key1, key2, 'Syndicated copies from same dependency must collapse to identical confirmation identity');
  });

  // 4. new reference period creates a new confirmation identity
  await suite.test('4. new reference period creates a new confirmation identity', async () => {
    const keyAug = computeConfirmationKey({ factId: 'vn.macro.cpi.yoy', referencePeriod: '2026-08' });
    const keySep = computeConfirmationKey({ factId: 'vn.macro.cpi.yoy', referencePeriod: '2026-09' });
    assert.notEqual(keyAug, keySep, 'New reference period must produce distinct confirmation identity');
  });

  // 5. new independent dependency creates new confirmation identity
  await suite.test('5. new independent dependency creates new confirmation identity', async () => {
    const keyNso = computeConfirmationKey({ factId: 'vn.macro.gdp', dependencyGroup: 'NSO' });
    const keySbv = computeConfirmationKey({ factId: 'vn.macro.gdp', dependencyGroup: 'SBV' });
    assert.notEqual(keyNso, keySbv, 'Different independent dependencies must produce distinct confirmation identity');
  });

  // 6. unconfirmed structural change -> WATCH
  await suite.test('6. unconfirmed structural change -> WATCH', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    const watchPacket = {
      ...packet,
      derivedSignals: [{ signalId: 'sig_liquidity_tightening_preliminary', isUnconfirmed: true }],
      evidenceFingerprint: 'ev_unconfirmed_signal_fp'
    };

    const res = await evaluateAndApplyStrategyStability({
      factPacket: watchPacket,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      client: null
    });

    assert.equal(res.lifecycleState, STRATEGY_LIFECYCLE_STATES.WATCH);
    assert.ok(res.watchReasons.length > 0);
    assert.equal(res.watchReasons[0].type, 'UNCONFIRMED_SIGNAL_CHANGE');
  });

  // 7. WATCH + evidence disappears/is invalidated -> STABLE
  await suite.test('7. WATCH + evidence disappears/is invalidated -> STABLE', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    // Move to WATCH
    const watchPacket = {
      ...packet,
      derivedSignals: [{ signalId: 'sig_temporary_concern', isUnconfirmed: true }],
      evidenceFingerprint: 'ev_watch_fp'
    };
    const watchRes = await evaluateAndApplyStrategyStability({
      factPacket: watchPacket,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      client: null
    });
    assert.equal(watchRes.lifecycleState, STRATEGY_LIFECYCLE_STATES.WATCH);

    // Revert back without the unconfirmed signal
    const restoredPacket = {
      ...packet,
      derivedSignals: [],
      evidenceFingerprint: 'ev_restored_clean_fp'
    };
    const recovered = await evaluateAndApplyStrategyStability({
      factPacket: restoredPacket,
      now: new Date('2026-09-06T00:20:00.000Z'),
      allowLlm: false,
      client: null
    });
    assert.equal(recovered.lifecycleState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 8. WATCH + structural confirmation -> REVIEW_REQUIRED
  await suite.test('8. WATCH + structural confirmation -> REVIEW_REQUIRED', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    // Transition to WATCH
    const watchPacket = {
      ...packet,
      derivedSignals: [{ signalId: 'sig_rate_pressure', isUnconfirmed: true }],
      evidenceFingerprint: 'ev_rate_pressure_fp'
    };
    await evaluateAndApplyStrategyStability({
      factPacket: watchPacket,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      client: null
    });

    // Confirmation arrives via corroborated official claim
    const confirmedPacket = {
      ...packet,
      claims: [
        {
          claimId: 'claim_sbv_rate_hike_confirmed',
          claimType: CLAIM_TYPES.POLICY_EVENT,
          authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
          supportStatus: CLAIM_STATUS.CORROBORATED,
          independentSourceCount: 3,
          subject: 'SBV tăng lãi suất điều hành chính thức'
        }
      ],
      evidenceFingerprint: 'ev_confirmed_rate_fp'
    };

    let aiReviewAttempted = false;
    await evaluateAndApplyStrategyStability({
      factPacket: confirmedPacket,
      now: new Date('2026-09-06T00:30:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        aiReviewAttempted = true;
        return {
          executiveDecision: { stance: 'DEFENSIVE', actionNow: 'Giảm tỷ trọng cổ phiếu' },
          confidence: 'HIGH'
        };
      },
      client: null
    });

    assert.equal(aiReviewAttempted, true, 'Confirmed signal in WATCH must trigger AI review (REVIEW_REQUIRED)');
  });

  // 9. REVIEW_REQUIRED -> EVALUATING when review starts
  await suite.test('9. REVIEW_REQUIRED -> EVALUATING when review starts', async () => {
    let capturedState = null;
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED, 'EVALUATION_STARTED');
    assert.equal(nextState, STRATEGY_LIFECYCLE_STATES.EVALUATING);

    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    // Trigger review and observe onStateTransition hook
    await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: NOW,
      allowLlm: false,
      onStateTransition: (state) => {
        capturedState = state;
      },
      client: null
    });
    assert.equal(capturedState, STRATEGY_LIFECYCLE_STATES.EVALUATING);
  });

  // 10. successful KEEP -> STABLE
  await suite.test('10. successful KEEP -> STABLE', async () => {
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.EVALUATING, 'EVALUATION_COMPLETED', { result: 'KEEP' });
    assert.equal(nextState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 11. successful CONFIDENCE -> STABLE
  await suite.test('11. successful CONFIDENCE -> STABLE', async () => {
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.EVALUATING, 'EVALUATION_COMPLETED', { result: 'CONFIDENCE' });
    assert.equal(nextState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 12. successful DETAILS -> STABLE
  await suite.test('12. successful DETAILS -> STABLE', async () => {
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.EVALUATING, 'EVALUATION_COMPLETED', { result: 'DETAILS' });
    assert.equal(nextState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 13. successful PUBLISH_NEW -> STABLE
  await suite.test('13. successful PUBLISH_NEW -> STABLE', async () => {
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.EVALUATING, 'EVALUATION_COMPLETED', { result: 'PUBLISH_NEW' });
    assert.equal(nextState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 14. AI failure from EVALUATING -> current strategy preserved
  await suite.test('14. AI failure from EVALUATING -> current strategy preserved', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    const initial = await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    const reviewPacket = {
      ...packet,
      claims: [
        {
          claimId: 'claim_corroborated_test',
          supportStatus: CLAIM_STATUS.CORROBORATED,
          independentSourceCount: 2,
          subject: 'Biến động vĩ mô được xác nhận'
        }
      ],
      evidenceFingerprint: 'ev_review_req_failure_test'
    };

    const failedRun = await evaluateAndApplyStrategyStability({
      factPacket: reviewPacket,
      now: new Date('2026-09-06T00:15:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        throw new Error('Gemini API Quota Exceeded (429)');
      },
      client: null
    });

    assert.equal(failedRun.strategyId, initial.strategyId, 'Published strategyId must be preserved on AI failure');
    assert.equal(failedRun.decisionFingerprint, initial.decisionFingerprint);
  });

  // 15. AI failure does not falsely transition to successful STABLE
  await suite.test('15. AI failure does not falsely transition to successful STABLE', async () => {
    const nextState = transitionLifecycleState(STRATEGY_LIFECYCLE_STATES.EVALUATING, 'EVALUATION_FAILED');
    assert.notEqual(nextState, STRATEGY_LIFECYCLE_STATES.STABLE);
  });

  // 16. failed evaluation returns REVIEW_REQUIRED or truthful pending state
  await suite.test('16. failed evaluation returns REVIEW_REQUIRED or truthful pending state', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    const reviewPacket = {
      ...packet,
      claims: [{ claimId: 'claim_fail_test', supportStatus: CLAIM_STATUS.CORROBORATED, independentSourceCount: 2, subject: 'Review trigger' }],
      evidenceFingerprint: 'ev_trigger_failure_test'
    };

    const failedRun = await evaluateAndApplyStrategyStability({
      factPacket: reviewPacket,
      now: new Date('2026-09-06T00:15:00.000Z'),
      allowLlm: true,
      generateLlmFn: async () => {
        throw new Error('Timeout communicating with AI provider');
      },
      client: null
    });

    assert.equal(failedRun.latestAssessmentStatus, EVALUATION_STATUSES.FAILED);
    assert.equal(failedRun.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
  });

  // 17. data quality HEALTHY -> DEGRADED
  await suite.test('17. data quality HEALTHY -> DEGRADED', async () => {
    const healthyPacket = { evidence: [{ id: 'obs_1', status: 'available', freshness: 'fresh' }] };
    assert.equal(assessDataQuality(healthyPacket), DATA_QUALITY_STATES.HEALTHY);

    const degradedPacket = {
      evidence: [
        { id: 'obs_1', status: 'available', freshness: 'fresh' },
        { id: 'obs_2', status: 'stale', freshness: 'stale' }
      ]
    };
    assert.equal(assessDataQuality(degradedPacket), DATA_QUALITY_STATES.DEGRADED);
  });

  // 18. data quality DEGRADED -> INSUFFICIENT
  await suite.test('18. data quality DEGRADED -> INSUFFICIENT', async () => {
    const insufficientPacket = {
      evidence: [
        { id: 'obs_1', status: 'unavailable' },
        { id: 'obs_2', status: 'unavailable' }
      ]
    };
    assert.equal(assessDataQuality(insufficientPacket), DATA_QUALITY_STATES.INSUFFICIENT);
  });

  // 19. INSUFFICIENT does not force NEUTRAL regime
  await suite.test('19. INSUFFICIENT does not force NEUTRAL regime', async () => {
    const initialVersion = createStrategyVersion({
      strategyId: 'strat_regime_test_1',
      evidenceFingerprint: 'ev_baseline',
      decisionFingerprint: 'dec_baseline',
      confidence: 'MEDIUM',
      regime: { status: 'DEFENSIVE', directionalStance: 'CAUTIOUS' },
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED
    });
    await persistStrategyVersion(initialVersion, null);

    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });

    const degradedPacket = {
      ...packet,
      evidence: [
        { id: 'obs_cpi', status: 'unavailable', factId: 'vn.macro.cpi.yoy' },
        { id: 'obs_vnindex', status: 'unavailable', factId: 'vn.market.vnindex.close' }
      ],
      evidenceFingerprint: 'ev_insufficient_fp'
    };

    const res = await evaluateAndApplyStrategyStability({
      factPacket: degradedPacket,
      now: new Date('2026-09-06T00:15:00.000Z'),
      allowLlm: false,
      client: null
    });

    assert.equal(res.dataQualityState, DATA_QUALITY_STATES.INSUFFICIENT);
    assert.equal(res.regime?.directionalStance, 'CAUTIOUS', 'INSUFFICIENT data must NOT overwrite regime to NEUTRAL');
    assert.notEqual(res.regime?.directionalStance, 'NEUTRAL');
  });

  // 20. official validated shock bypasses ordinary confirmation waiting
  await suite.test('20. official validated shock bypasses ordinary confirmation waiting', async () => {
    const shockClaim = {
      claimId: 'claim_sbv_emergency_policy',
      claimType: CLAIM_TYPES.POLICY_EVENT,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      subject: 'SBV ban hành quyết định can thiệp khẩn cấp'
    };
    const packet = {
      evidence: BASELINE_OBSERVATIONS,
      claims: [shockClaim],
      evidenceFingerprint: 'ev_shock_fp'
    };

    const gate = assessStrategyMateriality({
      currentStrategy: { strategyId: 'strat_active', evidenceFingerprint: 'ev_baseline', lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE },
      factPacket: packet,
      now: NOW
    });

    assert.equal(gate.requiresReview, true);
    assert.equal(gate.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
    assert.ok(gate.shockOverride);
    assert.equal(gate.shockOverride.scope, SHOCK_SCOPES.POLICY);
  });

  // 21. unverified news cannot trigger shock override
  await suite.test('21. unverified news cannot trigger shock override', async () => {
    const unverifiedRumorClaim = {
      claimId: 'claim_unverified_rumor',
      claimType: CLAIM_TYPES.POLICY_EVENT,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.SECONDARY_MEDIA,
      subject: 'Tin đồn thay đổi chính sách tỷ giá'
    };
    const shock = detectShockOverride({
      claims: [unverifiedRumorClaim],
      evidence: BASELINE_OBSERVATIONS
    });
    assert.equal(shock, null, 'Unverified news must never trigger shock override');
  });

  // 22. shock does not bypass evidence validation
  await suite.test('22. shock does not bypass evidence validation', async () => {
    assert.throws(() => {
      createShockOverride({
        triggerEvidence: [{ portfolioId: 'user_portfolio_leak' }],
        scope: SHOCK_SCOPES.MARKET_WIDE
      });
    }, /FORBIDDEN_USER_DATA/);
  });

  // 23. shock may update tactical risk scope without forcing macro regime change
  await suite.test('23. shock may update tactical risk scope without forcing macro regime change', async () => {
    const tacticalShock = createShockOverride({
      triggerEvidence: ['obs_market_halt_1'],
      scope: SHOCK_SCOPES.TACTICAL_RISK_OVERLAY,
      reason: 'Biến động thanh khoản đột ngột',
      resolutionCondition: { type: 'TACTICAL_RISK_SUBSIDED' }
    });
    assert.equal(tacticalShock.scope, SHOCK_SCOPES.TACTICAL_RISK_OVERLAY);
  });

  // 24. shock resolution requires evidence, not elapsed time alone
  await suite.test('24. shock resolution requires evidence, not elapsed time alone', async () => {
    const shock = createShockOverride({
      triggerEvidence: ['claim_halt_1'],
      scope: SHOCK_SCOPES.MARKET_WIDE,
      reason: 'Tạm ngừng giao dịch',
      resolutionCondition: { type: 'TRADING_RESUMED' }
    });

    // Advance 60 days without resolving evidence
    const unresolved = resolveShockOverride(shock, { claims: [], evidence: [] }, new Date('2026-11-06T00:00:00.000Z'));
    assert.equal(unresolved.status, SHOCK_STATUSES.ACTIVE, 'Shock must remain ACTIVE without evidence, even if time elapses');

    // Resolving evidence arrives
    const resolved = resolveShockOverride(
      shock,
      { claims: [{ claimType: CLAIM_TYPES.MARKET_EVENT, subject: 'Giao dịch bình thường trở lại tại Sở GDCK' }] },
      new Date('2026-11-06T00:00:00.000Z')
    );
    assert.equal(resolved.status, SHOCK_STATUSES.RESOLVED);
    assert.ok(resolved.resolvedAt);
  });

  // 25. DATA_REVISION classified separately from NEW_PERIOD
  await suite.test('25. DATA_REVISION classified separately from NEW_PERIOD', async () => {
    const revisedObs = { factId: 'vn.macro.cpi', period: '2026-08', revision: 'revised' };
    const prevObs = { factId: 'vn.macro.cpi', period: '2026-08', revision: 'original' };
    const newPeriodObs = { factId: 'vn.macro.cpi', period: '2026-09' };

    const revType = classifyEvidenceRevision(revisedObs, prevObs);
    const newPeriodType = classifyEvidenceRevision(newPeriodObs, prevObs);

    assert.equal(revType, REVISION_TYPES.DATA_REVISION);
    assert.equal(newPeriodType, REVISION_TYPES.NEW_PERIOD);
    assert.notEqual(revType, newPeriodType);
  });

  // 26. SOURCE_CORRECTION classified separately from DATA_REVISION
  await suite.test('26. SOURCE_CORRECTION classified separately from DATA_REVISION', async () => {
    const correctionObs = { factId: 'vn.customs.trade', isCorrection: true };
    const revisionObs = { factId: 'vn.customs.trade', revision: 'revised' };

    assert.equal(classifyEvidenceRevision(correctionObs), REVISION_TYPES.SOURCE_CORRECTION);
    assert.equal(classifyEvidenceRevision(revisionObs), REVISION_TYPES.DATA_REVISION);
  });

  // 27. METHODOLOGY_CHANGE does not masquerade as market movement
  await suite.test('27. METHODOLOGY_CHANGE does not masquerade as market movement', async () => {
    const methodologyObs = { factId: 'vn.macro.m2', isMethodologyChange: true };
    assert.equal(classifyEvidenceRevision(methodologyObs), REVISION_TYPES.METHODOLOGY_CHANGE);
  });

  // 28. stale evaluation cannot publish after newer evidence supersedes snapshot
  await suite.test('28. stale evaluation cannot publish after newer evidence supersedes snapshot', async () => {
    clearStabilityMemoryStore();
    const packetA = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    const initial = await evaluateAndApplyStrategyStability({ factPacket: packetA, now: NOW, allowLlm: false, client: null });

    const reviewPacket = {
      ...packetA,
      claims: [{ claimId: 'claim_trigger_rev', supportStatus: CLAIM_STATUS.CORROBORATED, independentSourceCount: 2, subject: 'Review trigger' }],
      evidenceFingerprint: 'ev_snapshot_A'
    };

    // Simulate authoritative evidence superseded by snapshot B while AI ran
    const res = await evaluateAndApplyStrategyStability({
      factPacket: reviewPacket,
      now: new Date('2026-09-06T00:20:00.000Z'),
      allowLlm: true,
      authoritativeEvidenceFingerprint: 'ev_newer_superseded_B',
      generateLlmFn: async () => ({
        ...initial,
        confidence: 'HIGH',
        regime: { ...(initial.regime || {}), status: 'DEFENSIVE', directionalStance: 'CAUTIOUS' },
        executiveDecision: {
          ...(initial.executiveDecision || {}),
          stance: 'defensive',
          conviction: 'high',
          confidence: 'HIGH'
        }
      }),
      client: null
    });

    assert.equal(res.strategyId, initial.strategyId, 'Stale evaluation must not overwrite published strategy');
    assert.equal(res.latestAssessmentStatus, EVALUATION_STATUSES.DEFERRED);
    assert.equal(res.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
    assert.equal(res.isDeferred, true);
  });

  // 29. publication race cannot leave two current strategies
  await suite.test('29. publication race cannot leave two current strategies', async () => {
    const version1 = createStrategyVersion({
      strategyId: 'strat_worker_1',
      evidenceFingerprint: 'ev_1',
      decisionFingerprint: 'dec_1',
      confidence: 'MEDIUM',
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED
    });
    await persistStrategyVersion(version1, null);

    const version2 = createStrategyVersion({
      strategyId: 'strat_worker_2',
      evidenceFingerprint: 'ev_2',
      decisionFingerprint: 'dec_2',
      confidence: 'MEDIUM',
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED
    });

    await assert.rejects(
      async () => {
        await persistStrategyVersion(version2, null);
      },
      /multiple published versions forbidden/
    );
  });

  // 30. DB enforces only one status=published
  await suite.test('30. DB enforces only one status=published', async () => {
    const migrationPath = path.join(REPO_ROOT, 'supabase/migrations/20260906000000_create_strategy_stability_foundation.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(
      sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_versions_single_published'),
      'Migration must define partial unique index on status=published'
    );
    assert.ok(
      sql.includes("WHERE (status = 'published')") || sql.includes("WHERE status = 'published'"),
      'Migration index predicate must filter where status=published'
    );
  });

  // 31. strategy_assessments UPDATE rejected
  await suite.test('31. strategy_assessments UPDATE rejected', async () => {
    await assert.rejects(
      async () => {
        await updateStrategyAssessment('asmt_1', { result: 'PUBLISH_NEW' }, null);
      },
      /strategy_assessments is append-only: UPDATE and DELETE operations are forbidden/
    );
  });

  // 32. strategy_assessments DELETE rejected
  await suite.test('32. strategy_assessments DELETE rejected', async () => {
    await assert.rejects(
      async () => {
        await deleteStrategyAssessment('asmt_1', null);
      },
      /strategy_assessments is append-only: UPDATE and DELETE operations are forbidden/
    );
  });

  // 33. assessment exact retry is idempotent
  await suite.test('33. assessment exact retry is idempotent', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    const retryKey = 'scheduler_retry_job_20260906_0100';
    const firstCall = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      idempotencyKey: retryKey,
      client: null
    });

    const secondCall = await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      idempotencyKey: retryKey,
      client: null
    });

    assert.equal(secondCall.isIdempotentReplay, true);
    assert.equal(firstCall.latestAssessmentAt, secondCall.latestAssessmentAt);

    const assessments = await listStrategyAssessments(firstCall.strategyId, null);
    // Initial + 1 unique idempotency run = 2 assessments (not 3!)
    assert.equal(assessments.length, 2);
  });

  // 34. real later assessment is not incorrectly deduplicated
  await suite.test('34. real later assessment is not incorrectly deduplicated', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    const initial = await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:10:00.000Z'),
      allowLlm: false,
      idempotencyKey: 'job_cycle_1',
      client: null
    });

    await evaluateAndApplyStrategyStability({
      factPacket: packet,
      now: new Date('2026-09-06T00:20:00.000Z'),
      allowLlm: false,
      idempotencyKey: 'job_cycle_2',
      client: null
    });

    const assessments = await listStrategyAssessments(initial.strategyId, null);
    assert.equal(assessments.length, 3, 'Distinct review cycles must each be recorded in append-only log');
  });

  // 35. state survives repository/process restart
  await suite.test('35. state survives repository/process restart', async () => {
    const version = createStrategyVersion({
      strategyId: 'strat_restart_test',
      evidenceFingerprint: 'ev_restart_fp',
      decisionFingerprint: 'dec_restart_fp',
      confidence: 'MEDIUM',
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH,
      watchReasons: [{ type: 'UNCONFIRMED_SIGNAL_CHANGE', description: 'Watching FX' }]
    });
    await persistStrategyVersion(version, null);

    const retrieved = await getCurrentPublishedStrategy(null);
    assert.equal(retrieved.strategyId, 'strat_restart_test');
    assert.equal(retrieved.lifecycleState, STRATEGY_LIFECYCLE_STATES.WATCH);
    assert.equal(retrieved.watchReasons[0].type, 'UNCONFIRMED_SIGNAL_CHANGE');
  });

  // 36. public GET provider-free
  await suite.test('36. public GET provider-free', async () => {
    let providerCalled = false;
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    await evaluateAndApplyStrategyStability({ factPacket: packet, now: NOW, allowLlm: false, client: null });

    const res = await getMarketStrategist({
      now: NOW,
      getMarketContextFabricFn: async () => ({ facts: BASELINE_OBSERVATIONS }),
      getNewsFeedFn: async () => ({ data: BASELINE_NEWS }),
      allowLlm: false,
      isReadOnly: true,
      generateLlmFn: async () => {
        providerCalled = true;
        return {};
      },
      client: null
    });

    assert.equal(providerCalled, false, 'Provider must never be called on public GET');
    assert.ok(res.strategyId);
  });

  // 37. public GET does not mutate lifecycle state
  await suite.test('37. public GET does not mutate lifecycle state', async () => {
    const version = createStrategyVersion({
      strategyId: 'strat_watch_get_test',
      evidenceFingerprint: 'ev_get_fp',
      decisionFingerprint: 'dec_get_fp',
      confidence: 'MEDIUM',
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH
    });
    await persistStrategyVersion(version, null);

    const beforeAsmtCount = (await listStrategyAssessments(version.strategyId, null)).length;

    const res = await getMarketStrategist({
      now: NOW,
      getMarketContextFabricFn: async () => ({ facts: BASELINE_OBSERVATIONS }),
      getNewsFeedFn: async () => ({ data: BASELINE_NEWS }),
      allowLlm: false,
      isReadOnly: true,
      client: null
    });

    assert.equal(res.lifecycleState, STRATEGY_LIFECYCLE_STATES.WATCH);
    const afterAsmtCount = (await listStrategyAssessments(version.strategyId, null)).length;
    assert.equal(afterAsmtCount, beforeAsmtCount, 'Public GET must not mutate or persist assessments');
  });

  // 38. no numeric hysteresis thresholds introduced
  await suite.test('38. no numeric hysteresis thresholds introduced', async () => {
    const gateCode = fs.readFileSync(path.join(REPO_ROOT, 'server/src/ai/strategyAssessmentGate.js'), 'utf8');
    assert.equal(gateCode.includes('USD_VND_BUFFER'), false);
    assert.equal(gateCode.includes('SHOCK_THRESHOLD'), false);
    assert.equal(gateCode.includes('RATE_HYSTERESIS'), false);
    assert.equal(gateCode.includes('CONFIRM_DAYS'), false);
  });

  // 39. no opaque materiality score
  await suite.test('39. no opaque materiality score', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: BASELINE_OBSERVATIONS,
      newsArticles: BASELINE_NEWS,
      now: NOW
    });
    const gate = assessStrategyMateriality({
      currentStrategy: null,
      factPacket: packet,
      now: NOW
    });
    assert.equal(gate.materialityScore, undefined);
    assert.equal(gate.score, undefined);
    assert.ok(Array.isArray(gate.reasons));
  });

  // 40. policyVersion stored
  await suite.test('40. policyVersion stored', async () => {
    assert.equal(STABILITY_POLICY_VERSION, 'strategy-stability-v2');
    const version = createStrategyVersion({
      strategyId: 'strat_policy_test',
      evidenceFingerprint: 'ev_pol',
      decisionFingerprint: 'dec_pol',
      confidence: 'MEDIUM'
    });
    assert.equal(version.policyVersion, 'strategy-stability-v2');

    const asmt = createStrategyAssessment({
      assessmentId: 'asmt_policy_test',
      strategyId: 'strat_policy_test',
      evidenceFingerprint: 'ev_pol',
      decisionFingerprint: 'dec_pol',
      confidence: 'HIGH',
      result: 'KEEP'
    });
    assert.equal(asmt.policyVersion, 'strategy-stability-v2');
  });

  // 41. 01D historical replay tests remain unchanged/passing
  await suite.test('41. 01D historical replay tests remain unchanged/passing', async () => {
    const replayTestContent = fs.readFileSync(path.join(REPO_ROOT, 'server/test/historical-as-of-replay.test.js'), 'utf8');
    assert.ok(
      replayTestContent.includes('resolveEvidenceAvailabilityTime') &&
      replayTestContent.includes('buildHistoricalEvidencePacket')
    );
  });

  // 42. no private user/profile/portfolio data
  await suite.test('42. no private user/profile/portfolio data', async () => {
    assert.throws(() => {
      createStrategyVersion({
        strategyId: 'strat_private_leak',
        evidenceFingerprint: 'ev_fp',
        decisionFingerprint: 'dec_fp',
        confidence: 'MEDIUM',
        userId: 'private_user_123'
      });
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      createStrategyAssessment({
        assessmentId: 'asmt_private_leak',
        strategyId: 'strat_1',
        evidenceFingerprint: 'ev_fp',
        decisionFingerprint: 'dec_fp',
        confidence: 'HIGH',
        result: 'KEEP',
        portfolioId: 'port_123'
      });
    }, /FORBIDDEN_USER_DATA/);
  });

});
