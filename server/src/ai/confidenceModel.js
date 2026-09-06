import { createHash } from 'node:crypto';

export const CONFIDENCE_FRAMEWORK_VERSION = 'confidence-v2';
export const CONFIDENCE_ASSESSMENT_POLICY_VERSION = 'confidence-v2-unvalidated';

export const EVIDENCE_SUPPORT = Object.freeze({ STRONG: 'STRONG', ADEQUATE: 'ADEQUATE', FRAGILE: 'FRAGILE', INSUFFICIENT: 'INSUFFICIENT' });
export const ANALYTIC_CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE' });
export const ASSESSMENT_STATUS = Object.freeze({ ASSESSED: 'ASSESSED', NOT_ASSESSED: 'NOT_ASSESSED' });
export const CALIBRATION_STATUS = Object.freeze({ UNVALIDATED: 'UNVALIDATED', PARTIAL: 'PARTIAL', VALIDATED: 'VALIDATED', SUSPENDED: 'SUSPENDED' });
export const CONFIDENCE_TARGET_TYPES = Object.freeze({ MARKET_STRATEGY: 'MARKET_STRATEGY', CLAIM: 'CLAIM', PILLAR: 'PILLAR' });
export const REASON_SEVERITY = Object.freeze({ POSITIVE: 'POSITIVE', INFORMATIONAL: 'INFORMATIONAL', LIMITATION: 'LIMITATION', BLOCKING: 'BLOCKING' });

export const CONFIDENCE_REASON_CODES = Object.freeze({
  EVIDENCE_REQUIREMENTS_MET: 'EVIDENCE_REQUIREMENTS_MET',
  CRITICAL_EVIDENCE_MISSING: 'CRITICAL_EVIDENCE_MISSING',
  EVIDENCE_INTEGRITY_FAILED: 'EVIDENCE_INTEGRITY_FAILED',
  FRESHNESS_REQUIREMENT_FAILED: 'FRESHNESS_REQUIREMENT_FAILED',
  CORROBORATION_DEPENDENT: 'CORROBORATION_DEPENDENT',
  MATERIAL_CONFLICT_UNRESOLVED: 'MATERIAL_CONFLICT_UNRESOLVED',
  ASSUMPTION_SENSITIVE: 'ASSUMPTION_SENSITIVE',
  ANALYTIC_REVIEW_INCOMPLETE: 'ANALYTIC_REVIEW_INCOMPLETE',
  MODEL_APPLICABILITY_UNCERTAIN: 'MODEL_APPLICABILITY_UNCERTAIN',
  REVISION_IMPACT_PENDING: 'REVISION_IMPACT_PENDING',
  CALIBRATION_NOT_ESTABLISHED: 'CALIBRATION_NOT_ESTABLISHED',
  CALIBRATION_NOT_APPLICABLE: 'CALIBRATION_NOT_APPLICABLE',
  DUPLICATE_EVIDENCE_IGNORED: 'DUPLICATE_EVIDENCE_IGNORED',
  CADENCE_VALID_CARRY_FORWARD: 'CADENCE_VALID_CARRY_FORWARD',
  EXPECTATION_BASELINE_UNAVAILABLE: 'EXPECTATION_BASELINE_UNAVAILABLE',
  ASSESSMENT_POLICY_UNCONFIGURED: 'ASSESSMENT_POLICY_UNCONFIGURED',
  MATERIAL_LIMITATION_UNRESOLVED: 'MATERIAL_LIMITATION_UNRESOLVED'
});

const PRIVATE_KEYS = new Set(['userid', 'user_id', 'profileid', 'profile_id', 'portfolio', 'holdings', 'transactions', 'cash', 'email', 'password', 'token', 'authorization', 'credential', 'secret', 'apikey', 'api_key']);
const normalizedString = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function normalizeConfidenceTimestamp(value, field) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError(`${field} must be a valid Date`);
    return value.toISOString();
  }
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) throw new TypeError(`${field} must be an explicit timezone-aware timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) if (!PRIVATE_KEYS.has(key.toLowerCase())) output[key] = sanitizePublic(child);
  return output;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableConfidenceHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(sanitizePublic(value)))).digest('hex');
}

const uniqueStrings = (values) => Object.freeze([...new Set((Array.isArray(values) ? values : []).map(normalizedString).filter(Boolean))].sort());

function freezeRecord(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeRecord));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeRecord(child)])));
}

export function createConfidenceReason(code, options = {}) {
  if (!Object.values(CONFIDENCE_REASON_CODES).includes(code)) throw new TypeError(`Unknown confidence reason code: ${code}`);
  const severity = options.severity || REASON_SEVERITY.INFORMATIONAL;
  if (!Object.values(REASON_SEVERITY).includes(severity)) throw new TypeError(`Invalid confidence reason severity: ${severity}`);
  return Object.freeze({
    code,
    scope: normalizedString(options.scope),
    targetId: normalizedString(options.targetId),
    severity,
    effect: normalizedString(options.effect),
    evidenceIds: uniqueStrings(options.evidenceIds),
    requirementIds: uniqueStrings(options.requirementIds),
    messageKey: normalizedString(options.messageKey) || `confidence.${code.toLowerCase()}`,
    messageParams: freezeRecord(sanitizePublic(options.messageParams || {})),
    remediationConditions: uniqueStrings(options.remediationConditions)
  });
}

export function generateConfidenceAssessmentId({ targetType, targetId, scope, cutoff, inputFingerprint, profileVersion, policyVersion } = {}) {
  const cutoffIso = normalizeConfidenceTimestamp(cutoff, 'cutoff');
  const hash = stableConfidenceHash({ targetType, targetId, scope, cutoff: cutoffIso, inputFingerprint, profileVersion, policyVersion });
  return `confidence_assessment:${hash.slice(0, 32)}`;
}

export function createConfidenceAssessment(options = {}) {
  const assessmentStatus = options.assessmentStatus;
  const evidenceSupport = options.evidenceSupport;
  const candidateGrade = options.candidateGrade ?? null;
  const publicGrade = options.publicGrade ?? null;
  const calibrationStatus = options.calibrationStatus || CALIBRATION_STATUS.UNVALIDATED;
  const cutoff = normalizeConfidenceTimestamp(options.cutoff, 'cutoff');
  const asOf = normalizeConfidenceTimestamp(options.asOf || cutoff, 'asOf');
  const createdAt = normalizeConfidenceTimestamp(options.createdAt || asOf, 'createdAt');
  const calibrationManifestId = normalizedString(options.calibrationManifestId);
  const calibrationKnowableAt = options.calibrationKnowableAt
    ? normalizeConfidenceTimestamp(options.calibrationKnowableAt, 'calibrationKnowableAt')
    : null;
  const caps = options.caps || options.capResults || [];
  if (!Object.values(ASSESSMENT_STATUS).includes(assessmentStatus)) throw new TypeError('Invalid assessmentStatus');
  if (!Object.values(EVIDENCE_SUPPORT).includes(evidenceSupport)) throw new TypeError('Invalid evidenceSupport');
  const validGrades = new Set([...Object.values(ANALYTIC_CONFIDENCE), null]);
  if (!validGrades.has(candidateGrade) || !validGrades.has(publicGrade)) throw new TypeError('Invalid confidence grade');
  if (!Object.values(CALIBRATION_STATUS).includes(calibrationStatus)) throw new TypeError('Invalid calibrationStatus');
  if (!Array.isArray(caps)) throw new TypeError('caps must be an array');
  if (assessmentStatus === ASSESSMENT_STATUS.NOT_ASSESSED && (candidateGrade !== null || publicGrade !== null)) throw new TypeError('NOT_ASSESSED requires null candidateGrade and publicGrade');
  if (assessmentStatus === ASSESSMENT_STATUS.ASSESSED && candidateGrade === null) throw new TypeError('ASSESSED requires a candidateGrade');
  if (candidateGrade === ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE && publicGrade !== ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE) throw new TypeError('INSUFFICIENT_EVIDENCE cannot be converted to another public grade');
  if (publicGrade === ANALYTIC_CONFIDENCE.HIGH && !(
    assessmentStatus === ASSESSMENT_STATUS.ASSESSED
    && candidateGrade === ANALYTIC_CONFIDENCE.HIGH
    && calibrationStatus === CALIBRATION_STATUS.VALIDATED
    && options.calibrationApplicable === true
    && calibrationManifestId
    && calibrationKnowableAt
    && Date.parse(calibrationKnowableAt) <= Date.parse(cutoff)
    && caps.length === 0
  )) throw new TypeError('Public HIGH requires assessed candidate HIGH, applicable validated calibration knowable by cutoff, and no active cap');

  const targetType = options.targetType;
  const targetId = normalizedString(options.targetId);
  const scope = normalizedString(options.scope);
  const inputFingerprint = normalizedString(options.inputFingerprint);
  const profileVersion = normalizedString(options.profileVersion);
  const policyVersion = normalizedString(options.policyVersion) || CONFIDENCE_ASSESSMENT_POLICY_VERSION;
  if (!Object.values(CONFIDENCE_TARGET_TYPES).includes(targetType) || !targetId || !scope || !inputFingerprint) throw new TypeError('Confidence assessment requires target identity, scope, and inputFingerprint');
  const expectedId = generateConfidenceAssessmentId({ targetType, targetId, scope, cutoff, inputFingerprint, profileVersion, policyVersion });
  if (options.assessmentId && options.assessmentId !== expectedId) throw new TypeError('assessmentId does not match deterministic assessment identity');

  return Object.freeze({
    assessmentId: expectedId,
    targetType,
    targetId,
    scope,
    horizon: normalizedString(options.horizon),
    cutoff,
    asOf,
    inputFingerprint,
    profileVersion,
    policyVersion,
    evidenceSupport,
    candidateGrade,
    publicGrade,
    assessmentStatus,
    calibrationStatus,
    calibrationApplicable: options.calibrationApplicable === true,
    calibrationManifestId,
    calibrationKnowableAt,
    gateResults: freezeRecord(sanitizePublic(options.gateResults || [])),
    caps: freezeRecord(sanitizePublic(caps)),
    reasons: Object.freeze((Array.isArray(options.reasons) ? options.reasons : []).map((reason) => createConfidenceReason(reason.code, reason))),
    upgradeRequirements: freezeRecord(sanitizePublic(options.upgradeRequirements || [])),
    strategyAssessmentId: normalizedString(options.strategyAssessmentId || options.linkedStrategyAssessmentId),
    strategyId: normalizedString(options.strategyId),
    strategyVersion: normalizedString(options.strategyVersion || options.linkedStrategyVersionId),
    createdAt
  });
}

export function createCalibrationManifest(options = {}) {
  const manifestId = normalizedString(options.manifestId);
  const targetType = options.targetType || CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY;
  const scope = normalizedString(options.scope);
  const policyVersion = normalizedString(options.policyVersion);
  const profileVersion = normalizedString(options.profileVersion);
  const status = options.status || CALIBRATION_STATUS.UNVALIDATED;
  const createdAt = normalizeConfidenceTimestamp(options.createdAt, 'createdAt');
  const effectiveAt = options.effectiveAt ? normalizeConfidenceTimestamp(options.effectiveAt, 'effectiveAt') : null;
  if (!manifestId || !scope || !policyVersion || !profileVersion) throw new TypeError('Calibration manifest requires identity, scope, policyVersion, and profileVersion');
  if (!Object.values(CONFIDENCE_TARGET_TYPES).includes(targetType)) throw new TypeError('Invalid calibration targetType');
  if (!Object.values(CALIBRATION_STATUS).includes(status)) throw new TypeError('Invalid calibration status');
  if (status === CALIBRATION_STATUS.VALIDATED && !effectiveAt) throw new TypeError('VALIDATED calibration requires effectiveAt');
  return Object.freeze({
    manifestId,
    cohort: normalizedString(options.cohort),
    targetType,
    claimType: normalizedString(options.claimType),
    scope,
    horizon: normalizedString(options.horizon),
    policyVersion,
    profileVersion,
    modelVersion: normalizedString(options.modelVersion),
    datasetStartAt: options.datasetStartAt ? normalizeConfidenceTimestamp(options.datasetStartAt, 'datasetStartAt') : null,
    datasetEndAt: options.datasetEndAt ? normalizeConfidenceTimestamp(options.datasetEndAt, 'datasetEndAt') : null,
    evaluationMethod: freezeRecord(sanitizePublic(options.evaluationMethod || {})),
    applicability: freezeRecord(sanitizePublic(options.applicability || {})),
    releaseCriteria: freezeRecord(sanitizePublic(options.releaseCriteria || {})),
    status,
    effectiveAt,
    createdAt
  });
}
