import { createHash } from 'node:crypto';
import {
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_LIFECYCLE_STATES,
  DATA_QUALITY_STATES,
  SHOCK_SCOPES,
  SHOCK_STATUSES,
  STABILITY_POLICY_VERSION,
  computeDecisionFingerprint,
  createStrategyVersion,
  createStrategyAssessment,
  assertZeroPrivateData
} from './strategyStabilityModel.js';
import { assessStrategyMateriality } from './strategyAssessmentGate.js';
import {
  getCurrentPublishedStrategy,
  getLatestStrategyAssessment,
  getLatestCompletedStrategyAssessment,
  getStrategyAssessmentByIdempotencyKey,
  persistStrategyAssessment,
  publishStrategyVersionAtomic
} from './strategyStabilityRepository.js';
import {
  generateMarketStrategist,
  computeStrategistFingerprint
} from './marketStrategistEngine.js';

/**
 * Orchestrates the Strategy Stability lifecycle (Two Clocks):
 * 1. Checks exact idempotency retries.
 * 2. Evaluates incoming validated evidence against active StrategyVersion via pre-AI gate.
 * 3. Enforces read-only provider-free guarantees on allowLlm=false.
 * 4. Manages lifecycle states: STABLE, WATCH, REVIEW_REQUIRED, EVALUATING.
 * 5. Protects against stale evaluation publishing when evidence is superseded.
 * 6. Publishes new StrategyVersion ONLY when decisionFingerprint differs and candidate passes safety gates.
 * 7. Hardens against concurrency races on published strategy versions.
 */
export async function evaluateAndApplyStrategyStability({
  factPacket,
  now = new Date(),
  allowLlm = true,
  geminiApiKey,
  geminiModel,
  openAiApiKey,
  apiKey,
  runtime,
  generateLlmFn,
  fetchFn,
  aiEnabled,
  client,
  idempotencyKey = null,
  getAuthoritativeEvidenceFingerprint = null,
  authoritativeEvidenceFingerprint = null,
  onStateTransition = null,
  isReadOnly = false
} = {}) {
  if (!factPacket || typeof factPacket !== 'object') {
    throw new TypeError('evaluateAndApplyStrategyStability requires a valid factPacket');
  }

  assertZeroPrivateData(factPacket, 'EVALUATE_STRATEGY_STABILITY_PACKET');

  const nowIso = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const nowMs = now instanceof Date ? now.getTime() : Date.now();

  // 1. Check assessment idempotency for exact retries
  if (idempotencyKey) {
    const existing = await getStrategyAssessmentByIdempotencyKey(idempotencyKey, client);
    if (existing) {
      const current = await getCurrentPublishedStrategy(client);
      const isExistingCompleted = existing.evaluationStatus === EVALUATION_STATUSES.COMPLETED;
      return {
        ...(current?.rawOutput || {}),
        ...(current || {}),
        publishedAt: current?.publishedAt,
        strategyPublishedAt: current?.publishedAt,
        latestAssessmentAt: existing.assessedAt,
        latestAssessmentResult: isExistingCompleted ? existing.result : null,
        latestAssessmentStatus: existing.evaluationStatus,
        lifecycleState: existing.lifecycleState,
        dataQualityState: existing.dataQualityState,
        watchReasons: existing.watchReasons || [],
        shockOverride: existing.shockOverride || null,
        confirmationKeys: existing.confirmationKeys || [],
        idempotencyKey: existing.idempotencyKey,
        reviewPending: !isExistingCompleted,
        currentConfidence: current?.confidence || existing.confidence,
        dataAsOf: existing.dataAsOf,
        decisionFingerprint: existing.decisionFingerprint,
        evidenceFingerprint: existing.evidenceFingerprint,
        lastAssessment: existing,
        isIdempotentReplay: true
      };
    }
  }

  // 2. Retrieve current published strategy and assessments
  const currentStrategy = await getCurrentPublishedStrategy(client);
  const lastAssessment = await getLatestStrategyAssessment(currentStrategy?.strategyId, client);
  const lastCompletedAssessment = await getLatestCompletedStrategyAssessment(currentStrategy?.strategyId, client);

  // 3. Compute evidence fingerprint
  const evidenceFingerprint = factPacket.evidenceFingerprint || computeStrategistFingerprint({
    validFactIds: factPacket.validFactIds,
    validArticleIds: factPacket.validArticleIds,
    validSignalIds: factPacket.validSignalIds,
    validClaimIds: factPacket.validClaimIds,
    evidence: factPacket.evidence,
    untrustedNews: factPacket.untrustedNews,
    derivedSignals: factPacket.derivedSignals,
    claims: factPacket.claims
  });

  // 4. Pre-AI Gate: evaluate whether review is warranted and determine lifecycle state
  const gateResult = assessStrategyMateriality({
    currentStrategy,
    lastAssessment,
    lastCompletedAssessment,
    factPacket,
    now
  });

  // 5. Public read-only path (e.g. GET endpoint with isReadOnly: true and existing published strategy)
  // Invariant: Public GET is provider-free and NEVER mutates lifecycle state.
  if (currentStrategy && isReadOnly) {
    const isCompleted = lastAssessment?.evaluationStatus === EVALUATION_STATUSES.COMPLETED;
    return {
      ...(currentStrategy.rawOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      strategyPublishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: lastAssessment?.assessedAt || currentStrategy.publishedAt,
      latestAssessmentResult: isCompleted ? lastAssessment.result : null,
      latestAssessmentStatus: lastAssessment?.evaluationStatus || EVALUATION_STATUSES.COMPLETED,
      lifecycleState: lastAssessment?.lifecycleState || currentStrategy.lifecycleState || STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: lastAssessment?.watchReasons || currentStrategy.watchReasons || [],
      shockOverride: lastAssessment?.shockOverride || currentStrategy.shockOverride || null,
      reviewPending: !isCompleted ? true : gateResult.requiresReview,
      currentConfidence: currentStrategy.confidence,
      dataAsOf: currentStrategy.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint: currentStrategy.evidenceFingerprint,
      lastAssessment: lastAssessment || null
    };
  }

  // 6. Fast path / Insufficient Data Protection:
  // Invariant: INSUFFICIENT data != NEUTRAL market.
  // When critical evidence is unavailable/stale, do NOT run synthesis to overwrite market conclusion.
  // Instead, preserve current published market conclusion and record a KEEP assessment with limitations.
  if (currentStrategy && (gateResult.dataQualityState === DATA_QUALITY_STATES.INSUFFICIENT || !gateResult.requiresReview)) {
    const isInsufficient = gateResult.dataQualityState === DATA_QUALITY_STATES.INSUFFICIENT;
    const targetLifecycleState = isInsufficient
      ? (currentStrategy.lifecycleState || STRATEGY_LIFECYCLE_STATES.STABLE)
      : (gateResult.lifecycleState || STRATEGY_LIFECYCLE_STATES.STABLE);
    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`KEEP:${currentStrategy.strategyId}:${nowIso}:${targetLifecycleState}:${gateResult.dataQualityState}`).digest('hex').slice(0, 12)}`;
    const assessment = createStrategyAssessment({
      assessmentId,
      strategyId: currentStrategy.strategyId,
      assessedAt: nowIso,
      dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
      evidenceFingerprint,
      previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      confidence: currentStrategy.confidence,
      previousConfidence: currentStrategy.confidence,
      result: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || (isInsufficient ? {
        type: MATERIALITY_TRIGGER_TYPES.DATA_QUALITY_DEGRADATION,
        description: 'Chất lượng dữ liệu thị trường không đủ (INSUFFICIENT); bảo lưu chiến lược đã xuất bản.'
      } : {}),
      materialChanges: [],
      limitations: isInsufficient ? 'Chưa đủ dữ liệu tin cậy để đánh giá lại chiến lược thị trường.' : null,
      lifecycleState: targetLifecycleState,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: gateResult.watchReasons || [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: gateResult.confirmationKeys || [],
      idempotencyKey,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...(currentStrategy.rawOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      strategyPublishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: ASSESSMENT_RESULTS.KEEP,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      lifecycleState: targetLifecycleState,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: assessment.watchReasons,
      shockOverride: assessment.shockOverride,
      confirmationKeys: assessment.confirmationKeys,
      currentConfidence: currentStrategy.confidence,
      dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint,
      lastAssessment: assessment
    };
  }

  // 7. Review is required: Snapshot freeze and transition to EVALUATING
  const snapshotEvidenceFingerprint = evidenceFingerprint;
  const snapshotDataAsOf = factPacket.dataAsOf || nowIso;
  if (typeof onStateTransition === 'function') {
    onStateTransition(STRATEGY_LIFECYCLE_STATES.EVALUATING);
  }

  let candidateOutput = null;
  let providerError = null;

  try {
    candidateOutput = await generateMarketStrategist({
      factPacket,
      now,
      geminiApiKey,
      geminiModel,
      openAiApiKey,
      apiKey,
      runtime,
      generateLlmFn,
      fetchFn,
      aiEnabled,
      allowLlm
    });
  } catch (err) {
    providerError = err?.message || 'LLM_SYNTHESIS_ERROR';
  }

  // 8. Handle AI / generation failure during required review
  const hasProviderFailure = Boolean(providerError || (allowLlm && candidateOutput?.lastProviderError));
  if (hasProviderFailure || !candidateOutput) {
    const errorDetails = providerError || candidateOutput?.lastProviderError || 'Synthesis failed during required review';
    if (currentStrategy) {
      const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`FAIL:${currentStrategy.strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
      const failedAssessment = createStrategyAssessment({
        assessmentId,
        strategyId: currentStrategy.strategyId,
        assessedAt: nowIso,
        dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
        evidenceFingerprint: snapshotEvidenceFingerprint,
        previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
        decisionFingerprint: currentStrategy.decisionFingerprint,
        confidence: currentStrategy.confidence,
        previousConfidence: currentStrategy.confidence,
        result: ASSESSMENT_RESULTS.KEEP,
        evaluationStatus: EVALUATION_STATUSES.FAILED,
        triggerReason: gateResult.reasons[0] || {},
        limitations: errorDetails,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED, // Failure returns to REVIEW_REQUIRED, NOT STABLE!
        dataQualityState: gateResult.dataQualityState,
        watchReasons: gateResult.watchReasons || [],
        shockOverride: gateResult.shockOverride || null,
        confirmationKeys: gateResult.confirmationKeys || [],
        idempotencyKey,
        policyVersion: STABILITY_POLICY_VERSION,
        runManifestId: null
      });

      await persistStrategyAssessment(failedAssessment, client);

      return {
        ...(currentStrategy.rawOutput || {}),
        ...currentStrategy,
        publishedAt: currentStrategy.publishedAt,
        strategyPublishedAt: currentStrategy.publishedAt,
        latestAssessmentAt: failedAssessment.assessedAt,
        latestAssessmentResult: null,
        latestAssessmentStatus: EVALUATION_STATUSES.FAILED,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
        reviewPending: true,
        dataQualityState: gateResult.dataQualityState,
        watchReasons: failedAssessment.watchReasons,
        shockOverride: failedAssessment.shockOverride,
        confirmationKeys: failedAssessment.confirmationKeys,
        currentConfidence: currentStrategy.confidence,
        dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
        decisionFingerprint: currentStrategy.decisionFingerprint,
        evidenceFingerprint: snapshotEvidenceFingerprint,
        lastAssessment: failedAssessment,
        providerError: errorDetails
      };
    } else {
      // Cold start with complete failure: throw unavailable
      const err = new Error('STRATEGY_INITIAL_PUBLICATION_FAILED: Cannot establish initial strategy');
      err.code = 'AI_STRATEGIST_UNAVAILABLE';
      throw err;
    }
  }

  // 9. Stale Evaluation Protection
  // Compare current authoritative evidence baseline with evaluation snapshot
  let isSuperseded = false;
  if (typeof getAuthoritativeEvidenceFingerprint === 'function') {
    const currentAuthoritativeFp = await getAuthoritativeEvidenceFingerprint();
    if (currentAuthoritativeFp && currentAuthoritativeFp !== snapshotEvidenceFingerprint) {
      isSuperseded = true;
    }
  } else if (authoritativeEvidenceFingerprint && authoritativeEvidenceFingerprint !== snapshotEvidenceFingerprint) {
    isSuperseded = true;
  }

  if (isSuperseded && currentStrategy) {
    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`DEFERRED:${currentStrategy.strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
    const deferredAssessment = createStrategyAssessment({
      assessmentId,
      strategyId: currentStrategy.strategyId,
      assessedAt: nowIso,
      dataAsOf: snapshotDataAsOf,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      confidence: currentStrategy.confidence,
      previousConfidence: currentStrategy.confidence,
      result: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.DEFERRED,
      triggerReason: gateResult.reasons[0] || {},
      limitations: 'Bằng chứng thị trường đã thay đổi trong khi AI đang đánh giá; hoãn xuất bản (DEFERRED) và chuyển lại REVIEW_REQUIRED.',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: gateResult.watchReasons || [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: gateResult.confirmationKeys || [],
      idempotencyKey,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput?.runId || null
    });

    await persistStrategyAssessment(deferredAssessment, client);

    return {
      ...(currentStrategy.rawOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      strategyPublishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: deferredAssessment.assessedAt,
      latestAssessmentResult: null,
      latestAssessmentStatus: EVALUATION_STATUSES.DEFERRED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
      reviewPending: true,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: deferredAssessment.watchReasons,
      shockOverride: deferredAssessment.shockOverride,
      confirmationKeys: deferredAssessment.confirmationKeys,
      currentConfidence: currentStrategy.confidence,
      dataAsOf: currentStrategy.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      lastAssessment: deferredAssessment,
      isDeferred: true
    };
  }

  // 10. Compute candidate decision fingerprint
  const candidateDecisionFingerprint = computeDecisionFingerprint(candidateOutput);

  // Case A: Cold start (no previous strategy published)
  if (!currentStrategy) {
    const strategyId = `strat_${nowMs}_${candidateDecisionFingerprint.slice(0, 12)}`;
    const newVersion = createStrategyVersion({
      strategyId,
      previousStrategyId: null,
      generatedAt: candidateOutput.generatedAt || nowIso,
      publishedAt: nowIso,
      dataAsOf: candidateOutput.dataAsOf || factPacket.dataAsOf || nowIso,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      decisionFingerprint: candidateDecisionFingerprint,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges: ['INITIAL_PUBLICATION'],
      confidence: candidateOutput.confidence || 'MEDIUM',
      regime: candidateOutput.regime || {},
      executiveDecision: candidateOutput.executiveDecision || {},
      assetStrategy: candidateOutput.assetStrategy || [],
      preferredThemes: candidateOutput.preferredThemes || [],
      avoidOrUnderweight: candidateOutput.avoidOrUnderweight || [],
      riskOverlay: candidateOutput.riskOverlay || {},
      horizon: candidateOutput.horizon || 'medium',
      invalidationConditions: candidateOutput.invalidationConditions || [],
      status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null,
      limitations: candidateOutput.limitations || null,
      rawOutput: candidateOutput,
      investmentOrientation: candidateOutput.investmentOrientation || null,
      evidenceCoverage: candidateOutput.evidenceCoverage || factPacket.evidenceCoverage || null,
      methodologyVersion: candidateOutput.methodologyVersion || 'strategist-v1'
    });

    try {
      await publishStrategyVersionAtomic({
        newVersion,
        expectedCurrentStrategyId: null
      }, client);
    } catch (err) {
      if (
        err.isConflict ||
        err.code === 'P0001' ||
        err.code === '23505' ||
        err.message?.includes('STRATEGY_VERSION_CONFLICT') ||
        err.message?.includes('idx_strategy_versions_single_published')
      ) {
        const refreshed = await getCurrentPublishedStrategy(client);
        return {
          ...(refreshed?.rawOutput || {}),
          ...(refreshed || {}),
          publishedAt: refreshed?.publishedAt,
          strategyPublishedAt: refreshed?.publishedAt,
          latestAssessmentAt: refreshed?.publishedAt,
          latestAssessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
          latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
          lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
          conflict: true,
          concurrencyError: err.message
        };
      }
      throw err;
    }

    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`PUB:${strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
    const assessment = createStrategyAssessment({
      assessmentId,
      strategyId,
      assessedAt: nowIso,
      dataAsOf: newVersion.dataAsOf,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      previousEvidenceFingerprint: null,
      decisionFingerprint: candidateDecisionFingerprint,
      confidence: newVersion.confidence,
      previousConfidence: null,
      result: ASSESSMENT_RESULTS.PUBLISH_NEW,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges: ['INITIAL_PUBLICATION'],
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: gateResult.confirmationKeys || [],
      idempotencyKey,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...candidateOutput,
      ...newVersion,
      strategyId,
      publishedAt: newVersion.publishedAt,
      strategyPublishedAt: newVersion.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: assessment.confirmationKeys,
      currentConfidence: newVersion.confidence,
      dataAsOf: newVersion.dataAsOf,
      decisionFingerprint: candidateDecisionFingerprint,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      lastAssessment: assessment
    };
  }

  // Case B: Decision fingerprint is identical -> DO NOT publish new strategy
  if (candidateDecisionFingerprint === currentStrategy.decisionFingerprint) {
    const candidateConfidence = candidateOutput.confidence || currentStrategy.confidence;
    const confidenceChanged = candidateConfidence !== currentStrategy.confidence;

    // Detect details changes
    const materialChanges = [];
    if (confidenceChanged) {
      materialChanges.push(`CONFIDENCE_SHIFT:${currentStrategy.confidence}->${candidateConfidence}`);
    }

    const currentRationale = currentStrategy.executiveDecision?.oneLineDecision || currentStrategy.executiveDecision?.actionNow || '';
    const candidateRationale = candidateOutput.executiveDecision?.oneLineDecision || candidateOutput.executiveDecision?.actionNow || '';
    if (currentRationale !== candidateRationale && !confidenceChanged) {
      materialChanges.push('DETAILS_UPDATED');
    }

    const resultOutcome = confidenceChanged
      ? ASSESSMENT_RESULTS.CONFIDENCE
      : (materialChanges.length > 0 ? ASSESSMENT_RESULTS.DETAILS : ASSESSMENT_RESULTS.KEEP);

    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`${resultOutcome}:${currentStrategy.strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
    const assessment = createStrategyAssessment({
      assessmentId,
      strategyId: currentStrategy.strategyId,
      assessedAt: nowIso,
      dataAsOf: candidateOutput.dataAsOf || factPacket.dataAsOf || currentStrategy.dataAsOf,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      confidence: candidateConfidence,
      previousConfidence: currentStrategy.confidence,
      result: resultOutcome,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: gateResult.confirmationKeys || [],
      idempotencyKey,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...(currentStrategy.rawOutput || candidateOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      strategyPublishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: resultOutcome,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: assessment.confirmationKeys,
      currentConfidence: candidateConfidence,
      dataAsOf: assessment.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint: snapshotEvidenceFingerprint,
      materialChanges,
      lastAssessment: assessment
    };
  }

  // Case C: Decision fingerprint changed -> PUBLISH_NEW
  const newStrategyId = `strat_${nowMs}_${candidateDecisionFingerprint.slice(0, 12)}`;
  const materialChanges = [
    `REGIME:${currentStrategy.regime?.directionalStance || 'UNKNOWN'}->${candidateOutput.regime?.directionalStance || 'UNKNOWN'}`,
    `EXECUTIVE_ACTION:${currentStrategy.executiveDecision?.stance || 'UNKNOWN'}->${candidateOutput.executiveDecision?.stance || 'UNKNOWN'}`
  ];

  const newVersion = createStrategyVersion({
    strategyId: newStrategyId,
    previousStrategyId: currentStrategy.strategyId,
    generatedAt: candidateOutput.generatedAt || nowIso,
    publishedAt: nowIso,
    dataAsOf: candidateOutput.dataAsOf || factPacket.dataAsOf || nowIso,
    evidenceFingerprint: snapshotEvidenceFingerprint,
    decisionFingerprint: candidateDecisionFingerprint,
    triggerReason: gateResult.reasons[0] || {},
    materialChanges,
    confidence: candidateOutput.confidence || 'MEDIUM',
    regime: candidateOutput.regime || {},
    executiveDecision: candidateOutput.executiveDecision || {},
    assetStrategy: candidateOutput.assetStrategy || [],
    preferredThemes: candidateOutput.preferredThemes || [],
    avoidOrUnderweight: candidateOutput.avoidOrUnderweight || [],
    riskOverlay: candidateOutput.riskOverlay || {},
    horizon: candidateOutput.horizon || 'medium',
    invalidationConditions: candidateOutput.invalidationConditions || [],
    status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
    lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState: gateResult.dataQualityState,
    watchReasons: [],
    shockOverride: gateResult.shockOverride || null,
    policyVersion: STABILITY_POLICY_VERSION,
    runManifestId: candidateOutput.runId || null,
    limitations: candidateOutput.limitations || null,
    rawOutput: candidateOutput,
    investmentOrientation: candidateOutput.investmentOrientation || null,
    evidenceCoverage: candidateOutput.evidenceCoverage || factPacket.evidenceCoverage || null,
    methodologyVersion: candidateOutput.methodologyVersion || 'strategist-v1'
  });

  // Atomic publication: atomically supersedes current strategy and inserts new version
  // Guarantees zero-published prevention via transaction rollback and expectedCurrentStrategyId validation
  try {
    await publishStrategyVersionAtomic({
      newVersion,
      expectedCurrentStrategyId: currentStrategy.strategyId
    }, client);
  } catch (err) {
    if (
      err.isConflict ||
      err.code === 'P0001' ||
      err.code === '23505' ||
      err.message?.includes('STRATEGY_VERSION_CONFLICT') ||
      err.message?.includes('idx_strategy_versions_single_published')
    ) {
      const refreshed = await getCurrentPublishedStrategy(client);
      return {
        ...(refreshed?.rawOutput || {}),
        ...(refreshed || {}),
        publishedAt: refreshed?.publishedAt,
        strategyPublishedAt: refreshed?.publishedAt,
        latestAssessmentAt: lastAssessment?.assessedAt || refreshed?.publishedAt,
        latestAssessmentResult: lastAssessment?.evaluationStatus === EVALUATION_STATUSES.COMPLETED ? lastAssessment.result : null,
        latestAssessmentStatus: lastAssessment?.evaluationStatus || EVALUATION_STATUSES.COMPLETED,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
        reviewPending: true,
        conflict: true,
        concurrencyError: err.message
      };
    }
    throw err;
  }

  // Record PUBLISH_NEW assessment
  const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`PUB:${newStrategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
  const assessment = createStrategyAssessment({
    assessmentId,
    strategyId: newStrategyId,
    assessedAt: nowIso,
    dataAsOf: newVersion.dataAsOf,
    evidenceFingerprint: snapshotEvidenceFingerprint,
    previousEvidenceFingerprint: currentStrategy.evidenceFingerprint,
    decisionFingerprint: candidateDecisionFingerprint,
    confidence: newVersion.confidence,
    previousConfidence: currentStrategy.confidence,
    result: ASSESSMENT_RESULTS.PUBLISH_NEW,
    evaluationStatus: EVALUATION_STATUSES.COMPLETED,
    triggerReason: gateResult.reasons[0] || {},
    materialChanges,
    lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState: gateResult.dataQualityState,
    watchReasons: [],
    shockOverride: gateResult.shockOverride || null,
    confirmationKeys: gateResult.confirmationKeys || [],
    idempotencyKey,
    policyVersion: STABILITY_POLICY_VERSION,
    runManifestId: candidateOutput.runId || null
  });

  await persistStrategyAssessment(assessment, client);

  return {
    ...candidateOutput,
    ...newVersion,
    strategyId: newStrategyId,
    publishedAt: newVersion.publishedAt,
    strategyPublishedAt: newVersion.publishedAt,
    latestAssessmentAt: assessment.assessedAt,
    latestAssessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
    latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
    lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
    dataQualityState: gateResult.dataQualityState,
    watchReasons: [],
    shockOverride: gateResult.shockOverride || null,
    confirmationKeys: assessment.confirmationKeys,
    currentConfidence: newVersion.confidence,
    dataAsOf: newVersion.dataAsOf,
    decisionFingerprint: candidateDecisionFingerprint,
    evidenceFingerprint: snapshotEvidenceFingerprint,
    lastAssessment: assessment
  };
}
