import { createHash } from 'node:crypto';
import {
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  STRATEGY_LIFECYCLE_STATUSES,
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
  persistStrategyVersion,
  persistStrategyAssessment,
  supersedeStrategyVersion
} from './strategyStabilityRepository.js';
import {
  generateMarketStrategist,
  computeStrategistFingerprint
} from './marketStrategistEngine.js';

/**
 * Orchestrates the Strategy Stability lifecycle (Two Clocks):
 * 1. Evaluates incoming validated evidence against active StrategyVersion via pre-AI gate.
 * 2. If review is not required: logs append-only KEEP assessment, skips AI/LLM.
 * 3. If review is required: runs strategist engine, compares candidate decisionFingerprint against current.
 * 4. Publishes new StrategyVersion ONLY when decisionFingerprint differs and candidate passes safety gates.
 * 5. Returns active strategy enriched with latest assessment metadata.
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
  client
} = {}) {
  if (!factPacket || typeof factPacket !== 'object') {
    throw new TypeError('evaluateAndApplyStrategyStability requires a valid factPacket');
  }

  assertZeroPrivateData(factPacket, 'EVALUATE_STRATEGY_STABILITY_PACKET');

  const nowIso = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const nowMs = now instanceof Date ? now.getTime() : Date.now();

  // 1. Retrieve current published strategy and latest assessment
  const currentStrategy = await getCurrentPublishedStrategy(client);
  const lastAssessment = await getLatestStrategyAssessment(currentStrategy?.strategyId, client);

  // 2. Compute evidence fingerprint
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

  // 3. Pre-AI Gate: evaluate whether review is warranted
  const gateResult = assessStrategyMateriality({
    currentStrategy,
    lastAssessment,
    factPacket,
    now
  });

  // Fast path: Current strategy exists and no deep review required -> KEEP without AI
  if (currentStrategy && !gateResult.requiresReview) {
    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`KEEP:${currentStrategy.strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
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
      triggerReason: gateResult.reasons[0] || {},
      materialChanges: [],
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...(currentStrategy.rawOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: ASSESSMENT_RESULTS.KEEP,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      currentConfidence: currentStrategy.confidence,
      dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint,
      lastAssessment: assessment
    };
  }

  // 4. Review is required: execute strategist synthesis
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

  // 5. Handle AI / generation failure during required review
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
        evidenceFingerprint,
        previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
        decisionFingerprint: currentStrategy.decisionFingerprint,
        confidence: currentStrategy.confidence,
        previousConfidence: currentStrategy.confidence,
        result: ASSESSMENT_RESULTS.KEEP,
        evaluationStatus: EVALUATION_STATUSES.FAILED,
        triggerReason: gateResult.reasons[0] || {},
        limitations: errorDetails,
        policyVersion: STABILITY_POLICY_VERSION,
        runManifestId: null
      });

      await persistStrategyAssessment(failedAssessment, client);

      return {
        ...(currentStrategy.rawOutput || {}),
        ...currentStrategy,
        publishedAt: currentStrategy.publishedAt,
        latestAssessmentAt: failedAssessment.assessedAt,
        latestAssessmentResult: ASSESSMENT_RESULTS.KEEP,
        latestAssessmentStatus: EVALUATION_STATUSES.FAILED,
        currentConfidence: currentStrategy.confidence,
        dataAsOf: factPacket.dataAsOf || currentStrategy.dataAsOf,
        decisionFingerprint: currentStrategy.decisionFingerprint,
        evidenceFingerprint,
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

  // 6. Compute candidate decision fingerprint
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
      evidenceFingerprint,
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
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null,
      limitations: candidateOutput.limitations || null,
      rawOutput: candidateOutput,
      investmentOrientation: candidateOutput.investmentOrientation || null,
      evidenceCoverage: candidateOutput.evidenceCoverage || factPacket.evidenceCoverage || null,
      methodologyVersion: candidateOutput.methodologyVersion || 'strategist-v1'
    });

    await persistStrategyVersion(newVersion, client);

    const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`PUB:${strategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
    const assessment = createStrategyAssessment({
      assessmentId,
      strategyId,
      assessedAt: nowIso,
      dataAsOf: newVersion.dataAsOf,
      evidenceFingerprint,
      previousEvidenceFingerprint: null,
      decisionFingerprint: candidateDecisionFingerprint,
      confidence: newVersion.confidence,
      previousConfidence: null,
      result: ASSESSMENT_RESULTS.PUBLISH_NEW,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges: ['INITIAL_PUBLICATION'],
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...candidateOutput,
      ...newVersion,
      strategyId,
      publishedAt: newVersion.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      currentConfidence: newVersion.confidence,
      dataAsOf: newVersion.dataAsOf,
      decisionFingerprint: candidateDecisionFingerprint,
      evidenceFingerprint,
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
      evidenceFingerprint,
      previousEvidenceFingerprint: lastAssessment?.evidenceFingerprint || currentStrategy.evidenceFingerprint,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      confidence: candidateConfidence,
      previousConfidence: currentStrategy.confidence,
      result: resultOutcome,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges,
      policyVersion: STABILITY_POLICY_VERSION,
      runManifestId: candidateOutput.runId || null
    });

    await persistStrategyAssessment(assessment, client);

    return {
      ...(currentStrategy.rawOutput || candidateOutput || {}),
      ...currentStrategy,
      publishedAt: currentStrategy.publishedAt,
      latestAssessmentAt: assessment.assessedAt,
      latestAssessmentResult: resultOutcome,
      latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
      currentConfidence: candidateConfidence,
      dataAsOf: assessment.dataAsOf,
      decisionFingerprint: currentStrategy.decisionFingerprint,
      evidenceFingerprint,
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
    evidenceFingerprint,
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
    policyVersion: STABILITY_POLICY_VERSION,
    runManifestId: candidateOutput.runId || null,
    limitations: candidateOutput.limitations || null,
    rawOutput: candidateOutput,
    investmentOrientation: candidateOutput.investmentOrientation || null,
    evidenceCoverage: candidateOutput.evidenceCoverage || factPacket.evidenceCoverage || null,
    methodologyVersion: candidateOutput.methodologyVersion || 'strategist-v1'
  });

  // Mark previous strategy version as superseded
  await supersedeStrategyVersion(currentStrategy.strategyId, client);

  // Persist new version
  await persistStrategyVersion(newVersion, client);

  // Record PUBLISH_NEW assessment
  const assessmentId = `asmt_${nowMs}_${createHash('sha256').update(`PUB:${newStrategyId}:${nowIso}`).digest('hex').slice(0, 12)}`;
  const assessment = createStrategyAssessment({
    assessmentId,
    strategyId: newStrategyId,
    assessedAt: nowIso,
    dataAsOf: newVersion.dataAsOf,
    evidenceFingerprint,
    previousEvidenceFingerprint: currentStrategy.evidenceFingerprint,
    decisionFingerprint: candidateDecisionFingerprint,
    confidence: newVersion.confidence,
    previousConfidence: currentStrategy.confidence,
    result: ASSESSMENT_RESULTS.PUBLISH_NEW,
    evaluationStatus: EVALUATION_STATUSES.COMPLETED,
    triggerReason: gateResult.reasons[0] || {},
    materialChanges,
    policyVersion: STABILITY_POLICY_VERSION,
    runManifestId: candidateOutput.runId || null
  });

  await persistStrategyAssessment(assessment, client);

  return {
    ...candidateOutput,
    ...newVersion,
    strategyId: newStrategyId,
    publishedAt: newVersion.publishedAt,
    latestAssessmentAt: assessment.assessedAt,
    latestAssessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
    latestAssessmentStatus: EVALUATION_STATUSES.COMPLETED,
    currentConfidence: newVersion.confidence,
    dataAsOf: newVersion.dataAsOf,
    decisionFingerprint: candidateDecisionFingerprint,
    evidenceFingerprint,
    lastAssessment: assessment
  };
}
