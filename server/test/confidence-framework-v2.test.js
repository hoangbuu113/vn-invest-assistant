import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createApp } from '../index.js';
import {
  assessConfidence,
  evaluateSupportGraph,
  resolveAsOfEvidence
} from '../src/ai/confidenceEngine.js';
import {
  ANALYTIC_CONFIDENCE,
  ASSESSMENT_STATUS,
  CALIBRATION_STATUS,
  CONFIDENCE_ASSESSMENT_POLICY_VERSION,
  CONFIDENCE_REASON_CODES,
  CONFIDENCE_TARGET_TYPES,
  EVIDENCE_SUPPORT,
  createCalibrationManifest,
  createConfidenceAssessment
} from '../src/ai/confidenceModel.js';
import {
  FRESHNESS_BEHAVIOR,
  PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
  REQUIREMENT_PROFILE_VERSION
} from '../src/ai/confidenceProfiles.js';
import {
  clearConfidenceMemoryForTest,
  getConfidenceMemorySnapshotForTest,
  getLatestConfidenceAssessment,
  persistConfidenceAssessment
} from '../src/ai/confidenceRepository.js';
import { attachMarketStrategyConfidence } from '../src/ai/confidenceService.js';
import { buildMarketStrategistFactPacket } from '../src/ai/marketStrategistEngine.js';
import { evaluateAndApplyStrategyStability } from '../src/ai/strategyStabilityService.js';
import {
  clearStabilityMemoryStore,
  getStabilityMemorySnapshotForTest
} from '../src/ai/strategyStabilityRepository.js';
import { getMarketStrategist } from '../src/marketStrategist.js';
import { buildConfidenceAssessmentViewModel } from '../../client/src/utils/marketStrategistDisplay.js';

const CUTOFF = '2026-09-06T12:00:00.000Z';
const EARLIER = '2026-09-05T12:00:00.000Z';
const COMPLETE_REVIEW = Object.freeze({
  complete: true,
  assumptions: Object.freeze([]),
  alternativeExplanations: Object.freeze([]),
  counterEvidence: Object.freeze([]),
  sensitivity: 'REVIEWED',
  modelApplicability: 'SUPPORTED',
  materialLimitations: Object.freeze([]),
  revisionImpactPendingEvidenceIds: Object.freeze([])
});

function evidence(overrides = {}) {
  const factId = overrides.factId || 'vn.market.vnindex.close';
  const id = overrides.observationId || `${factId}:2026-09-05:v1`;
  return {
    observationId: id,
    factId,
    value: 100,
    status: 'available',
    freshness: 'fresh',
    authorityLevel: 'MARKET_DIRECT',
    source: factId.startsWith('vn.monetary.') ? 'SBV' : 'TEST_SOURCE',
    sourceContentHash: `hash:${id}`,
    sourceAvailableAt: EARLIER,
    firstSeenAt: EARLIER,
    fetchedAt: EARLIER,
    ...overrides
  };
}

function strongEvidence() {
  return [
    evidence(),
    evidence({
      observationId: 'vn.macro.cpi.yoy:2026-08:v1',
      factId: 'vn.macro.cpi.yoy',
      authorityLevel: 'PRIMARY_OFFICIAL'
    }),
    evidence({
      observationId: 'vn.monetary.rate.vnd_overnight:2026-09-05:v1',
      factId: 'vn.monetary.rate.vnd_overnight',
      authorityLevel: 'REGULATORY_OFFICIAL'
    })
  ];
}

function assess(overrides = {}) {
  return assessConfidence({
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    targetId: 'strategy:one',
    scope: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.scope,
    horizon: 'medium',
    cutoff: CUTOFF,
    asOf: CUTOFF,
    evidence: strongEvidence(),
    profile: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
    calibrationManifests: [],
    analyticReview: COMPLETE_REVIEW,
    ...overrides
  });
}

function validatedManifest(overrides = {}) {
  return createCalibrationManifest({
    manifestId: 'calibration:test-only:v1',
    cohort: 'TEST_FIXTURE_ONLY',
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    scope: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.scope,
    horizon: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.horizon,
    policyVersion: CONFIDENCE_ASSESSMENT_POLICY_VERSION,
    profileVersion: REQUIREMENT_PROFILE_VERSION,
    modelVersion: 'test-fixture',
    datasetStartAt: '2025-01-01T00:00:00.000Z',
    datasetEndAt: '2026-08-31T00:00:00.000Z',
    evaluationMethod: { fixture: true },
    applicability: { fixture: true },
    releaseCriteria: { fixture: true },
    status: CALIBRATION_STATUS.VALIDATED,
    effectiveAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  });
}

function oneRequirementProfile(paths) {
  return {
    ...PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
    profileId: 'TEST_PROFILE',
    profileVersion: 'test-profile-v1',
    essentialRequirements: [{ requirementId: 'REQ_TEST', scope: 'test', paths }],
    analyticReviewRequirements: { requiredForAssessment: false, requiredForHigh: false, fields: [] },
    calibrationApplicability: {
      ...PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.calibrationApplicability,
      profileVersion: 'test-profile-v1'
    }
  };
}

test('A: identical input, cutoff, and policy produces the same assessment', () => {
  assert.deepEqual(assess(), assess());
});

test('B: evidence order cannot change confidence', () => {
  const original = strongEvidence();
  const left = assess({ evidence: original });
  const right = assess({ evidence: [...original].reverse() });
  assert.equal(left.assessmentId, right.assessmentId);
  assert.equal(left.publicGrade, right.publicGrade);
});

test('C: exact duplicate evidence cannot increase support', () => {
  const original = strongEvidence();
  const base = assess({ evidence: original });
  const duplicate = assess({ evidence: [...original, { ...original[0] }] });
  assert.equal(duplicate.evidenceSupport, base.evidenceSupport);
  assert.equal(duplicate.candidateGrade, base.candidateGrade);
  assert.ok(duplicate.reasons.some((item) => item.code === CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED));
});

test('D: irrelevant evidence cannot increase the grade', () => {
  const base = assess();
  const withIrrelevant = assess({ evidence: [...strongEvidence(), evidence({ observationId: 'irrelevant:1', factId: 'other.unregistered.fact', authorityLevel: 'MARKET_DIRECT' })] });
  assert.equal(withIrrelevant.evidenceSupport, base.evidenceSupport);
  assert.equal(withIrrelevant.publicGrade, base.publicGrade);
});

test('E: missing essential support is INSUFFICIENT_EVIDENCE, never LOW', () => {
  const result = assess({ evidence: strongEvidence().filter((item) => !item.factId.startsWith('vn.macro.')) });
  assert.equal(result.evidenceSupport, 'INSUFFICIENT');
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('malformed available fact values fail integrity and never become zero support', () => {
  const items = strongEvidence();
  items[0] = { ...items[0], value: null };
  const result = assess({ evidence: items });
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  assert.ok(result.reasons.some((item) => item.code === CONFIDENCE_REASON_CODES.EVIDENCE_INTEGRITY_FAILED));
});

test('F: absent mandatory profile is NOT_ASSESSED with null grades', () => {
  const result = assess({ profile: null });
  assert.equal(result.assessmentStatus, ASSESSMENT_STATUS.NOT_ASSESSED);
  assert.equal(result.candidateGrade, null);
  assert.equal(result.publicGrade, null);
  assert.equal(result.reasons[0].code, CONFIDENCE_REASON_CODES.ASSESSMENT_POLICY_UNCONFIGURED);
});

test('G: future evidence is excluded by the shared replay resolver', () => {
  const future = evidence({ observationId: 'future:1', sourceAvailableAt: '2026-09-07T00:00:00.000Z', firstSeenAt: '2026-09-07T00:00:00.000Z' });
  const result = resolveAsOfEvidence([future], CUTOFF);
  assert.equal(result.included.length, 0);
  assert.equal(result.exclusionLog[0].reason, 'FUTURE_EVIDENCE');
});

test('shared replay authority uses max(sourceAvailableAt, firstSeenAt) and ignores stored systemKnowableAt', () => {
  const lateFirstSeen = evidence({
    observationId: 'availability:late-first-seen',
    publishedAt: '2026-09-01T00:00:00.000Z',
    sourceAvailableAt: '2026-09-02T00:00:00.000Z',
    firstSeenAt: '2026-09-07T00:00:00.000Z',
    systemKnowableAt: '2026-09-01T00:00:00.000Z'
  });
  const lateSource = evidence({
    observationId: 'availability:late-source',
    sourceAvailableAt: '2026-09-07T00:00:00.000Z',
    firstSeenAt: '2026-09-02T00:00:00.000Z'
  });
  assert.equal(resolveAsOfEvidence([lateFirstSeen, lateSource], CUTOFF).included.length, 0);
  assert.equal(resolveAsOfEvidence([lateFirstSeen], '2026-09-07T00:00:00.000Z').included[0].resolvedAvailability.availabilityTime, '2026-09-07T00:00:00.000Z');
});

test('H: revision first known after cutoff has no effect on earlier assessment', () => {
  const base = strongEvidence();
  const revision = evidence({
    observationId: 'vn.market.vnindex.close:2026-09-05:v2',
    factId: 'vn.market.vnindex.close',
    value: 101,
    sourceContentHash: 'revision-hash',
    sourceAvailableAt: '2026-09-07T00:00:00.000Z',
    firstSeenAt: '2026-09-07T00:00:00.000Z',
    isRevisedVersion: true,
    versionNumber: 2
  });
  assert.equal(assess({ evidence: base }).assessmentId, assess({ evidence: [...base, revision] }).assessmentId);
});

test('I: calibration effective after cutoff cannot grant historical HIGH', () => {
  const futureManifest = validatedManifest({ effectiveAt: '2026-09-07T00:00:00.000Z' });
  const result = assess({ calibrationManifests: [futureManifest] });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.ok(result.reasons.some((item) => item.code === CONFIDENCE_REASON_CODES.CALIBRATION_NOT_APPLICABLE));
});

test('J: cadence-valid official macro carry-forward is not penalized', () => {
  const items = strongEvidence();
  items[1] = { ...items[1], status: 'stale', freshness: 'stale', cadenceValidCarryForward: true };
  const result = assess({ evidence: items });
  assert.equal(result.evidenceSupport, 'STRONG');
  assert.ok(result.reasons.some((item) => item.code === CONFIDENCE_REASON_CODES.CADENCE_VALID_CARRY_FORWARD));
});

test('K: stale essential current-market evidence fails only its scoped gate', () => {
  const items = strongEvidence();
  items[0] = { ...items[0], status: 'stale', freshness: 'stale' };
  const result = assess({ evidence: items });
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  assert.deepEqual(result.gateResults.filter((gate) => !gate.passed).map((gate) => gate.requirementId), ['REQ_VN_MARKET_STATE']);
  assert.ok(result.reasons.some((item) => item.code === CONFIDENCE_REASON_CODES.FRESHNESS_REQUIREMENT_FAILED));
});

test('L: provider outage does not change grade when a registered alternative remains valid', () => {
  const profile = oneRequirementProfile([
    { pathId: 'OFFICIAL', evidenceGroup: 'OFFICIAL_MACRO', authorityLevels: ['PRIMARY_OFFICIAL'], freshnessBehavior: FRESHNESS_BEHAVIOR.REQUIRE_CURRENT, supportLevel: 'PRIMARY' },
    { pathId: 'REFERENCE', evidenceGroup: 'MARKET_REFERENCE', authorityLevels: ['MARKET_REFERENCE'], freshnessBehavior: FRESHNESS_BEHAVIOR.REQUIRE_CURRENT, supportLevel: 'ALTERNATIVE' }
  ]);
  const alternate = evidence({ observationId: 'vn.market.vnindex.close:alt', authorityLevel: 'MARKET_REFERENCE' });
  const outage = evidence({ observationId: 'vn.macro.cpi.yoy:outage', factId: 'vn.macro.cpi.yoy', authorityLevel: 'PRIMARY_OFFICIAL', status: 'unavailable' });
  const withoutOutage = assess({ profile, evidence: [alternate] });
  const withOutage = assess({ profile, evidence: [alternate, outage] });
  assert.equal(withOutage.candidateGrade, withoutOutage.candidateGrade);
});

test('M: same-origin syndicated copies do not add independent support', () => {
  const profile = oneRequirementProfile([
    { pathId: 'CLAIM', evidenceGroup: 'CLAIM_FAMILY', authorityLevels: [], freshnessBehavior: FRESHNESS_BEHAVIOR.REQUIRE_CURRENT, supportLevel: 'FRAGILE' }
  ]);
  const first = evidence({ observationId: undefined, id: 'article:1', factId: null, claimId: 'claim:same-story', sourceContentHash: 'copy-a', dependencyGroup: 'wire:origin' });
  const second = { ...first, id: 'article:2', sourceContentHash: 'copy-b' };
  const graph = evaluateSupportGraph(resolveAsOfEvidence([first, second], CUTOFF).included, profile);
  assert.equal(graph.participatingEvidence.length, 1);
  assert.equal(graph.deduplicationLog.length, 1);
});

test('N: unresolved material conflict creates an explicit scoped MEDIUM cap', () => {
  const items = strongEvidence();
  items[0] = { ...items[0], normalizedConflict: { material: true, resolved: false, definition: 'close', unit: 'index_point', period: 'session', vintage: 'v1', scope: 'vn_market', lineage: 'VNDIRECT' } };
  const result = assess({ evidence: items, calibrationManifests: [validatedManifest()] });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.ok(result.caps.some((cap) => cap.code === CONFIDENCE_REASON_CODES.MATERIAL_CONFLICT_UNRESOLVED && cap.scope === result.scope));
  assert.ok(result.reasons.some((reason) => reason.code === CONFIDENCE_REASON_CODES.MATERIAL_CONFLICT_UNRESOLVED));
});

test('O: assumption-sensitive judgment has an explicit LOW cap', () => {
  const result = assess({ analyticReview: { ...COMPLETE_REVIEW, assumptionSensitive: true } });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.LOW);
  assert.ok(result.caps.some((cap) => cap.code === CONFIDENCE_REASON_CODES.ASSUMPTION_SENSITIVE));
});

test('every deterministic cap has a matching structured reason and auditable support chain', () => {
  const result = assess({
    analyticReview: {
      ...COMPLETE_REVIEW,
      assumptionSensitive: true,
      modelApplicability: 'UNCERTAIN',
      materialLimitations: [{ code: 'LIMITATION_TEST', resolved: false, remediationCondition: 'RESOLVE_LIMITATION_TEST' }]
    }
  });
  for (const cap of result.caps) {
    assert.ok(result.reasons.some((reason) => reason.code === cap.code && reason.scope === cap.scope));
  }
  assert.ok(result.gateResults.every((gate) => gate.passed && gate.supportChain?.strategy?.scope === result.scope));
  assert.ok(result.reasons.every((reason) => (
    'code' in reason
    && 'scope' in reason
    && 'targetId' in reason
    && 'severity' in reason
    && 'effect' in reason
    && Array.isArray(reason.evidenceIds)
    && Array.isArray(reason.requirementIds)
    && 'messageKey' in reason
    && typeof reason.messageParams === 'object'
    && Array.isArray(reason.remediationConditions)
  )));
});

test('a bare complete flag cannot bypass structured analytic review requirements', () => {
  const result = assess({ analyticReview: { complete: true } });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.ok(result.caps.some((cap) => cap.code === CONFIDENCE_REASON_CODES.ANALYTIC_REVIEW_INCOMPLETE));
});

test('P: candidate HIGH with default UNVALIDATED calibration is public MEDIUM', () => {
  const result = assess();
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNVALIDATED);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
});

test('Q / public HIGH rule A: candidate HIGH with applicable VALIDATED calibration and no cap permits public HIGH', () => {
  const result = assess({ calibrationManifests: [validatedManifest()] });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.VALIDATED);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.HIGH);
});

test('public HIGH rule B: candidate MEDIUM remains public MEDIUM with applicable VALIDATED calibration', () => {
  const profile = oneRequirementProfile([
    { pathId: 'ALTERNATIVE', evidenceGroup: 'MARKET_REFERENCE', authorityLevels: ['MARKET_REFERENCE'], freshnessBehavior: FRESHNESS_BEHAVIOR.REQUIRE_CURRENT, supportLevel: 'ALTERNATIVE' }
  ]);
  const result = assess({
    profile,
    evidence: [evidence({ authorityLevel: 'MARKET_REFERENCE' })],
    calibrationManifests: [validatedManifest({ profileVersion: profile.profileVersion })]
  });
  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.VALIDATED);
  assert.equal(result.calibrationApplicable, true);
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.deepEqual(result.caps, []);
});

test('public HIGH rule C: candidate HIGH is public MEDIUM with UNVALIDATED calibration', () => {
  const result = assess();
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNVALIDATED);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
});

test('public HIGH rule D: future VALIDATED manifest is non-applicable and cannot grant HIGH', () => {
  const manifest = validatedManifest({
    manifestId: 'calibration:test-only:future',
    createdAt: '2026-09-07T00:00:00.000Z',
    effectiveAt: '2026-09-07T00:00:00.000Z'
  });
  const result = assess({ calibrationManifests: [manifest] });
  assert.equal(manifest.status, CALIBRATION_STATUS.VALIDATED);
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.calibrationApplicable, false);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
});

test('public HIGH rule E: active MEDIUM cap keeps public grade at MEDIUM', () => {
  const result = assess({
    calibrationManifests: [validatedManifest()],
    evidence: strongEvidence().map((item, index) => index === 0
      ? {
          ...item,
          normalizedConflict: {
            material: true,
            resolved: false,
            definition: 'close',
            unit: 'index_point',
            period: 'session',
            vintage: 'v1',
            scope: 'vn_market',
            lineage: 'VNDIRECT'
          }
        }
      : item)
  });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.equal(result.caps.some((cap) => cap.cap === ANALYTIC_CONFIDENCE.MEDIUM), true);
});

test('public HIGH rule F: active LOW cap keeps public grade at LOW', () => {
  const result = assess({
    calibrationManifests: [validatedManifest()],
    analyticReview: { ...COMPLETE_REVIEW, assumptionSensitive: true }
  });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.LOW);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.LOW);
  assert.equal(result.caps.some((cap) => cap.cap === ANALYTIC_CONFIDENCE.LOW), true);
});

test('public HIGH rule G: model boundary rejects malformed persisted HIGH states', () => {
  const valid = assess({ calibrationManifests: [validatedManifest()] });
  assert.equal(valid.publicGrade, ANALYTIC_CONFIDENCE.HIGH);
  const invalidStates = [
    { candidateGrade: ANALYTIC_CONFIDENCE.MEDIUM },
    { candidateGrade: ANALYTIC_CONFIDENCE.LOW },
    { calibrationStatus: CALIBRATION_STATUS.UNVALIDATED },
    { calibrationApplicable: false },
    { calibrationManifestId: null },
    { calibrationKnowableAt: '2026-09-07T00:00:00.000Z' },
    { caps: [{ code: CONFIDENCE_REASON_CODES.MATERIAL_CONFLICT_UNRESOLVED, scope: valid.scope, cap: ANALYTIC_CONFIDENCE.MEDIUM, evidenceIds: [] }] },
    { caps: [{ code: CONFIDENCE_REASON_CODES.ASSUMPTION_SENSITIVE, scope: valid.scope, cap: ANALYTIC_CONFIDENCE.LOW, evidenceIds: [] }] }
  ];
  for (const override of invalidStates) {
    assert.throws(
      () => createConfidenceAssessment({ ...valid, ...override }),
      /Public HIGH requires assessed candidate HIGH/
    );
  }
});

test('R: real Strategy Stability keeps one StrategyVersion when only confidence changes', async () => {
  clearConfidenceMemoryForTest();
  clearStabilityMemoryStore();
  const packet = buildMarketStrategistFactPacket({
    marketObservations: strongEvidence(),
    newsArticles: [],
    now: new Date(CUTOFF)
  });
  const initialStability = await evaluateAndApplyStrategyStability({
    factPacket: packet,
    now: new Date(CUTOFF),
    allowLlm: false,
    client: null
  });
  const first = await attachMarketStrategyConfidence({
    factPacket: packet,
    strategyResult: initialStability,
    now: new Date(CUTOFF),
    client: null,
    analyticReview: COMPLETE_REVIEW
  });
  const versionCountBefore = getStabilityMemorySnapshotForTest().versions.size;

  const keepStability = await evaluateAndApplyStrategyStability({
    factPacket: packet,
    now: new Date('2026-09-06T12:15:00.000Z'),
    allowLlm: false,
    client: null
  });
  const second = await attachMarketStrategyConfidence({
    factPacket: packet,
    strategyResult: keepStability,
    now: new Date('2026-09-06T12:15:00.000Z'),
    client: null,
    analyticReview: { ...COMPLETE_REVIEW, assumptionSensitive: true }
  });

  assert.equal(keepStability.latestAssessmentResult, 'KEEP');
  assert.equal(second.strategyId, first.strategyId);
  assert.equal(getStabilityMemorySnapshotForTest().versions.size, versionCountBefore);
  assert.equal(versionCountBefore, 1);
  assert.notEqual(first.confidenceAssessment.publicGrade, second.confidenceAssessment.publicGrade);
  assert.equal(getConfidenceMemorySnapshotForTest().assessments.size, 2);
});

test('S: narrative confidence cannot override deterministic public grade', async () => {
  clearConfidenceMemoryForTest();
  const result = await attachMarketStrategyConfidence({
    factPacket: { evidence: strongEvidence(), evidenceFingerprint: 'facts' },
    strategyResult: { strategyId: 'strategy:ai-request', confidence: 'HIGH', executiveDecision: { confidence: 'HIGH' } },
    now: new Date(CUTOFF),
    client: null,
    analyticReview: COMPLETE_REVIEW
  });
  assert.equal(result.executiveDecision.confidence, 'HIGH');
  assert.equal(result.confidenceAssessment.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
});

test('T: real strategist and Express route preserve NOT_ASSESSED and INSUFFICIENT_EVIDENCE', async () => {
  const cases = [
    {
      expectedStatus: ASSESSMENT_STATUS.NOT_ASSESSED,
      expectedGrade: null,
      expectedSupport: EVIDENCE_SUPPORT.INSUFFICIENT,
      expectedReason: CONFIDENCE_REASON_CODES.ASSESSMENT_POLICY_UNCONFIGURED,
      marketObservations: strongEvidence(),
      profile: null
    },
    {
      expectedStatus: ASSESSMENT_STATUS.ASSESSED,
      expectedGrade: ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE,
      expectedSupport: EVIDENCE_SUPPORT.INSUFFICIENT,
      expectedReason: CONFIDENCE_REASON_CODES.CRITICAL_EVIDENCE_MISSING,
      marketObservations: [],
      profile: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1
    }
  ];

  for (const scenario of cases) {
    clearConfidenceMemoryForTest();
    clearStabilityMemoryStore();
    const attachConfidenceFn = (options) => attachMarketStrategyConfidence({
      ...options,
      profile: scenario.profile
    });
    const realStrategistEntryPoint = (options = {}) => getMarketStrategist({
      ...options,
      now: new Date(CUTOFF),
      getMarketContextFabricFn: async () => ({ facts: scenario.marketObservations }),
      getNewsFeedFn: async () => ({ data: [] }),
      client: null,
      attachConfidenceFn
    });

    await realStrategistEntryPoint({ allowLlm: false, isReadOnly: false });
    const app = createApp({ getMarketStrategistFn: realStrategistEntryPoint });
    const server = app.listen(0);
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/market-strategist`);
      const body = await response.json();
      assert.equal(response.status, 200);
      const confidenceAssessment = body.data.confidenceAssessment;
      assert.equal(confidenceAssessment.assessmentStatus, scenario.expectedStatus);
      assert.equal(confidenceAssessment.publicGrade, scenario.expectedGrade);
      assert.equal(confidenceAssessment.evidenceSupport, scenario.expectedSupport);
      assert.notEqual(confidenceAssessment.publicGrade, ANALYTIC_CONFIDENCE.LOW);
      assert.ok(confidenceAssessment.reasons.some((reason) => reason.code === scenario.expectedReason));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('U: UI renders structured strengths, limitations, and upgrades without percentages', async () => {
  const view = buildConfidenceAssessmentViewModel(assess());
  assert.ok(view.strengths.length > 0);
  assert.ok(view.limitations.length > 0);
  assert.ok(view.upgrades.length > 0);
  const renderedText = JSON.stringify(view);
  assert.doesNotMatch(renderedText, /\d+\s*%/);
  assert.match(view.disclaimer, /không phải xác suất đầu tư có lãi/);
  const component = await readFile(new URL('../../client/src/components/InvestmentBriefPanel.jsx', import.meta.url), 'utf8');
  assert.match(component, /Độ vững của nhận định/);
  assert.match(component, /Điểm mạnh/);
  assert.match(component, /Giới hạn/);
  assert.match(component, /Để đạt Cao/);
  assert.doesNotMatch(component, /Mức độ xác tín/);
});

test('V: replay jointly respects evidence, policy, and calibration state at cutoff', () => {
  const futureEvidence = evidence({ observationId: 'vn.market.vnindex.close:future', sourceAvailableAt: '2026-09-07T00:00:00.000Z', firstSeenAt: '2026-09-07T00:00:00.000Z' });
  const futureCalibration = validatedManifest({ manifestId: 'calibration:future', createdAt: '2026-09-07T00:00:00.000Z', effectiveAt: '2026-09-07T00:00:00.000Z' });
  const result = assess({ evidence: [...strongEvidence(), futureEvidence], calibrationManifests: [futureCalibration] });
  assert.equal(result.candidateGrade, ANALYTIC_CONFIDENCE.HIGH);
  assert.equal(result.publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNVALIDATED);
});

test('production persistence writes durably before mirroring memory and never falls back on read failure', async () => {
  clearConfidenceMemoryForTest();
  const item = assess();
  const failingClient = {
    from() {
      return { upsert() { return { select: async () => ({ data: null, error: { message: 'db down' } }) }; } };
    }
  };
  await assert.rejects(() => persistConfidenceAssessment(item, failingClient), { code: 'CONFIDENCE_ASSESSMENT_PERSISTENCE_FAILED' });
  assert.equal(getConfidenceMemorySnapshotForTest().assessments.size, 0);

  const missingClient = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit: async () => ({ data: [], error: null })
      };
    }
  };
  assert.equal(await getLatestConfidenceAssessment(item.targetId, item.scope, missingClient), null);

  const readFailureClient = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit: async () => ({ data: null, error: { message: 'read failed' } })
      };
    }
  };
  await assert.rejects(() => getLatestConfidenceAssessment(item.targetId, item.scope, readFailureClient), { code: 'CONFIDENCE_ASSESSMENT_QUERY_FAILED' });
});

test('successful durable write mirrors the immutable assessment after persistence', async () => {
  clearConfidenceMemoryForTest();
  const item = assess();
  let durableWriteCompleted = false;
  const client = {
    from() {
      return {
        upsert() {
          return {
            select: async () => {
              durableWriteCompleted = true;
              return { data: [], error: null };
            }
          };
        }
      };
    }
  };
  await persistConfidenceAssessment(item, client);
  assert.equal(durableWriteCompleted, true);
  assert.equal(getConfidenceMemorySnapshotForTest().assessments.get(item.assessmentId), item);
});

test('migration is forward-only, append-only, public-read/service-write, and has no production validated seed', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260906050000_create_confidence_framework_v2.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.confidence_assessments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.calibration_manifests/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.confidence_assessments/);
  assert.match(sql, /GRANT SELECT, INSERT ON public\.confidence_assessments TO service_role/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.confidence_assessments FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /candidate_grade = 'HIGH'/);
  assert.match(sql, /calibration_knowable_at <= cutoff/);
  assert.match(sql, /jsonb_array_length\(caps\) = 0/);
  assert.doesNotMatch(sql, /INSERT INTO public\.calibration_manifests/i);
});
