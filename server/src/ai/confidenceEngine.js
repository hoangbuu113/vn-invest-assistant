import { resolveEvidenceAvailabilityTime } from '../replay/availability.js';
import {
  ANALYTIC_CONFIDENCE,
  ASSESSMENT_STATUS,
  CALIBRATION_STATUS,
  CONFIDENCE_REASON_CODES,
  EVIDENCE_SUPPORT,
  REASON_SEVERITY,
  createConfidenceAssessment,
  createConfidenceReason,
  normalizeConfidenceTimestamp,
  stableConfidenceHash
} from './confidenceModel.js';
import { FRESHNESS_BEHAVIOR } from './confidenceProfiles.js';

const GRADE_RANK = Object.freeze({
  [ANALYTIC_CONFIDENCE.HIGH]: 3,
  [ANALYTIC_CONFIDENCE.MEDIUM]: 2,
  [ANALYTIC_CONFIDENCE.LOW]: 1,
  [ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE]: 0
});

const evidenceId = (item) => item?.observationId || item?.versionId || item?.articleId || item?.evidenceId || item?.claimId || item?.id || null;
const contentIdentity = (item) => item?.sourceContentHash || item?.contentHash || evidenceId(item);

function trustedReplayInput(item) {
  const firstSeenAt = item?.versionFirstSeenAt || item?.firstSeenAt || item?.initialFetchedAt || item?.fetchedAt || null;
  const sourceAvailableAt = item?.versionPublishedAt || item?.sourceAvailableAt || item?.publishedAt || item?.observedAt || null;
  return {
    versionPublishedAt: item?.versionPublishedAt || undefined,
    correctedAt: item?.correctedAt || undefined,
    sourceUpdatedAt: item?.sourceUpdatedAt || undefined,
    sourceAvailableAt,
    versionFirstSeenAt: item?.versionFirstSeenAt || undefined,
    firstSeenAt,
    isCorrection: item?.isCorrection === true,
    isUpdate: item?.isUpdate === true,
    isRevisedVersion: item?.isRevisedVersion === true,
    versionNumber: item?.versionNumber,
    versionId: item?.versionId,
    articleId: item?.articleId
  };
}

function compareResolvedEvidence(left, right) {
  const semanticLeft = left.factId || left.claimId || left.articleId || evidenceId(left) || '';
  const semanticRight = right.factId || right.claimId || right.articleId || evidenceId(right) || '';
  if (semanticLeft !== semanticRight) return semanticLeft.localeCompare(semanticRight);
  const leftReference = left.referenceTime || left.referencePeriod || '';
  const rightReference = right.referenceTime || right.referencePeriod || '';
  if (leftReference !== rightReference) return rightReference.localeCompare(leftReference);
  const leftAvailable = left.resolvedAvailability?.availabilityTime || '';
  const rightAvailable = right.resolvedAvailability?.availabilityTime || '';
  if (leftAvailable !== rightAvailable) return rightAvailable.localeCompare(leftAvailable);
  return (evidenceId(left) || '').localeCompare(evidenceId(right) || '');
}

/** Replay-safe evidence projection. Invalid cutoff or untrusted availability fails closed. */
export function resolveAsOfEvidence(evidence = [], cutoff) {
  const cutoffIso = normalizeConfidenceTimestamp(cutoff, 'cutoff');
  const cutoffMs = Date.parse(cutoffIso);
  const included = [];
  const excluded = [];
  const exclusionLog = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const id = evidenceId(item);
    const declaredUnavailable = String(item?.status || '').toLowerCase() === 'unavailable';
    const invalidFactValue = Boolean(item?.factId) && !declaredUnavailable
      && !(typeof item.value === 'number' && Number.isFinite(item.value));
    if (!item || !id || !(item.sourceContentHash || item.contentHash) || invalidFactValue) {
      excluded.push(item);
      exclusionLog.push({ evidenceId: id, reason: 'EVIDENCE_INTEGRITY_FAILED' });
      continue;
    }
    const availability = resolveEvidenceAvailabilityTime(trustedReplayInput(item));
    if (!availability.replaySafe || availability.availabilityTimestampMs === null) {
      excluded.push(item);
      exclusionLog.push({ evidenceId: id, reason: 'UNSAFE_REPLAY_AVAILABILITY', classification: availability.classification });
      continue;
    }
    if (availability.availabilityTimestampMs > cutoffMs) {
      excluded.push(item);
      exclusionLog.push({ evidenceId: id, reason: 'FUTURE_EVIDENCE', availabilityTime: availability.availabilityTime, cutoff: cutoffIso });
      continue;
    }
    included.push(Object.freeze({ ...item, resolvedAvailability: availability }));
  }
  included.sort(compareResolvedEvidence);
  return Object.freeze({ included: Object.freeze(included), excluded: Object.freeze(excluded), exclusionLog: Object.freeze(exclusionLog), cutoff: cutoffIso });
}

function classifyEvidenceGroup(item) {
  const factId = String(item?.factId || '');
  const authority = item?.authorityLevel || item?.sourceAuthority || null;
  if ((factId.startsWith('vn.macro.') || factId.startsWith('vn.trade.')) && ['PRIMARY_OFFICIAL', 'REGULATORY_OFFICIAL'].includes(authority)) return 'OFFICIAL_MACRO';
  if ((factId.startsWith('vn.monetary.') || factId.startsWith('vn.policy.')) && authority === 'REGULATORY_OFFICIAL') return 'MONETARY_POLICY';
  if ((factId.startsWith('vn.market.') || factId.startsWith('vn.fx.')) && ['MARKET_DIRECT', 'MARKET_REFERENCE'].includes(authority)) return 'MARKET_REFERENCE';
  if (factId.startsWith('global.') || item?.pillar === 'intermarket') return 'INTERMARKET';
  if (item?.claimId || item?.type === 'claim' || item?.sourceType === 'claim') return 'CLAIM_FAMILY';
  return null;
}

function deduplicateEvidence(evidence) {
  const exact = new Map();
  const log = [];
  for (const item of [...(Array.isArray(evidence) ? evidence : [])].sort(compareResolvedEvidence)) {
    const key = `${evidenceId(item)}:${contentIdentity(item)}`;
    if (exact.has(key)) {
      log.push({ reasonCode: CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED, ignoredEvidenceId: evidenceId(item), retainedEvidenceId: evidenceId(exact.get(key)) });
      continue;
    }
    exact.set(key, item);
  }

  // One current vintage per semantic observation fact. This is deterministic
  // across input order and prevents revisions from increasing support counts.
  const currentFacts = new Map();
  const others = [];
  for (const item of exact.values()) {
    if (!item.factId) {
      others.push(item);
      continue;
    }
    const current = currentFacts.get(item.factId);
    if (!current || compareResolvedEvidence(item, current) < 0) {
      if (current) log.push({ reasonCode: CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED, ignoredEvidenceId: evidenceId(current), retainedEvidenceId: evidenceId(item) });
      currentFacts.set(item.factId, item);
    } else {
      log.push({ reasonCode: CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED, ignoredEvidenceId: evidenceId(item), retainedEvidenceId: evidenceId(current) });
    }
  }

  // Syndicated copies with the same dependency origin and claim identity are
  // one support path, never independent corroboration.
  const syndicated = new Map();
  for (const item of others.sort(compareResolvedEvidence)) {
    const origin = item.dependencyGroup || item.originFamily || null;
    const claimKey = item.claimId || item.canonicalUrl || item.articleId || evidenceId(item);
    const key = origin ? `${origin}:${claimKey}` : `independent:${evidenceId(item)}`;
    if (syndicated.has(key)) {
      log.push({ reasonCode: CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED, ignoredEvidenceId: evidenceId(item), retainedEvidenceId: evidenceId(syndicated.get(key)) });
    } else {
      syndicated.set(key, item);
    }
  }
  return {
    evidence: Object.freeze([...currentFacts.values(), ...syndicated.values()].sort(compareResolvedEvidence)),
    deduplicationLog: Object.freeze(log)
  };
}

function freshnessDecision(item, path) {
  const status = String(item?.status || 'available').toLowerCase();
  const freshness = String(item?.freshness || 'fresh').toLowerCase();
  if (status === 'unavailable') return { valid: false, reason: 'UNAVAILABLE' };
  const stale = status === 'stale' || freshness === 'stale' || item?.isStale === true;
  if (!stale) return { valid: true, carryForward: false };
  if (
    path.freshnessBehavior === FRESHNESS_BEHAVIOR.ALLOW_CADENCE_VALID_CARRY_FORWARD
    && (item.cadenceValidCarryForward === true || item.freshnessDecision === 'CADENCE_VALID_CARRY_FORWARD')
  ) return { valid: true, carryForward: true };
  if (path.freshnessBehavior === FRESHNESS_BEHAVIOR.EVENT_DRIVEN && item.eventStillEffective === true) return { valid: true, carryForward: true };
  return { valid: false, reason: 'STALE' };
}

function pathEvidence(item, path) {
  if (classifyEvidenceGroup(item) !== path.evidenceGroup) return null;
  if (path.authorityLevels?.length && !path.authorityLevels.includes(item.authorityLevel || item.sourceAuthority)) return null;
  const freshness = freshnessDecision(item, path);
  return freshness.valid ? { item, freshness } : { item, freshness, invalid: true };
}

function isAnalyticReviewComplete(analyticReview, profile) {
  if (analyticReview?.complete !== true) return false;
  const fields = profile?.analyticReviewRequirements?.fields || [];
  return fields.every((field) => {
    const value = analyticReview[field];
    if (['assumptions', 'alternativeExplanations', 'counterEvidence'].includes(field)) return Array.isArray(value);
    if (field === 'sensitivity') return value !== null && value !== undefined && value !== '';
    if (field === 'modelApplicability') return value === 'SUPPORTED';
    return value !== null && value !== undefined;
  });
}

export function evaluateSupportGraph(asOfEvidence = [], profile, { analyticReview = null } = {}) {
  if (!profile || !Array.isArray(profile.essentialRequirements)) {
    return Object.freeze({ configured: false, gateResults: Object.freeze([]), essentialsFulfilled: Object.freeze([]), essentialsMissing: Object.freeze([]), participatingEvidence: Object.freeze([]), deduplicationLog: Object.freeze([]), cadenceCarryForwardIds: Object.freeze([]), freshnessFailures: Object.freeze([]), alternativePathsUsed: false, fragilePathsUsed: false });
  }
  const deduped = deduplicateEvidence(asOfEvidence);
  const fulfilled = [];
  const missing = [];
  const participating = new Map();
  const cadenceCarryForwardIds = [];
  const freshnessFailures = [];
  let alternativePathsUsed = false;
  let fragilePathsUsed = false;

  for (const requirement of profile.essentialRequirements) {
    let selected = null;
    for (let pathIndex = 0; pathIndex < requirement.paths.length; pathIndex += 1) {
      const path = requirement.paths[pathIndex];
      const matches = deduped.evidence.map((item) => pathEvidence(item, path)).filter(Boolean);
      for (const match of matches.filter((entry) => entry.invalid)) freshnessFailures.push({ requirementId: requirement.requirementId, evidenceId: evidenceId(match.item), reason: match.freshness.reason });
      const valid = matches.filter((entry) => !entry.invalid);
      if (path.requiresAnalyticSupport && !isAnalyticReviewComplete(analyticReview, profile)) continue;
      if (valid.length > 0) {
        selected = { path, pathIndex, matches: valid };
        break;
      }
    }
    if (!selected) {
      missing.push(Object.freeze({ requirementId: requirement.requirementId, scope: requirement.scope, pathIds: Object.freeze(requirement.paths.map((path) => path.pathId)) }));
      continue;
    }
    const ids = selected.matches.map(({ item }) => evidenceId(item)).sort();
    for (const match of selected.matches) {
      participating.set(evidenceId(match.item), match.item);
      if (match.freshness.carryForward) cadenceCarryForwardIds.push(evidenceId(match.item));
    }
    const alternative = selected.pathIndex > 0 || selected.path.supportLevel === 'ALTERNATIVE';
    alternativePathsUsed ||= alternative;
    fragilePathsUsed ||= selected.path.supportLevel === 'FRAGILE';
    fulfilled.push(Object.freeze({ requirementId: requirement.requirementId, scope: requirement.scope, pathId: selected.path.pathId, evidenceIds: Object.freeze(ids), viaAlternative: alternative, supportLevel: selected.path.supportLevel }));
  }
  const gateResults = profile.essentialRequirements.map((requirement) => {
    const hit = fulfilled.find((item) => item.requirementId === requirement.requirementId);
    return Object.freeze({
      requirementId: requirement.requirementId,
      scope: requirement.scope,
      passed: Boolean(hit),
      pathId: hit?.pathId || null,
      evidenceIds: hit?.evidenceIds || Object.freeze([]),
      supportChain: hit ? Object.freeze({
        observations: hit.evidenceIds,
        claim: Object.freeze({ requirementId: requirement.requirementId, pathId: hit.pathId }),
        pillar: Object.freeze({ scope: requirement.scope }),
        strategy: Object.freeze({ targetType: profile.targetType, scope: profile.scope })
      }) : null
    });
  });
  return Object.freeze({ configured: true, gateResults: Object.freeze(gateResults), essentialsFulfilled: Object.freeze(fulfilled), essentialsMissing: Object.freeze(missing), participatingEvidence: Object.freeze([...participating.values()].sort(compareResolvedEvidence)), deduplicationLog: deduped.deduplicationLog, cadenceCarryForwardIds: Object.freeze([...new Set(cadenceCarryForwardIds)].sort()), freshnessFailures: Object.freeze(freshnessFailures), alternativePathsUsed, fragilePathsUsed });
}

export function deriveEvidenceSupport(supportGraph) {
  if (!supportGraph?.configured || supportGraph.essentialsMissing?.length > 0) return EVIDENCE_SUPPORT.INSUFFICIENT;
  if (supportGraph.fragilePathsUsed) return EVIDENCE_SUPPORT.FRAGILE;
  if (supportGraph.alternativePathsUsed) return EVIDENCE_SUPPORT.ADEQUATE;
  return EVIDENCE_SUPPORT.STRONG;
}

const capGrade = (grade, cap) => GRADE_RANK[grade] > GRADE_RANK[cap] ? cap : grade;

export function evaluateConfidenceCaps(supportGraph, { profile, analyticReview = null, targetId, scope } = {}) {
  if (!profile) return Object.freeze({ assessmentStatus: ASSESSMENT_STATUS.NOT_ASSESSED, candidateGrade: null, caps: Object.freeze([]), reasons: Object.freeze([]) });
  const evidenceSupport = deriveEvidenceSupport(supportGraph);
  const reasons = [];
  const caps = [];
  if (evidenceSupport === EVIDENCE_SUPPORT.INSUFFICIENT) {
    const requirementIds = supportGraph.essentialsMissing.map((item) => item.requirementId);
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.CRITICAL_EVIDENCE_MISSING, { scope, targetId, severity: REASON_SEVERITY.BLOCKING, effect: 'INSUFFICIENT_EVIDENCE', requirementIds, evidenceIds: supportGraph.freshnessFailures.map((item) => item.evidenceId), remediationConditions: requirementIds }));
    if (supportGraph.freshnessFailures.length > 0) reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.FRESHNESS_REQUIREMENT_FAILED, { scope, targetId, severity: REASON_SEVERITY.BLOCKING, effect: 'ESSENTIAL_PATH_UNAVAILABLE', requirementIds: supportGraph.freshnessFailures.map((item) => item.requirementId), evidenceIds: supportGraph.freshnessFailures.map((item) => item.evidenceId) }));
    return Object.freeze({ assessmentStatus: ASSESSMENT_STATUS.ASSESSED, candidateGrade: ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE, caps: Object.freeze(caps), reasons: Object.freeze(reasons) });
  }

  let candidateGrade = evidenceSupport === EVIDENCE_SUPPORT.STRONG
    ? ANALYTIC_CONFIDENCE.HIGH
    : evidenceSupport === EVIDENCE_SUPPORT.ADEQUATE
      ? ANALYTIC_CONFIDENCE.MEDIUM
      : ANALYTIC_CONFIDENCE.LOW;
  reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.EVIDENCE_REQUIREMENTS_MET, { scope, targetId, severity: REASON_SEVERITY.POSITIVE, effect: 'ESSENTIAL_PATHS_VALID', requirementIds: supportGraph.essentialsFulfilled.map((item) => item.requirementId), evidenceIds: supportGraph.participatingEvidence.map(evidenceId) }));
  if (supportGraph.alternativePathsUsed) reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.CORROBORATION_DEPENDENT, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_MEDIUM', requirementIds: supportGraph.essentialsFulfilled.filter((item) => item.viaAlternative).map((item) => item.requirementId) }));
  if (supportGraph.deduplicationLog.length > 0) reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.DUPLICATE_EVIDENCE_IGNORED, { scope, targetId, severity: REASON_SEVERITY.INFORMATIONAL, effect: 'NO_GRADE_INCREASE', evidenceIds: supportGraph.deduplicationLog.map((item) => item.ignoredEvidenceId) }));
  if (supportGraph.cadenceCarryForwardIds.length > 0) reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.CADENCE_VALID_CARRY_FORWARD, { scope, targetId, severity: REASON_SEVERITY.INFORMATIONAL, effect: 'NO_AGE_PENALTY', evidenceIds: supportGraph.cadenceCarryForwardIds }));

  const participatingIds = new Set(supportGraph.participatingEvidence.map(evidenceId));
  const conflictIds = supportGraph.participatingEvidence.filter((item) => {
    const conflict = item.normalizedConflict;
    return conflict?.material === true
      && conflict?.resolved !== true
      && ['definition', 'unit', 'period', 'vintage', 'scope', 'lineage'].every((field) => typeof conflict[field] === 'string' && conflict[field].trim());
  }).map(evidenceId);
  if (conflictIds.length > 0) {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
    caps.push({ code: CONFIDENCE_REASON_CODES.MATERIAL_CONFLICT_UNRESOLVED, scope, cap: ANALYTIC_CONFIDENCE.MEDIUM, evidenceIds: conflictIds });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.MATERIAL_CONFLICT_UNRESOLVED, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_MEDIUM', evidenceIds: conflictIds }));
  }
  const revisionIds = (analyticReview?.revisionImpactPendingEvidenceIds || []).filter((id) => participatingIds.has(id));
  if (revisionIds.length > 0) {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
    caps.push({ code: CONFIDENCE_REASON_CODES.REVISION_IMPACT_PENDING, scope, cap: ANALYTIC_CONFIDENCE.MEDIUM, evidenceIds: revisionIds });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.REVISION_IMPACT_PENDING, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_MEDIUM', evidenceIds: revisionIds }));
  }
  if (profile.analyticReviewRequirements?.requiredForHigh && !isAnalyticReviewComplete(analyticReview, profile)) {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
    caps.push({ code: CONFIDENCE_REASON_CODES.ANALYTIC_REVIEW_INCOMPLETE, scope, cap: ANALYTIC_CONFIDENCE.MEDIUM, evidenceIds: [] });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.ANALYTIC_REVIEW_INCOMPLETE, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_MEDIUM', requirementIds: ['REQ_STRUCTURED_ANALYTIC_REVIEW'], remediationConditions: profile.analyticReviewRequirements.fields }));
  }
  if (analyticReview?.assumptionSensitive === true) {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.LOW);
    caps.push({ code: CONFIDENCE_REASON_CODES.ASSUMPTION_SENSITIVE, scope, cap: ANALYTIC_CONFIDENCE.LOW, evidenceIds: [] });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.ASSUMPTION_SENSITIVE, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_LOW' }));
  }
  if (analyticReview?.modelApplicability === 'UNCERTAIN') {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.LOW);
    caps.push({ code: CONFIDENCE_REASON_CODES.MODEL_APPLICABILITY_UNCERTAIN, scope, cap: ANALYTIC_CONFIDENCE.LOW, evidenceIds: [] });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.MODEL_APPLICABILITY_UNCERTAIN, { scope, targetId, severity: REASON_SEVERITY.LIMITATION, effect: 'CAP_LOW' }));
  }
  if (Array.isArray(analyticReview?.materialLimitations) && analyticReview.materialLimitations.some((item) => item?.resolved !== true)) {
    candidateGrade = capGrade(candidateGrade, ANALYTIC_CONFIDENCE.MEDIUM);
    const limitations = analyticReview.materialLimitations.filter((item) => item?.resolved !== true);
    caps.push({ code: CONFIDENCE_REASON_CODES.MATERIAL_LIMITATION_UNRESOLVED, scope, cap: ANALYTIC_CONFIDENCE.MEDIUM, evidenceIds: [] });
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.MATERIAL_LIMITATION_UNRESOLVED, {
      scope,
      targetId,
      severity: REASON_SEVERITY.LIMITATION,
      effect: 'CAP_MEDIUM',
      messageParams: { limitationCodes: limitations.map((item) => item?.code).filter(Boolean) },
      remediationConditions: limitations.map((item) => item?.remediationCondition).filter(Boolean)
    }));
  }
  return Object.freeze({ assessmentStatus: ASSESSMENT_STATUS.ASSESSED, candidateGrade, caps: Object.freeze(caps), reasons: Object.freeze(reasons) });
}

export function evaluateCalibrationApplicability(manifests = [], profile, cutoff) {
  const cutoffIso = normalizeConfidenceTimestamp(cutoff, 'cutoff');
  const cutoffMs = Date.parse(cutoffIso);
  const list = (Array.isArray(manifests) ? manifests : []).filter((manifest) => {
    if (!manifest?.createdAt) return false;
    const createdMs = Date.parse(manifest.createdAt);
    return Number.isFinite(createdMs) && createdMs <= cutoffMs;
  });
  const matching = list.filter((manifest) => (
    manifest.targetType === profile?.targetType
    && manifest.scope === profile?.scope
    && manifest.horizon === profile?.horizon
    && manifest.policyVersion === profile?.policyVersion
    && manifest.profileVersion === profile?.profileVersion
  ));
  const effective = matching.filter((manifest) => !manifest.effectiveAt || (
    Number.isFinite(Date.parse(manifest.effectiveAt)) && Date.parse(manifest.effectiveAt) <= cutoffMs
  )).sort((left, right) => {
    const leftTime = left.effectiveAt || left.createdAt;
    const rightTime = right.effectiveAt || right.createdAt;
    return rightTime.localeCompare(leftTime) || right.createdAt.localeCompare(left.createdAt);
  });
  const current = effective[0] || null;
  if (current?.status === CALIBRATION_STATUS.VALIDATED && current.effectiveAt) {
    const knowableAt = new Date(Math.max(Date.parse(current.createdAt), Date.parse(current.effectiveAt))).toISOString();
    return Object.freeze({ status: CALIBRATION_STATUS.VALIDATED, applicable: true, manifestId: current.manifestId, knowableAt, reasonCode: null });
  }
  return Object.freeze({
    status: current?.status || CALIBRATION_STATUS.UNVALIDATED,
    applicable: false,
    manifestId: current?.manifestId || null,
    knowableAt: current
      ? new Date(Math.max(Date.parse(current.createdAt), Date.parse(current.effectiveAt || current.createdAt))).toISOString()
      : null,
    reasonCode: matching.some((manifest) => manifest.status === CALIBRATION_STATUS.VALIDATED)
      ? CONFIDENCE_REASON_CODES.CALIBRATION_NOT_APPLICABLE
      : CONFIDENCE_REASON_CODES.CALIBRATION_NOT_ESTABLISHED
  });
}

export function deriveConfidence({ evidenceSupport, capResult, calibration, targetId, scope } = {}) {
  if (capResult.assessmentStatus === ASSESSMENT_STATUS.NOT_ASSESSED) return Object.freeze({ assessmentStatus: ASSESSMENT_STATUS.NOT_ASSESSED, evidenceSupport, candidateGrade: null, publicGrade: null, calibrationStatus: calibration?.status || CALIBRATION_STATUS.UNVALIDATED, calibrationApplicable: false, calibrationManifestId: null, calibrationKnowableAt: null, reasons: capResult.reasons || Object.freeze([]), caps: capResult.caps || Object.freeze([]) });
  const candidateGrade = capResult.candidateGrade;
  let publicGrade = candidateGrade;
  const reasons = [...(capResult.reasons || [])];
  if (candidateGrade !== ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE && !(calibration?.status === CALIBRATION_STATUS.VALIDATED && calibration?.applicable === true)) {
    if (candidateGrade === ANALYTIC_CONFIDENCE.HIGH) publicGrade = ANALYTIC_CONFIDENCE.MEDIUM;
    const code = calibration?.reasonCode || CONFIDENCE_REASON_CODES.CALIBRATION_NOT_ESTABLISHED;
    reasons.push(createConfidenceReason(code, {
      scope,
      targetId,
      severity: REASON_SEVERITY.LIMITATION,
      effect: candidateGrade === ANALYTIC_CONFIDENCE.HIGH ? 'PUBLIC_HIGH_CAPPED_AT_MEDIUM' : 'PUBLIC_HIGH_UNAVAILABLE',
      remediationConditions: ['APPLICABLE_VALIDATED_CALIBRATION_MANIFEST']
    }));
  }
  return Object.freeze({ assessmentStatus: ASSESSMENT_STATUS.ASSESSED, evidenceSupport, candidateGrade, publicGrade, calibrationStatus: calibration?.status || CALIBRATION_STATUS.UNVALIDATED, calibrationApplicable: calibration?.applicable === true, calibrationManifestId: calibration?.manifestId || null, calibrationKnowableAt: calibration?.knowableAt || null, reasons: Object.freeze(reasons), caps: capResult.caps || Object.freeze([]) });
}

export function deriveUpgradeRequirements(derived, supportGraph, profile) {
  const upgrades = [];
  for (const missing of supportGraph?.essentialsMissing || []) upgrades.push({ requirementId: missing.requirementId, code: 'PROVIDE_VALID_ESSENTIAL_SUPPORT_PATH', currentState: 'MISSING', requiredState: 'VALID_SUPPORT_PATH', evidenceIds: [] });
  for (const cap of derived?.caps || []) upgrades.push({ requirementId: cap.code, code: `RESOLVE_${cap.code}`, currentState: cap.cap, requiredState: 'CAP_REMOVED', evidenceIds: cap.evidenceIds || [] });
  if (derived?.assessmentStatus === ASSESSMENT_STATUS.ASSESSED
    && derived?.candidateGrade !== ANALYTIC_CONFIDENCE.INSUFFICIENT_EVIDENCE
    && derived?.calibrationApplicable !== true) {
    upgrades.push({ requirementId: 'CALIBRATION_APPLICABILITY', code: 'ESTABLISH_APPLICABLE_VALIDATED_CALIBRATION', currentState: derived.calibrationStatus, requiredState: CALIBRATION_STATUS.VALIDATED, evidenceIds: [] });
  }
  return Object.freeze(upgrades.map((item) => Object.freeze(item)));
}

export function assessConfidence({ targetType, targetId, scope, horizon = null, cutoff, asOf = cutoff, evidence = [], profile = null, calibrationManifests = [], analyticReview = null, strategyAssessmentId = null, strategyId = null, strategyVersion = null } = {}) {
  const cutoffIso = normalizeConfidenceTimestamp(cutoff, 'cutoff');
  const resolved = resolveAsOfEvidence(evidence, cutoffIso);
  if (!profile) {
    const inputFingerprint = stableConfidenceHash({ evidence: resolved.included.map((item) => [evidenceId(item), contentIdentity(item)]), policy: null });
    return createConfidenceAssessment({ targetType, targetId, scope, horizon, cutoff: cutoffIso, asOf, inputFingerprint, profileVersion: null, evidenceSupport: EVIDENCE_SUPPORT.INSUFFICIENT, candidateGrade: null, publicGrade: null, assessmentStatus: ASSESSMENT_STATUS.NOT_ASSESSED, calibrationStatus: CALIBRATION_STATUS.UNVALIDATED, calibrationApplicable: false, gateResults: [], caps: [], reasons: [createConfidenceReason(CONFIDENCE_REASON_CODES.ASSESSMENT_POLICY_UNCONFIGURED, { scope, targetId, severity: REASON_SEVERITY.BLOCKING, effect: 'NOT_ASSESSED' })], upgradeRequirements: [{ requirementId: 'ASSESSMENT_POLICY', code: 'CONFIGURE_GOVERNED_REQUIREMENT_PROFILE', currentState: 'UNCONFIGURED', requiredState: 'CONFIGURED', evidenceIds: [] }], strategyAssessmentId, strategyId, strategyVersion, createdAt: cutoffIso });
  }
  const supportGraph = evaluateSupportGraph(resolved.included, profile, { analyticReview });
  const evidenceSupport = deriveEvidenceSupport(supportGraph);
  const capResult = evaluateConfidenceCaps(supportGraph, { profile, analyticReview, targetId, scope });
  const calibration = evaluateCalibrationApplicability(calibrationManifests, profile, cutoffIso);
  const derived = deriveConfidence({ evidenceSupport, capResult, calibration, targetId, scope });
  const integrityExclusions = resolved.exclusionLog.filter((entry) => entry.reason === 'EVIDENCE_INTEGRITY_FAILED' || entry.reason === 'UNSAFE_REPLAY_AVAILABILITY');
  const reasons = [...derived.reasons];
  if (evidenceSupport === EVIDENCE_SUPPORT.INSUFFICIENT && integrityExclusions.length > 0) {
    reasons.push(createConfidenceReason(CONFIDENCE_REASON_CODES.EVIDENCE_INTEGRITY_FAILED, {
      scope,
      targetId,
      severity: REASON_SEVERITY.BLOCKING,
      effect: 'INVALID_EVIDENCE_EXCLUDED',
      evidenceIds: integrityExclusions.map((entry) => entry.evidenceId),
      remediationConditions: ['PROVIDE_REPLAY_SAFE_VALIDATED_EVIDENCE']
    }));
  }
  const inputFingerprint = stableConfidenceHash({
    includedEvidence: resolved.included.map((item) => [evidenceId(item), contentIdentity(item), item.resolvedAvailability?.availabilityTime]),
    exclusions: integrityExclusions,
    participatingEvidenceIds: supportGraph.participatingEvidence.map(evidenceId),
    profileVersion: profile.profileVersion,
    policyVersion: profile.policyVersion,
    analyticReview: analyticReview || null,
    calibration
  });
  const derivedWithReasons = Object.freeze({ ...derived, reasons: Object.freeze(reasons) });
  const upgrades = deriveUpgradeRequirements(derivedWithReasons, supportGraph, profile);
  return createConfidenceAssessment({ targetType, targetId, scope, horizon: horizon || profile.horizon, cutoff: cutoffIso, asOf, inputFingerprint, profileVersion: profile.profileVersion, policyVersion: profile.policyVersion, evidenceSupport, candidateGrade: derived.candidateGrade, publicGrade: derived.publicGrade, assessmentStatus: derived.assessmentStatus, calibrationStatus: derived.calibrationStatus, calibrationApplicable: derived.calibrationApplicable, calibrationManifestId: derived.calibrationManifestId, calibrationKnowableAt: derived.calibrationKnowableAt, gateResults: supportGraph.gateResults, caps: derived.caps, reasons, upgradeRequirements: upgrades, strategyAssessmentId, strategyId, strategyVersion, createdAt: cutoffIso });
}
