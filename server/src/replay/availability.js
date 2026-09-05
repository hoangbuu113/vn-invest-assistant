/**
 * Availability Contract — Point-in-Time Evidence Availability Resolution
 *
 * Part of V1.3 Improvement 01D: Historical As-of Replay Foundation.
 *
 * Hardened Invariants:
 * 1. Single Availability Contract: Centralizes all availability resolution for observations,
 *    news articles, and claims. Never scatter availability logic across domains.
 * 2. Strict Priority Hierarchy:
 *    - Priority 1: Authoritative release/publication timestamp (publishedAt / releasedAt).
 *    - Priority 2: Trustworthy system-observed / ingested timestamp (observedAt / firstSeenAt / fetchedAt).
 *    - Priority 3: Otherwise UNSAFE_FOR_REPLAY.
 * 3. Never Synthesize Timestamps:
 *    - Never infer publication time from URL folder dates (e.g. /2026/09/03/ in URL).
 *    - Never confuse economic reference period (e.g. '2026-08') with publication date.
 *    - Never fall back to current wall-clock time (new Date()) or midnight guesses.
 *    - Missing timestamp != reference period != current fetchedAt.
 */

export const AVAILABILITY_CLASSIFICATION = Object.freeze({
  AUTHORITATIVE_PUBLICATION_TIME: 'AUTHORITATIVE_PUBLICATION_TIME',
  SYSTEM_FIRST_SEEN_TIME: 'SYSTEM_FIRST_SEEN_TIME',
  UNSAFE_FOR_REPLAY: 'UNSAFE_FOR_REPLAY'
});

const AUTHORITATIVE_PUBLICATION_FIELDS = Object.freeze([
  'publishedAt',
  'releasedAt',
  'published_at',
  'publishedTime',
  'publicationTime',
  'releaseTime'
]);

const SYSTEM_FIRST_SEEN_FIELDS = Object.freeze([
  'observedAt',
  'observed_at',
  'firstSeenAt',
  'first_seen_at',
  'fetchedAt',
  'fetched_at'
]);

/**
 * Checks if a string represents an economic cadence or reference period
 * rather than an exact point-in-time timestamp.
 * Examples of periods that must NEVER be used as timestamps:
 * - '2026' (annual)
 * - '2026-08' (monthly)
 * - '2026-Q3' (quarterly)
 */
function isReferencePeriodString(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return /^\d{4}$/.test(trimmed) ||
         /^\d{4}-\d{2}$/.test(trimmed) ||
         /^\d{4}-Q[1-4]$/i.test(trimmed);
}

/**
 * Safely parses and validates a timestamp candidate.
 * Returns { valid: true, iso: string, ms: number } or { valid: false }.
 */
function parseTimestampSafely(val) {
  if (val === null || val === undefined || typeof val === 'boolean') {
    return { valid: false };
  }

  if (val instanceof Date) {
    const ms = val.getTime();
    if (Number.isFinite(ms)) {
      return { valid: true, iso: val.toISOString(), ms };
    }
    return { valid: false };
  }

  if (typeof val === 'number') {
    if (Number.isFinite(val) && val > 0) {
      const d = new Date(val);
      const ms = d.getTime();
      if (Number.isFinite(ms)) {
        return { valid: true, iso: d.toISOString(), ms };
      }
    }
    return { valid: false };
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return { valid: false };

    // Explicit rejection of coarse reference period formats
    if (isReferencePeriodString(trimmed)) {
      return { valid: false, reason: 'COARSE_REFERENCE_PERIOD_NOT_A_TIMESTAMP' };
    }

    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) {
      return { valid: true, iso: new Date(ms).toISOString(), ms };
    }
    return { valid: false };
  }

  return { valid: false };
}

/**
 * Resolves the deterministic point-in-time availability time for an evidence item.
 *
 * @param {object} evidenceItem - Observation, news article, claim, or raw evidence payload.
 * @param {object} [options]
 * @param {boolean} [options.allowFirstSeen=true] - Whether to allow system first-seen timestamps when publication time is absent.
 * @returns {object} { isAvailable: boolean, availabilityTime: string|null, availabilityTimestampMs: number|null, classification: string, sourceField: string|null, reason?: string }
 */
export function resolveEvidenceAvailabilityTime(evidenceItem, { allowFirstSeen = true } = {}) {
  if (!evidenceItem || typeof evidenceItem !== 'object') {
    return Object.freeze({
      isAvailable: false,
      availabilityTime: null,
      availabilityTimestampMs: null,
      classification: AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY,
      sourceField: null,
      reason: 'NULL_OR_INVALID_EVIDENCE'
    });
  }

  // Priority 1: Authoritative release/publication timestamp
  for (const field of AUTHORITATIVE_PUBLICATION_FIELDS) {
    if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
      const parsed = parseTimestampSafely(evidenceItem[field]);
      if (parsed.valid) {
        return Object.freeze({
          isAvailable: true,
          availabilityTime: parsed.iso,
          availabilityTimestampMs: parsed.ms,
          classification: AVAILABILITY_CLASSIFICATION.AUTHORITATIVE_PUBLICATION_TIME,
          sourceField: field
        });
      }
    }
  }

  // Priority 2: Trustworthy system-observed / ingested timestamp
  if (allowFirstSeen) {
    for (const field of SYSTEM_FIRST_SEEN_FIELDS) {
      if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
        const parsed = parseTimestampSafely(evidenceItem[field]);
        if (parsed.valid) {
          return Object.freeze({
            isAvailable: true,
            availabilityTime: parsed.iso,
            availabilityTimestampMs: parsed.ms,
            classification: AVAILABILITY_CLASSIFICATION.SYSTEM_FIRST_SEEN_TIME,
            sourceField: field
          });
        }
      }
    }
  }

  // Priority 3: Otherwise evidence is NOT replay-safe
  return Object.freeze({
    isAvailable: false,
    availabilityTime: null,
    availabilityTimestampMs: null,
    classification: AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY,
    sourceField: null,
    reason: 'MISSING_TRUSTWORTHY_AVAILABILITY_TIMESTAMP'
  });
}
