/**
 * Fact Model — Normalized observation schema for Vietnam Market Context Data Fabric.
 *
 * Hardened Invariants:
 * 1. Missing is never zero. Missing numerical values must be null.
 * 2. Every fact distinguishes:
 *    - factId: stable semantic meaning (e.g. vn.market.vnindex.close)
 *    - observationId: exact vintage/reference observation (e.g. vn.market.vnindex.close:2026-09-04)
 *    - sourceContentHash: deterministic SHA-256 hash of defining observation fields
 * 3. Exact unit semantics:
 *    - index_point vs percent vs percentage_point
 *    - quote direction (e.g. VND_PER_USD, CNY_PER_USD)
 * 4. Distinct timestamps:
 *    - referenceTime: session date / period (nullable, never fabricated)
 *    - observedAt: market / observation timestamp
 *    - publishedAt: official release publication timestamp
 *    - fetchedAt: ingestion timestamp
 */

import crypto from 'node:crypto';

export const PILLARS = Object.freeze({
  MACRO: 'macro',
  MONETARY: 'monetary',
  MARKET: 'market',
  INTERMARKET: 'intermarket'
});

export const OBSERVATION_STATUS = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale'
});

export const OBSERVATION_FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  DELAYED: 'delayed'
});

export const AUTHORITY_LEVELS = Object.freeze({
  PRIMARY_OFFICIAL: 'PRIMARY_OFFICIAL',       // e.g. NSO
  REGULATORY_OFFICIAL: 'REGULATORY_OFFICIAL', // e.g. SBV
  MARKET_DIRECT: 'MARKET_DIRECT',             // e.g. Twelve Data, VNDIRECT
  MARKET_REFERENCE: 'MARKET_REFERENCE'        // e.g. Yahoo Finance reference quote
});

export const UNIT_TYPES = Object.freeze({
  INDEX_POINT: 'index_point',
  PERCENT: 'percent',
  PERCENTAGE_POINT: 'percentage_point',
  CURRENCY_RATIO: 'currency_ratio',
  PRICE_USD: 'price_usd'
});

function finiteOrNull(val) {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export function validateIsoTimestamp(val, fieldName) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string' || !val.trim()) return null;
  const parsed = Date.parse(val.trim());
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid ISO timestamp provided for ${fieldName}: ${val}`);
  }
  return new Date(parsed).toISOString();
}

/**
 * Calculates a canonical deterministic SHA-256 hash of defining source fact fields.
 * Includes all materially relevant semantics:
 * - factId, value, unit, unitType, change, changeUnit, changeUnitType, changeBasis,
 *   changePercent, quoteDirection, volume, volumeUnit, referenceTime, sourceId,
 *   revisionMarker, methodologyVersion.
 * Distinguishes observations when corrected source content/values differ even with identical metadata.
 */
export function calculateSourceContentHash(payload = {}) {
  const content = {
    factId: payload.factId || payload.id || '',
    value: finiteOrNull(payload.value),
    unit: typeof payload.unit === 'string' ? payload.unit.trim() : '',
    unitType: payload.unitType || null,
    change: finiteOrNull(payload.change),
    changeUnit: typeof payload.changeUnit === 'string' ? payload.changeUnit.trim() : null,
    changeUnitType: payload.changeUnitType || null,
    changeBasis: payload.changeBasis || null,
    changePercent: finiteOrNull(payload.changePercent),
    quoteDirection: payload.quoteDirection || null,
    volume: finiteOrNull(payload.volume),
    volumeUnit: typeof payload.volumeUnit === 'string' ? payload.volumeUnit.trim() : null,
    referenceTime: payload.referenceTime || null,
    sourceId: payload.sourceId || payload.source || '',
    revisionMarker: payload.revisionMarker || payload.revision || null,
    methodologyVersion: payload.methodologyVersion || 'v1.2'
  };
  const canonicalJson = JSON.stringify(content, Object.keys(content).sort());
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Normalizes a reference period string to a canonical sort key for chronological comparison.
 * Handles:
 * - monthly periods: 'YYYY-MM' -> 'YYYY-MM-31T23:59:59.999Z'
 * - daily sessions: 'YYYY-MM-DD' -> 'YYYY-MM-DDT23:59:59.999Z'
 * - ISO timestamps: 'YYYY-MM-DDTHH:mm:ss.sssZ'
 */
export function normalizeReferencePeriodKey(ref) {
  if (!ref || typeof ref !== 'string') return '';
  const trimmed = ref.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split('-').map(Number);
    // Use last day of that month in UTC
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dayStr = String(lastDay).padStart(2, '0');
    return `${trimmed}-${dayStr}T23:59:59.999Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return trimmed;
}

/**
 * Deterministic comparator for ordering observation vintages.
 * Required logic:
 * 1. Choose latest valid reference period (newer period beats older period revised later).
 * 2. Within that reference period, choose latest valid revision/vintage.
 *
 * Sorts DESCENDING (returns negative if a is newer/preferred over b).
 */
export function compareObservationVintages(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  // Step 1: Compare reference period (newer reference period always wins)
  const refKeyA = normalizeReferencePeriodKey(a.referenceTime);
  const refKeyB = normalizeReferencePeriodKey(b.referenceTime);

  if (refKeyA && refKeyB && refKeyA !== refKeyB) {
    return refKeyB.localeCompare(refKeyA);
  }
  // If only one has reference period, the one with valid reference period takes precedence
  if (refKeyA && !refKeyB) return -1;
  if (!refKeyA && refKeyB) return 1;

  // Step 2: Within the same reference period (or when neither has one), choose latest revision/vintage
  const aPub = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bPub = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (aPub !== bPub) return bPub - aPub;

  const aObs = a.observedAt ? Date.parse(a.observedAt) : 0;
  const bObs = b.observedAt ? Date.parse(b.observedAt) : 0;
  if (aObs !== bObs) return bObs - aObs;

  const aRev = a.revisionMarker || '';
  const bRev = b.revisionMarker || '';
  if (aRev !== bRev) return bRev.localeCompare(aRev);

  const aFetch = a.fetchedAt ? Date.parse(a.fetchedAt) : 0;
  const bFetch = b.fetchedAt ? Date.parse(b.fetchedAt) : 0;
  if (aFetch !== bFetch) return bFetch - aFetch;

  const aCreated = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bCreated = b.createdAt ? Date.parse(b.createdAt) : 0;
  if (aCreated !== bCreated) return bCreated - aCreated;

  return (b.observationId || '').localeCompare(a.observationId || '');
}

/**
 * Deterministic selector: groups observations by factId and selects the single latest observation
 * per fact according to reference period and vintage precedence.
 */
export function selectLatestObservationPerFact(observations = []) {
  const latestByFact = new Map();
  for (const obs of Array.isArray(observations) ? observations : []) {
    if (!obs || !obs.factId) continue;
    const existing = latestByFact.get(obs.factId);
    if (!existing || compareObservationVintages(obs, existing) < 0) {
      latestByFact.set(obs.factId, obs);
    }
  }
  return Array.from(latestByFact.values());
}

/**
 * Generates an immutable, deterministic observation ID reflecting semantic fact, source vintage,
 * and canonical content hash.
 * Invariant: Identical content produces identical observationId; corrected content produces NEW observationId.
 */
export function buildObservationId({
  factId,
  referenceTime = null,
  publishedAt = null,
  observedAt = null,
  revision = null,
  contentHash = null,
  methodologyVersion = 'v1.2'
}) {
  const ref = referenceTime || 'undated';
  const vintageTokens = [];
  if (publishedAt) {
    vintageTokens.push(`pub_${publishedAt.replace(/[:.]/g, '')}`);
  } else if (observedAt) {
    vintageTokens.push(`obs_${observedAt.replace(/[:.]/g, '')}`);
  }
  if (revision) {
    vintageTokens.push(`rev_${revision}`);
  }
  if (contentHash) {
    vintageTokens.push(`h_${contentHash.slice(0, 12)}`);
  }
  const vintage = vintageTokens.length > 0 ? vintageTokens.join('_') : `m_${methodologyVersion}`;
  return `${factId}:${ref}:${vintage}`;
}

export function createMarketObservation({
  id,
  factId,
  observationId,
  pillar,
  label,
  metric,
  value = null,
  unit = '',
  unitType = null,
  change = null,
  changeUnit = null,
  changeUnitType = null,
  changePercent = null,
  changeBasis = null,
  previousValue = null,
  volume = null,
  volumeUnit = null,
  quoteDirection = null,
  referenceTime = null,
  observedAt = null,
  publishedAt = null,
  fetchedAt = new Date().toISOString(),
  source = '',
  authorityLevel = AUTHORITY_LEVELS.MARKET_REFERENCE,
  provenance = {},
  freshness = OBSERVATION_FRESHNESS.FRESH,
  status = OBSERVATION_STATUS.AVAILABLE,
  qualityStatus = 'available',
  statusReason = null,
  revisionMarker = null,
  sourceContentHash = null,
  methodologyVersion = 'v1.2'
}) {
  const resolvedFactId = factId || id;
  if (!resolvedFactId || typeof resolvedFactId !== 'string') {
    throw new TypeError('MarketObservation requires a valid string factId or id');
  }

  const validPillars = Object.values(PILLARS);
  if (!validPillars.includes(pillar)) {
    throw new TypeError(`MarketObservation pillar must be one of: ${validPillars.join(', ')}`);
  }

  const numValue = finiteOrNull(value);
  const numChange = finiteOrNull(change);
  const numChangePercent = finiteOrNull(changePercent);
  const numPrev = finiteOrNull(previousValue);
  const numVol = finiteOrNull(volume);

  const resolvedReferenceTime = typeof referenceTime === 'string' && referenceTime.trim() ? referenceTime.trim() : null;
  const validatedObservedAt = validateIsoTimestamp(observedAt, 'observedAt');
  const validatedPublishedAt = validateIsoTimestamp(publishedAt, 'publishedAt');
  const validatedFetchedAt = validateIsoTimestamp(fetchedAt, 'fetchedAt') || new Date().toISOString();

  const computedContentHash = sourceContentHash || calculateSourceContentHash({
    factId: resolvedFactId,
    value: numValue,
    unit,
    unitType,
    change: numChange,
    changeUnit,
    changeUnitType,
    changeBasis,
    changePercent: numChangePercent,
    quoteDirection,
    volume: numVol,
    volumeUnit,
    referenceTime: resolvedReferenceTime,
    sourceId: source,
    revisionMarker,
    methodologyVersion
  });

  const resolvedObsId = observationId || buildObservationId({
    factId: resolvedFactId,
    referenceTime: resolvedReferenceTime,
    publishedAt: validatedPublishedAt,
    observedAt: validatedObservedAt,
    revision: revisionMarker,
    contentHash: computedContentHash,
    methodologyVersion
  });

  // Auto-downgrade to unavailable if value is non-finite
  const resolvedStatus = (numValue === null && status === OBSERVATION_STATUS.AVAILABLE)
    ? OBSERVATION_STATUS.UNAVAILABLE
    : status;

  return Object.freeze({
    id: id || resolvedFactId,
    factId: resolvedFactId,
    observationId: resolvedObsId,
    pillar,
    label: typeof label === 'string' ? label : (metric || resolvedFactId),
    metric: typeof metric === 'string' ? metric : (label || resolvedFactId),
    value: numValue,
    unit: typeof unit === 'string' ? unit : '',
    unitType: unitType || null,
    change: numChange,
    changeUnit: typeof changeUnit === 'string' ? changeUnit : (unit || null),
    changeUnitType: changeUnitType || null,
    changePercent: numChangePercent,
    changeBasis: typeof changeBasis === 'string' ? changeBasis : null,
    previousValue: numPrev,
    volume: numVol,
    volumeUnit: typeof volumeUnit === 'string' ? volumeUnit : null,
    quoteDirection: typeof quoteDirection === 'string' ? quoteDirection : null,
    referenceTime: resolvedReferenceTime,
    observedAt: validatedObservedAt,
    publishedAt: validatedPublishedAt,
    fetchedAt: validatedFetchedAt,
    source: typeof source === 'string' ? source : '',
    authorityLevel: Object.values(AUTHORITY_LEVELS).includes(authorityLevel) ? authorityLevel : AUTHORITY_LEVELS.MARKET_REFERENCE,
    provenance: Object.freeze(provenance && typeof provenance === 'object' ? { ...provenance } : {}),
    freshness: Object.values(OBSERVATION_FRESHNESS).includes(freshness) ? freshness : OBSERVATION_FRESHNESS.FRESH,
    status: Object.values(OBSERVATION_STATUS).includes(resolvedStatus) ? resolvedStatus : OBSERVATION_STATUS.UNAVAILABLE,
    qualityStatus: typeof qualityStatus === 'string' ? qualityStatus : 'available',
    statusReason: typeof statusReason === 'string' ? statusReason : null,
    revisionMarker: typeof revisionMarker === 'string' ? revisionMarker : null,
    sourceContentHash: computedContentHash,
    methodologyVersion: typeof methodologyVersion === 'string' ? methodologyVersion : 'v1.2'
  });
}

export function createUnavailableObservation(
  id,
  pillar,
  label,
  reason,
  {
    factId = null,
    observationId = null,
    metric = null,
    source = '',
    unit = '',
    unitType = null,
    referenceTime = null,
    authorityLevel = AUTHORITY_LEVELS.MARKET_REFERENCE
  } = {}
) {
  const resolvedFactId = factId || id;
  return createMarketObservation({
    id,
    factId: resolvedFactId,
    observationId: observationId || (referenceTime ? `${resolvedFactId}:${referenceTime}:unavailable` : `${resolvedFactId}:unavailable`),
    pillar,
    label,
    metric: metric || label,
    value: null,
    unit,
    unitType,
    referenceTime,
    source,
    authorityLevel,
    status: OBSERVATION_STATUS.UNAVAILABLE,
    statusReason: reason,
    provenance: { reason }
  });
}
