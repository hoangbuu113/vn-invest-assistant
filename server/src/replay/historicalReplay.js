/**
 * Historical As-of Replay Foundation (01D.1)
 *
 * Implements deterministic point-in-time evidence reconstruction:
 * "What could THIS SYSTEM actually have known at time T?"
 *
 * Hardened Invariants:
 * 1. Definitive Replay Semantic:
 *    - Replay cutoff (asOf) evaluates system-knowable time:
 *      systemKnowableAt = max(sourceAvailableAt, systemFirstSeenAt).
 *    - systemKnowableAt can NEVER be earlier than systemFirstSeenAt.
 *    - Future evidence, later revisions, subsequent news corrections, and subsequent
 *      corroborations are strictly excluded.
 * 2. Immutable Observation Selection:
 *    - Vintages are grouped by (factId + referencePeriod) to preserve full historical
 *      cadence (e.g. July and August data both survive in historical observations).
 *    - Within each reference period, ordered using `compareObservationVintages`.
 *    - A separate `latestFactSnapshot` projection provides the latest single period per fact.
 * 3. News Version Selection:
 *    - Each news version is evaluated by its own versionAvailableAt / systemKnowableAt.
 *    - Corrections retain original article publishedAt, but are excluded before their
 *      actual version availability time.
 *    - versionId is strictly a tie-breaker, never an eligibility shortcut.
 * 4. As-of Claim Reconstruction:
 *    - Current `market_claims` database rows are NEVER used.
 *    - Claims are deterministically extracted and reconciled point-in-time from asOf evidence
 *      using the authoritative 01C claim reconciliation engine.
 *    - Custom claims must be replay-safe and <= asOf; cannot bypass cutoff.
 * 5. As-of Freshness:
 *    - Freshness is evaluated relative to `asOf`, NEVER `new Date()` or current server clock.
 * 6. Deterministic Fingerprint:
 *    - Generated strictly from asOf-eligible evidence (observations, news, signals, claims).
 *    - Input ordering does not alter the fingerprint.
 *    - Future evidence added later cannot change earlier fingerprints.
 * 7. Security:
 *    - Zero private portfolio or user data allowed in replay inputs.
 *    - No external LLM (Gemini/OpenAI) or network provider calls.
 */

import {
  resolveEvidenceAvailabilityTime,
  AVAILABILITY_CLASSIFICATION,
  isReplaySafeAvailability
} from './availability.js';
import {
  compareObservationVintages,
  normalizeReferencePeriodKey,
  selectLatestObservationPerFact
} from '../context/factModel.js';
import { applyRuntimeFreshness } from '../context/freshnessPolicy.js';
import { deriveTradeBalance } from '../context/providers/customsTrade.js';
import { applyNewsFreshness } from '../news/repository.js';
import { deriveMarketSignals } from '../ai/derivedSignals.js';
import {
  extractClaimsFromObservation,
  extractClaimsFromArticle
} from '../claims/claimExtractor.js';
import { reconcileClaims } from '../claims/claimReconciliation.js';
import {
  createMarketClaim,
  CLAIM_STATUS,
  CLAIM_TYPES,
  CLAIM_AUTHORITY_LEVELS
} from '../claims/claimModel.js';
import {
  computeStrategistFingerprint,
  computeEvidenceDataAsOf
} from '../ai/marketStrategistEngine.js';

export const REPLAY_POLICY_VERSION = '01D-v1';

/**
 * Validates that no private user or portfolio data has leaked into replay inputs.
 */
function assertNoPrivateData(items = [], label = 'evidence') {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (
      'portfolio' in item ||
      'holdings' in item ||
      'cash' in item ||
      'transactions' in item ||
      'userId' in item ||
      'user_id' in item ||
      'email' in item
    ) {
      const err = new Error(
        `FORBIDDEN_USER_DATA_IN_REPLAY_INPUT: Private user/portfolio data is strictly prohibited in historical replay (${label})`
      );
      err.code = 'FORBIDDEN_USER_DATA';
      throw err;
    }
  }
}

/**
 * Builds a deterministic point-in-time evidence packet representing exactly
 * what VN Invest Assistant could have known at `asOf`.
 *
 * @param {object} params
 * @param {string|Date} params.asOf - The point-in-time cutoff timestamp (required).
 * @param {Array<object>} [params.observations=[]] - Candidate market observation vintages.
 * @param {Array<object>} [params.newsArticles=[]] - Candidate news articles and versions.
 * @param {Array<object>} [params.customClaims=[]] - Optional pre-existing candidate claims.
 * @param {Array<object>} [params.claimEvidenceLinks=[]] - Optional historical evidence links.
 * @param {boolean} [params.includeDerived=true] - Whether to compute derived facts and signals.
 * @param {string} [params.policyVersion=REPLAY_POLICY_VERSION] - Policy version string.
 * @param {boolean} [params.assumeInstantIngestion=false] - Optional explicit trusted ingestion flag.
 * @returns {object} The reconstructed point-in-time historical evidence packet.
 */
export function buildHistoricalEvidencePacket({
  asOf,
  observations = [],
  newsArticles = [],
  customClaims = [],
  claimEvidenceLinks = [],
  includeDerived = true,
  policyVersion = REPLAY_POLICY_VERSION,
  assumeInstantIngestion = false
} = {}) {
  // 1. Strict asOf validation
  if (!asOf) {
    const err = new TypeError('INVALID_AS_OF: asOf parameter is required for historical replay');
    err.code = 'INVALID_AS_OF';
    throw err;
  }

  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const asOfMs = asOfDate.getTime();
  if (!Number.isFinite(asOfMs)) {
    const err = new TypeError(`INVALID_AS_OF: Unable to parse asOf timestamp: ${asOf}`);
    err.code = 'INVALID_AS_OF';
    throw err;
  }
  const normalizedAsOf = asOfDate.toISOString();

  // 2. Private data security guard
  assertNoPrivateData(observations, 'observations');
  assertNoPrivateData(newsArticles, 'newsArticles');
  assertNoPrivateData(customClaims, 'customClaims');

  const limitations = [];
  let excludedFutureObsCount = 0;
  let excludedFutureNewsCount = 0;
  let excludedFutureClaimsCount = 0;
  let excludedBeforeSystemFirstSeenObsCount = 0;
  let excludedBeforeSystemFirstSeenNewsCount = 0;
  let backfilledObsExcludedCount = 0;
  let excludedUnsafeObsCount = 0;
  let excludedUnsafeNewsCount = 0;
  let excludedUnsafeClaimsCount = 0;
  let excludedUnsafeVersionCount = 0;

  // 3. Observation Point-in-Time Selection
  // Group by (factId + referencePeriod) to preserve full multi-period evidence history.
  const candidateObs = Array.isArray(observations) ? observations : [];
  const eligibleObsByGroup = new Map();

  for (const obs of candidateObs) {
    if (!obs || typeof obs !== 'object') continue;

    const avail = resolveEvidenceAvailabilityTime(obs, { assumeInstantIngestion });
    if (!avail.replaySafe || avail.availabilityTimestampMs === null) {
      excludedUnsafeObsCount++;
      limitations.push(
        `Observation ${obs.observationId || obs.factId || 'unknown'} excluded: lacks trustworthy availability timestamp (${avail.classification || 'UNSAFE'}).`
      );
      continue;
    }

    if (avail.availabilityTimestampMs > asOfMs) {
      excludedFutureObsCount++;
      if (
        avail.sourceAvailableAt &&
        Date.parse(avail.sourceAvailableAt) <= asOfMs &&
        avail.systemFirstSeenAt &&
        Date.parse(avail.systemFirstSeenAt) > asOfMs
      ) {
        excludedBeforeSystemFirstSeenObsCount++;
        // If source published over 30 days prior to system first-seen, count as backfilled
        if (Date.parse(avail.systemFirstSeenAt) - Date.parse(avail.sourceAvailableAt) > 30 * 24 * 3600 * 1000) {
          backfilledObsExcludedCount++;
        }
      }
      continue;
    }

    const factId = obs.factId ? obs.factId : (obs.evidenceId || obs.id || obs.subject);
    if (!factId) continue;

    const normRef = normalizeReferencePeriodKey(obs.referenceTime) || (obs.referenceTime ? obs.referenceTime.trim() : 'point');
    const groupKey = `${factId}:${normRef}`;

    if (!eligibleObsByGroup.has(groupKey)) {
      eligibleObsByGroup.set(groupKey, []);
    }
    eligibleObsByGroup.get(groupKey).push({ obs, avail });
  }

  // Select single best vintage per (factId, referencePeriod) group
  const asOfObservations = [];
  for (const [, items] of eligibleObsByGroup.entries()) {
    items.sort((a, b) => compareObservationVintages(a.obs, b.obs));
    const winningObs = items[0].obs;
    // Apply runtime freshness relative to asOfDate (NEVER wall-clock time)
    const freshObs = applyRuntimeFreshness(winningObs, asOfDate);
    asOfObservations.push(freshObs);
  }

  // Sort observations deterministically
  asOfObservations.sort((a, b) => {
    const idA = a.observationId || a.factId || '';
    const idB = b.observationId || b.factId || '';
    return idA.localeCompare(idB);
  });

  // 4. Derived Facts (Merchandise Trade Balance) Point-in-Time
  // Matches exports and imports for each period present in historical observations.
  if (includeDerived) {
    const distinctRefTimes = new Set(
      asOfObservations
        .filter((o) => o.factId === 'vn.trade.goods.exports.month_usd' && o.referenceTime)
        .map((o) => o.referenceTime)
    );

    // Also include null/undated if any
    if (asOfObservations.some((o) => o.factId === 'vn.trade.goods.exports.month_usd' && !o.referenceTime)) {
      distinctRefTimes.add(null);
    }

    for (const ref of distinctRefTimes) {
      const exportsObs = asOfObservations.find(
        (o) => o.factId === 'vn.trade.goods.exports.month_usd' && (o.referenceTime || null) === ref
      );
      const importsObs = asOfObservations.find(
        (o) => o.factId === 'vn.trade.goods.imports.month_usd' && (o.referenceTime || null) === ref
      );

      if (exportsObs && importsObs) {
        const derivedBalance = deriveTradeBalance(exportsObs, importsObs, { now: asOfDate });
        const existingIdx = asOfObservations.findIndex(
          (o) => o.factId === 'vn.trade.goods.balance.month_usd' && (o.referenceTime || null) === ref
        );
        if (existingIdx < 0) {
          asOfObservations.push(derivedBalance);
        }
      }
    }

    asOfObservations.sort((a, b) => {
      const idA = a.observationId || a.factId || '';
      const idB = b.observationId || b.factId || '';
      return idA.localeCompare(idB);
    });
  }

  // Projection: Single latest observation per fact (for current-state consumers)
  const latestFactSnapshot = selectLatestObservationPerFact(asOfObservations);
  latestFactSnapshot.sort((a, b) => (a.factId || '').localeCompare(b.factId || ''));

  // 5. News Article Point-in-Time Selection
  const candidateNews = Array.isArray(newsArticles) ? newsArticles : [];
  const eligibleNewsByArticle = new Map();

  for (const art of candidateNews) {
    if (!art || typeof art !== 'object') continue;

    const avail = resolveEvidenceAvailabilityTime(art, { assumeInstantIngestion });
    if (!avail.replaySafe || avail.availabilityTimestampMs === null) {
      excludedUnsafeNewsCount++;
      if (avail.classification === AVAILABILITY_CLASSIFICATION.UNSAFE_UNTRUSTWORTHY_VERSION_TIME) {
        excludedUnsafeVersionCount++;
      }
      limitations.push(
        `News article ${art.articleId || art.url || 'unknown'} excluded: lacks trustworthy availability timestamp (${avail.classification || 'UNSAFE'}).`
      );
      continue;
    }

    if (avail.availabilityTimestampMs > asOfMs) {
      excludedFutureNewsCount++;
      if (
        avail.sourceAvailableAt &&
        Date.parse(avail.sourceAvailableAt) <= asOfMs &&
        avail.systemFirstSeenAt &&
        Date.parse(avail.systemFirstSeenAt) > asOfMs
      ) {
        excludedBeforeSystemFirstSeenNewsCount++;
      }
      continue;
    }

    const artKey = art.articleId || art.id || art.url || art.evidenceId;
    if (!artKey) continue;

    if (!eligibleNewsByArticle.has(artKey)) {
      eligibleNewsByArticle.set(artKey, []);
    }
    eligibleNewsByArticle.get(artKey).push({ art, avail });
  }

  // Select latest eligible version deterministically by version availability time
  const asOfNews = [];
  for (const [, items] of eligibleNewsByArticle.entries()) {
    items.sort((a, b) => {
      // 1. Latest knowable version availability time wins
      if (b.avail.availabilityTimestampMs !== a.avail.availabilityTimestampMs) {
        return b.avail.availabilityTimestampMs - a.avail.availabilityTimestampMs;
      }
      // 2. VersionId tie-breaker (only when availability times are identical)
      return (b.art.versionId || '').localeCompare(a.art.versionId || '');
    });

    const winningItem = items[0];
    const winningArticle = {
      ...winningItem.art,
      articlePublishedAt: winningItem.avail.articlePublishedAt || winningItem.avail.sourceAvailableAt,
      versionAvailableAt: winningItem.avail.versionAvailableAt || winningItem.avail.availabilityTime
    };

    // Apply news freshness relative to asOfDate
    const freshArticle = applyNewsFreshness(winningArticle, asOfDate);
    asOfNews.push(freshArticle);
  }

  // Sort news deterministically by articleId
  asOfNews.sort((a, b) => (a.articleId || a.id || '').localeCompare(b.articleId || b.id || ''));

  // 6. Derived Signals Point-in-Time Recomputation
  let asOfSignals = [];
  if (includeDerived) {
    asOfSignals = deriveMarketSignals({
      observations: asOfObservations,
      now: asOfDate
    });
    asOfSignals.sort((a, b) => (a.signalId || '').localeCompare(b.signalId || ''));
  }

  // 7. Claim Reconstruction Point-in-Time
  // CRITICAL: Reconstruct claims purely from asOf-eligible evidence.
  // Never read current market_claims database/memory status!
  const candidateClaims = [];
  const eligibleEvidenceItems = [];

  // A. Evidence and claims from eligible observations
  for (const obs of asOfObservations) {
    eligibleEvidenceItems.push({
      ...obs,
      evidenceId: obs.evidenceId || obs.observationId || obs.id,
      subject: obs.subject || obs.factId,
      referencePeriod: obs.referencePeriod || obs.referenceTime,
      numericValue: obs.numericValue ?? obs.value ?? null
    });

    const extracted = extractClaimsFromObservation(obs);
    for (const item of extracted) {
      candidateClaims.push(item.claim);
    }

    // Also register candidate claim directly if observation defines explicit subject and value
    if (obs.subject && (obs.numericValue !== undefined || obs.value !== undefined || obs.valueText)) {
      candidateClaims.push(
        createMarketClaim({
          claimType:
            obs.claimType ||
            (typeof (obs.numericValue ?? obs.value) === 'number'
              ? CLAIM_TYPES.MACRO_NUMERIC
              : CLAIM_TYPES.FACT_OBSERVATION),
          subject: obs.subject,
          predicate: obs.predicate || 'EQUALS',
          numericValue: obs.numericValue ?? (typeof obs.value === 'number' ? obs.value : null),
          valueText: obs.valueText || null,
          unit: obs.unit || null,
          referencePeriod: obs.referencePeriod || obs.referenceTime || null,
          scope: obs.scope || null,
          authorityLevel: obs.authorityLevel || CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
          publishedAt: obs.publishedAt || null
        })
      );
    }
  }

  // B. Evidence and claims from eligible news
  for (const art of asOfNews) {
    eligibleEvidenceItems.push({
      ...art,
      evidenceId: art.evidenceId || art.versionId || art.articleId || art.id,
      subject: art.subject,
      referencePeriod: art.referencePeriod,
      numericValue: art.numericValue ?? (typeof art.value === 'number' ? art.value : null)
    });

    const extracted = extractClaimsFromArticle(art);
    for (const item of extracted) {
      candidateClaims.push(item.claim);
    }

    // Also register candidate claim directly if article defines explicit subject and value
    if (art.subject && (art.numericValue !== undefined || art.value !== undefined || art.valueText)) {
      candidateClaims.push(
        createMarketClaim({
          claimType:
            art.claimType ||
            (typeof (art.numericValue ?? art.value) === 'number'
              ? CLAIM_TYPES.MACRO_NUMERIC
              : CLAIM_TYPES.NEWS_ASSERTION),
          subject: art.subject,
          predicate: art.predicate || 'EQUALS',
          numericValue: art.numericValue ?? (typeof art.value === 'number' ? art.value : null),
          valueText: art.valueText || null,
          unit: art.unit || null,
          referencePeriod: art.referencePeriod || null,
          scope: art.scope || null,
          authorityLevel: art.sourceAuthority || art.authorityLevel || CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
          publishedAt: art.publishedAt || null
        })
      );
    }
  }

  // C. Optional custom claims knowable at asOf (must be replay-safe)
  if (Array.isArray(customClaims) && customClaims.length > 0) {
    for (const claim of customClaims) {
      if (!claim || typeof claim !== 'object') continue;
      const avail = resolveEvidenceAvailabilityTime(claim, { assumeInstantIngestion });
      if (!avail.replaySafe || avail.availabilityTimestampMs === null) {
        excludedUnsafeClaimsCount++;
        limitations.push(
          `Custom claim ${claim.claimId || 'unknown'} excluded: lacks trustworthy availability timestamp (${avail.classification || 'UNSAFE'}).`
        );
        continue;
      }
      if (avail.availabilityTimestampMs > asOfMs) {
        excludedFutureClaimsCount++;
        continue; // Future claim excluded
      }
      candidateClaims.push(claim);
    }
  }

  // Deduplicate candidate claims by claimId
  const uniqueClaimsMap = new Map();
  for (const c of candidateClaims) {
    if (!c || !c.claimId) continue;
    if (!uniqueClaimsMap.has(c.claimId)) {
      uniqueClaimsMap.set(c.claimId, c);
    }
  }
  const dedupClaims = Array.from(uniqueClaimsMap.values());

  // Filter claimEvidenceLinks if provided: only include links created <= asOf
  const asOfLinks = [];
  if (Array.isArray(claimEvidenceLinks)) {
    for (const link of claimEvidenceLinks) {
      if (!link) continue;
      const linkCreatedAt = link.createdAt || link.created_at;
      if (linkCreatedAt) {
        const ms = Date.parse(linkCreatedAt);
        if (Number.isFinite(ms) && ms > asOfMs) {
          continue;
        }
      }
      asOfLinks.push(link);
    }
  }

  // Reconcile claims point-in-time using authoritative 01C engine
  const reconciled = reconcileClaims(dedupClaims, eligibleEvidenceItems);
  const reconstructedClaims = reconciled.map((r) => r.claim);
  reconstructedClaims.sort((a, b) => (a.claimId || '').localeCompare(b.claimId || ''));

  // 8. Compute dataAsOf
  const dataAsOf = computeEvidenceDataAsOf({
    evidence: asOfObservations,
    untrustedNews: asOfNews,
    now: asOfDate
  });

  // 9. Compute Deterministic SHA-256 Fingerprint
  const evidenceFingerprint = computeStrategistFingerprint({
    evidence: asOfObservations,
    untrustedNews: asOfNews,
    derivedSignals: asOfSignals,
    claims: reconstructedClaims,
    selectionPolicyVersion: policyVersion
  });

  // 10. Assemble Replay Metadata
  const totalIncluded = asOfObservations.length + asOfNews.length;
  const totalExcludedFuture = excludedFutureObsCount + excludedFutureNewsCount + excludedFutureClaimsCount;
  const totalExcludedUnsafe = excludedUnsafeObsCount + excludedUnsafeNewsCount + excludedUnsafeClaimsCount;
  const totalExcludedBeforeSystemFirstSeen =
    excludedBeforeSystemFirstSeenObsCount + excludedBeforeSystemFirstSeenNewsCount;

  const replayMetadata = Object.freeze({
    asOf: normalizedAsOf,
    dataAsOf,
    policyVersion,
    includedEvidenceCount: totalIncluded,
    includedObservationsCount: asOfObservations.length,
    includedNewsCount: asOfNews.length,
    reconstructedClaimsCount: reconstructedClaims.length,
    derivedSignalsCount: asOfSignals.length,
    excludedFutureEvidenceCount: totalExcludedFuture,
    excludedBeforeSystemFirstSeenCount: totalExcludedBeforeSystemFirstSeen,
    backfilledEvidenceExcludedCount: backfilledObsExcludedCount,
    excludedUnsafeTimestampCount: totalExcludedUnsafe,
    excludedUnsafeVersionCount,
    limitations: Object.freeze([...limitations])
  });

  return Object.freeze({
    asOf: normalizedAsOf,
    dataAsOf,
    policyVersion,
    observations: asOfObservations,
    historicalObservations: asOfObservations,
    latestFactSnapshot,
    news: asOfNews,
    claims: reconstructedClaims,
    derivedSignals: asOfSignals,
    evidenceFingerprint,
    freshness: {
      observationsFreshness: asOfObservations.map((o) => ({
        factId: o.factId,
        observationId: o.observationId,
        freshness: o.freshness,
        status: o.status
      })),
      newsFreshness: asOfNews.map((n) => ({
        articleId: n.articleId,
        versionId: n.versionId,
        freshness: n.freshness,
        status: n.status
      }))
    },
    limitations: Object.freeze([...limitations]),
    replayMetadata
  });
}
