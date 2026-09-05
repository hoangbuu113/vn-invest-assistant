import { computeStrategistFingerprint } from './marketStrategistEngine.js';
import { CLAIM_STATUS, CLAIM_TYPES, CLAIM_AUTHORITY_LEVELS } from '../claims/claimModel.js';
import { DEPENDENCY_GROUPS } from '../claims/sourceFamily.js';

export const MATERIALITY_TRIGGER_TYPES = Object.freeze({
  COLD_START_INITIAL_PUBLICATION: 'COLD_START_INITIAL_PUBLICATION',
  NO_EVIDENCE_CHANGE: 'NO_EVIDENCE_CHANGE',
  CLAIM_STATE_CHANGE: 'CLAIM_STATE_CHANGE',
  CLAIM_CORROBORATED: 'CLAIM_CORROBORATED',
  CLAIM_CONTRADICTED: 'CLAIM_CONTRADICTED',
  CONTRADICTION_RESOLVED: 'CONTRADICTION_RESOLVED',
  OFFICIAL_REVISION_CONSUMED: 'OFFICIAL_REVISION_CONSUMED',
  EVIDENCE_QUALITY_DEGRADATION: 'EVIDENCE_QUALITY_DEGRADATION',
  STRUCTURED_POLICY_EVENT: 'STRUCTURED_POLICY_EVENT',
  INVALIDATION_CONDITION_TRIGGERED: 'INVALIDATION_CONDITION_TRIGGERED',
  NON_MATERIAL_NEWS_ONLY: 'NON_MATERIAL_NEWS_ONLY'
});

/**
 * Evaluates whether incoming validated evidence packet warrants deep AI strategy review.
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

  // 1. Cold start: if no strategy has ever been published, deep evaluation is required to establish baseline
  if (!currentStrategy) {
    return {
      requiresReview: true,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.COLD_START_INITIAL_PUBLICATION,
          description: 'Khởi tạo chiến lược ban đầu (chưa có bản tin xuất bản trước đó).'
        }
      ]
    };
  }

  // Compute or extract current evidence fingerprint
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

  // 2. Exact evidence match: if evidence fingerprint is identical and last assessment completed, review is skipped
  if (
    currentEvidenceFingerprint === baselineEvidenceFingerprint &&
    lastAssessment?.evaluationStatus === 'COMPLETED'
  ) {
    return {
      requiresReview: false,
      reasons: [
        {
          type: MATERIALITY_TRIGGER_TYPES.NO_EVIDENCE_CHANGE,
          description: 'Dữ kiện thị trường đã được kiểm chứng không thay đổi.'
        }
      ]
    };
  }

  const reasons = [];

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
      for (const id of item.evidenceIds || []) {
        citedEvidenceIds.add(id);
      }
    }
  }
  if (Array.isArray(rawStrategy.avoidOrUnderweight)) {
    for (const item of rawStrategy.avoidOrUnderweight) {
      for (const id of item.evidenceIds || []) {
        citedEvidenceIds.add(id);
      }
    }
  }
  if (Array.isArray(rawStrategy.preferredThemes)) {
    for (const item of rawStrategy.preferredThemes) {
      for (const id of item.evidenceIds || []) {
        citedEvidenceIds.add(id);
      }
    }
  }

  // 3. Check for official revisions of consumed or core facts
  for (const obs of evidence) {
    const isCited = citedEvidenceIds.size === 0 ||
      citedEvidenceIds.has(obs.observationId || obs.id) ||
      citedEvidenceIds.has(obs.factId) ||
      (obs.revisionOf && citedEvidenceIds.has(obs.revisionOf)) ||
      (obs.revision_of && citedEvidenceIds.has(obs.revision_of));
    const hasRevision = obs.revision === 'revised' || Boolean(obs.revisionOf) || Boolean(obs.revision_of);
    if (hasRevision && isCited) {
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.OFFICIAL_REVISION_CONSUMED,
        factId: obs.factId || obs.id,
        observationId: obs.observationId || obs.id,
        revision: obs.revision,
        description: `Dữ liệu chính thức được điều chỉnh cho chỉ số đã sử dụng: ${obs.label || obs.metric || obs.id}`
      });
    }
  }

  // 4. Check for claim state changes (CORROBORATED, CONTRADICTED, resolved contradictions)
  for (const claim of claims) {
    if (claim.supportStatus === CLAIM_STATUS.CORROBORATED) {
      // Independent corroboration established
      reasons.push({
        type: MATERIALITY_TRIGGER_TYPES.CLAIM_CORROBORATED,
        claimId: claim.claimId,
        subject: claim.subject,
        independentSourceCount: claim.independentSourceCount,
        description: `Luận điểm được xác nhận độc lập (CORROBORATED): ${claim.subject}`
      });
    } else if (claim.supportStatus === CLAIM_STATUS.CONTRADICTED) {
      // Active contradiction detected
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

  // 5. Check for evidence degradation to INSUFFICIENT or STALE on cited facts
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

  // 6. Check invalidation conditions if explicitly defined on current strategy
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

  // 7. News dependency check:
  // If no other structural reasons exist, check if evidence change is merely additional news articles
  // originating from already-seen dependency groups or syndicated copies
  if (reasons.length === 0) {
    // Check if new articles add any novel independent claim
    const hasNovelIndependentClaim = claims.some(
      (c) => c.independentSourceCount > 1 && c.supportStatus !== CLAIM_STATUS.SINGLE_SOURCE
    );

    if (!hasNovelIndependentClaim && untrustedNews.length > 0) {
      // Non-material news update (e.g. repeated or syndicated news without new independent corroboration)
      return {
        requiresReview: false,
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
    reasons
  };
}
