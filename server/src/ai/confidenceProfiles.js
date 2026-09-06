import { CONFIDENCE_ASSESSMENT_POLICY_VERSION, CONFIDENCE_TARGET_TYPES } from './confidenceModel.js';

export const REQUIREMENT_PROFILE_VERSION = 'vn-market-strategy-confidence-profile-v1';

export const EVIDENCE_GROUPS = Object.freeze({
  OFFICIAL_MACRO: 'OFFICIAL_MACRO',
  MONETARY_POLICY: 'MONETARY_POLICY',
  MARKET_REFERENCE: 'MARKET_REFERENCE',
  CLAIM_FAMILY: 'CLAIM_FAMILY',
  INTERMARKET: 'INTERMARKET'
});

export const FRESHNESS_BEHAVIOR = Object.freeze({
  REQUIRE_CURRENT: 'REQUIRE_CURRENT',
  ALLOW_CADENCE_VALID_CARRY_FORWARD: 'ALLOW_CADENCE_VALID_CARRY_FORWARD',
  EVENT_DRIVEN: 'EVENT_DRIVEN'
});

function supportPath(pathId, evidenceGroup, options = {}) {
  return Object.freeze({
    pathId,
    evidenceGroup,
    authorityLevels: Object.freeze([...(options.authorityLevels || [])]),
    freshnessBehavior: options.freshnessBehavior || FRESHNESS_BEHAVIOR.REQUIRE_CURRENT,
    supportLevel: options.supportLevel || 'PRIMARY',
    requiresAnalyticSupport: options.requiresAnalyticSupport === true
  });
}

function requirement(requirementId, scope, paths, messageKey) {
  return Object.freeze({
    requirementId,
    scope,
    paths: Object.freeze(paths),
    messageKey
  });
}

/**
 * Governed structural profile for the existing Vietnam medium-horizon market
 * strategist. It defines evidence kinds, not numerical market thresholds.
 */
export const PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1 = Object.freeze({
  profileId: 'MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1',
  profileVersion: REQUIREMENT_PROFILE_VERSION,
  targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
  scope: 'MARKET_STRATEGY_VN_MEDIUM_HORIZON',
  horizon: 'medium',
  policyVersion: CONFIDENCE_ASSESSMENT_POLICY_VERSION,
  essentialRequirements: Object.freeze([
    requirement('REQ_VN_MARKET_STATE', 'vn_market', [
      supportPath('PATH_VN_MARKET_REFERENCE', EVIDENCE_GROUPS.MARKET_REFERENCE, {
        authorityLevels: ['MARKET_DIRECT', 'MARKET_REFERENCE'],
        freshnessBehavior: FRESHNESS_BEHAVIOR.REQUIRE_CURRENT
      })
    ], 'confidence.requirement.vn_market_state'),
    requirement('REQ_VN_MACRO_CONTEXT', 'vn_macro', [
      supportPath('PATH_OFFICIAL_VN_MACRO', EVIDENCE_GROUPS.OFFICIAL_MACRO, {
        authorityLevels: ['PRIMARY_OFFICIAL', 'REGULATORY_OFFICIAL'],
        freshnessBehavior: FRESHNESS_BEHAVIOR.ALLOW_CADENCE_VALID_CARRY_FORWARD
      })
    ], 'confidence.requirement.vn_macro_context'),
    requirement('REQ_VN_MONETARY_CONTEXT', 'vn_monetary', [
      supportPath('PATH_OFFICIAL_VN_MONETARY', EVIDENCE_GROUPS.MONETARY_POLICY, {
        authorityLevels: ['REGULATORY_OFFICIAL'],
        freshnessBehavior: FRESHNESS_BEHAVIOR.EVENT_DRIVEN
      })
    ], 'confidence.requirement.vn_monetary_context')
  ]),
  highOnlyRequirements: Object.freeze([
    Object.freeze({
      requirementId: 'REQ_STRUCTURED_ANALYTIC_REVIEW',
      type: 'ANALYTIC_REVIEW_COMPLETE',
      messageKey: 'confidence.requirement.structured_analytic_review'
    })
  ]),
  analyticReviewRequirements: Object.freeze({
    requiredForAssessment: false,
    requiredForHigh: true,
    fields: Object.freeze([
      'assumptions',
      'alternativeExplanations',
      'counterEvidence',
      'sensitivity',
      'modelApplicability'
    ])
  }),
  calibrationApplicability: Object.freeze({
    requiredForPublicHigh: true,
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    scope: 'MARKET_STRATEGY_VN_MEDIUM_HORIZON',
    horizon: 'medium',
    profileVersion: REQUIREMENT_PROFILE_VERSION,
    policyVersion: CONFIDENCE_ASSESSMENT_POLICY_VERSION
  }),
  unconfiguredItems: Object.freeze([
    'NUMERIC_WEIGHTS',
    'NUMERIC_SCORE',
    'SAMPLE_SIZE_THRESHOLD',
    'ACCURACY_TARGET',
    'CONFIDENCE_INTERVAL',
    'FALSE_HIGH_TOLERANCE',
    'NUMERIC_HYSTERESIS'
  ])
});

export const CONFIDENCE_PROFILES = Object.freeze({
  [PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.profileId]: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1
});

export function resolveProfile(targetType, scope) {
  return Object.values(CONFIDENCE_PROFILES).find((profile) => (
    profile.targetType === targetType && profile.scope === scope
  )) || null;
}
