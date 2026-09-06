/**
 * Availability Contract — Point-in-Time Evidence Availability Resolution
 *
 * Part of V1.3 Improvement 01D.1: System-Knowable Replay Timestamp Corrections.
 *
 * Hardened Invariants:
 * 1. Definitive Replay Semantic:
 *    Answers "What could THIS SYSTEM actually have known at time T?",
 *    NOT "What had already been published somewhere in the world at time T?".
 * 2. Independent Resolution:
 *    sourceAvailableAt and systemFirstSeenAt are resolved independently.
 * 3. System First-Seen as Hard Lower Bound:
 *    systemKnowableAt can NEVER be earlier than systemFirstSeenAt.
 *    systemKnowableAt = max(sourceAvailableAt, systemFirstSeenAt) when both are trustworthy.
 * 4. Published-Only Evidence:
 *    publishedAt alone does NOT prove that our system knew the item at that time.
 *    Without trustworthy systemFirstSeen (or explicit trustInstantIngestion flag),
 *    the item is UNSAFE_MISSING_SYSTEM_FIRST_SEEN and excluded from replay.
 * 5. News Version Integrity:
 *    Every news version must have its own trustworthy version availability time.
 *    Corrections/updates retain original article publishedAt, but must be evaluated
 *    by versionAvailableAt / systemKnowableAt, never original articlePublishedAt.
 * 6. Never Synthesize Timestamps:
 *    No URL parsing, no reference period parsing as timestamps, no wall-clock fallback.
 */

export const AVAILABILITY_CLASSIFICATION = Object.freeze({
  SYSTEM_KNOWABLE_FROM_SOURCE_AND_FIRST_SEEN: 'SYSTEM_KNOWABLE_FROM_SOURCE_AND_FIRST_SEEN',
  SYSTEM_KNOWABLE_FROM_FIRST_SEEN: 'SYSTEM_KNOWABLE_FROM_FIRST_SEEN',
  SYSTEM_KNOWABLE_ASSUMED_INSTANT_INGESTION: 'SYSTEM_KNOWABLE_ASSUMED_INSTANT_INGESTION',
  UNSAFE_MISSING_SYSTEM_FIRST_SEEN: 'UNSAFE_MISSING_SYSTEM_FIRST_SEEN',
  UNSAFE_INVALID_TIMESTAMP: 'UNSAFE_INVALID_TIMESTAMP',
  UNSAFE_UNTRUSTWORTHY_VERSION_TIME: 'UNSAFE_UNTRUSTWORTHY_VERSION_TIME',
  UNSAFE_FOR_REPLAY: 'UNSAFE_FOR_REPLAY'
});

const VERSION_SOURCE_PUBLICATION_FIELDS = Object.freeze([
  'versionPublishedAt',
  'version_published_at',
  'correctedAt',
  'corrected_at',
  'sourceUpdatedAt',
  'source_updated_at'
]);

const EXPLICIT_SOURCE_AVAILABILITY_FIELDS = Object.freeze([
  'sourceAvailableAt',
  'source_available_at'
]);

const GENERAL_SOURCE_PUBLICATION_FIELDS = Object.freeze([
  'publishedAt',
  'releasedAt',
  'published_at',
  'publishedTime',
  'publicationTime',
  'releaseTime'
]);

const VERSION_SYSTEM_FIRST_SEEN_FIELDS = Object.freeze([
  'versionFirstSeenAt',
  'version_first_seen_at',
  'versionObservedAt',
  'version_observed_at'
]);

const GENERAL_SYSTEM_FIRST_SEEN_FIELDS = Object.freeze([
  'firstSeenAt',
  'first_seen_at',
  'observedAt',
  'observed_at',
  'initialFetchedAt',
  'initial_fetched_at'
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
 * Checks if an item is a news article revision/correction/subsequent version.
 */
function isVersionedCorrection(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isCorrection === true || item.isUpdate === true || item.isRevisedVersion === true) return true;
  if (typeof item.versionNumber === 'number' && item.versionNumber > 1) return true;
  if (typeof item.versionId === 'string' && item.articleId && item.versionId !== item.articleId) {
    if (!item.versionId.endsWith(':v1') && !item.versionId.endsWith(':v_1') && !item.versionId.includes('v1_')) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the deterministic point-in-time availability time for an evidence item.
 *
 * Enforces the core invariant:
 * systemKnowableAt = max(sourceAvailableAt, systemFirstSeenAt)
 * systemKnowableAt can NEVER be earlier than systemFirstSeenAt.
 *
 * @param {object} evidenceItem - Observation, news article, claim, or raw evidence payload.
 * @param {object} [options]
 * @param {boolean} [options.allowFirstSeenOnly=true] - Whether to allow system first-seen alone.
 * @param {boolean} [options.assumeInstantIngestion=false] - If true, treats sourceAvailableAt as systemFirstSeenAt when missing.
 * @returns {object} Replay availability descriptor.
 */
export function resolveEvidenceAvailabilityTime(evidenceItem, {
  allowFirstSeenOnly = true,
  assumeInstantIngestion = false
} = {}) {
  if (!evidenceItem || typeof evidenceItem !== 'object') {
    return Object.freeze({
      isAvailable: false,
      replaySafe: false,
      sourceAvailableAt: null,
      systemFirstSeenAt: null,
      availabilityTime: null,
      availabilityTimestampMs: null,
      classification: AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY,
      sourceField: null,
      systemField: null,
      reason: 'NULL_OR_INVALID_EVIDENCE'
    });
  }

  // Instant ingestion must be controlled ONLY by trusted caller configuration, never by payload fields
  const instantIngestion = assumeInstantIngestion === true;

  const isCorrection = isVersionedCorrection(evidenceItem);

  // 1. Resolve source available timestamp
  let parsedSource = null;
  let sourceField = null;
  let hasInvalidSourceTimestamp = false;
  let hasExplicitSourceAvailabilityCandidate = false;

  // Check version-specific source publication fields first
  for (const field of VERSION_SOURCE_PUBLICATION_FIELDS) {
    if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
      const parsed = parseTimestampSafely(evidenceItem[field]);
      if (parsed.valid) {
        parsedSource = parsed;
        sourceField = field;
        break;
      } else {
        hasInvalidSourceTimestamp = true;
      }
    }
  }

  // Prefer an explicit canonical source-availability timestamp over the
  // publication timestamp. This lets trusted normalized evidence (including
  // VN equity vintages) preserve a later source-availability boundary without
  // trusting its stored/derived systemKnowableAt value.
  if (!parsedSource) {
    for (const field of EXPLICIT_SOURCE_AVAILABILITY_FIELDS) {
      if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
        hasExplicitSourceAvailabilityCandidate = true;
        const parsed = parseTimestampSafely(evidenceItem[field]);
        if (parsed.valid) {
          parsedSource = parsed;
          sourceField = field;
          break;
        } else {
          hasInvalidSourceTimestamp = true;
        }
      }
    }
  }

  // Fall back to general source publication fields only when no explicit
  // source-availability timestamp was resolved.
  let articlePublishedAt = null;
  if (!parsedSource && !hasExplicitSourceAvailabilityCandidate) {
    for (const field of GENERAL_SOURCE_PUBLICATION_FIELDS) {
      if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
        const parsed = parseTimestampSafely(evidenceItem[field]);
        if (parsed.valid) {
          parsedSource = parsed;
          sourceField = field;
          articlePublishedAt = parsed.iso;
          break;
        } else {
          hasInvalidSourceTimestamp = true;
        }
      }
    }
  } else {
    // Preserve the original publication timestamp separately when a more
    // authoritative version/source-availability timestamp was selected.
    for (const field of GENERAL_SOURCE_PUBLICATION_FIELDS) {
      if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
        const parsed = parseTimestampSafely(evidenceItem[field]);
        if (parsed.valid) {
          articlePublishedAt = parsed.iso;
          break;
        }
      }
    }
  }

  // 2. Resolve system first-seen timestamp
  let parsedSystem = null;
  let systemField = null;
  let hasInvalidSystemTimestamp = false;

  // Check version-specific first-seen fields first
  for (const field of VERSION_SYSTEM_FIRST_SEEN_FIELDS) {
    if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
      const parsed = parseTimestampSafely(evidenceItem[field]);
      if (parsed.valid) {
        parsedSystem = parsed;
        systemField = field;
        break;
      } else {
        hasInvalidSystemTimestamp = true;
      }
    }
  }

  // Fall back to general system first-seen fields
  if (!parsedSystem) {
    for (const field of GENERAL_SYSTEM_FIRST_SEEN_FIELDS) {
      if (field in evidenceItem && evidenceItem[field] !== undefined && evidenceItem[field] !== null) {
        const parsed = parseTimestampSafely(evidenceItem[field]);
        if (parsed.valid) {
          parsedSystem = parsed;
          systemField = field;
          break;
        } else {
          hasInvalidSystemTimestamp = true;
        }
      }
    }
  }

  // If timestamp candidate was present but unparseable
  if ((hasInvalidSourceTimestamp && !parsedSource) || (hasInvalidSystemTimestamp && !parsedSystem)) {
    return Object.freeze({
      isAvailable: false,
      replaySafe: false,
      sourceAvailableAt: null,
      systemFirstSeenAt: null,
      availabilityTime: null,
      availabilityTimestampMs: null,
      articlePublishedAt: null,
      versionAvailableAt: null,
      classification: AVAILABILITY_CLASSIFICATION.UNSAFE_INVALID_TIMESTAMP,
      sourceField,
      systemField,
      reason: 'INVALID_OR_COARSE_TIMESTAMP'
    });
  }

  // 3. Handle versioned news corrections without trustworthy version time
  if (isCorrection) {
    const hasVersionSpecificTime = Boolean(
      (sourceField && VERSION_SOURCE_PUBLICATION_FIELDS.includes(sourceField)) ||
      (systemField && VERSION_SYSTEM_FIRST_SEEN_FIELDS.includes(systemField)) ||
      evidenceItem.versionFirstSeenAt ||
      evidenceItem.versionPublishedAt ||
      evidenceItem.correctedAt ||
      evidenceItem.sourceUpdatedAt
    );
    // If it's a correction and lacks ANY version-specific availability or system-first-seen timestamp
    if (!hasVersionSpecificTime && !parsedSystem) {
      return Object.freeze({
        isAvailable: false,
        replaySafe: false,
        sourceAvailableAt: parsedSource ? parsedSource.iso : null,
        systemFirstSeenAt: null,
        availabilityTime: null,
        availabilityTimestampMs: null,
        articlePublishedAt,
        versionAvailableAt: null,
        classification: AVAILABILITY_CLASSIFICATION.UNSAFE_UNTRUSTWORTHY_VERSION_TIME,
        sourceField,
        systemField: null,
        reason: 'CORRECTION_LACKS_TRUSTWORTHY_VERSION_AVAILABILITY_TIMESTAMP'
      });
    }
  }

  // 4. Case A: Both sourceAvailableAt and systemFirstSeenAt exist
  if (parsedSource && parsedSystem) {
    const knowableMs = Math.max(parsedSource.ms, parsedSystem.ms);
    const knowableIso = new Date(knowableMs).toISOString();
    return Object.freeze({
      isAvailable: true,
      replaySafe: true,
      sourceAvailableAt: parsedSource.iso,
      systemFirstSeenAt: parsedSystem.iso,
      availabilityTime: knowableIso,
      availabilityTimestampMs: knowableMs,
      articlePublishedAt: articlePublishedAt || parsedSource.iso,
      versionAvailableAt: knowableIso,
      classification: AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_FROM_SOURCE_AND_FIRST_SEEN,
      sourceField,
      systemField
    });
  }

  // 5. Case B: Source available exists, but systemFirstSeenAt is missing
  if (parsedSource && !parsedSystem) {
    if (instantIngestion) {
      return Object.freeze({
        isAvailable: true,
        replaySafe: true,
        sourceAvailableAt: parsedSource.iso,
        systemFirstSeenAt: parsedSource.iso,
        availabilityTime: parsedSource.iso,
        availabilityTimestampMs: parsedSource.ms,
        articlePublishedAt: articlePublishedAt || parsedSource.iso,
        versionAvailableAt: parsedSource.iso,
        classification: AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_ASSUMED_INSTANT_INGESTION,
        sourceField,
        systemField: null
      });
    }

    return Object.freeze({
      isAvailable: false,
      replaySafe: false,
      sourceAvailableAt: parsedSource.iso,
      systemFirstSeenAt: null,
      availabilityTime: null,
      availabilityTimestampMs: null,
      articlePublishedAt: articlePublishedAt || parsedSource.iso,
      versionAvailableAt: null,
      classification: AVAILABILITY_CLASSIFICATION.UNSAFE_MISSING_SYSTEM_FIRST_SEEN,
      sourceField,
      systemField: null,
      reason: 'MISSING_TRUSTWORTHY_SYSTEM_FIRST_SEEN'
    });
  }

  // 6. Case C: System first-seen exists, but source publication timestamp is absent
  if (!parsedSource && parsedSystem) {
    if (allowFirstSeenOnly) {
      return Object.freeze({
        isAvailable: true,
        replaySafe: true,
        sourceAvailableAt: null,
        systemFirstSeenAt: parsedSystem.iso,
        availabilityTime: parsedSystem.iso,
        availabilityTimestampMs: parsedSystem.ms,
        articlePublishedAt: null,
        versionAvailableAt: parsedSystem.iso,
        classification: AVAILABILITY_CLASSIFICATION.SYSTEM_KNOWABLE_FROM_FIRST_SEEN,
        sourceField: null,
        systemField
      });
    }

    return Object.freeze({
      isAvailable: false,
      replaySafe: false,
      sourceAvailableAt: null,
      systemFirstSeenAt: parsedSystem.iso,
      availabilityTime: null,
      availabilityTimestampMs: null,
      articlePublishedAt: null,
      versionAvailableAt: null,
      classification: AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY,
      sourceField: null,
      systemField,
      reason: 'FIRST_SEEN_ONLY_NOT_PERMITTED'
    });
  }

  // 7. Case D: Neither exists
  return Object.freeze({
    isAvailable: false,
    replaySafe: false,
    sourceAvailableAt: null,
    systemFirstSeenAt: null,
    availabilityTime: null,
    availabilityTimestampMs: null,
    articlePublishedAt: null,
    versionAvailableAt: null,
    classification: AVAILABILITY_CLASSIFICATION.UNSAFE_FOR_REPLAY,
    sourceField: null,
    systemField: null,
    reason: 'MISSING_TRUSTWORTHY_AVAILABILITY_TIMESTAMP'
  });
}

export function isReplaySafeAvailability(avail) {
  if (!avail || typeof avail !== 'object') return false;
  return Boolean(avail.replaySafe && avail.availabilityTimestampMs !== null);
}
