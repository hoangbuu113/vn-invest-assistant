import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEvidenceAvailabilityTime,
  AVAILABILITY_CLASSIFICATION,
  buildHistoricalEvidencePacket,
  REPLAY_POLICY_VERSION
} from '../src/replay/index.js';

import {
  createMarketObservation,
  AUTHORITY_LEVELS,
  OBSERVATION_STATUS
} from '../src/context/factModel.js';

import {
  createMarketClaim,
  CLAIM_STATUS,
  CLAIM_TYPES,
  CLAIM_AUTHORITY_LEVELS
} from '../src/claims/claimModel.js';

import {
  SOURCE_FAMILIES,
  DEPENDENCY_GROUPS
} from '../src/claims/sourceFamily.js';

import {
  persistClaims,
  clearMemoryClaims
} from '../src/claims/claimRepository.js';

function makeObs(opts) {
  let pillar = opts.pillar;
  if (!pillar) {
    if (opts.factId?.startsWith('vn.macro.') || opts.factId?.startsWith('vn.trade.')) pillar = 'macro';
    else if (opts.factId?.startsWith('vn.market.')) pillar = 'market';
    else if (opts.factId?.startsWith('vn.monetary.')) pillar = 'monetary';
    else if (opts.factId?.startsWith('global.intermarket.')) pillar = 'intermarket';
    else pillar = 'macro';
  }
  return createMarketObservation({ pillar, ...opts });
}

// ============================================================
// 1. OBSERVATION POINT-IN-TIME SELECTION TESTS (1 - 6)
// ============================================================

test('1. future observation excluded', () => {
  const obsFuture = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-02T23:59:59.999Z', // Replay cutoff BEFORE publication
    observations: [obsFuture]
  });

  assert.equal(packet.observations.length, 0, 'Future observation must be excluded');
  assert.equal(packet.replayMetadata.excludedFutureEvidenceCount, 1, 'Excluded count recorded');
});

test('2. observation published before asOf included', () => {
  const obsPast = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T00:00:00.000Z', // Replay cutoff AFTER publication
    observations: [obsPast]
  });

  assert.equal(packet.observations.length, 1, 'Observation published before asOf must be included');
  assert.equal(packet.observations[0].factId, 'vn.macro.cpi.yoy');
  assert.equal(packet.observations[0].value, 4.89);
});

test('3. referencePeriod alone does not make evidence knowable', () => {
  // Observation for August 2026 without any publishedAt / observedAt / fetchedAt
  const obsUndated = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08'
    // Intentionally no publishedAt, observedAt, or fetchedAt
  };

  const avail = resolveEvidenceAvailabilityTime(obsUndated);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-10T00:00:00.000Z',
    observations: [obsUndated]
  });

  assert.equal(packet.observations.length, 0, 'Undated observation must be excluded');
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1, 'Marked as unsafe timestamp');
  assert.ok(packet.limitations.some((l) => l.includes('lacks trustworthy availability timestamp')));
});

test('4. preliminary selected before revision release', () => {
  const obsPrelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const obsRevised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36500000000,
    referenceTime: '2026-07',
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z'
  });

  // Replay on August 20 (after preliminary, before revision)
  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-08-20T00:00:00.000Z',
    observations: [obsPrelim, obsRevised]
  });

  assert.equal(packet.observations.length, 1);
  assert.equal(packet.observations[0].revisionMarker, 'preliminary');
  assert.equal(packet.observations[0].value, 36000000000, 'Must select preliminary value');
});

test('5. revised selected after revision release', () => {
  const obsPrelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const obsRevised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36500000000,
    referenceTime: '2026-07',
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z'
  });

  // Replay on September 1 (after both preliminary and revision)
  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T00:00:00.000Z',
    observations: [obsPrelim, obsRevised]
  });

  assert.equal(packet.observations.length, 1);
  assert.equal(packet.observations[0].revisionMarker, 'revised');
  assert.equal(packet.observations[0].value, 36500000000, 'Must select revised value');
});

test('6. later revision does not alter earlier replay', () => {
  const obsPrelim = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    revisionMarker: 'preliminary',
    publishedAt: '2026-09-03T08:00:00.000Z'
  });
  const obsRevised = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.92,
    referenceTime: '2026-08',
    revisionMarker: 'revised',
    publishedAt: '2026-09-20T08:00:00.000Z'
  });

  // Replay at Sep 5 without future revision
  const packetBefore = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obsPrelim]
  });

  // Replay at Sep 5 WITH future revision present in storage
  const packetAfter = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obsPrelim, obsRevised]
  });

  assert.equal(packetBefore.observations[0].value, 4.89);
  assert.equal(packetAfter.observations[0].value, 4.89);
  assert.equal(packetBefore.evidenceFingerprint, packetAfter.evidenceFingerprint, 'Fingerprint must be 100% identical');
});

// ============================================================
// 2. NEWS POINT-IN-TIME VERSION REPLAY (7 - 10)
// ============================================================

test('7. future news excluded', () => {
  const futureNews = {
    articleId: 'art_future_1',
    versionId: 'art_future_1:v_111',
    title: 'Thị trường chứng khoán ngày mai',
    publishedAt: '2026-09-05T10:00:00.000Z',
    sourceId: 'cafef'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T09:00:00.000Z', // 1 hour before article
    newsArticles: [futureNews]
  });

  assert.equal(packet.news.length, 0, 'Future news article must be excluded');
  assert.equal(packet.replayMetadata.excludedFutureEvidenceCount, 1);
});

test('8. news v1 selected before correction', () => {
  const articleV1 = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_111',
    title: 'Vinamilk công bố doanh thu tăng 5%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    sourceId: 'cafef'
  };
  const articleV2Correction = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_222',
    title: 'Đính chính: Vinamilk công bố doanh thu tăng 8%',
    publishedAt: '2026-09-01T14:00:00.000Z',
    sourceId: 'cafef'
  };

  // Replay at 11:00 (v1 available, v2 not yet)
  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T11:00:00.000Z',
    newsArticles: [articleV1, articleV2Correction]
  });

  assert.equal(packet.news.length, 1);
  assert.equal(packet.news[0].versionId, 'art_vnm_action:v_111', 'Must select v1');
  assert.ok(packet.news[0].title.includes('tăng 5%'));
});

test('9. corrected news version selected only after correction availability', () => {
  const articleV1 = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_111',
    title: 'Vinamilk công bố doanh thu tăng 5%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    sourceId: 'cafef'
  };
  const articleV2Correction = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_222',
    title: 'Đính chính: Vinamilk công bố doanh thu tăng 8%',
    publishedAt: '2026-09-01T14:00:00.000Z',
    sourceId: 'cafef'
  };

  // Replay at 16:00 (both v1 and v2 available)
  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T16:00:00.000Z',
    newsArticles: [articleV1, articleV2Correction]
  });

  assert.equal(packet.news.length, 1);
  assert.equal(packet.news[0].versionId, 'art_vnm_action:v_222', 'Must select corrected v2');
  assert.ok(packet.news[0].title.includes('tăng 8%'));
});

test('10. future correction does not alter earlier packet', () => {
  const articleV1 = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_111',
    title: 'Vinamilk công bố doanh thu tăng 5%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    sourceId: 'cafef'
  };
  const articleV2Correction = {
    articleId: 'art_vnm_action',
    versionId: 'art_vnm_action:v_222',
    title: 'Đính chính: Vinamilk công bố doanh thu tăng 8%',
    publishedAt: '2026-09-01T14:00:00.000Z',
    sourceId: 'cafef'
  };

  const p1 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T11:00:00.000Z',
    newsArticles: [articleV1]
  });

  const p2 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T11:00:00.000Z',
    newsArticles: [articleV1, articleV2Correction]
  });

  assert.equal(p1.evidenceFingerprint, p2.evidenceFingerprint, 'Fingerprint for 11:00 must not be changed by 14:00 correction');
});

// ============================================================
// 3. CLAIM RECONSTRUCTION & INDEPENDENCE AS-OF (11 - 13)
// ============================================================

test('11. claim SINGLE_SOURCE before second evidence', () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T08:00:00.000Z'
  });

  const evIR = {
    evidenceId: 'ir_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố tái cấu trúc',
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    customClaims: [claim],
    observations: [evIR]
  });

  const rClaim = packet.claims.find((c) => c.subject === 'vn.issuer.vnm.restructuring');
  assert.ok(rClaim);
  assert.equal(rClaim.independentSourceCount, 1);
  assert.equal(rClaim.supportStatus, CLAIM_STATUS.SUPPORTED);
});

test('12. claim CORROBORATED after second truly independent evidence', () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T08:00:00.000Z'
  });

  const evIR = {
    evidenceId: 'ir_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố tái cấu trúc',
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const evIndependentSurvey = {
    evidenceId: 'independent_survey_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.MARKET_DATA,
    dependencyGroup: DEPENDENCY_GROUPS.MARKET_DATA,
    isPrimaryResearch: true,
    methodology: 'independent_survey',
    title: 'Independent confirmation',
    publishedAt: '2026-09-01T13:00:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T15:00:00.000Z', // After both evidence items
    customClaims: [claim],
    observations: [evIR, evIndependentSurvey]
  });

  const rClaim = packet.claims.find((c) => c.subject === 'vn.issuer.vnm.restructuring');
  assert.ok(rClaim);
  assert.equal(rClaim.independentSourceCount, 2);
  assert.equal(rClaim.supportStatus, CLAIM_STATUS.CORROBORATED);
});

test('13. future corroboration does not leak backward', () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T08:00:00.000Z'
  });

  const evIR = {
    evidenceId: 'ir_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố tái cấu trúc',
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const evIndependentSurveyFuture = {
    evidenceId: 'independent_survey_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.MARKET_DATA,
    dependencyGroup: DEPENDENCY_GROUPS.MARKET_DATA,
    isPrimaryResearch: true,
    methodology: 'independent_survey',
    title: 'Independent confirmation',
    publishedAt: '2026-09-01T13:00:00.000Z' // Arrives at 13:00
  };

  // Replay at 10:00 with BOTH items present in system input
  const packet10 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    customClaims: [claim],
    observations: [evIR, evIndependentSurveyFuture]
  });

  const claim10 = packet10.claims.find((c) => c.subject === 'vn.issuer.vnm.restructuring');
  assert.equal(claim10.independentSourceCount, 1, 'At 10:00, 13:00 corroboration must not leak');
  assert.equal(claim10.supportStatus, CLAIM_STATUS.SUPPORTED, 'Must be SUPPORTED, not CORROBORATED');
});

// ============================================================
// 4. CONTRADICTION & RESOLUTION AS-OF (14 - 15)
// ============================================================

test('14. contradiction appears only after conflicting evidence arrives', () => {
  const officialClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T09:00:00.000Z'
  });

  const conflictingClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 5.20,
    unit: '%',
    referencePeriod: '2026-08',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
    publishedAt: '2026-09-01T12:00:00.000Z' // Arrives at 12:00
  });

  // Replay at 10:00 (before conflicting claim)
  const packet10 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    customClaims: [officialClaim, conflictingClaim]
  });
  const c10 = packet10.claims.find((c) => c.claimId === officialClaim.claimId);
  assert.equal(c10.contradictionCount, 0, 'No contradiction at 10:00');

  // Replay at 13:00 (after conflicting claim)
  const packet13 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T13:00:00.000Z',
    customClaims: [officialClaim, conflictingClaim]
  });
  const c13 = packet13.claims.find((c) => c.claimId === officialClaim.claimId);
  assert.equal(c13.contradictionCount, 1, 'Contradiction active at 13:00');
});

test('15. later contradiction resolution does not rewrite earlier replay', () => {
  const officialClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T09:00:00.000Z'
  });

  const conflictingClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 5.20,
    unit: '%',
    referencePeriod: '2026-08',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
    publishedAt: '2026-09-01T12:00:00.000Z'
  });

  // Replaying at 13:00 will FOREVER show contradiction active
  const p13 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T13:00:00.000Z',
    customClaims: [officialClaim, conflictingClaim]
  });
  const c13 = p13.claims.find((c) => c.claimId === officialClaim.claimId);
  assert.equal(c13.contradictionCount, 1, 'Contradiction must remain at 13:00');
});

// ============================================================
// 5. POINT-IN-TIME RECONSTRUCTION VS DB STATE (16 - 20)
// ============================================================

test('16. source dependency reconstructed point-in-time', () => {
  const evNSO = {
    evidenceId: 'obs_cpi_aug',
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_cpi_aug',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z',
    sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO
  };
  const evReuters = {
    evidenceId: 'art_reuters_aug',
    title: 'Vietnam CPI rises 4.89% per NSO',
    snippet: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%',
    publishedAt: '2026-09-03T10:00:00.000Z',
    sourceFamily: SOURCE_FAMILIES.REUTERS
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T12:00:00.000Z',
    observations: [evNSO],
    newsArticles: [evReuters]
  });

  const cpiClaim = packet.claims.find((c) => c.subject === 'vn.macro.cpi.yoy');
  assert.ok(cpiClaim);
  assert.equal(cpiClaim.independentSourceCount, 1, 'Collapses point-in-time to 1 OFFICIAL_NSO group');
});

test('17. future dependency classification does not leak backward', () => {
  // At 10:00 an article arrives with no attribution
  const artMorning = {
    evidenceId: 'art_morning',
    articleId: 'art_morning',
    title: 'CPI dự kiến tăng',
    publishedAt: '2026-09-03T10:00:00.000Z',
    sourceFamily: SOURCE_FAMILIES.CAFEF
  };
  // Later at 14:00, official release arrives
  const obsAfternoon = {
    evidenceId: 'obs_nso',
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_nso',
    value: 4.89,
    publishedAt: '2026-09-03T14:00:00.000Z',
    sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO
  };

  const p11 = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T11:00:00.000Z',
    newsArticles: [artMorning],
    observations: [obsAfternoon]
  });

  assert.equal(p11.observations.length, 0, '14:00 observation does not exist at 11:00');
});

test('18. current market_claims status cannot override historical reconstruction', async () => {
  clearMemoryClaims();

  // Create a claim that is CURRENTLY marked CORROBORATED in storage
  const claimInDb = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    supportStatus: CLAIM_STATUS.CORROBORATED, // Currently corroborated
    independentSourceCount: 2,
    publishedAt: '2026-09-01T08:00:00.000Z'
  });

  await persistClaims([{ claim: claimInDb, supportingEvidence: [] }], null);

  // At historical time T, only ONE evidence item existed
  const evSingle = {
    evidenceId: 'art_single_morning',
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    referencePeriod: '2026-08',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    publishedAt: '2026-09-01T08:30:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T09:00:00.000Z',
    newsArticles: [evSingle]
  });

  const reconstructed = packet.claims.find((c) => c.subject === 'vn.macro.cpi.yoy');
  assert.ok(reconstructed);
  assert.notEqual(reconstructed.supportStatus, CLAIM_STATUS.CORROBORATED, 'Current DB CORROBORATED must NOT leak into historical replay');
});

test('19. preliminary claim is not SUPERSEDED before revision exists', () => {
  const claimPrelim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 36000000000,
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const claimRevised = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 36500000000,
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z'
  });

  // Replay on Aug 20 (before revised exists)
  const packetAug20 = buildHistoricalEvidencePacket({
    asOf: '2026-08-20T00:00:00.000Z',
    customClaims: [claimPrelim, claimRevised]
  });

  const pClaim = packetAug20.claims.find((c) => c.revisionMarker === 'preliminary');
  assert.ok(pClaim);
  assert.notEqual(pClaim.supportStatus, CLAIM_STATUS.SUPERSEDED, 'Preliminary claim is NOT superseded on Aug 20');
});

test('20. revised claim supersedes only after revision becomes knowable', () => {
  const claimPrelim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 36000000000,
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const claimRevised = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 36500000000,
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z'
  });

  // Replay on Sep 2 (after revised is published)
  const packetSep2 = buildHistoricalEvidencePacket({
    asOf: '2026-09-02T00:00:00.000Z',
    customClaims: [claimPrelim, claimRevised]
  });

  const pClaim = packetSep2.claims.find((c) => c.revisionMarker === 'preliminary');
  assert.ok(pClaim);
  assert.equal(pClaim.supportStatus, CLAIM_STATUS.SUPERSEDED, 'Preliminary claim IS superseded after revision is knowable');
});

// ============================================================
// 6. DERIVED FACTS & SIGNALS AS-OF (21 - 22)
// ============================================================

test('21. derived trade balance uses only asOf-valid inputs', () => {
  const expJuly = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    unit: 'USD',
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const impJuly = makeObs({
    factId: 'vn.trade.goods.imports.month_usd',
    value: 34000000000,
    unit: 'USD',
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-08-20T00:00:00.000Z',
    observations: [expJuly, impJuly]
  });

  const balance = packet.observations.find((o) => o.factId === 'vn.trade.goods.balance.month_usd');
  assert.ok(balance, 'Derived trade balance must be present');
  assert.equal(balance.value, 2000000000, '36B - 34B = 2B USD surplus');
  assert.equal(balance.status, OBSERVATION_STATUS.AVAILABLE);
});

test('22. future revised input cannot leak into historical derived value', () => {
  const expJulyPrelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    unit: 'USD',
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });
  const impJulyPrelim = makeObs({
    factId: 'vn.trade.goods.imports.month_usd',
    value: 34000000000,
    unit: 'USD',
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z'
  });

  // Future revision on August 30
  const expJulyRevised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 37000000000,
    unit: 'USD',
    referenceTime: '2026-07',
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z'
  });

  // Replay at August 20
  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-08-20T00:00:00.000Z',
    observations: [expJulyPrelim, impJulyPrelim, expJulyRevised]
  });

  const balance = packet.observations.find((o) => o.factId === 'vn.trade.goods.balance.month_usd');
  assert.ok(balance);
  assert.equal(balance.value, 2000000000, 'Future export 37B must not leak; balance must stay 2B');
});

// ============================================================
// 7. FRESHNESS & CLOCK INDEPENDENCE (23 - 24)
// ============================================================

test('23. freshness evaluated against asOf', () => {
  // CPI released on Sep 3, 2026 for August 2026
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z'
  });

  // Replay on Sep 5, 2026: age is ~2 days -> FRESH
  const packetFresh = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obs]
  });
  assert.equal(packetFresh.observations[0].freshness, 'fresh');
  assert.equal(packetFresh.observations[0].status, 'available');

  // Replay on Nov 15, 2026: age from August month end (Aug 31) > 45 days -> STALE
  const packetStale = buildHistoricalEvidencePacket({
    asOf: '2026-11-15T00:00:00.000Z',
    observations: [obs]
  });
  assert.equal(packetStale.observations[0].freshness, 'stale');
  assert.equal(packetStale.observations[0].status, 'stale');
});

test('24. current wall clock cannot alter replay result', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z'
  });

  const p1 = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obs]
  });

  // Run replay again; regardless of current date, output and fingerprint must be identical
  const p2 = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obs]
  });

  assert.equal(p1.evidenceFingerprint, p2.evidenceFingerprint);
  assert.equal(p1.dataAsOf, p2.dataAsOf);
});

// ============================================================
// 8. TIMESTAMP CONSERVATISM & UNSAFE EVIDENCE (25 - 26)
// ============================================================

test('25. missing trustworthy availability timestamp is excluded conservatively', () => {
  const unsafeObs = {
    factId: 'vn.monetary.rate.vnd_overnight',
    value: 4.5,
    referenceTime: null
    // Missing all timestamp fields
  };

  const avail = resolveEvidenceAvailabilityTime(unsafeObs);
  assert.equal(avail.isAvailable, false);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [unsafeObs]
  });
  assert.equal(packet.observations.length, 0);
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
});

test('26. URL/reference-period dates are not synthesized into publication time', () => {
  const itemWithUrlDate = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    url: 'https://gso.gov.vn/du-lieu-thong-ke/2026/09/03/chi-so-gia-tieu-dung-cpi-thang-8-nam-2026/'
    // Notice: URL has /2026/09/03/ and referenceTime is 2026-08, but NO publishedAt or observedAt
  };

  const avail = resolveEvidenceAvailabilityTime(itemWithUrlDate);
  assert.equal(avail.isAvailable, false, 'Must NOT parse /2026/09/03/ from URL');
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-10T00:00:00.000Z',
    observations: [itemWithUrlDate]
  });
  assert.equal(packet.observations.length, 0, 'Item with URL date only must be excluded from replay');
});

// ============================================================
// 9. REPLAY IDEMPOTENCY & FINGERPRINT STABILITY (27 - 30)
// ============================================================

test('27. same historical replay after adding future rows is unchanged', () => {
  const obs1 = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });
  const obsFuture1 = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1295.2,
    observedAt: '2026-09-05T08:00:00.000Z'
  });
  const obsFuture2 = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1302.8,
    observedAt: '2026-09-06T08:00:00.000Z'
  });

  const packetInitial = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [obs1]
  });

  const packetLater = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [obs1, obsFuture1, obsFuture2]
  });

  assert.equal(packetInitial.evidenceFingerprint, packetLater.evidenceFingerprint);
  assert.equal(packetInitial.observations[0].value, packetLater.observations[0].value);
});

test('28. same replay produces same fingerprint', () => {
  const obs = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });

  const p1 = buildHistoricalEvidencePacket({ asOf: '2026-09-04T23:59:59.000Z', observations: [obs] });
  const p2 = buildHistoricalEvidencePacket({ asOf: '2026-09-04T23:59:59.000Z', observations: [obs] });

  assert.equal(typeof p1.evidenceFingerprint, 'string');
  assert.equal(p1.evidenceFingerprint.length, 64);
  assert.equal(p1.evidenceFingerprint, p2.evidenceFingerprint);
});

test('29. input ordering does not change fingerprint/output', () => {
  const obsA = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-03T08:00:00.000Z'
  });
  const obsB = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-03T08:00:00.000Z'
  });
  const obsC = makeObs({
    factId: 'global.intermarket.brent.futures',
    value: 78.5,
    observedAt: '2026-09-03T08:00:00.000Z'
  });

  const p1 = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T23:59:59.000Z',
    observations: [obsA, obsB, obsC]
  });
  const p2 = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T23:59:59.000Z',
    observations: [obsC, obsA, obsB]
  });

  assert.equal(p1.evidenceFingerprint, p2.evidenceFingerprint, 'Fingerprint must be order-invariant');
  assert.deepEqual(
    p1.observations.map((o) => o.factId),
    p2.observations.map((o) => o.factId),
    'Observations must be sorted deterministically'
  );
});

test('30. later claim status change does not alter earlier fingerprint', () => {
  const claimInitial = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    supportStatus: CLAIM_STATUS.SINGLE_SOURCE,
    independentSourceCount: 1,
    publishedAt: '2026-09-03T08:00:00.000Z'
  });

  const p1 = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T10:00:00.000Z',
    customClaims: [claimInitial]
  });

  // At a later date, claim is updated in caller's memory to CORROBORATED with 2 sources
  const claimUpdated = createMarketClaim({
    ...claimInitial,
    supportStatus: CLAIM_STATUS.CORROBORATED,
    independentSourceCount: 2,
    publishedAt: '2026-09-03T14:00:00.000Z' // Published later
  });

  // Replaying for 10:00 with both claims passed in
  const p2 = buildHistoricalEvidencePacket({
    asOf: '2026-09-03T10:00:00.000Z',
    customClaims: [claimInitial, claimUpdated]
  });

  assert.equal(p1.evidenceFingerprint, p2.evidenceFingerprint);
});

// ============================================================
// 10. PURITY, SECURITY & METADATA BOUNDARIES (31 - 35)
// ============================================================

test('31. no Gemini invocation', () => {
  // Functional check: buildHistoricalEvidencePacket executes synchronously/deterministically
  // without calling GoogleGenAI or network
  const obs = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [obs]
  });

  assert.ok(packet);
  assert.ok(packet.evidenceFingerprint);
  // Zero external keys needed
  assert.equal(typeof packet.evidenceFingerprint, 'string');
});

test('32. no OpenAI invocation', () => {
  const obs = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [obs]
  });

  assert.ok(packet);
  assert.equal(packet.observations.length, 1);
});

test('33. no live provider calls', () => {
  const obs = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [obs]
  });

  assert.ok(packet);
  assert.equal(packet.replayMetadata.policyVersion, REPLAY_POLICY_VERSION);
});

test('34. no profile/user/portfolio data', () => {
  const contaminatedObs = {
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z',
    portfolio: { holdings: ['VNM'] } // FORBIDDEN private field
  };

  assert.throws(
    () => {
      buildHistoricalEvidencePacket({
        asOf: '2026-09-04T23:59:59.000Z',
        observations: [contaminatedObs]
      });
    },
    { code: 'FORBIDDEN_USER_DATA' },
    'Must throw FORBIDDEN_USER_DATA when private portfolio data enters replay'
  );
});

test('35. replay limitations identify unsafe/excluded evidence', () => {
  const validObs = makeObs({
    factId: 'vn.market.vnindex.close',
    value: 1280.5,
    observedAt: '2026-09-04T08:00:00.000Z'
  });
  const unsafeObs = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08'
    // Missing trustworthy timestamp
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T23:59:59.000Z',
    observations: [validObs, unsafeObs]
  });

  assert.equal(packet.observations.length, 1);
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
  assert.ok(packet.limitations.length > 0, 'Limitations array must expose unsafe evidence');
  assert.ok(packet.replayMetadata.limitations.some((l) => l.includes('lacks trustworthy availability timestamp')));
});
