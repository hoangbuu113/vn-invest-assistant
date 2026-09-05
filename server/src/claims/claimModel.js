import { createHash } from 'node:crypto';

export const CLAIM_TYPES = Object.freeze({
  MACRO_NUMERIC: 'MACRO_NUMERIC',
  MONETARY_NUMERIC: 'MONETARY_NUMERIC',
  TRADE_NUMERIC: 'TRADE_NUMERIC',
  MARKET_EVENT: 'MARKET_EVENT',
  POLICY_EVENT: 'POLICY_EVENT',
  CORPORATE_EVENT: 'CORPORATE_EVENT',
  NEWS_ASSERTION: 'NEWS_ASSERTION'
});

export const CLAIM_STATUS = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  CORROBORATED: 'CORROBORATED',
  SINGLE_SOURCE: 'SINGLE_SOURCE',
  CONTRADICTED: 'CONTRADICTED',
  SUPERSEDED: 'SUPERSEDED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  UNRESOLVED: 'UNRESOLVED'
});

export const CLAIM_AUTHORITY_LEVELS = Object.freeze({
  PRIMARY_OFFICIAL: 'PRIMARY_OFFICIAL',
  REGULATORY_OFFICIAL: 'REGULATORY_OFFICIAL',
  MARKET_REFERENCE: 'MARKET_REFERENCE',
  FINANCIAL_MEDIA: 'FINANCIAL_MEDIA',
  NEWS_AGGREGATOR: 'NEWS_AGGREGATOR',
  UNVERIFIED_MEDIA: 'UNVERIFIED_MEDIA'
});

export const CONFIDENCE_RECENCY = Object.freeze({
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  HISTORICAL: 'HISTORICAL'
});

export const CONFIDENCE_CORROBORATION = Object.freeze({
  MULTI_SOURCE: 'MULTI_SOURCE',
  SINGLE_SOURCE: 'SINGLE_SOURCE',
  UNCONFIRMED: 'UNCONFIRMED'
});

export const CONFIDENCE_CONTRADICTION = Object.freeze({
  NONE: 'NONE',
  ACTIVE_CONTRADICTION: 'ACTIVE_CONTRADICTION',
  RESOLVED: 'RESOLVED'
});

export const CONFIDENCE_DERIVATION = Object.freeze({
  DIRECT_OBSERVATION: 'DIRECT_OBSERVATION',
  DERIVED_CALCULATION: 'DERIVED_CALCULATION',
  MEDIA_REPORTED: 'MEDIA_REPORTED'
});

function normalizeString(val) {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function normalizeNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num)) {
    throw new TypeError(`INVALID_NUMERIC_CLAIM_VALUE: Value must be a finite number, got ${val}`);
  }
  return num;
}

/**
 * Generates a deterministic claim identifier from semantic material fields.
 * Any change in material semantics (value, scope, revision, period) generates a distinct ID,
 * ensuring strict immutability across updates and corrections.
 */
export function generateClaimId({
  claimType,
  subject,
  predicate = 'EQUALS',
  referencePeriod = 'any',
  scope = 'all',
  methodology = 'default',
  revisionMarker = 'none',
  numericValue = null,
  valueText = null
} = {}) {
  const normType = normalizeString(claimType);
  const normSubject = normalizeString(subject);
  const normPredicate = normalizeString(predicate) || 'EQUALS';
  const normPeriod = normalizeString(referencePeriod) || 'any';
  const normScope = normalizeString(scope) || 'all';
  const normMeth = normalizeString(methodology) || 'default';
  const normRev = normalizeString(revisionMarker) || 'none';

  if (!normType || !normSubject) {
    throw new Error('generateClaimId requires non-empty claimType and subject');
  }

  let valuePart = '';
  if (numericValue !== null && numericValue !== undefined) {
    const num = Number(numericValue);
    if (!Number.isFinite(num)) {
      throw new TypeError(`generateClaimId: invalid numericValue ${numericValue}`);
    }
    // Canonical 4-decimal representation for stable hashing
    valuePart = `num:${num.toFixed(4)}`;
  } else {
    valuePart = `text:${(normalizeString(valueText) || '').toLowerCase()}`;
  }

  const rawKey = [
    normType,
    normSubject.toLowerCase(),
    normPredicate.toUpperCase(),
    normPeriod.toLowerCase(),
    normScope.toLowerCase(),
    normMeth.toLowerCase(),
    normRev.toLowerCase(),
    valuePart
  ].join('::');

  const hash = createHash('sha256').update(rawKey).digest('hex').slice(0, 20);
  return `claim_${hash}`;
}

/**
 * Builds transparent confidence dimensions for a claim.
 * Strictly avoids any single opaque 0-100 score.
 */
export function buildConfidenceDimensions({
  authorityLevel = CLAIM_AUTHORITY_LEVELS.UNVERIFIED_MEDIA,
  publishedAt = null,
  independentSourceCount = 1,
  completeness = 'COMPLETE',
  contradictionCount = 0,
  directVsDerived = CONFIDENCE_DERIVATION.DIRECT_OBSERVATION,
  revisionState = 'UNSPECIFIED',
  now = new Date()
} = {}) {
  let recency = CONFIDENCE_RECENCY.CURRENT;
  if (publishedAt) {
    const pubDate = new Date(publishedAt);
    if (!Number.isNaN(pubDate.getTime())) {
      const ageDays = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        recency = CONFIDENCE_RECENCY.HISTORICAL;
      } else if (ageDays > 45) {
        recency = CONFIDENCE_RECENCY.STALE;
      }
    }
  }

  const corroboration =
    independentSourceCount >= 2
      ? CONFIDENCE_CORROBORATION.MULTI_SOURCE
      : independentSourceCount === 1
      ? CONFIDENCE_CORROBORATION.SINGLE_SOURCE
      : CONFIDENCE_CORROBORATION.UNCONFIRMED;

  const contradiction =
    contradictionCount > 0
      ? CONFIDENCE_CONTRADICTION.ACTIVE_CONTRADICTION
      : CONFIDENCE_CONTRADICTION.NONE;

  return Object.freeze({
    authority: authorityLevel,
    recency,
    corroboration,
    completeness,
    contradiction,
    directVsDerived,
    revisionState
  });
}

/**
 * Creates an immutable MarketClaim domain object.
 */
export function createMarketClaim(payload = {}) {
  // Validate type
  const claimType = normalizeString(payload.claimType);
  if (!claimType || !Object.values(CLAIM_TYPES).includes(claimType)) {
    throw new Error(`INVALID_CLAIM_TYPE: "${payload.claimType}" is not a supported claim type`);
  }

  // Validate subject
  const subject = normalizeString(payload.subject);
  if (!subject) {
    throw new Error('INVALID_CLAIM_SUBJECT: subject cannot be empty');
  }

  // Validate predicate
  const predicate = normalizeString(payload.predicate) || 'EQUALS';

  // Validate values
  const numericValue = normalizeNumber(payload.numericValue ?? payload.value);
  const valueText = normalizeString(payload.valueText);
  if (numericValue === null && valueText === null) {
    throw new Error('INVALID_CLAIM_VALUE: Either numericValue or valueText must be provided');
  }

  const unit = normalizeString(payload.unit);
  const referencePeriod = normalizeString(payload.referencePeriod);
  const scope = normalizeString(payload.scope) || 'default';
  const methodology = normalizeString(payload.methodology) || 'v1.3';
  const revisionMarker = normalizeString(payload.revisionMarker);

  const authorityLevel = normalizeString(payload.authorityLevel) || CLAIM_AUTHORITY_LEVELS.UNVERIFIED_MEDIA;
  if (!Object.values(CLAIM_AUTHORITY_LEVELS).includes(authorityLevel)) {
    throw new Error(`INVALID_AUTHORITY_LEVEL: "${payload.authorityLevel}"`);
  }

  const supportStatus = normalizeString(payload.supportStatus) || CLAIM_STATUS.SINGLE_SOURCE;
  if (!Object.values(CLAIM_STATUS).includes(supportStatus)) {
    throw new Error(`INVALID_SUPPORT_STATUS: "${payload.supportStatus}"`);
  }

  const sourceCount = Math.max(0, Math.floor(Number(payload.sourceCount ?? 1)));
  const independentSourceCount = Math.max(0, Math.floor(Number(payload.independentSourceCount ?? 1)));
  const contradictionCount = Math.max(0, Math.floor(Number(payload.contradictionCount ?? 0)));
  const revisionOf = normalizeString(payload.revisionOf);
  const limitations = normalizeString(payload.limitations);
  const publishedAt = payload.publishedAt ? new Date(payload.publishedAt).toISOString() : null;
  const createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = payload.updatedAt ? new Date(payload.updatedAt).toISOString() : createdAt;

  const claimId =
    normalizeString(payload.claimId) ||
    generateClaimId({
      claimType,
      subject,
      predicate,
      referencePeriod,
      scope,
      methodology,
      revisionMarker,
      numericValue,
      valueText
    });

  const confidenceDimensions =
    payload.confidenceDimensions && typeof payload.confidenceDimensions === 'object'
      ? Object.freeze({ ...payload.confidenceDimensions })
      : buildConfidenceDimensions({
          authorityLevel,
          publishedAt,
          independentSourceCount,
          completeness: payload.completeness || 'COMPLETE',
          contradictionCount,
          directVsDerived: payload.directVsDerived || CONFIDENCE_DERIVATION.DIRECT_OBSERVATION,
          revisionState: revisionMarker || 'UNSPECIFIED'
        });

  return Object.freeze({
    claimId,
    claimType,
    subject,
    predicate,
    numericValue,
    valueText,
    unit,
    referencePeriod,
    scope,
    methodology,
    revisionMarker,
    authorityLevel,
    supportStatus,
    sourceCount,
    independentSourceCount,
    contradictionCount,
    revisionOf,
    confidenceDimensions,
    limitations,
    publishedAt,
    createdAt,
    updatedAt
  });
}
