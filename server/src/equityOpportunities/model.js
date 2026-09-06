import crypto from 'node:crypto';

export const EQUITY_OPPORTUNITY_POLICY_VERSION = 'vn-equity-opportunity-v1';

export const EQUITY_QUALIFICATION_STATUS = Object.freeze({
  QUALIFIED: 'QUALIFIED',
  WATCH: 'WATCH',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  REJECTED: 'REJECTED'
});

export const EQUITY_OPPORTUNITY_STATUS_ORDER = Object.freeze({
  [EQUITY_QUALIFICATION_STATUS.QUALIFIED]: 0,
  [EQUITY_QUALIFICATION_STATUS.WATCH]: 1,
  [EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE]: 2,
  [EQUITY_QUALIFICATION_STATUS.REJECTED]: 3
});

const PRIVATE_KEYS = new Set([
  'userid', 'user_id', 'profileid', 'profile_id', 'portfolio', 'holdings',
  'transactions', 'cash', 'email', 'password', 'token', 'authorization',
  'credential', 'secret', 'apikey', 'api_key'
]);

function normalizedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function explicitTimestamp(value, field) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    throw new TypeError(`${field} must be an explicit timezone-aware timestamp`);
  }
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function sanitizePublicValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) continue;
    result[key] = sanitizePublicValue(child);
  }
  return result;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function normalizeReason(reason, { requireEvidence = false } = {}) {
  if (!reason || typeof reason !== 'object') throw new TypeError('Opportunity reason must be an object');
  const code = normalizedString(reason.code)?.toUpperCase() || null;
  if (!code || !/^[A-Z][A-Z0-9_]*$/.test(code)) {
    throw new TypeError('Opportunity reason requires a canonical code');
  }
  const evidenceRefs = Array.isArray(reason.evidenceRefs)
    ? [...new Set(reason.evidenceRefs.map(normalizedString).filter(Boolean))].sort()
    : [];
  if (requireEvidence && evidenceRefs.length === 0) {
    throw new TypeError(`Positive opportunity reason ${code} requires evidenceRefs`);
  }
  return Object.freeze({ code, evidenceRefs: Object.freeze(evidenceRefs) });
}

export function buildOpportunityEvidenceRef(item) {
  if (!item || typeof item !== 'object') throw new TypeError('Opportunity evidence reference is required');
  const factId = normalizedString(item.factId);
  const observationId = normalizedString(item.observationId);
  const sourceContentHash = normalizedString(item.sourceContentHash);
  const systemKnowableAt = explicitTimestamp(item.systemKnowableAt, 'systemKnowableAt');
  if (!factId || !observationId || !sourceContentHash) {
    throw new TypeError('Opportunity evidence requires canonical fact, observation, and content identities');
  }
  return Object.freeze({
    factId,
    observationId,
    evidenceType: normalizedString(item.evidenceType),
    metric: normalizedString(item.metric),
    numericValue: typeof item.numericValue === 'number' && Number.isFinite(item.numericValue)
      ? item.numericValue
      : null,
    textValue: normalizedString(item.textValue),
    unit: normalizedString(item.unit),
    currency: normalizedString(item.currency),
    referencePeriod: normalizedString(item.referencePeriod),
    observedAt: item.observedAt ? explicitTimestamp(item.observedAt, 'observedAt') : null,
    publishedAt: item.publishedAt ? explicitTimestamp(item.publishedAt, 'publishedAt') : null,
    sourceAvailableAt: item.sourceAvailableAt
      ? explicitTimestamp(item.sourceAvailableAt, 'sourceAvailableAt')
      : null,
    firstSeenAt: explicitTimestamp(item.firstSeenAt, 'firstSeenAt'),
    systemKnowableAt,
    sourceId: normalizedString(item.sourceId),
    sourceName: normalizedString(item.sourceName),
    sourceFamily: normalizedString(item.sourceFamily),
    dependencyGroup: normalizedString(item.dependencyGroup),
    authorityLevel: normalizedString(item.authorityLevel),
    sourceContentHash,
    provenance: Object.freeze(sanitizePublicValue(item.provenance || {}))
  });
}

export function calculateOpportunityEvidenceFingerprint(evidenceRefs = []) {
  const canonicalRefs = (Array.isArray(evidenceRefs) ? evidenceRefs : [])
    .map((ref) => ({
      observationId: ref.observationId,
      sourceContentHash: ref.sourceContentHash
    }))
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  return stableHash(canonicalRefs);
}

export function createEquityOpportunityCandidate(payload = {}) {
  const assetId = normalizedString(payload.assetId);
  const symbol = normalizedString(payload.symbol)?.toUpperCase() || null;
  const exchange = normalizedString(payload.exchange)?.toUpperCase() || null;
  const companyName = normalizedString(payload.companyName);
  const asOf = explicitTimestamp(payload.asOf, 'asOf');
  const evaluatedAt = explicitTimestamp(payload.evaluatedAt || asOf, 'evaluatedAt');
  const generatedAt = explicitTimestamp(payload.generatedAt || evaluatedAt, 'generatedAt');
  const qualificationStatus = payload.qualificationStatus;
  const policyVersion = normalizedString(payload.policyVersion) || EQUITY_OPPORTUNITY_POLICY_VERSION;

  if (!assetId || !symbol || !exchange || !companyName) {
    throw new TypeError('Opportunity candidate requires canonical asset identity');
  }
  if (!Object.values(EQUITY_QUALIFICATION_STATUS).includes(qualificationStatus)) {
    throw new TypeError('Opportunity candidate has an invalid qualificationStatus');
  }

  const evidenceRefs = (Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [])
    .map(buildOpportunityEvidenceRef)
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  const evidenceIds = new Set(evidenceRefs.map((ref) => ref.observationId));
  const qualificationReasons = (Array.isArray(payload.qualificationReasons)
    ? payload.qualificationReasons
    : []).map((reason) => normalizeReason(reason, { requireEvidence: true }));
  const disqualificationReasons = (Array.isArray(payload.disqualificationReasons)
    ? payload.disqualificationReasons
    : []).map((reason) => normalizeReason(reason));

  for (const reason of qualificationReasons) {
    if (reason.evidenceRefs.some((id) => !evidenceIds.has(id))) {
      throw new TypeError(`Positive opportunity reason ${reason.code} references unknown evidence`);
    }
  }
  if (
    ![EQUITY_QUALIFICATION_STATUS.QUALIFIED, EQUITY_QUALIFICATION_STATUS.WATCH].includes(qualificationStatus)
    && qualificationReasons.length > 0
  ) {
    throw new TypeError('Non-shortlisted opportunity candidates cannot carry positive reasons');
  }

  const missingRequirements = [...new Set(
    (Array.isArray(payload.missingRequirements) ? payload.missingRequirements : [])
      .map((value) => normalizedString(value)?.toUpperCase())
      .filter(Boolean)
  )].sort();
  const dataQuality = sanitizePublicValue(payload.dataQuality || {});
  const computedEvidenceFingerprint = calculateOpportunityEvidenceFingerprint(evidenceRefs);
  const evidenceFingerprint = normalizedString(payload.evidenceFingerprint) || computedEvidenceFingerprint;
  if (evidenceFingerprint !== computedEvidenceFingerprint) {
    throw new TypeError('Opportunity evidenceFingerprint does not match evidenceRefs');
  }
  const evidenceVersion = `eqev_${evidenceFingerprint.slice(0, 16)}`;
  if (payload.evidenceVersion && payload.evidenceVersion !== evidenceVersion) {
    throw new TypeError('Opportunity evidenceVersion does not match evidenceFingerprint');
  }

  const identityHash = stableHash({
    assetId,
    symbol,
    exchange,
    asOf,
    evidenceFingerprint,
    qualificationStatus,
    qualificationReasons,
    disqualificationReasons,
    dataQuality,
    missingRequirements,
    policyVersion
  });
  const candidateId = `vn_equity_opportunity:${symbol.toLowerCase()}:${identityHash.slice(0, 24)}`;
  if (payload.candidateId && payload.candidateId !== candidateId) {
    throw new TypeError('Opportunity candidateId does not match deterministic content');
  }

  return Object.freeze({
    candidateId,
    assetId,
    symbol,
    exchange,
    companyName,
    asOf,
    evidenceVersion,
    evidenceFingerprint,
    qualificationStatus,
    qualificationReasons: Object.freeze(qualificationReasons),
    disqualificationReasons: Object.freeze(disqualificationReasons),
    evidenceRefs: Object.freeze(evidenceRefs),
    dataQuality: Object.freeze(dataQuality),
    missingRequirements: Object.freeze(missingRequirements),
    evaluatedAt,
    generatedAt,
    policyVersion
  });
}

export function compareEquityOpportunityCandidates(left, right) {
  const statusDifference = (EQUITY_OPPORTUNITY_STATUS_ORDER[left.qualificationStatus] ?? 99)
    - (EQUITY_OPPORTUNITY_STATUS_ORDER[right.qualificationStatus] ?? 99);
  if (statusDifference !== 0) return statusDifference;
  const evidenceDifference = (right?.dataQuality?.availableEvidenceCount || 0)
    - (left?.dataQuality?.availableEvidenceCount || 0);
  if (evidenceDifference !== 0) return evidenceDifference;
  return (left.symbol || '').localeCompare(right.symbol || '');
}

