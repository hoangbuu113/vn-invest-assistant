export const MONETARY_POLICY_VERSION = 'monetary-evidence-policy-v2';

export const MONETARY_REQUIREMENT_IDS = Object.freeze({
  POLICY_CONTEXT: 'REQ_VN_MONETARY_POLICY_CONTEXT',
  TRANSMISSION_CONTEXT: 'REQ_VN_MONETARY_TRANSMISSION_CONTEXT',
  FX_ADMIN_REFERENCE: 'REQ_VN_MONETARY_FX_ADMIN_REFERENCE',
  FX_MARKET_REFERENCE: 'REQ_VN_MONETARY_FX_MARKET_REFERENCE',
  INTERBANK_CONDITIONS: 'REQ_VN_MONETARY_INTERBANK_CONDITIONS',
  OMO_OPERATIONS: 'REQ_VN_MONETARY_OMO_OPERATIONS',
  CREDIT_CONDITIONS: 'REQ_VN_MONETARY_CREDIT_CONDITIONS',
  OFFICIAL_POLICY_STATEMENT: 'REQ_VN_MONETARY_OFFICIAL_POLICY_STATEMENT'
});

export const MONETARY_AUTHORITY_LEVELS = Object.freeze({
  REGULATORY_OFFICIAL: 'REGULATORY_OFFICIAL',
  PRIMARY_OFFICIAL: 'PRIMARY_OFFICIAL',
  GOVERNMENT_REPUBLICATION: 'GOVERNMENT_REPUBLICATION',
  OFFICIAL_INTERNATIONAL_DISTRIBUTOR: 'OFFICIAL_INTERNATIONAL_DISTRIBUTOR',
  MARKET_REFERENCE: 'MARKET_REFERENCE',
  MARKET_DIRECT: 'MARKET_DIRECT'
});

export const MONETARY_SUPPORT_PATHS = Object.freeze({
  PATH_SBV_DIRECT: Object.freeze({
    pathId: 'PATH_SBV_DIRECT',
    authorityLevels: Object.freeze(['REGULATORY_OFFICIAL']),
    originIssuers: Object.freeze(['SBV']),
    supportLevel: 'PRIMARY',
    enabledByDefault: true
  }),
  PATH_SBV_VERIFIED_ATTACHMENT: Object.freeze({
    pathId: 'PATH_SBV_VERIFIED_ATTACHMENT',
    authorityLevels: Object.freeze(['REGULATORY_OFFICIAL']),
    originIssuers: Object.freeze(['SBV']),
    supportLevel: 'PRIMARY',
    enabledByDefault: true
  }),
  PATH_VN_OFFICIAL_REPUBLICATION: Object.freeze({
    pathId: 'PATH_VN_OFFICIAL_REPUBLICATION',
    authorityLevels: Object.freeze(['GOVERNMENT_REPUBLICATION', 'PRIMARY_OFFICIAL']),
    originIssuers: Object.freeze(['SBV']),
    supportLevel: 'ALTERNATIVE',
    enabledByDefault: false
  }),
  PATH_OFFICIAL_INTERNATIONAL_DISTRIBUTOR: Object.freeze({
    pathId: 'PATH_OFFICIAL_INTERNATIONAL_DISTRIBUTOR',
    authorityLevels: Object.freeze(['OFFICIAL_INTERNATIONAL_DISTRIBUTOR']),
    originIssuers: Object.freeze(['SBV']),
    supportLevel: 'ALTERNATIVE',
    enabledByDefault: false
  }),
  PATH_APPROVED_SECONDARY_MARKET_REFERENCE: Object.freeze({
    pathId: 'PATH_APPROVED_SECONDARY_MARKET_REFERENCE',
    authorityLevels: Object.freeze(['MARKET_REFERENCE']),
    supportLevel: 'ALTERNATIVE',
    enabledByDefault: false,
    maxPublicGrade: 'MEDIUM'
  }),
  PATH_NSO_OFFICIAL_CREDIT: Object.freeze({
    pathId: 'PATH_NSO_OFFICIAL_CREDIT',
    authorityLevels: Object.freeze(['PRIMARY_OFFICIAL']),
    originIssuers: Object.freeze(['NSO']),
    supportLevel: 'ALTERNATIVE',
    enabledByDefault: false
  }),
  PATH_MARKET_FX_REFERENCE: Object.freeze({
    pathId: 'PATH_MARKET_FX_REFERENCE',
    authorityLevels: Object.freeze(['MARKET_DIRECT', 'MARKET_REFERENCE']),
    supportLevel: 'PRIMARY',
    enabledByDefault: true
  })
});

const REQUIREMENTS = Object.freeze({
  [MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE,
    scope: 'vn_monetary.fx_market_reference',
    factIds: Object.freeze(['vn.monetary.fx.usd_vnd']),
    pathIds: Object.freeze(['PATH_MARKET_FX_REFERENCE']),
    messageKey: 'confidence.requirement.vn_monetary.fx_market_reference'
  }),
  [MONETARY_REQUIREMENT_IDS.FX_ADMIN_REFERENCE]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.FX_ADMIN_REFERENCE,
    scope: 'vn_monetary.fx_administrative_reference',
    factIds: Object.freeze(['vn.monetary.fx.sbv_central.usd_vnd']),
    supportScope: 'FX_ADMIN_REFERENCE',
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_VN_OFFICIAL_REPUBLICATION']),
    messageKey: 'confidence.requirement.vn_monetary.fx_admin_reference'
  }),
  [MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS,
    scope: 'vn_monetary.interbank_conditions',
    factIds: Object.freeze(['vn.monetary.rate.vnd_overnight', 'vn.monetary.interbank.vnd.overnight.daily_avg_rate']),
    supportScope: 'INTERBANK_CONDITIONS',
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_OFFICIAL_INTERNATIONAL_DISTRIBUTOR', 'PATH_APPROVED_SECONDARY_MARKET_REFERENCE']),
    messageKey: 'confidence.requirement.vn_monetary.interbank_conditions'
  }),
  [MONETARY_REQUIREMENT_IDS.OMO_OPERATIONS]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.OMO_OPERATIONS,
    scope: 'vn_monetary.omo_operations',
    factPrefixes: Object.freeze(['vn.monetary.omo.']),
    supportScope: 'OMO_OPERATIONS',
    requiredEvidenceFields: Object.freeze(['operationType', 'maturityDate', 'netEffect']),
    requiredFiniteFields: Object.freeze(['netEffect']),
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_VN_OFFICIAL_REPUBLICATION']),
    messageKey: 'confidence.requirement.vn_monetary.omo_operations'
  }),
  [MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS,
    scope: 'vn_monetary.credit_conditions',
    factIds: Object.freeze(['vn.monetary.credit.outstanding.ytd_growth']),
    factPrefixes: Object.freeze(['vn.monetary.credit.']),
    supportScope: 'CREDIT_CONDITIONS',
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_VN_OFFICIAL_REPUBLICATION', 'PATH_OFFICIAL_INTERNATIONAL_DISTRIBUTOR', 'PATH_NSO_OFFICIAL_CREDIT']),
    messageKey: 'confidence.requirement.vn_monetary.credit_conditions'
  }),
  [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT,
    scope: 'vn_monetary.policy_context',
    factPrefixes: Object.freeze(['vn.monetary.policy.']),
    supportScope: 'POLICY_CONTEXT',
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_VN_OFFICIAL_REPUBLICATION']),
    messageKey: 'confidence.requirement.vn_monetary.policy_context'
  }),
  [MONETARY_REQUIREMENT_IDS.OFFICIAL_POLICY_STATEMENT]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.OFFICIAL_POLICY_STATEMENT,
    scope: 'vn_monetary.official_policy_statement',
    factPrefixes: Object.freeze(['vn.monetary.policy.decision.', 'vn.monetary.policy.statement.']),
    supportScope: 'OFFICIAL_POLICY_STATEMENT',
    requiredEvidenceFields: Object.freeze(['policyInstrument', 'previousValue', 'effectiveFrom']),
    requiredFiniteFields: Object.freeze(['previousValue']),
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT']),
    messageKey: 'confidence.requirement.vn_monetary.official_policy_statement'
  }),
  [MONETARY_REQUIREMENT_IDS.TRANSMISSION_CONTEXT]: Object.freeze({
    requirementId: MONETARY_REQUIREMENT_IDS.TRANSMISSION_CONTEXT,
    scope: 'vn_monetary.transmission_context',
    factPrefixes: Object.freeze(['vn.monetary.interbank.', 'vn.monetary.credit.', 'vn.monetary.money_supply.']),
    supportScope: 'TRANSMISSION_CONTEXT',
    pathIds: Object.freeze(['PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT', 'PATH_VN_OFFICIAL_REPUBLICATION', 'PATH_OFFICIAL_INTERNATIONAL_DISTRIBUTOR']),
    messageKey: 'confidence.requirement.vn_monetary.transmission_context'
  })
});

export const MONETARY_REQUIREMENTS = REQUIREMENTS;

const exactSubjectRequirements = new Map([
  ['vn.monetary.fx.usd_vnd', [MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE]],
  ['vn.monetary.fx.commercial.usd_vnd', [MONETARY_REQUIREMENT_IDS.FX_MARKET_REFERENCE]],
  ['vn.monetary.fx.sbv_central.usd_vnd', [MONETARY_REQUIREMENT_IDS.FX_ADMIN_REFERENCE]],
  ['vn.monetary.rate.vnd_overnight', [MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS]],
  ['vn.monetary.interbank.vnd.overnight.daily_avg_rate', [MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS]],
  ['vn.monetary.credit.outstanding.ytd_growth', [MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS]],
  ['vn.monetary.stance.composite', [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT, MONETARY_REQUIREMENT_IDS.TRANSMISSION_CONTEXT]]
]);

function requirementsForClaim(claim = {}) {
  const subject = String(claim.subject || '');
  const exact = exactSubjectRequirements.get(subject);
  if (exact) return exact;
  if (subject.startsWith('vn.monetary.policy.decision.') || (
    subject.startsWith('vn.monetary.policy.')
    && (claim.claimType === 'POLICY_EVENT' || ['CHANGED', 'INCREASED', 'DECREASED'].includes(String(claim.predicate || '').toUpperCase()))
  )) {
    return [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT, MONETARY_REQUIREMENT_IDS.OFFICIAL_POLICY_STATEMENT];
  }
  if (subject.startsWith('vn.monetary.policy.')) return [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT];
  if (subject.startsWith('vn.monetary.omo.')) return [MONETARY_REQUIREMENT_IDS.OMO_OPERATIONS];
  if (subject.startsWith('vn.monetary.credit.')) return [MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS];
  if (subject.startsWith('vn.monetary.interbank.')) return [MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS];
  return [];
}

/** Resolve monetary dependencies only from deterministic claim/signal identifiers. */
export function resolveMonetaryDependencies({ claims = [], derivedSignals = [], evidence = [], decisionMetadata = null } = {}) {
  const evidenceById = new Map((Array.isArray(evidence) ? evidence : []).map((item) => [item.observationId || item.id, item]));
  const dependencyMap = new Map();
  const add = (claimId, subject, requirementId, sourceType) => {
    const key = `${claimId}:${requirementId}`;
    if (!dependencyMap.has(key)) dependencyMap.set(key, Object.freeze({ claimId, subject, requirementId, sourceType }));
  };

  for (const claim of Array.isArray(claims) ? claims : []) {
    if (claim?.monetaryDependencyEligible === false) continue;
    for (const requirementId of requirementsForClaim(claim)) {
      const key = `${claim.claimId || `claim:${claim.subject}`}:${requirementId}`;
      if (!dependencyMap.has(key)) dependencyMap.set(key, Object.freeze({
        claimId: claim.claimId || `claim:${claim.subject}`,
        subject: claim.subject,
        predicate: claim.predicate || null,
        claimType: claim.claimType || null,
        requirementId,
        sourceType: 'DETERMINISTIC_CLAIM'
      }));
    }
  }

  for (const signal of Array.isArray(derivedSignals) ? derivedSignals : []) {
    if (!['FX_PRESSURE', 'MONETARY_STANCE'].includes(signal?.signalType)) continue;
    for (const id of signal.inputEvidenceIds || []) {
      const factId = evidenceById.get(id)?.factId || '';
      for (const requirementId of requirementsForClaim({ subject: factId })) {
        add(signal.signalId, factId, requirementId, 'DETERMINISTIC_SIGNAL');
      }
    }
  }

  if (decisionMetadata?.source === 'DETERMINISTIC_SERVER') {
    for (const requirementId of decisionMetadata.monetaryRequirementIds || []) {
      if (!REQUIREMENTS[requirementId]) continue;
      add(`strategy-assumption:${requirementId}`, null, requirementId, 'DETERMINISTIC_STRATEGY_METADATA');
    }
  }

  const claimDependencies = [...dependencyMap.values()].sort((a, b) => a.requirementId.localeCompare(b.requirementId) || a.claimId.localeCompare(b.claimId));
  return Object.freeze({
    policyVersion: MONETARY_POLICY_VERSION,
    claimDependencies: Object.freeze(claimDependencies),
    activeRequirementIds: Object.freeze([...new Set(claimDependencies.map((item) => item.requirementId))].sort())
  });
}

export function buildMonetaryRequirements(activeRequirementIds = [], { enabledPathIds = [], claimDependencies = [] } = {}) {
  const explicitlyEnabled = new Set(enabledPathIds);
  return Object.freeze([...new Set(activeRequirementIds)].map((id) => {
    const definition = REQUIREMENTS[id];
    if (!definition) return null;
    const paths = definition.pathIds.map((pathId) => MONETARY_SUPPORT_PATHS[pathId]).filter((path) => path && (path.enabledByDefault || explicitlyEnabled.has(path.pathId))).map((path) => Object.freeze({
      ...path,
      evidenceGroup: 'MONETARY_SCOPED',
      factIds: definition.factIds || Object.freeze([]),
      factPrefixes: definition.factPrefixes || Object.freeze([]),
      supportScope: definition.supportScope || null,
      requiredEvidenceFields: definition.requiredEvidenceFields || Object.freeze([]),
      requiredFiniteFields: definition.requiredFiniteFields || Object.freeze([]),
      requiresDirectionalComparison: claimDependencies.some((item) => (
        item.requirementId === id
        && ['RISING', 'FALLING', 'INCREASED', 'DECREASED', 'EASING', 'TIGHTENING'].includes(String(item.predicate || '').toUpperCase())
      )),
      freshnessBehavior: [
        MONETARY_REQUIREMENT_IDS.INTERBANK_CONDITIONS,
        MONETARY_REQUIREMENT_IDS.CREDIT_CONDITIONS,
        MONETARY_REQUIREMENT_IDS.TRANSMISSION_CONTEXT
      ].includes(id)
        ? 'ALLOW_CADENCE_VALID_CARRY_FORWARD'
        : [MONETARY_REQUIREMENT_IDS.POLICY_CONTEXT, MONETARY_REQUIREMENT_IDS.OFFICIAL_POLICY_STATEMENT].includes(id)
          ? 'EVENT_DRIVEN'
          : 'REQUIRE_CURRENT'
    }));
    return Object.freeze({
      requirementId: definition.requirementId,
      scope: definition.scope,
      paths: Object.freeze(paths),
      messageKey: definition.messageKey,
      claimDependencies: Object.freeze(claimDependencies.filter((item) => item.requirementId === id))
    });
  }).filter(Boolean));
}

export function resolveMonetaryConfidenceProfile(baseProfile, factPacket, options = {}) {
  const dependencies = factPacket?.monetaryDependencies || resolveMonetaryDependencies(factPacket || {});
  const monetaryRequirements = buildMonetaryRequirements(dependencies.activeRequirementIds, {
    ...options,
    claimDependencies: dependencies.claimDependencies
  });
  const nonMonetary = (baseProfile?.essentialRequirements || []).filter((item) => item.requirementId !== 'REQ_VN_MONETARY_CONTEXT');
  return Object.freeze({
    ...baseProfile,
    essentialRequirements: Object.freeze([...nonMonetary, ...monetaryRequirements]),
    activeMonetaryRequirements: dependencies.activeRequirementIds,
    monetaryDependencies: dependencies.claimDependencies,
    monetaryPolicyVersion: MONETARY_POLICY_VERSION
  });
}
