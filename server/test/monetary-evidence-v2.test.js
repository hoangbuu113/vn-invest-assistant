import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createApp } from '../index.js';
import { assessConfidence } from '../src/ai/confidenceEngine.js';
import { ANALYTIC_CONFIDENCE, CONFIDENCE_TARGET_TYPES } from '../src/ai/confidenceModel.js';
import { PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1 } from '../src/ai/confidenceProfiles.js';
import {
  MONETARY_REQUIREMENT_IDS,
  resolveMonetaryConfidenceProfile,
  resolveMonetaryDependencies
} from '../src/ai/monetaryEvidencePolicy.js';
import {
  MONETARY_PARSER_PROFILES,
  MONETARY_REPLAY_MODES,
  clearManualMonetaryEvidenceForTest,
  createManualOfficialMonetaryVintage,
  importManualOfficialMonetaryEvidence,
  listManualOfficialMonetaryEvidence,
  resolveMonetaryReplayTime
} from '../src/monetaryEvidence.js';
import { buildMarketStrategistFactPacket } from '../src/ai/marketStrategistEngine.js';
import { buildConfidenceAssessmentViewModel } from '../../client/src/utils/marketStrategistDisplay.js';

const CUTOFF = new Date('2026-09-07T10:00:00.000Z');
const COMPLETE_REVIEW = Object.freeze({
  complete: true, assumptions: [], alternativeExplanations: [], counterEvidence: [],
  sensitivity: 'REVIEWED', modelApplicability: 'SUPPORTED', materialLimitations: [],
  revisionImpactPendingEvidenceIds: []
});

function ev(factId, authorityLevel, overrides = {}) {
  const observationId = overrides.observationId || `${factId}:2026-09-05:v1`;
  return {
    id: observationId,
    observationId,
    factId,
    pillar: factId.startsWith('vn.market.') ? 'market' : factId.startsWith('vn.macro.') ? 'macro' : 'monetary',
    value: 1,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: authorityLevel === 'REGULATORY_OFFICIAL' ? 'SBV' : 'TEST',
    authorityLevel,
    sourceContentHash: `hash:${observationId}`,
    sourceAvailableAt: '2026-09-05T08:00:00.000Z',
    firstSeenAt: '2026-09-05T09:00:00.000Z',
    fetchedAt: '2026-09-05T09:00:00.000Z',
    ...overrides
  };
}

const baseEvidence = () => [
  ev('vn.market.vnindex.close', 'MARKET_DIRECT'),
  ev('vn.macro.cpi.yoy', 'PRIMARY_OFFICIAL')
];

function profileFor({ claims, derivedSignals = [], evidence = baseEvidence(), enabledPathIds = [] }) {
  const packet = { claims, derivedSignals, evidence };
  packet.monetaryDependencies = resolveMonetaryDependencies(packet);
  return resolveMonetaryConfidenceProfile(PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1, packet, { enabledPathIds });
}

function assess({ profile, evidence }) {
  return assessConfidence({
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    targetId: 'strategy:monetary-v2',
    scope: profile.scope,
    horizon: profile.horizon,
    cutoff: CUTOFF,
    evidence,
    profile,
    calibrationManifests: [],
    analyticReview: COMPLETE_REVIEW
  });
}

test('A/D: FX-only market claim activates only market FX and unrelated OMO is not globally required', () => {
  const claims = [{ claimId: 'fx-claim', claimType: 'MONETARY_NUMERIC', subject: 'vn.monetary.fx.usd_vnd', predicate: 'EQUALS' }];
  const profile = profileFor({ claims });
  assert.deepEqual(profile.activeMonetaryRequirements, [MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE]);
  const result = assess({ profile, evidence: [...baseEvidence(), ev('vn.monetary.fx.usd_vnd', 'MARKET_REFERENCE')] });
  assert.notEqual(result.publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  assert.equal(result.gateResults.some((gate) => gate.requirementId === MONETARY_REQUIREMENT_IDS.OMO_OPERATIONS), false);
});

test('B/F: policy-rate change requires official policy decision and Yahoo cannot satisfy it', () => {
  const claims = [{ claimId: 'policy-change', claimType: 'POLICY_EVENT', subject: 'vn.monetary.policy.refinancing_rate', predicate: 'CHANGED' }];
  const profile = profileFor({ claims });
  assert.deepEqual(profile.activeMonetaryRequirements, [MONETARY_REQUIREMENT_IDS.OFFICIAL_POLICY_STATEMENT, MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT]);
  const yahoo = ev('vn.monetary.policy.decision.refinancing_rate', 'MARKET_REFERENCE', { source: 'Yahoo Finance' });
  assert.equal(assess({ profile, evidence: [...baseEvidence(), yahoo] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  const official = ev('vn.monetary.policy.decision.refinancing_rate', 'REGULATORY_OFFICIAL', {
    source: 'SBV', policyInstrument: 'REFINANCING_RATE', previousValue: 4.5, effectiveFrom: '2026-09-05T00:00:00.000Z'
  });
  assert.notEqual(assess({ profile, evidence: [...baseEvidence(), official] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('C: credit claim activates and requires official credit evidence only', () => {
  const claims = [{ claimId: 'credit', claimType: 'MONETARY_NUMERIC', subject: 'vn.monetary.credit.outstanding.ytd_growth', predicate: 'EQUALS' }];
  const profile = profileFor({ claims });
  assert.deepEqual(profile.activeMonetaryRequirements, [MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS]);
  assert.equal(assess({ profile, evidence: baseEvidence() }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  assert.notEqual(assess({ profile, evidence: [...baseEvidence(), ev('vn.monetary.credit.outstanding.ytd_growth', 'REGULATORY_OFFICIAL')] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('OMO claim activates OMO requirement and only matching evidence satisfies it', () => {
  const claims = [{ claimId: 'omo', claimType: 'POLICY_EVENT', subject: 'vn.monetary.omo.net_injection', predicate: 'EQUALS' }];
  const profile = profileFor({ claims });
  assert.deepEqual(profile.activeMonetaryRequirements, [MONETARY_REQUIREMENT_IDS.OMO_OPERATIONS]);
  assert.equal(assess({ profile, evidence: [...baseEvidence(), ev('vn.monetary.credit.outstanding.ytd_growth', 'REGULATORY_OFFICIAL')] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  const omo = ev('vn.monetary.omo.net_injection', 'REGULATORY_OFFICIAL', { operationType: 'NET_INJECTION', maturityDate: '2026-09-12', netEffect: 5000 });
  assert.notEqual(assess({ profile, evidence: [...baseEvidence(), omo] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('E: broad supportive/restrictive claim requires governed policy plus transmission support', () => {
  const claims = [{ claimId: 'composite', claimType: 'POLICY_EVENT', subject: 'vn.monetary.stance.composite', predicate: 'SUPPORTIVE' }];
  const profile = profileFor({ claims });
  assert.deepEqual(profile.activeMonetaryRequirements, [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT, MONETARY_REQUIREMENT_IDS.TRANSMISSION_CONTEXT]);
  const onlyPolicy = [...baseEvidence(), ev('vn.monetary.policy.refinancing_rate', 'REGULATORY_OFFICIAL')];
  assert.equal(assess({ profile, evidence: onlyPolicy }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  const both = [...onlyPolicy, ev('vn.monetary.interbank.vnd.overnight.daily_avg_rate', 'REGULATORY_OFFICIAL')];
  assert.notEqual(assess({ profile, evidence: both }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('G/H: configured government republication is scope-bound and same-origin copies do not strengthen support', () => {
  const claims = [{ claimId: 'credit', claimType: 'MONETARY_NUMERIC', subject: 'vn.monetary.credit.outstanding.ytd_growth' }];
  const profile = profileFor({ claims, enabledPathIds: ['PATH_VN_OFFICIAL_REPUBLICATION'] });
  const republished = (id, scope = 'CREDIT_CONDITIONS') => ev('vn.monetary.credit.outstanding.ytd_growth', 'GOVERNMENT_REPUBLICATION', {
    observationId: id, source: 'Government Portal', originIssuer: 'SBV', publisher: 'Government Portal',
    deliveryProvider: 'Government Portal', provenanceFamily: 'OFFICIAL_GOVERNMENT', dependencyGroup: 'OFFICIAL_SBV',
    supportScope: scope, supportPathId: 'PATH_VN_OFFICIAL_REPUBLICATION'
  });
  assert.equal(assess({ profile, evidence: [...baseEvidence(), republished('wrong', 'OMO_OPERATIONS')] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  const result = assess({ profile, evidence: [...baseEvidence(), republished('copy-1'), republished('copy-2')] });
  const gate = result.gateResults.find((item) => item.requirementId === MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS);
  assert.equal(gate.passed, true);
  assert.equal(gate.evidenceIds.length, 1);
});

test('L: blocked direct source does not invalidate a valid configured official republication', () => {
  const claims = [{ claimId: 'credit', claimType: 'MONETARY_NUMERIC', subject: 'vn.monetary.credit.outstanding.ytd_growth' }];
  const profile = profileFor({ claims, enabledPathIds: ['PATH_VN_OFFICIAL_REPUBLICATION'] });
  const blocked = ev('vn.monetary.credit.outstanding.ytd_growth', 'REGULATORY_OFFICIAL', { observationId: 'blocked', status: 'unavailable', value: null, source: 'SBV', statusReason: 'BLOCKED_BY_SOURCE_ACCESS' });
  const alternate = ev('vn.monetary.credit.outstanding.ytd_growth', 'GOVERNMENT_REPUBLICATION', { observationId: 'alternate', originIssuer: 'SBV', publisher: 'Government Portal', supportScope: 'CREDIT_CONDITIONS', supportPathId: 'PATH_VN_OFFICIAL_REPUBLICATION' });
  assert.notEqual(assess({ profile, evidence: [...baseEvidence(), blocked, alternate] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
});

test('M/N: explicitly test-enabled secondary is capped at MEDIUM; unconfigured secondary is ignored', () => {
  const claims = [{ claimId: 'interbank', claimType: 'MONETARY_NUMERIC', subject: 'vn.monetary.rate.vnd_overnight' }];
  const secondary = ev('vn.monetary.rate.vnd_overnight', 'MARKET_REFERENCE', { source: 'Approved fixture', supportScope: 'INTERBANK_CONDITIONS', supportPathId: 'PATH_APPROVED_SECONDARY_MARKET_REFERENCE' });
  const disabledProfile = profileFor({ claims });
  assert.equal(assess({ profile: disabledProfile, evidence: [...baseEvidence(), secondary] }).publicGrade, ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE);
  const enabledProfile = profileFor({ claims, enabledPathIds: ['PATH_APPROVED_SECONDARY_MARKET_REFERENCE'] });
  assert.equal(assess({ profile: enabledProfile, evidence: [...baseEvidence(), secondary] }).publicGrade, ANALYTIC_CONFIDENCE.MEDIUM);
});

function officialArtifact() {
  return `<meta property="article:published_time" content="2026-07-11T08:00:00+07:00"><article>Ngân hàng Nhà nước Việt Nam (SBV). Diễn biến thị trường ngoại tệ và thị trường liên ngân hàng tuần từ 06-10.7.2026. Lãi suất bình quân kỳ hạn qua đêm là 4,50%/năm.</article>`;
}

test('I: manual import uses trusted receive time and cannot backdate AS_OPERATED replay', () => {
  const vintage = createManualOfficialMonetaryVintage({ sourceUrl: 'https://sbv.gov.vn/release/weekly', documentId: 'SBV-W27-2026', artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 }, { now: CUTOFF });
  assert.equal(vintage.sourceAvailableAt, '2026-07-11T01:00:00.000Z');
  assert.equal(vintage.trustedSystemFirstSeenAt, CUTOFF.toISOString());
  assert.equal(vintage.systemKnowableAt, CUTOFF.toISOString());
  assert.equal(resolveMonetaryReplayTime(vintage, MONETARY_REPLAY_MODES.AS_OPERATED), CUTOFF.toISOString());
  assert.equal(resolveMonetaryReplayTime(vintage, MONETARY_REPLAY_MODES.RECONSTRUCTED), vintage.sourceAvailableAt);
});

test('J/K: unverifiable provenance and raw numeric entry cannot become official evidence', () => {
  assert.throws(() => createManualOfficialMonetaryVintage({ sourceUrl: 'https://example.com/sbv', documentId: 'x', artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 }, { now: CUTOFF }), /INVALID_OFFICIAL_MONETARY_PROVENANCE/);
  assert.throws(() => createManualOfficialMonetaryVintage({ sourceUrl: 'https://sbv.gov.vn/release', attachmentUrl: 'https://example.com/fake.pdf', documentId: 'x', artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 }, { now: CUTOFF }), /INVALID_OFFICIAL_MONETARY_ATTACHMENT/);
  assert.throws(() => createManualOfficialMonetaryVintage({ sourceUrl: 'https://sbv.gov.vn/release', documentId: 'x', artifactText: officialArtifact(), value: 4.5, parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 }, { now: CUTOFF }), /RAW_NUMBER_CANNOT_BECOME_OFFICIAL_EVIDENCE/);
});

test('manual repository admits evidence only at/after trusted system knowable time', async () => {
  clearManualMonetaryEvidenceForTest();
  await importManualOfficialMonetaryEvidence({ sourceUrl: 'https://sbv.gov.vn/release/weekly', documentId: 'SBV-W27-2026', artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 }, { now: CUTOFF, client: null });
  assert.equal((await listManualOfficialMonetaryEvidence({ cutoff: new Date('2026-09-07T09:59:59.000Z'), client: null })).length, 0);
  assert.equal((await listManualOfficialMonetaryEvidence({ cutoff: CUTOFF, client: null })).length, 1);
});

test('production repository failures never fall back to process memory', async () => {
  clearManualMonetaryEvidenceForTest();
  const payload = { sourceUrl: 'https://sbv.gov.vn/release/weekly', documentId: 'SBV-W27-2026', artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1 };
  const writeFailureClient = {
    from: () => ({
      upsert: () => ({ select: async () => ({ data: null, error: { message: 'write failed' } }) })
    })
  };
  await assert.rejects(importManualOfficialMonetaryEvidence(payload, { now: CUTOFF, client: writeFailureClient }), /MONETARY_EVIDENCE_PERSISTENCE_FAILED/);
  assert.equal((await listManualOfficialMonetaryEvidence({ cutoff: CUTOFF, client: null })).length, 0);

  await importManualOfficialMonetaryEvidence(payload, { now: CUTOFF, client: null });
  const readFailureClient = {
    from: () => ({
      select: () => ({
        lte: () => ({ order: async () => ({ data: null, error: { message: 'read failed' } }) })
      })
    })
  };
  await assert.rejects(listManualOfficialMonetaryEvidence({ cutoff: CUTOFF, client: readFailureClient }), /MONETARY_EVIDENCE_QUERY_FAILED/);
});

test('unauthorized and ordinary bearer callers cannot invoke the official ingestion route', async () => {
  const schedulerToken = 's'.repeat(40);
  let calls = 0;
  const app = createApp({ alertSchedulerToken: schedulerToken, importManualOfficialMonetaryEvidenceFn: async () => { calls += 1; return { isDurable: true, vintage: { vintageId: 'v', observationId: 'o', factId: 'f', systemKnowableAt: CUTOFF.toISOString() } }; } });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/api/internal/monetary-evidence/import`;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authorized internal ingestion uses the production validator and caller cannot escalate authority fields', async () => {
  clearManualMonetaryEvidenceForTest();
  const schedulerToken = 't'.repeat(40);
  const app = createApp({ alertSchedulerToken: schedulerToken, supabaseAuthClient: null });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/monetary-evidence/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${schedulerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUrl: 'https://sbv.gov.vn/release/weekly', documentId: 'SBV-W27-2026',
        artifactText: officialArtifact(), parserProfileVersion: MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1,
        authorityLevel: 'PRIMARY_OFFICIAL', originIssuer: 'FAKE', publisher: 'FAKE'
      })
    });
    assert.equal(response.status, 503, 'test/offline storage is truthfully non-durable');
    const stored = await listManualOfficialMonetaryEvidence({ cutoff: new Date(), client: null });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].authorityLevel, 'REGULATORY_OFFICIAL');
    assert.equal(stored[0].originIssuer, 'SBV');
    assert.equal(stored[0].publisher, 'SBV');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production fact packet dependency activation is based on structured identifiers, not narrative text', () => {
  const packet = buildMarketStrategistFactPacket({
    marketObservations: [...baseEvidence(), ev('vn.monetary.fx.usd_vnd', 'MARKET_REFERENCE')],
    newsArticles: [{ articleId: 'narrative', title: 'SBV OMO injection and credit easing', publishedAt: '2026-09-05T00:00:00Z' }],
    now: CUTOFF
  });
  assert.deepEqual(packet.monetaryDependencies.activeRequirementIds, [MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE]);
});

test('forward migration is immutable, service-write-only, and schema mirror matches its table contract', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/20260907000000_create_official_monetary_evidence_vintages.sql', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.official_monetary_evidence_vintages/);
    assert.match(sql, /BEFORE UPDATE OR DELETE/);
    assert.match(sql, /REVOKE ALL ON public\.official_monetary_evidence_vintages FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT SELECT, INSERT ON public\.official_monetary_evidence_vintages TO service_role/);
    assert.match(sql, /system_knowable_at = GREATEST\(source_available_at, system_first_seen_at\)/);
  }
  assert.doesNotMatch(migration, /ALTER TABLE public\.confidence_assessments/);
});

test('UI monetary limitations are projected only from structured gates and remediation codes', () => {
  const view = buildConfidenceAssessmentViewModel({
    assessmentStatus: 'ASSESSED', publicGrade: 'INSUFFICIENT_EVIDENCE', evidenceSupport: 'INSUFFICIENT', calibrationStatus: 'UNVALIDATED',
    gateResults: [{ requirementId: MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS, passed: false, pathId: null, evidenceIds: [] }],
    reasons: [],
    upgradeRequirements: [{ requirementId: MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS, code: 'PROVIDE_VALID_ESSENTIAL_SUPPORT_PATH' }]
  });
  assert.deepEqual(view.monetaryDiagnostics, [{
    requirementId: MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS,
    label: 'Điều kiện tín dụng', status: 'MISSING', pathId: null, evidenceIds: [],
    remediation: 'PROVIDE_VALID_ESSENTIAL_SUPPORT_PATH'
  }]);
});
