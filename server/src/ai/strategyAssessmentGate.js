import { computeStrategistFingerprint } from './marketStrategistEngine.js';
import { CLAIM_STATUS, CLAIM_TYPES, CLAIM_AUTHORITY_LEVELS } from '../claims/claimModel.js';
import { DEPENDENCY_GROUPS } from '../claims/sourceFamily.js';
import {
  STRATEGY_LIFECYCLE_STATES,
  DATA_QUALITY_STATES,
  SHOCK_SCOPES,
  SHOCK_STATUSES,
  REVISION_TYPES,
  computeConfirmationKey,
  createShockOverride
} from './strategyStabilityModel.js';

export const MATERIALITY_TRIGGER_TYPES = Object.freeze({
  COLD_START_INITIAL_PUBLICATION: 'COLD_START_INITIAL_PUBLICATION',
  NO_EVIDENCE_CHANGE: 'NO_EVIDENCE_CHANGE',
  CLAIM_STATE_CHANGE: 'CLAIM_STATE_CHANGE',
  CLAIM_CORROBORATED: 'CLAIM_CORROBORATED',
  CLAIM_CONTRADICTED: 'CLAIM_CONTRADICTED',
  CONTRADICTION_RESOLVED: 'CONTRADICTION_RESOLVED',
  OFFICIAL_REVISION_CONSUMED: 'OFFICIAL_REVISION_CONSUMED',
  EVIDENCE_QUALITY_DEGRADATION: 'EVIDENCE_QUALITY_DEGRADATION',
  DATA_QUALITY_DEGRADATION: 'DATA_QUALITY_DEGRADATION',
  STRUCTURED_POLICY_EVENT: 'STRUCTURED_POLICY_EVENT',
  INVALIDATION_CONDITION_TRIGGERED: 'INVALIDATION_CONDITION_TRIGGERED',
  NON_MATERIAL_NEWS_ONLY: 'NON_MATERIAL_NEWS_ONLY',
  SHOCK_OVERRIDE: 'SHOCK_OVERRIDE',
  UNCONFIRMED_SIGNAL: 'UNCONFIRMED_SIGNAL',
  CONFIRMED_SIGNAL: 'CONFIRMED_SIGNAL',
  WATCH_INVALIDATED: 'WATCH_INVALIDATED'
});

/**
 * Assesses data quality state independently from market regime conclusions.
 * GUARANTEE: INSUFFICIENT data != NEUTRAL market regime.
 */
export function assessDataQuality(factPacket) {
  if (!factPacket || typeof factPacket !== 'object') {
    return DATA_QUALITY_STATES.INSUFFICIENT;
  }
  const evidence = Array.isArray(factPacket.evidence) ? factPacket.evidence : [];
  if (evidence.length === 0) {
    return DATA_QUALITY_STATES.INSUFFICIENT;
  }

  let unavailableCount = 0;
  let staleCount = 0;
  let freshAvailableCount = 0;

  for (const obs of evidence) {
    if (obs.status === 'unavailable') {
      unavailableCount++;
    } else if (obs.freshness === 'stale' || obs.status === 'stale') {
      staleCount++;
    } else if (obs.status === 'available' && obs.freshness === 'fresh') {
      freshAvailableCount++;
    }
  }

  // If all or critical majority of evidence is unavailable
  if (freshAvailableCount === 0 && unavailableCount > 0) {
    return DATA_QUALITY_STATES.INSUFFICIENT;
  }

  if (unavailableCount > 0 || staleCount > 0) {
    return DATA_QUALITY_STATES.DEGRADED;
  }

  return DATA_QUALITY_STATES.HEALTHY;
}

/**
 * Classifies an evidence revision into structural types:
 * NEW_PERIOD, DATA_REVISION, SOURCE_CORRECTION, METHODOLOGY_CHANGE, RETRACTION.
 */
export function classifyEvidenceRevision(obs, previousObs = null) {
  if (!obs || typeof obs !== 'object') return null;

  if (obs.isRetracted || obs.status === 'retracted') {
    return REVISION_TYPES.RETRACTION;
  }
  if (obs.isMethodologyChange || obs.methodologyChange || obs.methodologyVersion === 'post_oct_2025_m2') {
    return REVISION_TYPES.METHODOLOGY_CHANGE;
  }
  if (obs.isCorrection || obs.correctionOf || obs.errorCorrection) {
    return REVISION_TYPES.SOURCE_CORRECTION;
  }
  if (obs.revision === 'revised' || Boolean(obs.revisionOf) || Boolean(obs.revision_of)) {
    return REVISION_TYPES.DATA_REVISION;
  }
  if (previousObs && obs.period && previousObs.period && obs.period !== previousObs.period) {
    return REVISION_TYPES.NEW_PERIOD;
  }
  return null;
}

/**
 * Collects deterministic confirmation identity keys from incoming evidence.
 */
export function collectConfirmationKeys(factPacket) {
  const keys = new Set();
  const evidence = Array.isArray(factPacket.evidence) ? factPacket.evidence : [];
  const claims = Array.isArray(factPacket.claims) ? factPacket.claims : [];
  const news = Array.isArray(factPacket.untrustedNews) ? factPacket.untrustedNews : [];

  for (const obs of evidence) {
    keys.add(computeConfirmationKey({
      factId: obs.factId || obs.id,
      referencePeriod: obs.period || null,
      observationId: obs.observationId || obs.id,
      dependencyGroup: obs.dependencyGroup || 'OFFICIAL_MACRO',
      sessionDate: obs.session || (obs.observedAt ? String(obs.observedAt).slice(0, 10) : null)
    }));
  }

  for (const claim of claims) {
    keys.add(computeConfirmationKey({
      claimId: claim.claimId,
      dependencyGroup: claim.dependencyGroup || 'CLAIM_FAMILY'
    }));
  }

  for (const item of news) {
    keys.add(computeConfirmationKey({
      dependencyGroup: item.dependencyGroup || item.source || 'SYNDICATED_MEDIA'
    }));
  }

  return Array.from(keys).sort();
}

/**
 * Detects structural shock override events requiring immediate review.
 * Bypasses confirmation waiting without bypassing evidence validation.
 */
export function detectShockOverride(factPacket, currentStrategy = null) {
  const claims = Array.isArray(factPacket.claims) ? factPacket.claims : [];
  const evidence = Array.isArray(factPacket.evidence) ? factPacket.evidence : [];

  // 1. Official Primary Policy Events
  for (const claim of claims) {
    const isPolicy = claim.claimType === CLAIM_TYPES.POLICY_EVENT;
    const isPrimaryOfficial = claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL ||
                              claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.REGULATORY_OFFICIAL;
    if (isPolicy && isPrimaryOfficial) {
      return createShockOverride({
        triggerEvidence: [claim.claimId],
        scope: SHOCK_SCOPES.POLICY,
        reason: `Thông báo chính sách chính thức khẩn cấp: ${claim.subject}`,
        resolutionCondition: { type: 'POLICY_IMPLEMENTATION_CONFIRMED', subject: claim.subject }
      });
    }
  }

  // 2. Verified Market Interruption / Closure
  for (const claim of claims) {
    if (claim.claimType === CLAIM_TYPES.MARKET_EVENT && claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL) {
      if (/đình chỉ|ngừng giao dịch|market halt|market closure/i.test(claim.subject || '')) {
        return createShockOverride({
          triggerEvidence: [claim.claimId],
          scope: SHOCK_SCOPES.MARKET_WIDE,
          reason: `Sự kiện gián đoạn thị trường chính thức: ${claim.subject}`,
          resolutionCondition: { type: 'TRADING_RESUMED' }
        });
      }
    }
  }

  // 3. Authoritative retraction affecting current strategy
  for (const obs of evidence) {
    if (obs.status === 'retracted' || obs.isRetracted) {
      return createShockOverride({
        triggerEvidence: [obs.observationId || obs.id],
        scope: SHOCK_SCOPES.TACTICAL_RISK_OVERLAY,
        reason: `Rút lại số liệu chính thức (retraction): ${obs.label || obs.id}`,
        resolutionCondition: { type: 'REPLACEMENT_DATA_PUBLISHED', metric: obs.factId || obs.id }
      });
    }
  }

  // 4. Tactical risk overlay shock
  for (const claim of claims) {
    if (claim.isTacticalShock && (claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL || claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.REGULATORY_OFFICIAL)) {
      return createShockOverride({
        triggerEvidence: [claim.claimId],
        scope: SHOCK_SCOPES.TACTICAL_RISK_OVERLAY,
        reason: claim.subject,
        resolutionCondition: { type: 'TACTICAL_RISK_SUBSIDED' }
      });
    }
  }

  return null;
}

/**
 * Resolves an active ShockOverride based strictly on deterministic evidence.
 * GUARANTEE: Never resolves solely due to elapsed time.
 */
export function resolveShockOverride(shockOverride, factPacket, now = new Date()) {
  if (!shockOverride || shockOverride.status === SHOCK_STATUSES.RESOLVED) {
    return shockOverride;
  }

  const cond = shockOverride.resolutionCondition;
  if (!cond) return shockOverride;

  const nowIso = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const evidence = Array.isArray(factPacket?.evidence) ? factPacket.evidence : [];
  const claims = Array.isArray(factPacket?.claims) ? factPacket.claims : [];

  let isResolved = false;

  if (cond.type === 'POLICY_IMPLEMENTATION_CONFIRMED') {
    isResolved = claims.some(
      (c) => c.claimType === CLAIM_TYPES.POLICY_EVENT &&
             (c.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL || c.authorityLevel === CLAIM_AUTHORITY_LEVELS.REGULATORY_OFFICIAL) &&
             c.isResolved
    );
  } else if (cond.type === 'TRADING_RESUMED') {
    isResolved = claims.some(
      (c) => c.claimType === CLAIM_TYPES.MARKET_EVENT &&
             /giao dịch bình thường trở lại|trading resumed|mở cửa trở lại/i.test(c.subject || '')
    );
  } else if (cond.type === 'REPLACEMENT_DATA_PUBLISHED') {
    isResolved = evidence.some(
      (e) => (e.factId === cond.metric || e.id === cond.metric) &&
             e.status === 'available' &&
             !e.isRetracted
    );
  } else if (cond.type === 'TACTICAL_RISK_SUBSIDED') {
    isResolved = claims.some(
      (c) => c.isTacticalShockResolved || c.isResolved
    );
  }

  if (isResolved) {
    return createShockOverride({
      ...shockOverride,
      status: SHOCK_STATUSES.RESOLVED,
      resolvedAt: nowIso
    });
  }

  return shockOverride;
}

/**
 * Deterministic lifecycle state transition machine.
 */
export function transitionLifecycleState(currentState, event, context = {}) {
  switch (currentState) {
    case STRATEGY_LIFECYCLE_STATES.STABLE:
      if (event === 'UNCONFIRMED_SIGNAL') return STRATEGY_LIFECYCLE_STATES.WATCH;
      if (event === 'CONFIRMED_SIGNAL' || event === 'REVIEW_REQUIRED' || event === 'SHOCK_OVERRIDE') {
        return STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED;
      }
      return STRATEGY_LIFECYCLE_STATES.STABLE;

    case STRATEGY_LIFECYCLE_STATES.WATCH:
      if (event === 'WATCH_INVALIDATED' || event === 'SIGNAL_INVALIDATED') {
        return STRATEGY_LIFECYCLE_STATES.STABLE;
      }
      if (event === 'CONFIRMED_SIGNAL' || event === 'REVIEW_REQUIRED' || event === 'SHOCK_OVERRIDE') {
        return STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED;
      }
      return STRATEGY_LIFECYCLE_STATES.WATCH;

    case STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED:
      if (event === 'EVALUATION_STARTED') return STRATEGY_LIFECYCLE_STATES.EVALUATING;
      return STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED;

    case STRATEGY_LIFECYCLE_STATES.EVALUATING:
      if (event === 'EVALUATION_COMPLETED') {
        if (context.requiresMoreConfirmation) return STRATEGY_LIFECYCLE_STATES.WATCH;
        return STRATEGY_LIFECYCLE_STATES.STABLE;
      }
      if (event === 'EVALUATION_FAILED' || event === 'EVALUATION_DEFERRED' || event === 'EVALUATION_SUPERSEDED') {
        return STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED;
      }
      return STRATEGY_LIFECYCLE_STATES.EVALUATING;

    default:
      return currentState || STRATEGY_LIFECYCLE_STATES.STABLE;
  }
}

/**
 * Evaluates whether incoming validated evidence packet warrants deep AI strategy review
 * and determines operational strategy lifecycle transitions.
 * Strictly guarantees:
 * - NO opaque 0..100 scores
 * - NO uncalibrated market buffers or arbitrary price thresholds
 * - Transparent explainable structural reasons
 */
export function assessStrategyMateriality({
  currentStrategy = null,
  lastAssessment = null,
  factPacket,
  now = new Date()
} = {}) {
  if (!factPacket || typeof factPacket !== 'object') {
    throw new TypeError('assessStrategyMateriality requires a valid factPacket');
  }

  const dataQualityState = assessDataQuality(factPacket);
  const confirmationKeys = collectConfirmationKeys(factPacket);

  // 1. Cold start: if no strategy has ever been published, deep evaluation is required to establish baseline
  if (!currentStrategy) {
    return {
      requiresReview: true,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      dataQualityState,
      confirmationKeys,
      watchReasons: [],
      shockOverride: null,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.COLD_START_INITIAL_PUBLICATION,
          description: 'Khởi tạo chiến lược ban đầu (chưa có bản tin xuất bản trước đó).'
        }
      ]
    };
  }

  // Compute current evidence fingerprint
  const currentEvidenceFingerprint = factPacket.evidenceFingerprint || computeStrategistFingerprint({
    validFactIds: factPacket.validFactIds,
    validArticleIds: factPacket.validArticleIds,
    validSignalIds: factPacket.validSignalIds,
    validClaimIds: factPacket.validClaimIds,
    evidence: factPacket.evidence,
    untrustedNews: factPacket.untrustedNews,
    derivedSignals: factPacket.derivedSignals,
    claims: factPacket.claims
  });

  const baselineEvidenceFingerprint = lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint;
  const currentLifecycleState = lastAssessment?.lifecycleState || currentStrategy.lifecycleState || STRATEGY_LIFECYCLE_STATES.STABLE;

  // 2. Shock Override check (bypasses confirmation waiting)
  const shockOverride = detectShockOverride(factPacket, currentStrategy);
  if (shockOverride) {
    return {
      requiresReview: true,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      dataQualityState,
      confirmationKeys,
      watchReasons: [],
      shockOverride,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.SHOCK_OVERRIDE,
          scope: shockOverride.scope,
          reason: shockOverride.reason,
          description: `Kích hoạt cơ chế can thiệp khẩn cấp (SHOCK_OVERRIDE) cấp độ ${shockOverride.scope}: ${shockOverride.reason}`
        }
      ]
    };
  }

  // 3. Exact evidence match: if evidence fingerprint is identical and last assessment completed successfully
  if (
    currentEvidenceFingerprint === baselineEvidenceFingerprint &&
    lastAssessment?.evaluationStatus === 'COMPLETED'
  ) {
    return {
      requiresReview: false,
      lifecycleState: currentLifecycleState === STRATEGY_LIFECYCLE_STATES.WATCH ? STRATEGY_LIFECYCLE_STATES.WATCH : STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState,
      confirmationKeys,
      watchReasons: lastAssessment?.watchReasons || [],
      shockOverride: null,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.NO_EVIDENCE_CHANGE,
          description: 'Dữ kiện thị trường đã được kiểm chứng không thay đổi.'
        }
      ]
    };
  }

  const reasons = [];
  const watchReasons = [];

  const evidence = Array.isArray(factPacket.evidence) ? factPacket.evidence : [];
  const claims = Array.isArray(factPacket.claims) ? factPacket.claims : [];
  const untrustedNews = Array.isArray(factPacket.untrustedNews) ? factPacket.untrustedNews : [];

  // Extract evidence IDs cited by current strategy
  const citedEvidenceIds = new Set();
  const rawStrategy = currentStrategy.rawOutput || currentStrategy;
  if (rawStrategy.citations) {
    for (const id of rawStrategy.citations.factObservationIds || []) citedEvidenceIds.add(id);
    for (const id of rawStrategy.citations.articleIds || []) citedEvidenceIds.add(id);
  }
  if (Array.isArray(rawStrategy.evidence)) {
    for (const item of rawStrategy.evidence) {
      if (item.observationId) citedEvidenceIds.add(item.observationId);
      if (item.id) citedEvidenceIds.add(item.id);
      if (item.factId) citedEvidenceIds.add(item.factId);
    }
  }
  if (Array.isArray(rawStrategy.keyDrivers)) {
    for (const d of rawStrategy.keyDrivers) {
      for (const id of d.citations || []) citedEvidenceIds.add(id);
    }
  }
  if (Array.isArray(rawStrategy.assetStrategy)) {
    for (const item of rawStrategy.assetStrategy) {
      for (const id of item.evidenceIds || []) citedEvidenceIds.add(id);
    }
  }
  if (Array.isArray(rawStrategy.avoidOrUnderweight)) {
    for (const item of rawStrategy.avoidOrUnderweight) {
      for (const id of item.evidenceIds || []) citedEvidenceIds.add(id);
    }
  }
  if (Array.isArray(rawStrategy.preferredThemes)) {
    for (const item of rawStrategy.preferredThemes) {
      for (const id of item.evidenceIds || []) citedEvidenceIds.add(id);
    }
  }

  // 4. Check for official revisions of consumed or core facts
  for (const obs of evidence) {
    const isCited = citedEvidenceIds.size === 0 ||
      citedEvidenceIds.has(obs.observationId || obs.id) ||
      citedEvidenceIds.has(obs.factId) ||
      (obs.revisionOf && citedEvidenceIds.has(obs.revisionOf)) ||
      (obs.revision_of && citedEvidenceIds.has(obs.revision_of));
    const hasRevision = obs.revision === 'revised' || Boolean(obs.revisionOf) || Boolean(obs.revision_of) || Boolean(obs.isCorrection);
    if (hasRevision && isCited) {
      const revisionType = classifyEvidenceRevision(obs);
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED,
        factId: obs.factId || obs.id,
        observationId: obs.observationId || obs.id,
        revision: obs.revision,
        revisionType,
        description: `Dữ liệu chính thức được điều chỉnh cho chỉ số đã sử dụng: ${obs.label || obs.metric || obs.id}`
      });
    }
  }

  // 5. Check for claim state changes (CORROBORATED, CONTRADICTED, resolved contradictions)
  for (const claim of claims) {
    if (claim.supportStatus === CLAIM_STATUS.CORROBORATED) {
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.CLAIM_CORROBORATED,
        claimId: claim.claimId,
        subject: claim.subject,
        independentSourceCount: claim.independentSourceCount,
        description: `Luận điểm được xác nhận độc lập (CORROBORATED): ${claim.subject}`
      });
    } else if (claim.supportStatus === CLAIM_STATUS.CONTRADICTED) {
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.CLAIM_CONTRADICTED,
        claimId: claim.claimId,
        subject: claim.subject,
        contradictionCount: claim.contradictionCount,
        description: `Phát hiện mâu thuẫn dữ liệu (CONTRADICTED): ${claim.subject}`
      });
    }

    // High-authority official policy or market event claims
    if (
      (claim.claimType === CLAIM_TYPES.POLICY_EVENT || claim.claimType === CLAIM_TYPES.MARKET_EVENT) &&
      (claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL || claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.REGULATORY_OFFICIAL)
    ) {
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.STRUCTURED_POLICY_EVENT,
        claimId: claim.claimId,
        claimType: claim.claimType,
        authorityLevel: claim.authorityLevel,
        subject: claim.subject,
        description: `Sự kiện chính sách / thị trường chính thức: ${claim.subject}`
      });
    }
  }

  // 6. Check for evidence degradation to INSUFFICIENT or STALE on cited facts
  for (const obs of evidence) {
    const isCited = citedEvidenceIds.size === 0 || citedEvidenceIds.has(obs.observationId || obs.id) || citedEvidenceIds.has(obs.factId);
    if (isCited) {
      if (obs.status === 'unavailable' || obs.freshness === 'stale' || obs.status === 'stale') {
        reasons.push({
          type: MATERIALITY_TRIGGER_TYPES.EVIDENCE_QUALITY_DEGRADATION,
          factId: obs.factId || obs.id,
          observationId: obs.observationId || obs.id,
          status: obs.status,
          freshness: obs.freshness,
          description: `Độ tươi hoặc khả dụng của dữ kiện bị suy giảm: ${obs.label || obs.id}`
        });
      }
    }
  }

  // Check data quality degradation
  if (dataQualityState === DATA_QUALITY_STATES.INSUFFICIENT && lastAssessment?.dataQualityState !== DATA_QUALITY_STATES.INSUFFICIENT) {
    reasons.push({
      type: MATERIALITY_TRIGGER_TYPES.DATA_QUALITY_DEGRADATION,
      dataQualityState,
      description: 'Chất lượng dữ liệu thị trường suy giảm xuống mức INSUFFICIENT.'
    });
  }

  // 7. Check invalidation conditions if explicitly defined on current strategy
  const invalidationConditions = Array.isArray(currentStrategy.invalidationConditions)
    ? currentStrategy.invalidationConditions
    : [];

  for (const cond of invalidationConditions) {
    if (cond && typeof cond === 'object' && cond.metric && cond.threshold !== undefined) {
      const matchingObs = evidence.find((e) => (e.factId === cond.metric || e.id === cond.metric));
      if (matchingObs && typeof matchingObs.value === 'number') {
        let isHit = false;
        if (cond.operator === '>' && matchingObs.value > cond.threshold) isHit = true;
        if (cond.operator === '<' && matchingObs.value < cond.threshold) isHit = true;
        if (cond.operator === '>=' && matchingObs.value >= cond.threshold) isHit = true;
        if (cond.operator === '<=' && matchingObs.value <= cond.threshold) isHit = true;
        if (isHit) {
          reasons.push({
            type: MATERIALITY_TRIGGER_TYPES.INVALIDATION_CONDITION_TRIGGERED,
            condition: cond,
            observedValue: matchingObs.value,
            description: `Điều kiện vô hiệu hóa chiến lược kích hoạt: ${cond.description || cond.metric}`
          });
        }
      }
    }
  }

  // 8. Structural Hysteresis & Confirmation State Machine
  if (currentLifecycleState === STRATEGY_LIFECYCLE_STATES.WATCH) {
    // If currently in WATCH: check if previous watch reasons were confirmed or invalidated
    const previousWatchKeys = (lastAssessment?.watchReasons || []).flatMap((r) => r.confirmationKeys || []);
    const stillPresent = previousWatchKeys.some((k) => confirmationKeys.includes(k));

    if (!stillPresent && previousWatchKeys.length > 0 && reasons.length === 0) {
      // Evidence concern disappeared / invalidated -> transition back to STABLE
      return {
        requiresReview: false,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState,
        confirmationKeys,
        watchReasons: [],
        shockOverride: null,
        reasons: [
          {
            type: MATERIALITY_TRIGGER_TYPES.WATCH_INVALIDATED,
            description: 'Tín hiệu theo dõi (WATCH) không còn xuất hiện hoặc đã bị vô hiệu hóa; quay lại trạng thái STABLE.'
          }
        ]
      };
    }

    // Check if new independent confirmation arrived for WATCH signal
    const hasNewIndependentConfirmation = claims.some(
      (c) => c.independentSourceCount > 1 && c.supportStatus === CLAIM_STATUS.CORROBORATED
    ) || reasons.some((r) => r.type === MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED);

    if (hasNewIndependentConfirmation || reasons.length > 0) {
      return {
        requiresReview: true,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
        dataQualityState,
        confirmationKeys,
        watchReasons: [],
        shockOverride: null,
        reasons: reasons.length > 0 ? reasons : [
          {
            type: MATERIALITY_TRIGGER_TYPES.CONFIRMED_SIGNAL,
            description: 'Tín hiệu theo dõi đã nhận được xác nhận cấu trúc độc lập đầy đủ; chuyển sang REVIEW_REQUIRED.'
          }
        ]
      };
    }

    // Still unconfirmed: remain in WATCH
    return {
      requiresReview: false,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH,
      dataQualityState,
      confirmationKeys,
      watchReasons: lastAssessment?.watchReasons || [],
      shockOverride: null,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.UNCONFIRMED_SIGNAL,
          description: 'Dữ liệu mới đáng chú ý nhưng chưa đủ xác nhận cấu trúc độc lập; duy trì trạng thái WATCH.'
        }
      ]
    };
  }

  // Current state is STABLE (or REVIEW_REQUIRED)
  // Check if there is an unconfirmed notable signal (e.g. single-source preliminary signal or unconfirmed claim)
  const unconfirmedClaims = claims.filter((c) => c.supportStatus === CLAIM_STATUS.SINGLE_SOURCE && c.isNotable);
  const unconfirmedSignals = (factPacket.derivedSignals || []).filter((s) => s.isUnconfirmed);

  if (reasons.length === 0 && (unconfirmedClaims.length > 0 || unconfirmedSignals.length > 0)) {
    // Unconfirmed signal change -> transition to WATCH
    const unconfirmedKeys = unconfirmedClaims.map((c) => c.claimId).concat(unconfirmedSignals.map((s) => s.signalId));
    watchReasons.push({
      type: 'UNCONFIRMED_SIGNAL_CHANGE',
      confirmationKeys: unconfirmedKeys,
      evidenceIds: unconfirmedKeys,
      description: 'Xuất hiện tín hiệu đáng chú ý nhưng chưa đủ nguồn độc lập xác nhận; chuyển sang trạng thái WATCH.'
    });

    return {
      requiresReview: false,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH,
      dataQualityState,
      confirmationKeys,
      watchReasons,
      shockOverride: null,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.UNCONFIRMED_SIGNAL,
          description: 'Tín hiệu đáng chú ý chưa đủ xác nhận; chuyển sang theo dõi (WATCH).'
        }
      ]
    };
  }

  // 9. Non-material news check:
  if (reasons.length === 0) {
    const hasNovelIndependentClaim = claims.some(
      (c) => c.independentSourceCount > 1 && c.supportStatus !== CLAIM_STATUS.SINGLE_SOURCE
    );

    if (!hasNovelIndependentClaim && untrustedNews.length > 0) {
      return {
        requiresReview: false,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState,
        confirmationKeys,
        watchReasons: [],
        shockOverride: null,
        reasons: [
          {
            type: MATERIALITY_TRIGGER_TYPES.NON_MATERIAL_NEWS_ONLY,
            description: 'Tin tức mới chưa tạo ra luận điểm hoặc bằng chứng độc lập thay đổi quyết định.'
          }
        ]
      };
    }
  }

  const requiresReview = reasons.length > 0;
  return {
    requiresReview,
    lifecycleState: requiresReview ? STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED : STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState,
    confirmationKeys,
    watchReasons: [],
    shockOverride: null,
    reasons
  };
}
