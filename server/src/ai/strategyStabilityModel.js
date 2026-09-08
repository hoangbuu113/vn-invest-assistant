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
 * Canonicalizes ONLY decision-relevant content.
 * Strictly excludes:
 * - Wording differences in prose commentary/explanations (including oneLineDecision, actionNow)
 * - Evidence citation IDs, observation IDs, article IDs, citation order
 * - Generation / publication / assessment timestamps
 * - Request IDs, wall clock time
 * - Internal validation receipts or LLM model names
 */
export function canonicalizeDecisionPayload(strategyOrBrief) {
  if (!strategyOrBrief || typeof strategyOrBrief !== 'object') {
    throw new TypeError('canonicalizeDecisionPayload requires a valid strategy or candidate object');
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

  return {
    regime: regimeCanonical,
    executiveDecision: executiveDecisionCanonical,
    assetStrategy: assetStrategyCanonical,
    preferredThemes,
    avoidOrUnderweight,
    riskOverlay: riskOverlayCanonical,
    horizon,
    invalidationConditions
  };
}

/**
 * Computes deterministic decision fingerprint over the canonical governed
 * decision payload. Keep this as the sole fingerprint authority.
 */
export function computeDecisionFingerprint(strategyOrBrief) {
  const decisionPayload = canonicalizeDecisionPayload(strategyOrBrief);

  const canonicalJson = canonicalJsonStringify(decisionPayload);
  return createHash('sha256').update(canonicalJson).digest('hex');
}

function appendScalarDecisionChange(changes, type, field, previous, current, extra = {}) {
  if (canonicalJsonStringify(previous) === canonicalJsonStringify(current)) return;
  changes.push({ type, field, previous, current, ...extra });
}

function appendSetDecisionChanges(changes, type, field, previousItems, currentItems) {
  const previous = new Set(previousItems);
  const current = new Set(currentItems);
  for (const value of previousItems) {
    if (!current.has(value)) changes.push({ type, field, change: 'removed', value });
  }
  for (const value of currentItems) {
    if (!previous.has(value)) changes.push({ type, field, change: 'added', value });
  }
}

function decisionChangeCode(change) {
  const value = (input) => input === null || input === undefined || input === ''
    ? 'NONE'
    : (typeof input === 'object' ? canonicalJsonStringify(input) : String(input));
  if (change.type === 'ASSET_STRATEGY_CHANGED') {
    if (Array.isArray(change.previous) || Array.isArray(change.current)) {
      return `ASSET_STRATEGY:${change.assetClass}:${value(change.previous)}->${value(change.current)}`;
    }
    const previous = change.previous || {};
    const current = change.current || {};
    return `ASSET_STRATEGY:${change.assetClass}:${value(previous.posture)}|${value(previous.action)}|${value(previous.priority)}->${value(current.posture)}|${value(current.action)}|${value(current.priority)}`;
  }
  if (change.change === 'added' || change.change === 'removed') {
    return `${change.type}:${change.change.toUpperCase()}:${value(change.value)}`;
  }
  return `${change.type}:${value(change.previous)}->${value(change.current)}`;
}

/**
 * Deterministically describes changes between two immutable StrategyVersions
 * using exactly the governed inputs used by computeDecisionFingerprint.
 * Generated prose, citations, timestamps, and evidence identifiers are excluded.
 */
export function computeDecisionDelta(previousStrategy, currentStrategy) {
  if (!previousStrategy || !currentStrategy) {
    return { hasMaterialChange: false, changes: [], materialChanges: [] };
  }

  const previous = canonicalizeDecisionPayload(previousStrategy);
  const current = canonicalizeDecisionPayload(currentStrategy);
  const changes = [];

  for (const field of ['status', 'directionalStance', 'marketPhase']) {
    appendScalarDecisionChange(changes, 'REGIME_CHANGED', `regime.${field}`, previous.regime[field], current.regime[field]);
  }
  for (const field of ['stance', 'primaryAction']) {
    appendScalarDecisionChange(changes, 'EXECUTIVE_DECISION_CHANGED', `executiveDecision.${field}`, previous.executiveDecision[field], current.executiveDecision[field]);
  }

  const groupAssets = (items) => {
    const grouped = new Map();
    for (const item of items) {
      if (!grouped.has(item.assetClass)) grouped.set(item.assetClass, []);
      grouped.get(item.assetClass).push(item);
    }
    return grouped;
  };
  const previousAssets = groupAssets(previous.assetStrategy);
  const currentAssets = groupAssets(current.assetStrategy);
  const assetClasses = [...new Set([...previousAssets.keys(), ...currentAssets.keys()])].sort();
  for (const assetClass of assetClasses) {
    const previousItems = previousAssets.get(assetClass) || [];
    const currentItems = currentAssets.get(assetClass) || [];
    appendScalarDecisionChange(
      changes,
      'ASSET_STRATEGY_CHANGED',
      'assetStrategy',
      previousItems.length === 1 ? previousItems[0] : previousItems,
      currentItems.length === 1 ? currentItems[0] : currentItems,
      { assetClass }
    );
  }

  appendSetDecisionChanges(changes, 'PREFERRED_THEME_CHANGED', 'preferredThemes', previous.preferredThemes, current.preferredThemes);
  appendSetDecisionChanges(changes, 'UNDERWEIGHT_THEME_CHANGED', 'avoidOrUnderweight', previous.avoidOrUnderweight, current.avoidOrUnderweight);

  appendScalarDecisionChange(changes, 'RISK_OVERLAY_CHANGED', 'riskOverlay.posture', previous.riskOverlay.posture, current.riskOverlay.posture);
  appendSetDecisionChanges(changes, 'RISK_CONSTRAINT_CHANGED', 'riskOverlay.constraints', previous.riskOverlay.constraints, current.riskOverlay.constraints);
  appendScalarDecisionChange(changes, 'RISK_BUDGET_CHANGED', 'riskOverlay.riskBudget', previous.riskOverlay.riskBudget, current.riskOverlay.riskBudget);
  appendScalarDecisionChange(changes, 'HORIZON_CHANGED', 'horizon', previous.horizon, current.horizon);
  appendSetDecisionChanges(changes, 'INVALIDATION_CONDITION_CHANGED', 'invalidationConditions', previous.invalidationConditions, current.invalidationConditions);

  return {
    hasMaterialChange: changes.length > 0,
    changes,
    materialChanges: changes.map(decisionChangeCode)
  };
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
