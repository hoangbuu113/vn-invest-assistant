import { assessConfidence } from './confidenceEngine.js';
import { CONFIDENCE_TARGET_TYPES } from './confidenceModel.js';
import { PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1 } from './confidenceProfiles.js';
import {
  listCalibrationManifests,
  persistConfidenceAssessment
} from './confidenceRepository.js';

function buildDeterministicAnalyticReview(stabilityResult) {
  return Object.freeze({
    complete: false,
    assumptions: Object.freeze([]),
    alternativeExplanations: Object.freeze([]),
    counterEvidence: Object.freeze([]),
    sensitivity: null,
    modelApplicability: 'UNREVIEWED',
    materialLimitations: Object.freeze([]),
    revisionImpactPendingEvidenceIds: Object.freeze([]),
    source: 'DETERMINISTIC_FRAMEWORK_DEFAULT',
    strategyDecision: stabilityResult?.latestAssessmentResult || null
  });
}

export async function attachMarketStrategyConfidence({
  factPacket,
  strategyResult,
  now,
  client,
  isReadOnly = false,
  profile = PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
  analyticReview = null,
  listCalibrationManifestsFn = listCalibrationManifests,
  persistConfidenceAssessmentFn = persistConfidenceAssessment
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Confidence integration requires an explicit valid now Date');
  }
  const targetId = strategyResult?.strategyId || `unpublished:${factPacket?.evidenceFingerprint || 'market-strategy'}`;
  const manifests = profile
    ? await listCalibrationManifestsFn({
        targetType: profile.targetType,
        scope: profile.scope,
        policyVersion: profile.policyVersion,
        client
      })
    : [];
  const assessment = assessConfidence({
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    targetId,
    scope: profile?.scope || 'MARKET_STRATEGY_VN_MEDIUM_HORIZON',
    horizon: profile?.horizon || 'medium',
    cutoff: now,
    asOf: now,
    evidence: factPacket?.evidence || [],
    profile,
    calibrationManifests: manifests,
    analyticReview: analyticReview || buildDeterministicAnalyticReview(strategyResult),
    strategyAssessmentId: strategyResult?.lastAssessment?.assessmentId || null,
    strategyId: strategyResult?.strategyId || null,
    strategyVersion: strategyResult?.policyVersion || null
  });

  if (isReadOnly) {
    return { ...strategyResult, confidenceAssessment: assessment };
  }

  await persistConfidenceAssessmentFn(assessment, client);
  return { ...strategyResult, confidenceAssessment: assessment };
}
