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

/**
 * Helper to construct normalized MarketObservation fixtures with explicit system-knowable timestamps.
 */
function makeObs(opts) {
  let pillar = opts.pillar;
  if (!pillar) {
    if (opts.factId?.startsWith('vn.macro.') || opts.factId?.startsWith('vn.trade.')) pillar = 'macro';
    else if (opts.factId?.startsWith('vn.market.')) pillar = 'market';
    else if (opts.factId?.startsWith('vn.monetary.')) pillar = 'monetary';
    else if (opts.factId?.startsWith('global.intermarket.')) pillar = 'intermarket';
    else pillar = 'macro';
  }

  const resolvedObservedAt = opts.observedAt !== undefined ? opts.observedAt : (opts.omitFirstSeen ? null : opts.publishedAt);
  const base = createMarketObservation({
    pillar,
    observedAt: resolvedObservedAt,
    ...opts
  });

  if (opts.firstSeenAt !== undefined) {
    return Object.freeze({ ...base, firstSeenAt: opts.firstSeenAt });
  }
  if (opts.omitFirstSeen) {
    return Object.freeze({ ...base, observedAt: null, firstSeenAt: null });
  }
  return Object.freeze({ ...base, firstSeenAt: base.observedAt || base.publishedAt });
}

// ============================================================
// 22. REQUIRED TESTS (1 - 25)
// ============================================================

// 1. publishedAt 09:00 + firstSeenAt 11:00, asOf 10:00 -> excluded
test('1. publishedAt 09:00 + firstSeenAt 11:00, asOf 10:00 -> excluded', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T11:00:00.000Z'
  });

  const avail = resolveEvidenceAvailabilityTime(obs);
  assert.equal(avail.isAvailable, true);
  assert.equal(avail.availabilityTime, '2026-09-01T11:00:00.000Z');
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_FROM_SOURCE_AND_FIRST_SEEN);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    observations: [obs]
  });

  assert.equal(packet.observations.length, 0, 'Must be excluded before system first seen');
  assert.equal(packet.replayMetadata.excludedFutureEvidenceCount, 1);
  assert.equal(packet.replayMetadata.excludedBeforeSystemFirstSeenCount, 1);
});

// 2. same evidence asOf 12:00 -> included
test('2. same evidence asOf 12:00 -> included', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T11:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T12:00:00.000Z',
    observations: [obs]
  });

  assert.equal(packet.observations.length, 1, 'Must be included after system first seen');
  assert.equal(packet.observations[0].factId, 'vn.macro.cpi.yoy');
  assert.equal(packet.observations[0].value, 4.89);
});

// 3. backfilled 2024 fact first seen 2026, replay 2025 -> excluded
test('3. backfilled 2024 fact first seen 2026, replay 2025 -> excluded', () => {
  const backfilledObs = makeObs({
    factId: 'vn.macro.gdp.growth',
    value: 5.66,
    referenceTime: '2024-Q1',
    publishedAt: '2024-04-15T08:00:00.000Z',
    firstSeenAt: '2026-09-06T00:00:00.000Z'
  });

  // Replay in 2025 before backfill happened
  const packet2025 = buildHistoricalEvidencePacket({
    asOf: '2025-01-01T00:00:00.000Z',
    observations: [backfilledObs]
  });
  assert.equal(packet2025.observations.length, 0, 'Backfilled data must never leak into earlier intervals');
  assert.equal(packet2025.replayMetadata.backfilledEvidenceExcludedCount, 1);

  // Replay in 2026 after backfill happened
  const packet2026 = buildHistoricalEvidencePacket({
    asOf: '2026-09-07T00:00:00.000Z',
    observations: [backfilledObs]
  });
  assert.equal(packet2026.observations.length, 1, 'Backfilled data is knowable after system first seen');
});

// 4. publishedAt only, no trustworthy system first-seen -> unsafe/excluded by default
test('4. publishedAt only, no trustworthy system first-seen -> unsafe/excluded by default', () => {
  const rawItem = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const avail = resolveEvidenceAvailabilityTime(rawItem);
  assert.equal(avail.isAvailable, false);
  assert.equal(avail.replaySafe, false);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_MISSING_SYSTEM_FIRST_SEEN);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [rawItem]
  });
  assert.equal(packet.observations.length, 0, 'Published-only evidence must be excluded by default');
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
  assert.ok(packet.limitations.some((l) => l.includes('UNSAFE_MISSING_SYSTEM_FIRST_SEEN')));
});

// 5. firstSeen-only evidence may be replay-safe if contract explicitly permits
test('5. firstSeen-only evidence may be replay-safe if contract explicitly permits', () => {
  const tickData = {
    factId: 'vn.market.vnindex.tick',
    value: 1285.4,
    observedAt: '2026-09-01T09:30:00.000Z'
  };

  const avail = resolveEvidenceAvailabilityTime(tickData, { allowFirstSeenOnly: true });
  assert.equal(avail.isAvailable, true);
  assert.equal(avail.replaySafe, true);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_FROM_FIRST_SEEN);
  assert.equal(avail.availabilityTime, '2026-09-01T09:30:00.000Z');

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    observations: [tickData]
  });
  assert.equal(packet.observations.length, 1);
});

// 6. v1 published 09:00 / seen 09:05; v2 correction retains publishedAt 09:00 / firstSeen 14:05; asOf 11:00 -> v1
test('6. v1 published 09:00 / seen 09:05; v2 correction retains publishedAt 09:00 / firstSeen 14:05; asOf 11:00 -> v1', () => {
  const v1 = {
    articleId: 'art_trade_1',
    versionId: 'art_trade_1:v1',
    title: 'Initial: Exports rose 15%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T09:05:00.000Z'
  };
  const v2 = {
    articleId: 'art_trade_1',
    versionId: 'art_trade_1:v2',
    isCorrection: true,
    title: 'Correction: Exports fell 5%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    versionFirstSeenAt: '2026-09-01T14:05:00.000Z'
  };

  const packet11 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T11:00:00.000Z',
    newsArticles: [v1, v2]
  });

  assert.equal(packet11.news.length, 1);
  assert.equal(packet11.news[0].versionId, 'art_trade_1:v1');
  assert.equal(packet11.news[0].title, 'Initial: Exports rose 15%');
  assert.equal(packet11.replayMetadata.excludedFutureEvidenceCount, 1);
});

// 7. same case asOf 15:00 -> v2
test('7. same case asOf 15:00 -> v2', () => {
  const v1 = {
    articleId: 'art_trade_1',
    versionId: 'art_trade_1:v1',
    title: 'Initial: Exports rose 15%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T09:05:00.000Z'
  };
  const v2 = {
    articleId: 'art_trade_1',
    versionId: 'art_trade_1:v2',
    isCorrection: true,
    title: 'Correction: Exports fell 5%',
    publishedAt: '2026-09-01T09:00:00.000Z',
    versionFirstSeenAt: '2026-09-01T14:05:00.000Z'
  };

  const packet15 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T15:00:00.000Z',
    newsArticles: [v1, v2]
  });

  assert.equal(packet15.news.length, 1);
  assert.equal(packet15.news[0].versionId, 'art_trade_1:v2');
  assert.equal(packet15.news[0].title, 'Correction: Exports fell 5%');
  assert.equal(packet15.news[0].articlePublishedAt, '2026-09-01T09:00:00.000Z');
  assert.equal(packet15.news[0].versionAvailableAt, '2026-09-01T14:05:00.000Z');
});

// 8. correction without trustworthy version availability -> unsafe/excluded
test('8. correction without trustworthy version availability -> unsafe/excluded', () => {
  const unverifiedCorrection = {
    articleId: 'art_errata_1',
    versionId: 'art_errata_1:v2',
    isCorrection: true,
    title: 'Unverified Erratum',
    publishedAt: '2026-09-01T09:00:00.000Z'
  };

  const avail = resolveEvidenceAvailabilityTime(unverifiedCorrection);
  assert.equal(avail.isAvailable, false);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_UNTRUSTWORTHY_VERSION_TIME);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T15:00:00.000Z',
    newsArticles: [unverifiedCorrection]
  });
  assert.equal(packet.news.length, 0);
  assert.equal(packet.replayMetadata.excludedUnsafeVersionCount, 1);
});

// 9. versionId alone cannot make a future version eligible
test('9. versionId alone cannot make a future version eligible', () => {
  const v1 = {
    articleId: 'art_9',
    versionId: 'art_9:v1',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T09:05:00.000Z'
  };
  const vFuture = {
    articleId: 'art_9',
    versionId: 'art_9:v999',
    publishedAt: '2026-09-01T09:00:00.000Z',
    versionFirstSeenAt: '2026-09-01T18:00:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    newsArticles: [v1, vFuture]
  });

  assert.equal(packet.news.length, 1);
  assert.equal(packet.news[0].versionId, 'art_9:v1', 'v999 must not win by versionId sort alone');
});

// 10. future correction does not alter earlier replay fingerprint
test('10. future correction does not alter earlier replay fingerprint', () => {
  const v1 = {
    articleId: 'art_fp_1',
    versionId: 'art_fp_1:v1',
    title: 'Initial Report',
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T09:05:00.000Z'
  };
  const v2Future = {
    articleId: 'art_fp_1',
    versionId: 'art_fp_1:v2',
    isCorrection: true,
    title: 'Corrected Report',
    publishedAt: '2026-09-01T09:00:00.000Z',
    versionFirstSeenAt: '2026-09-01T18:00:00.000Z'
  };

  const pBefore = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    newsArticles: [v1]
  });
  const pAfter = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    newsArticles: [v1, v2Future]
  });

  assert.equal(pBefore.evidenceFingerprint, pAfter.evidenceFingerprint);
});

// 11. backfilled observation does not alter earlier replay fingerprint
test('11. backfilled observation does not alter earlier replay fingerprint', () => {
  const obsExisting = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2025-01',
    publishedAt: '2025-02-01T08:00:00.000Z',
    firstSeenAt: '2025-02-01T08:00:00.000Z'
  });
  const backfilledObs = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 30000000000,
    referenceTime: '2024-12',
    publishedAt: '2025-01-15T08:00:00.000Z',
    firstSeenAt: '2026-09-06T00:00:00.000Z'
  });

  const pBefore = buildHistoricalEvidencePacket({
    asOf: '2025-06-01T00:00:00.000Z',
    observations: [obsExisting]
  });
  const pAfter = buildHistoricalEvidencePacket({
    asOf: '2025-06-01T00:00:00.000Z',
    observations: [obsExisting, backfilledObs]
  });

  assert.equal(pBefore.evidenceFingerprint, pAfter.evidenceFingerprint);
});

// 12. preliminary seen Sep 3 + revision source-published Sep 10 but seen Sep 20; asOf Sep 15 -> preliminary
test('12. preliminary seen Sep 3 + revision source-published Sep 10 but seen Sep 20; asOf Sep 15 -> preliminary', () => {
  const prelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-08',
    revisionMarker: 'preliminary',
    publishedAt: '2026-09-03T08:00:00.000Z',
    firstSeenAt: '2026-09-03T08:00:00.000Z'
  });
  const revised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36500000000,
    referenceTime: '2026-08',
    revisionMarker: 'revised',
    publishedAt: '2026-09-10T08:00:00.000Z',
    firstSeenAt: '2026-09-20T08:00:00.000Z'
  });

  const packet15 = buildHistoricalEvidencePacket({
    asOf: '2026-09-15T00:00:00.000Z',
    observations: [prelim, revised]
  });

  assert.equal(packet15.observations.length, 1);
  assert.equal(packet15.observations[0].revisionMarker, 'preliminary');
  assert.equal(packet15.observations[0].value, 36000000000);
});

// 13. same asOf Sep 21 -> revised
test('13. same asOf Sep 21 -> revised', () => {
  const prelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-08',
    revisionMarker: 'preliminary',
    publishedAt: '2026-09-03T08:00:00.000Z',
    firstSeenAt: '2026-09-03T08:00:00.000Z'
  });
  const revised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36500000000,
    referenceTime: '2026-08',
    revisionMarker: 'revised',
    publishedAt: '2026-09-10T08:00:00.000Z',
    firstSeenAt: '2026-09-20T08:00:00.000Z'
  });

  const packet21 = buildHistoricalEvidencePacket({
    asOf: '2026-09-21T00:00:00.000Z',
    observations: [prelim, revised]
  });

  assert.equal(packet21.observations.length, 1);
  assert.equal(packet21.observations[0].revisionMarker, 'revised');
  assert.equal(packet21.observations[0].value, 36500000000);
});

// 14. two reference periods for same fact both survive historical evidence set
test('14. two reference periods for same fact both survive historical evidence set', () => {
  const julyExports = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-07',
    publishedAt: '2026-08-15T08:00:00.000Z',
    firstSeenAt: '2026-08-15T08:00:00.000Z'
  });
  const augustExports = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 37000000000,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z',
    firstSeenAt: '2026-09-03T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [julyExports, augustExports]
  });

  assert.equal(packet.observations.length, 2, 'Both July and August must remain in replay evidence');
  assert.ok(packet.observations.some((o) => o.referenceTime === '2026-07'));
  assert.ok(packet.observations.some((o) => o.referenceTime === '2026-08'));
});

// 15. only one vintage per fact/referencePeriod is selected
test('15. only one vintage per fact/referencePeriod is selected', () => {
  const julyPrelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-07',
    revisionMarker: 'preliminary',
    publishedAt: '2026-08-15T08:00:00.000Z',
    firstSeenAt: '2026-08-15T08:00:00.000Z'
  });
  const julyRevised = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36200000000,
    referenceTime: '2026-07',
    revisionMarker: 'revised',
    publishedAt: '2026-08-30T08:00:00.000Z',
    firstSeenAt: '2026-08-30T08:00:00.000Z'
  });
  const augustPrelim = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 37000000000,
    referenceTime: '2026-08',
    revisionMarker: 'preliminary',
    publishedAt: '2026-09-03T08:00:00.000Z',
    firstSeenAt: '2026-09-03T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [julyPrelim, julyRevised, augustPrelim]
  });

  assert.equal(packet.observations.length, 2);
  const julyItem = packet.observations.find((o) => o.referenceTime === '2026-07');
  assert.equal(julyItem.revisionMarker, 'revised');
  assert.equal(julyItem.value, 36200000000);
});

// 16. latest-fact projection chooses latest period without deleting historical evidence set
test('16. latest-fact projection chooses latest period without deleting historical evidence set', () => {
  const julyExports = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 36000000000,
    referenceTime: '2026-07',
    publishedAt: '2026-08-15T08:00:00.000Z',
    firstSeenAt: '2026-08-15T08:00:00.000Z'
  });
  const augustExports = makeObs({
    factId: 'vn.trade.goods.exports.month_usd',
    value: 37000000000,
    referenceTime: '2026-08',
    publishedAt: '2026-09-03T08:00:00.000Z',
    firstSeenAt: '2026-09-03T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [julyExports, augustExports]
  });

  assert.equal(packet.observations.length, 2, 'Historical evidence set preserves both periods');
  assert.equal(packet.latestFactSnapshot.length, 1, 'Snapshot projects only single latest period');
  assert.equal(packet.latestFactSnapshot[0].referenceTime, '2026-08');
  assert.equal(packet.latestFactSnapshot[0].value, 37000000000);
});

// 17. customClaims cannot bypass asOf
test('17. customClaims cannot bypass asOf', () => {
  const futureClaim = {
    claimId: 'claim_future_1',
    subject: 'vn.macro.inflation',
    predicate: 'EQUALS',
    numericValue: 5.0,
    publishedAt: '2026-09-10T08:00:00.000Z',
    firstSeenAt: '2026-09-10T08:00:00.000Z'
  };
  const undatedClaim = {
    claimId: 'claim_undated_1',
    subject: 'vn.macro.inflation',
    predicate: 'EQUALS',
    numericValue: 5.0
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    customClaims: [futureClaim, undatedClaim]
  });

  assert.equal(packet.claims.length, 0, 'Future and undated custom claims must never enter replay');
  assert.equal(packet.replayMetadata.excludedFutureEvidenceCount, 1);
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
});

// 18. current enriched dependency metadata cannot leak into historical version
test('18. current enriched dependency metadata cannot leak into historical version', () => {
  const rawArticleV1 = {
    articleId: 'art_18',
    versionId: 'art_18:v1',
    title: 'Trade balance preliminary',
    sourceId: 'unknown_blog',
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    newsArticles: [rawArticleV1]
  });

  assert.equal(packet.news.length, 1);
  assert.equal(packet.news[0].sourceId, 'unknown_blog');
  assert.equal(packet.news[0].sourceAuthority, undefined);
});

// 19. same-asOf deep packet equality remains unchanged after all future/backfill rows are appended
test('19. same-asOf deep packet equality remains unchanged after all future/backfill rows are appended', () => {
  const currentObs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  });
  const currentNews = {
    articleId: 'art_current',
    versionId: 'art_current:v1',
    title: 'CPI Released',
    publishedAt: '2026-09-01T08:30:00.000Z',
    firstSeenAt: '2026-09-01T08:30:00.000Z'
  };

  const pBase = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    observations: [currentObs],
    newsArticles: [currentNews]
  });

  const futureObs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.95,
    referenceTime: '2026-09',
    publishedAt: '2026-10-01T08:00:00.000Z',
    firstSeenAt: '2026-10-01T08:00:00.000Z'
  });
  const backfilledObs = makeObs({
    factId: 'vn.macro.gdp.growth',
    value: 5.66,
    referenceTime: '2024-Q1',
    publishedAt: '2024-04-15T08:00:00.000Z',
    firstSeenAt: '2026-09-06T00:00:00.000Z'
  });
  const futureNewsCorrection = {
    articleId: 'art_current',
    versionId: 'art_current:v2',
    isCorrection: true,
    title: 'CPI Correction',
    publishedAt: '2026-09-01T08:30:00.000Z',
    versionFirstSeenAt: '2026-09-02T14:00:00.000Z'
  };

  const pAppended = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    observations: [currentObs, futureObs, backfilledObs],
    newsArticles: [currentNews, futureNewsCorrection]
  });

  assert.equal(pBase.evidenceFingerprint, pAppended.evidenceFingerprint);
  assert.equal(pBase.observations.length, pAppended.observations.length);
  assert.equal(pBase.news.length, pAppended.news.length);
  assert.equal(pBase.claims.length, pAppended.claims.length);
});

// 20. timezone-equivalent timestamps generate identical replay state
test('20. timezone-equivalent timestamps generate identical replay state', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  });

  const pUtc = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    observations: [obs]
  });
  const pVn = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T17:00:00.000+07:00',
    observations: [obs]
  });

  assert.equal(pUtc.asOf, pVn.asOf);
  assert.equal(pUtc.evidenceFingerprint, pVn.evidenceFingerprint);
});

// 21. missing/ambiguous system-first-seen is reported in limitations
test('21. missing/ambiguous system-first-seen is reported in limitations', () => {
  const obsNoFirstSeen = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obsNoFirstSeen]
  });

  assert.ok(packet.limitations.length > 0);
  assert.ok(packet.limitations.some((l) => l.includes('UNSAFE_MISSING_SYSTEM_FIRST_SEEN')));
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
});

// 22. no wall clock
test('22. no wall clock: freshness evaluated strictly relative to asOf', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    referenceTime: '2026-08',
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  });

  const packetFresh = buildHistoricalEvidencePacket({
    asOf: '2026-09-02T08:00:00.000Z',
    observations: [obs]
  });
  assert.equal(packetFresh.observations[0].freshness, 'fresh');

  const packetStale = buildHistoricalEvidencePacket({
    asOf: '2026-11-01T08:00:00.000Z',
    observations: [obs]
  });
  assert.equal(packetStale.observations[0].freshness, 'stale');
});

// 23. no providers
test('23. no external provider network calls', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obs]
  });
  assert.ok(packet.evidenceFingerprint);
});

// 24. no Gemini/OpenAI
test('24. no Gemini/OpenAI LLM invocations', () => {
  const obs = makeObs({
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  });

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [obs]
  });
  assert.ok(packet.claims !== undefined);
});

// 25. no user/profile/portfolio data
test('25. no user/profile/portfolio data: strictly forbidden in replay', () => {
  const dirtyObs = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z',
    portfolio: { holdings: ['VNM'] }
  };

  assert.throws(
    () => {
      buildHistoricalEvidencePacket({
        asOf: '2026-09-05T00:00:00.000Z',
        observations: [dirtyObs]
      });
    },
    { code: 'FORBIDDEN_USER_DATA' }
  );
});

// ============================================================
// 26. REPLAY CLAIM CORROBORATION & CONTRADICTION PRESERVATION
// ============================================================

test('26. claim corroboration and contradiction preservation under as-of', () => {
  const officialClaim = {
    claimId: 'claim_cpi_1',
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 4.89,
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  };

  const officialEvidence = {
    evidenceId: 'nso_cpi',
    factId: 'vn.macro.cpi.yoy',
    subject: 'vn.macro.cpi.yoy',
    value: 4.89,
    numericValue: 4.89,
    referencePeriod: '2026-08',
    referenceTime: '2026-08',
    scope: 'monthly_yoy',
    sourceFamily: SOURCE_FAMILIES.STATISTICAL_OFFICE,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO,
    publishedAt: '2026-09-01T08:00:00.000Z',
    firstSeenAt: '2026-09-01T08:00:00.000Z'
  };

  const conflictingEvidenceFuture = {
    evidenceId: 'media_contradiction',
    factId: 'vn.macro.cpi.yoy',
    subject: 'vn.macro.cpi.yoy',
    value: 5.20,
    numericValue: 5.20,
    referencePeriod: '2026-08',
    referenceTime: '2026-08',
    scope: 'monthly_yoy',
    sourceFamily: SOURCE_FAMILIES.COMMERCIAL_NEWS,
    dependencyGroup: DEPENDENCY_GROUPS.COMMERCIAL_MEDIA,
    publishedAt: '2026-09-01T14:00:00.000Z',
    firstSeenAt: '2026-09-01T14:00:00.000Z'
  };

  // Replay at 10:00 before conflicting evidence arrives
  const p10 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T10:00:00.000Z',
    customClaims: [officialClaim],
    observations: [officialEvidence, conflictingEvidenceFuture]
  });
  const claim10 = p10.claims.find((c) => c.subject === 'vn.macro.cpi.yoy');
  assert.ok(claim10);
  assert.equal(claim10.contradictionCount, 0);

  // Replay at 15:00 after conflicting evidence arrives
  const p15 = buildHistoricalEvidencePacket({
    asOf: '2026-09-01T15:00:00.000Z',
    customClaims: [officialClaim],
    observations: [officialEvidence, conflictingEvidenceFuture]
  });
  const claim15 = p15.claims.find((c) => c.subject === 'vn.macro.cpi.yoy');
  assert.ok(claim15);
  assert.equal(claim15.contradictionCount, 1);
});

// 27. payload trustInstantIngestion=true cannot bypass first-seen requirement under default caller options
test('27. payload trustInstantIngestion=true cannot bypass first-seen requirement under default caller options', () => {
  const item = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    trustInstantIngestion: true
  };

  const avail = resolveEvidenceAvailabilityTime(item);
  assert.equal(avail.isAvailable, false);
  assert.equal(avail.replaySafe, false);
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.UNSAFE_MISSING_SYSTEM_FIRST_SEEN);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [item]
  });
  assert.equal(packet.observations.length, 0);
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 1);
});

// 28. payload assumeInstantIngestion=true and instantIngestion=true cannot bypass under default options
test('28. payload assumeInstantIngestion=true and instantIngestion=true cannot bypass under default options', () => {
  const itemAssume = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    assumeInstantIngestion: true
  };
  const itemInstant = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z',
    instantIngestion: true
  };

  assert.equal(resolveEvidenceAvailabilityTime(itemAssume).isAvailable, false);
  assert.equal(resolveEvidenceAvailabilityTime(itemAssume).classification, AVAILABILITY_CLASSIFICATION.UNSAFE_MISSING_SYSTEM_FIRST_SEEN);

  assert.equal(resolveEvidenceAvailabilityTime(itemInstant).isAvailable, false);
  assert.equal(resolveEvidenceAvailabilityTime(itemInstant).classification, AVAILABILITY_CLASSIFICATION.UNSAFE_MISSING_SYSTEM_FIRST_SEEN);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [itemAssume, itemInstant]
  });
  assert.equal(packet.observations.length, 0);
  assert.equal(packet.replayMetadata.excludedUnsafeTimestampCount, 2);
});

// 29. trusted caller option assumeInstantIngestion=true enables explicit internal contract
test('29. trusted caller option assumeInstantIngestion=true enables explicit internal contract', () => {
  const item = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T08:00:00.000Z'
  };

  const avail = resolveEvidenceAvailabilityTime(item, { assumeInstantIngestion: true });
  assert.equal(avail.isAvailable, true);
  assert.equal(avail.replaySafe, true);
  assert.equal(avail.availabilityTime, '2026-09-01T08:00:00.000Z');
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_ASSUMED_INSTANT_INGESTION);

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-05T00:00:00.000Z',
    observations: [item],
    assumeInstantIngestion: true
  });
  assert.equal(packet.observations.length, 1);
  assert.equal(packet.observations[0].factId, 'vn.macro.cpi.yoy');
});

// 30. publishedAt + valid firstSeenAt still obeys max(publishedAt, firstSeenAt)
test('30. publishedAt + valid firstSeenAt still obeys max(publishedAt, firstSeenAt)', () => {
  const obs = {
    factId: 'vn.macro.cpi.yoy',
    value: 4.89,
    publishedAt: '2026-09-01T09:00:00.000Z',
    firstSeenAt: '2026-09-01T11:00:00.000Z'
  };

  const avail = resolveEvidenceAvailabilityTime(obs, { assumeInstantIngestion: true });
  assert.equal(avail.availabilityTime, '2026-09-01T11:00:00.000Z');
  assert.equal(avail.classification, AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_FROM_SOURCE_AND_FIRST_SEEN);
});
