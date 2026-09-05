import { createHash } from 'node:crypto';

export const ASSESSMENT_RESULTS = Object.freeze({
  KEEP: 'KEEP',
  DETAILS: 'DETAILS',
  CONFIDENCE: 'CONFIDENCE',
  PUBLISH_NEW: 'PUBLISH_NEW'
});

export const EVALUATION_STATUSES = Object.freeze({
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DEFERRED: 'DEFERRED',
  SUPERSEDED: 'SUPERSEDED'
});

export const STRATEGY_LIFECYCLE_STATUSES = Object.freeze({
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded'
});

export const STRATEGY_LIFECYCLE_STATES = Object.freeze({
  STABLE: 'STABLE',
  WATCH: 'WATCH',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  EVALUATING: 'EVALUATING'
});

export const DATA_QUALITY_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  INSUFFICIENT: 'INSUFFICIENT'
});

export const SHOCK_SCOPES = Object.freeze({
  MARKET_WIDE: 'MARKET_WIDE',
  ASSET_CLASS: 'ASSET_CLASS',
  TACTICAL_RISK_OVERLAY: 'TACTICAL_RISK_OVERLAY',
  POLICY: 'POLICY'
});

export const SHOCK_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED'
});

export const REVISION_TYPES = Object.freeze({
  NEW_PERIOD: 'NEW_PERIOD',
  DATA_REVISION: 'DATA_REVISION',
  SOURCE_CORRECTION: 'SOURCE_CORRECTION',
  METHODOLOGY_CHANGE: 'METHODOLOGY_CHANGE',
  RETRACTION: 'RETRACTION'
});

export const STABILITY_POLICY_VERSION = 'strategy-stability-v2';

export const VALID_CONFIDENCE_VALUES = Object.freeze([
  'HIGH',
  'MEDIUM',
  'LOW',
  'INSUFFICIENT_EVIDENCE'
]);

/**
 * Asserts that no private user, profile, or portfolio data enters strategy structures.
 */
export function assertZeroPrivateData(obj, contextName = 'STRATEGY_DATA') {
  if (!obj || typeof obj !== 'object') return;
  const jsonStr = JSON.stringify(obj);
  if (/(?:"userId"|"user_id"|"portfolio"|"portfolioId"|"portfolio_id"|"holdings"|"holding"|"cash"|"transactions"|"transaction"|"email")\s*:/i.test(jsonStr)) {
    const err = new Error(`FORBIDDEN_USER_DATA_IN_${contextName}: Private user or portfolio data is strictly prohibited`);
    err.code = 'FORBIDDEN_USER_DATA';
    throw err;
  }
}

/**
 * Normalizes a list of strings or themes deterministically:
 * trims, lowercases, deduplicates, and sorts alphabetically.
 */
export function canonicalizeThemeList(items) {
  if (!Array.isArray(items)) return [];
  const set = new Set();
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      set.add(item.trim().toLowerCase());
    } else if (item && typeof item === 'object' && typeof (item.theme || item.name) === 'string') {
      const val = (item.theme || item.name).trim().toLowerCase();
      if (val) set.add(val);
    }
  }
  return Array.from(set).sort();
}

/**
 * Canonicalizes invalidation conditions deterministically.
 */
export function canonicalizeInvalidationConditions(items) {
  if (!Array.isArray(items)) return [];
  const set = new Set();
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      set.add(item.trim().toLowerCase());
    } else if (item && typeof item === 'object') {
      // If structured condition object: extract key semantic properties
      const key = [
        item.indicator || item.metric || '',
        item.operator || item.condition || '',
        item.threshold ?? '',
        item.description || item.reason || ''
      ].map((s) => String(s).trim().toLowerCase()).join(':');
      if (key.trim()) set.add(key);
    }
  }
  return Array.from(set).sort();
}

/**
 * Recursively serializes any value to canonical JSON with sorted object keys.
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => JSON.stringify(key) + ':' + canonicalJsonStringify(obj[key]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Canonicalizes asset strategy list deterministically.
 * Orders entries deterministically by assetClass / symbol and excludes evidence citations.
 */
export function canonicalizeAssetStrategy(items) {
  if (!Array.isArray(items)) return [];
  const canonical = items.map((item) => {
    if (!item || typeof item !== 'object') return {};
    return {
      assetClass: String(item.assetClass || item.asset_class || item.symbol || '').trim().toUpperCase(),
      posture: String(item.posture || item.directionalPosture || item.stance || '').trim().toUpperCase(),
      action: String(item.action || item.primaryAction || '').trim().toLowerCase(),
      priority: item.priority !== undefined && item.priority !== null
        ? (typeof item.priority === 'number' ? item.priority : String(item.priority).trim().toLowerCase())
        : null
    };
  });

  canonical.sort((a, b) => a.assetClass.localeCompare(b.assetClass));
  return canonical;
}

/**
 * Computes deterministic decision fingerprint over ONLY decision-relevant content.
 * Strictly excludes:
 * - Wording differences in prose commentary/explanations (including oneLineDecision, actionNow)
 * - Evidence citation IDs, observation IDs, article IDs, citation order
 * - Generation / publication / assessment timestamps
 * - Request IDs, wall clock time
 * - Internal validation receipts or LLM model names
 */
export function computeDecisionFingerprint(strategyOrBrief) {
  if (!strategyOrBrief || typeof strategyOrBrief !== 'object') {
    throw new TypeError('computeDecisionFingerprint requires a valid strategy or candidate object');
  }

  assertZeroPrivateData(strategyOrBrief, 'DECISION_FINGERPRINT');

  // 1. Regime core conclusion
  const rawRegime = strategyOrBrief.regime || {};
  const regimeCanonical = {
    status: String(rawRegime.status || strategyOrBrief.regimeStatus || '').trim().toUpperCase(),
    directionalStance: String(rawRegime.directionalStance || rawRegime.stance || strategyOrBrief.directionalStance || '').trim().toUpperCase(),
    marketPhase: String(rawRegime.marketPhase || rawRegime.phase || '').trim().toUpperCase()
  };

  // 2. Executive decision
  const rawExec = strategyOrBrief.executiveDecision || {};
  const executiveDecisionCanonical = {
    stance: String(rawExec.stance || strategyOrBrief.stance || regimeCanonical.directionalStance).trim().toUpperCase(),
    primaryAction: String(rawExec.primaryAction || rawExec.action || '').trim().toLowerCase()
  };

  // 3. Asset strategy posture
  const assetStrategyCanonical = canonicalizeAssetStrategy(
    strategyOrBrief.assetStrategy || strategyOrBrief.asset_strategy
  );

  // 4. Themes
  const preferredThemes = canonicalizeThemeList(
    strategyOrBrief.preferredThemes || strategyOrBrief.preferred_themes || strategyOrBrief.investmentOrientation?.preferredThemes
  );
  const avoidOrUnderweight = canonicalizeThemeList(
    strategyOrBrief.avoidOrUnderweight || strategyOrBrief.avoid_or_underweight || strategyOrBrief.investmentOrientation?.pressuredThemes
  );

  // 5. Risk overlay
  const rawRisk = strategyOrBrief.riskOverlay || strategyOrBrief.risk_overlay || {};
  const riskOverlayCanonical = {
    posture: String(rawRisk.posture || rawRisk.stance || '').trim().toUpperCase(),
    constraints: canonicalizeThemeList(rawRisk.constraints || rawRisk.actions),
    riskBudget: rawRisk.riskBudget ?? null
  };

  // 6. Horizon
  const horizon = String(strategyOrBrief.horizon || 'medium').trim().toLowerCase();

  // 7. Invalidation conditions
  const invalidationConditions = canonicalizeInvalidationConditions(
    strategyOrBrief.invalidationConditions || strategyOrBrief.invalidation_conditions
  );

  const decisionPayload = {
    regime: regimeCanonical,
    executiveDecision: executiveDecisionCanonical,
    assetStrategy: assetStrategyCanonical,
    preferredThemes,
    avoidOrUnderweight,
    riskOverlay: riskOverlayCanonical,
    horizon,
    invalidationConditions
  };

  const canonicalJson = canonicalJsonStringify(decisionPayload);
  return createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Generates a deterministic confirmation identity key for evidence tracking.
 * Ingredients: factId, referencePeriod, observationId/versionId, claimId, dependencyGroup, sessionDate.
 * Guarantees:
 * - Repeated reads of the same observation produce the same key.
 * - Multiple syndicated articles from the same dependency produce the same key.
 * - New reference period or new independent dependency produces a distinct key.
 */
export function computeConfirmationKey({
  factId = null,
  referencePeriod = null,
  observationId = null,
  versionId = null,
  claimId = null,
  dependencyGroup = null,
  sessionDate = null
} = {}) {
  const parts = [
    factId ? String(factId).trim().toLowerCase() : '',
    referencePeriod ? String(referencePeriod).trim().toLowerCase() : '',
    observationId ? String(observationId).trim().toLowerCase() : (versionId ? String(versionId).trim().toLowerCase() : ''),
    claimId ? String(claimId).trim().toLowerCase() : '',
    dependencyGroup ? String(dependencyGroup).trim().toUpperCase() : '',
    sessionDate ? String(sessionDate).trim().toLowerCase() : ''
  ];
  return parts.join('|');
}

/**
 * Creates and validates an immutable ShockOverride metadata record.
 */
export function createShockOverride({
  triggerEvidence = [],
  scope = SHOCK_SCOPES.MARKET_WIDE,
  reason = '',
  startedAt = new Date().toISOString(),
  resolutionCondition = null,
  status = SHOCK_STATUSES.ACTIVE,
  resolvedAt = null
} = {}) {
  if (!Object.values(SHOCK_SCOPES).includes(scope)) {
    throw new Error(`createShockOverride: invalid scope '${scope}'`);
  }
  if (!Object.values(SHOCK_STATUSES).includes(status)) {
    throw new Error(`createShockOverride: invalid status '${status}'`);
  }

  assertZeroPrivateData({ triggerEvidence, reason, resolutionCondition }, 'SHOCK_OVERRIDE');

  return Object.freeze({
    triggerEvidence: Array.isArray(triggerEvidence) ? triggerEvidence : [triggerEvidence].filter(Boolean),
    scope,
    reason: String(reason || ''),
    startedAt: startedAt instanceof Date ? startedAt.toISOString() : String(startedAt || new Date().toISOString()),
    resolutionCondition: resolutionCondition && typeof resolutionCondition === 'object'
      ? resolutionCondition
      : (typeof resolutionCondition === 'string' && resolutionCondition.trim() ? { description: resolutionCondition.trim() } : null),
    status,
    resolvedAt: resolvedAt instanceof Date ? resolvedAt.toISOString() : (resolvedAt || null)
  });
}

/**
 * Creates and validates an immutable StrategyVersion instance.
 */
export function createStrategyVersion(options = {}) {
  assertZeroPrivateData(options, 'STRATEGY_VERSION');
  const {
    strategyId,
    previousStrategyId = null,
    generatedAt,
    publishedAt,
    dataAsAsOf,
    dataAsOf = dataAsAsOf,
    evidenceFingerprint,
    decisionFingerprint,
    triggerReason = {},
    materialChanges = [],
    confidence,
    regime = {},
    executiveDecision = {},
    assetStrategy = [],
    preferredThemes = [],
    avoidOrUnderweight = [],
    riskOverlay = {},
    horizon = 'medium',
    invalidationConditions = [],
    status = STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
    lifecycleState = STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState = DATA_QUALITY_STATES.HEALTHY,
    watchReasons = [],
    shockOverride = null,
    policyVersion = STABILITY_POLICY_VERSION,
    runManifestId = null,
    nextReviewDueAt = null,
    limitations = null,
    methodologyVersion = 'strategist-v1',
    evidenceCoverage = null,
    investmentOrientation = null,
    rawOutput = null,
    createdAt = null
  } = options;
  if (!strategyId || typeof strategyId !== 'string') {
    throw new Error('createStrategyVersion: strategyId must be a non-empty string');
  }
  if (!evidenceFingerprint || typeof evidenceFingerprint !== 'string') {
    throw new Error('createStrategyVersion: evidenceFingerprint must be a non-empty string');
  }
  if (!decisionFingerprint || typeof decisionFingerprint !== 'string') {
    throw new Error('createStrategyVersion: decisionFingerprint must be a non-empty string');
  }
  if (!VALID_CONFIDENCE_VALUES.includes(confidence)) {
    throw new Error(`createStrategyVersion: invalid confidence '${confidence}'`);
  }
  if (!Object.values(STRATEGY_LIFECYCLE_STATUSES).includes(status)) {
    throw new Error(`createStrategyVersion: invalid status '${status}'`);
  }
  if (!Object.values(STRATEGY_LIFECYCLE_STATES).includes(lifecycleState)) {
    throw new Error(`createStrategyVersion: invalid lifecycleState '${lifecycleState}'`);
  }
  if (!Object.values(DATA_QUALITY_STATES).includes(dataQualityState)) {
    throw new Error(`createStrategyVersion: invalid dataQualityState '${dataQualityState}'`);
  }

  assertZeroPrivateData({
    strategyId,
    previousStrategyId,
    regime,
    executiveDecision,
    assetStrategy,
    preferredThemes,
    avoidOrUnderweight,
    riskOverlay,
    invalidationConditions,
    shockOverride,
    watchReasons
  }, 'STRATEGY_VERSION');

  const publishedIso = publishedAt instanceof Date ? publishedAt.toISOString() : (publishedAt || new Date().toISOString());
  const generatedIso = generatedAt instanceof Date ? generatedAt.toISOString() : (generatedAt || publishedIso);
  const dataAsOfIso = dataAsOf instanceof Date ? dataAsOf.toISOString() : (dataAsOf || publishedIso);

  return Object.freeze({
    strategyId,
    previousStrategyId: previousStrategyId || null,
    generatedAt: generatedIso,
    publishedAt: publishedIso,
    dataAsOf: dataAsOfIso,
    evidenceFingerprint,
    decisionFingerprint,
    triggerReason: triggerReason && typeof triggerReason === 'object' ? triggerReason : {},
    materialChanges: Array.isArray(materialChanges) ? materialChanges : [],
    confidence,
    regime: regime && typeof regime === 'object' ? regime : {},
    executiveDecision: executiveDecision && typeof executiveDecision === 'object' ? executiveDecision : {},
    assetStrategy: Array.isArray(assetStrategy) ? assetStrategy : [],
    preferredThemes: Array.isArray(preferredThemes) ? preferredThemes : [],
    avoidOrUnderweight: Array.isArray(avoidOrUnderweight) ? avoidOrUnderweight : [],
    riskOverlay: riskOverlay && typeof riskOverlay === 'object' ? riskOverlay : {},
    horizon: String(horizon || 'medium'),
    invalidationConditions: Array.isArray(invalidationConditions) ? invalidationConditions : [],
    status,
    lifecycleState,
    dataQualityState,
    watchReasons: Array.isArray(watchReasons) ? watchReasons : [],
    shockOverride: shockOverride && typeof shockOverride === 'object' ? shockOverride : null,
    policyVersion: policyVersion || STABILITY_POLICY_VERSION,
    runManifestId: runManifestId || null,
    nextReviewDueAt: nextReviewDueAt instanceof Date ? nextReviewDueAt.toISOString() : (nextReviewDueAt || null),
    limitations: limitations || null,
    methodologyVersion: methodologyVersion || rawOutput?.methodologyVersion || 'strategist-v1',
    evidenceCoverage: evidenceCoverage || rawOutput?.evidenceCoverage || null,
    investmentOrientation: investmentOrientation || rawOutput?.investmentOrientation || null,
    generationMode: rawOutput?.generationMode || 'deterministic_fallback',
    marketOverview: rawOutput?.marketOverview || null,
    keyDrivers: Array.isArray(rawOutput?.keyDrivers) ? rawOutput.keyDrivers : [],
    citations: rawOutput?.citations || null,
    evidence: Array.isArray(rawOutput?.evidence) ? rawOutput.evidence : [],
    derivedSignals: Array.isArray(rawOutput?.derivedSignals) ? rawOutput.derivedSignals : [],
    isStrategist: true,
    rawOutput: rawOutput || null,
    createdAt: createdAt || publishedIso
  });
}

/**
 * Creates and validates an append-only StrategyAssessment record.
 */
export function createStrategyAssessment(options = {}) {
  assertZeroPrivateData(options, 'STRATEGY_ASSESSMENT');
  const {
    assessmentId,
    strategyId,
    assessedAt,
    dataAsAsOf,
    dataAsOf = dataAsAsOf,
    evidenceFingerprint,
    previousEvidenceFingerprint = null,
    decisionFingerprint,
    confidence,
    previousConfidence = null,
    result,
    evaluationStatus = EVALUATION_STATUSES.COMPLETED,
    triggerReason = {},
    materialChanges = [],
    limitations = null,
    lifecycleState = STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState = DATA_QUALITY_STATES.HEALTHY,
    watchReasons = [],
    shockOverride = null,
    confirmationKeys = [],
    idempotencyKey = null,
    policyVersion = STABILITY_POLICY_VERSION,
    runManifestId = null,
    createdAt = null
  } = options;
  if (!assessmentId || typeof assessmentId !== 'string') {
    throw new Error('createStrategyAssessment: assessmentId must be a non-empty string');
  }
  if (!strategyId || typeof strategyId !== 'string') {
    throw new Error('createStrategyAssessment: strategyId must be a non-empty string');
  }
  if (!evidenceFingerprint || typeof evidenceFingerprint !== 'string') {
    throw new Error('createStrategyAssessment: evidenceFingerprint must be a non-empty string');
  }
  if (!decisionFingerprint || typeof decisionFingerprint !== 'string') {
    throw new Error('createStrategyAssessment: decisionFingerprint must be a non-empty string');
  }
  if (!Object.values(ASSESSMENT_RESULTS).includes(result)) {
    throw new Error(`createStrategyAssessment: invalid result '${result}'`);
  }
  if (!Object.values(EVALUATION_STATUSES).includes(evaluationStatus)) {
    throw new Error(`createStrategyAssessment: invalid evaluationStatus '${evaluationStatus}'`);
  }
  if (!VALID_CONFIDENCE_VALUES.includes(confidence)) {
    throw new Error(`createStrategyAssessment: invalid confidence '${confidence}'`);
  }
  if (previousConfidence !== null && !VALID_CONFIDENCE_VALUES.includes(previousConfidence)) {
    throw new Error(`createStrategyAssessment: invalid previousConfidence '${previousConfidence}'`);
  }
  if (!Object.values(STRATEGY_LIFECYCLE_STATES).includes(lifecycleState)) {
    throw new Error(`createStrategyAssessment: invalid lifecycleState '${lifecycleState}'`);
  }
  if (!Object.values(DATA_QUALITY_STATES).includes(dataQualityState)) {
    throw new Error(`createStrategyAssessment: invalid dataQualityState '${dataQualityState}'`);
  }

  assertZeroPrivateData({
    assessmentId,
    strategyId,
    triggerReason,
    materialChanges,
    limitations,
    shockOverride,
    watchReasons,
    confirmationKeys
  }, 'STRATEGY_ASSESSMENT');

  const assessedIso = assessedAt instanceof Date ? assessedAt.toISOString() : (assessedAt || new Date().toISOString());
  const dataAsOfIso = dataAsOf instanceof Date ? dataAsOf.toISOString() : (dataAsOf || assessedIso);

  return Object.freeze({
    assessmentId,
    strategyId,
    assessedAt: assessedIso,
    dataAsOf: dataAsOfIso,
    evidenceFingerprint,
    previousEvidenceFingerprint: previousEvidenceFingerprint || null,
    decisionFingerprint,
    confidence,
    previousConfidence: previousConfidence || null,
    result,
    evaluationStatus,
    triggerReason: triggerReason && typeof triggerReason === 'object' ? triggerReason : {},
    materialChanges: Array.isArray(materialChanges) ? materialChanges : [],
    limitations: limitations || null,
    lifecycleState,
    dataQualityState,
    watchReasons: Array.isArray(watchReasons) ? watchReasons : [],
    shockOverride: shockOverride && typeof shockOverride === 'object' ? shockOverride : null,
    confirmationKeys: Array.isArray(confirmationKeys) ? confirmationKeys : [],
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
    policyVersion: policyVersion || STABILITY_POLICY_VERSION,
    runManifestId: runManifestId || null,
    createdAt: createdAt || assessedIso
  });
}
