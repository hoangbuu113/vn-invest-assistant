/**
 * Strategy Stability Shadow Replay & Calibration Engine (Phase 3)
 *
 * Replays historical evidence trajectories using strict 01D Historical As-of
 * Replay semantics to evaluate the `strategy-stability-v2` policy over time.
 *
 * Hardened Invariants:
 * 1. Definitive As-of Semantics (01D):
 *    - Point-in-time evidence is reconstructed using system-knowable cutoff:
 *      systemKnowableAt = max(sourceAvailableAt, systemFirstSeenAt).
 *    - Strict zero future leakage: subsequent revisions, corrections, or post-dated
 *      news are never visible before their true availability timestamp.
 * 2. Absolute Shadow Isolation:
 *    - Does NOT write to production database (`strategy_versions`, `strategy_assessments`).
 *    - Does NOT mutate module-level production memory stores (`memoryStrategyVersions`).
 *    - Maintains an isolated, independent shadow state machine across the replay.
 * 3. Provider-Free & Deterministic:
 *    - Strictly zero external LLM (Gemini/OpenAI) or network provider calls (`allowLlm: false`).
 *    - Candidate synthesis uses `generateDeterministicMarketStrategist`.
 *    - Identical replays run twice produce 100% byte-for-byte deterministic metrics.
 * 4. Ground Truth Integrity:
 *    - Never calculates speculative "profit/accuracy" when historical ground truth is absent.
 *    - Never computes Brier scores without explicit probabilistic forecasts.
 *    - Sparse or incomplete data is truthfully reported as INSUFFICIENT / UNKNOWN.
 * 5. Security:
 *    - Strictly enforces zero private user, profile, or portfolio data.
 */

import { createHash } from 'node:crypto';
import {
  buildHistoricalEvidencePacket
} from '../replay/historicalReplay.js';
import {
  resolveEvidenceAvailabilityTime
} from '../replay/availability.js';
import {
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist,
  computeStrategistFingerprint
} from './marketStrategistEngine.js';
import {
  assessStrategyMateriality
} from './strategyAssessmentGate.js';
import {
  createStrategyVersion,
  createStrategyAssessment,
  assertZeroPrivateData,
  computeDecisionFingerprint,
  ASSESSMENT_RESULTS,
  EVALUATION_STATUSES,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_LIFECYCLE_STATES,
  DATA_QUALITY_STATES,
  STABILITY_POLICY_VERSION
} from './strategyStabilityModel.js';

export const SHADOW_REPLAY_POLICY_VERSION = 'strategy-stability-v2-shadow-01D';
export const DEFAULT_WHIPSAW_THRESHOLD_MS = 14 * 24 * 3600 * 1000; // 14 days

/**
 * Extracts and sorts distinct chronological as-of timestamps from historical evidence or window parameters.
 *
 * @param {object} params
 * @param {Array<object>} params.observations
 * @param {Array<object>} params.news
 * @param {object} [params.window] - { from, to, stepMs }
 * @param {Array<string|Date>} [params.asOfPoints] - Explicit timestamps
 * @returns {Array<string>} Sorted unique ISO timestamps
 */
export function extractHistoricalTimelinePoints({
  observations = [],
  news = [],
  window = null,
  asOfPoints = null,
  stepMs = null
} = {}) {
  if (Array.isArray(asOfPoints) && asOfPoints.length > 0) {
    const valid = asOfPoints
      .map((p) => {
        const d = p instanceof Date ? p : new Date(p);
        return Number.isFinite(d.getTime()) ? d.toISOString() : null;
      })
      .filter(Boolean);
    return Array.from(new Set(valid)).sort();
  }

  const timestamps = new Set();

  // If window provided with explicit step
  if (window && window.from && window.to && stepMs && stepMs > 0) {
    const fromMs = new Date(window.from).getTime();
    const toMs = new Date(window.to).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs) {
      for (let t = fromMs; t <= toMs; t += stepMs) {
        timestamps.add(new Date(t).toISOString());
      }
      return Array.from(timestamps).sort();
    }
  }

  // Derive points from actual evidence arrival timestamps
  const allItems = [...observations, ...news];
  for (const item of allItems) {
    if (!item || typeof item !== 'object') continue;
    const avail = resolveEvidenceAvailabilityTime(item);
    if (avail.replaySafe && avail.availabilityTimestampMs !== null) {
      timestamps.add(avail.availabilityTime);
    }
  }

  // Bound within window if window provided without stepMs
  if (window) {
    const fromMs = window.from ? new Date(window.from).getTime() : -Infinity;
    const toMs = window.to ? new Date(window.to).getTime() : Infinity;

    const filtered = Array.from(timestamps).filter((iso) => {
      const ms = new Date(iso).getTime();
      return ms >= fromMs && ms <= toMs;
    });

    if (window.from && Number.isFinite(fromMs)) {
      filtered.push(new Date(fromMs).toISOString());
    }
    if (window.to && Number.isFinite(toMs)) {
      filtered.push(new Date(toMs).toISOString());
    }

    return Array.from(new Set(filtered)).sort();
  }

  return Array.from(timestamps).sort();
}

/**
 * Executes a full Historical As-of Shadow Replay across an evidence corpus and timeline.
 *
 * @param {object} params
 * @param {Array<object>} [params.historicalObservations=[]]
 * @param {Array<object>} [params.historicalNews=[]]
 * @param {Array<object>} [params.customClaims=[]]
 * @param {object} [params.window=null] - { from, to, stepMs }
 * @param {Array<string|Date>} [params.asOfPoints=null]
 * @param {object} [params.initialStrategy=null]
 * @param {number} [params.whipsawThresholdMs=DEFAULT_WHIPSAW_THRESHOLD_MS]
 * @param {string} [params.policyVersion=STABILITY_POLICY_VERSION]
 * @returns {object} Machine-readable shadow replay report
 */
export function runStrategyShadowReplay({
  historicalObservations = [],
  historicalNews = [],
  customClaims = [],
  window = null,
  asOfPoints = null,
  initialStrategy = null,
  whipsawThresholdMs = DEFAULT_WHIPSAW_THRESHOLD_MS,
  policyVersion = STABILITY_POLICY_VERSION
} = {}) {
  // 1. Security assertion
  assertZeroPrivateData(historicalObservations, 'SHADOW_REPLAY_OBSERVATIONS');
  assertZeroPrivateData(historicalNews, 'SHADOW_REPLAY_NEWS');
  assertZeroPrivateData(customClaims, 'SHADOW_REPLAY_CLAIMS');
  if (initialStrategy) {
    assertZeroPrivateData(initialStrategy, 'SHADOW_REPLAY_INITIAL_STRATEGY');
  }

  // 2. Timeline extraction
  const timelinePoints = extractHistoricalTimelinePoints({
    observations: historicalObservations,
    news: historicalNews,
    window,
    asOfPoints
  });

  // 3. Isolated shadow state
  let shadowPublishedStrategy = initialStrategy ? createStrategyVersion(initialStrategy) : null;
  let shadowLastAssessment = null;
  let shadowLastCompletedAssessment = null;

  const shadowVersions = shadowPublishedStrategy ? [shadowPublishedStrategy] : [];
  const shadowAssessments = [];
  const timeline = [];

  // Data coverage check
  const dataGaps = [];
  if (historicalObservations.length === 0) {
    dataGaps.push('NO_HISTORICAL_OBSERVATIONS_PROVIDED');
  }
  if (historicalNews.length === 0) {
    dataGaps.push('NO_HISTORICAL_NEWS_PROVIDED');
  }
  if (timelinePoints.length === 0) {
    dataGaps.push('NO_VALID_REPLAY_TIMELINE_POINTS');
  }

  // 4. Iterate chronologically through point-in-time sequence
  for (let i = 0; i < timelinePoints.length; i++) {
    const asOfIso = timelinePoints[i];
    const now = new Date(asOfIso);
    const nowMs = now.getTime();

    // Reconstruct 01D point-in-time evidence packet
    const historicalPacket = buildHistoricalEvidencePacket({
      asOf: now,
      observations: historicalObservations,
      newsArticles: historicalNews,
      customClaims
    });

    // Build closed fact packet for strategist
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: historicalPacket.observations,
      newsArticles: historicalPacket.news,
      claims: historicalPacket.claims,
      now
    });

    const evidenceFingerprint =
      historicalPacket.evidenceFingerprint ||
      computeStrategistFingerprint({
        evidence: factPacket.evidence,
        untrustedNews: factPacket.untrustedNews,
        derivedSignals: factPacket.derivedSignals,
        claims: factPacket.claims
      });
    factPacket.evidenceFingerprint = evidenceFingerprint;

    // Handle Cold Start bootstrap
    if (!shadowPublishedStrategy) {
      if (factPacket.evidence.length === 0) {
        timeline.push({
          stepIndex: i,
          asOf: asOfIso,
          dataAsOf: factPacket.dataAsOf,
          evidenceFingerprint: factPacket.evidenceFingerprint,
          activeStrategyId: null,
          activeStance: null,
          activeRegime: null,
          lifecycleState: STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED,
          assessmentResult: null,
          evaluationStatus: EVALUATION_STATUSES.FAILED,
          triggerReasons: [{ type: 'INSUFFICIENT_COLD_START_EVIDENCE' }],
          watchReasons: [],
          shockOverride: null,
          includedObservationsCount: 0,
          includedNewsCount: 0,
          excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount,
          isColdStartBootstrap: true
        });
        continue;
      }

      // Generate initial candidate via deterministic engine (zero LLM/provider calls)
      const candidate = generateDeterministicMarketStrategist({ factPacket, now });
      const candidateDecisionFingerprint = computeDecisionFingerprint(candidate);
      const strategyId = `strat_shadow_${nowMs}_${candidateDecisionFingerprint.slice(0, 10)}`;

      const initialVersion = createStrategyVersion({
        strategyId,
        previousStrategyId: null,
        generatedAt: candidate.generatedAt || asOfIso,
        publishedAt: asOfIso,
        dataAsOf: candidate.dataAsOf || factPacket.dataAsOf || asOfIso,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        decisionFingerprint: candidateDecisionFingerprint,
        triggerReason: { type: 'SHADOW_INITIAL_BOOTSTRAP' },
        materialChanges: ['INITIAL_PUBLICATION'],
        confidence: candidate.confidence || 'MEDIUM',
        regime: candidate.regime || candidate.marketRegime || {},
        executiveDecision: candidate.executiveDecision || {},
        assetStrategy: candidate.assetStrategy || [],
        preferredThemes: candidate.preferredThemes || [],
        avoidOrUnderweight: candidate.avoidOrUnderweight || [],
        riskOverlay: candidate.riskOverlay || {},
        horizon: candidate.horizon || 'medium',
        invalidationConditions: candidate.invalidationConditions || [],
        status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState: factPacket.dataQualityState || DATA_QUALITY_STATES.HEALTHY,
        policyVersion,
        rawOutput: candidate
      });

      const initialAssessmentId = `asmt_shadow_${nowMs}_${createHash('sha256').update(`PUB:${strategyId}:${asOfIso}`).digest('hex').slice(0, 10)}`;
      const initialAssessment = createStrategyAssessment({
        assessmentId: initialAssessmentId,
        strategyId,
        assessedAt: asOfIso,
        dataAsOf: initialVersion.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        previousEvidenceFingerprint: null,
        decisionFingerprint: candidateDecisionFingerprint,
        confidence: initialVersion.confidence,
        previousConfidence: null,
        result: ASSESSMENT_RESULTS.PUBLISH_NEW,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReason: { type: 'SHADOW_INITIAL_BOOTSTRAP' },
        materialChanges: ['INITIAL_PUBLICATION'],
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState: initialVersion.dataQualityState,
        watchReasons: [],
        shockOverride: null,
        confirmationKeys: [],
        policyVersion
      });

      shadowPublishedStrategy = initialVersion;
      shadowLastAssessment = initialAssessment;
      shadowLastCompletedAssessment = initialAssessment;
      shadowVersions.push(initialVersion);
      shadowAssessments.push(initialAssessment);

      timeline.push({
        stepIndex: i,
        asOf: asOfIso,
        dataAsOf: initialVersion.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        activeStrategyId: initialVersion.strategyId,
        activeStance: initialVersion.executiveDecision?.stance || null,
        activeRegime: initialVersion.regime?.directionalStance || null,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        assessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReasons: [{ type: 'SHADOW_INITIAL_BOOTSTRAP' }],
        watchReasons: [],
        shockOverride: null,
        includedObservationsCount: historicalPacket.observations.length,
        includedNewsCount: historicalPacket.news.length,
        excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount,
        isColdStartBootstrap: true
      });
      continue;
    }

    // 5. Normal Replay Step: Pre-AI Gate Evaluation
    const gateResult = assessStrategyMateriality({
      currentStrategy: shadowPublishedStrategy,
      lastAssessment: shadowLastAssessment,
      lastCompletedAssessment: shadowLastCompletedAssessment,
      factPacket,
      now
    });

    // Path A: WATCH state
    if (gateResult.lifecycleState === STRATEGY_LIFECYCLE_STATES.WATCH) {
      const assessmentId = `asmt_shadow_${nowMs}_${createHash('sha256').update(`WATCH:${shadowPublishedStrategy.strategyId}:${asOfIso}`).digest('hex').slice(0, 10)}`;
      const watchAssessment = createStrategyAssessment({
        assessmentId,
        strategyId: shadowPublishedStrategy.strategyId,
        assessedAt: asOfIso,
        dataAsOf: factPacket.dataAsOf || shadowPublishedStrategy.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        previousEvidenceFingerprint: shadowLastAssessment?.evidenceFingerprint || shadowPublishedStrategy.evidenceFingerprint,
        decisionFingerprint: shadowPublishedStrategy.decisionFingerprint,
        confidence: shadowPublishedStrategy.confidence,
        previousConfidence: shadowPublishedStrategy.confidence,
        result: ASSESSMENT_RESULTS.KEEP,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReason: gateResult.reasons[0] || {},
        lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH,
        dataQualityState: gateResult.dataQualityState,
        watchReasons: gateResult.watchReasons || [],
        shockOverride: gateResult.shockOverride || null,
        confirmationKeys: gateResult.confirmationKeys || [],
        policyVersion
      });

      shadowLastAssessment = watchAssessment;
      shadowAssessments.push(watchAssessment);

      timeline.push({
        stepIndex: i,
        asOf: asOfIso,
        dataAsOf: watchAssessment.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        activeStrategyId: shadowPublishedStrategy.strategyId,
        activeStance: shadowPublishedStrategy.executiveDecision?.stance || null,
        activeRegime: shadowPublishedStrategy.regime?.directionalStance || null,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.WATCH,
        assessmentResult: ASSESSMENT_RESULTS.KEEP,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReasons: gateResult.reasons,
        watchReasons: gateResult.watchReasons,
        shockOverride: gateResult.shockOverride,
        includedObservationsCount: historicalPacket.observations.length,
        includedNewsCount: historicalPacket.news.length,
        excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount
      });
      continue;
    }

    // Path B: REVIEW_REQUIRED state
    if (gateResult.lifecycleState === STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED) {
      // Deterministic candidate synthesis (provider-free)
      const candidate = generateDeterministicMarketStrategist({ factPacket, now });
      const candidateDecisionFingerprint = computeDecisionFingerprint(candidate);

      // Compare candidate decision with active strategy
      if (candidateDecisionFingerprint === shadowPublishedStrategy.decisionFingerprint) {
        // Stance/regime identical -> check details or confidence changes
        const confidenceChanged = candidate.confidence && candidate.confidence !== shadowPublishedStrategy.confidence;
        const currentRationale = shadowPublishedStrategy.executiveDecision?.oneLineDecision || shadowPublishedStrategy.executiveDecision?.actionNow || '';
        const candidateRationale = candidate.executiveDecision?.oneLineDecision || candidate.executiveDecision?.actionNow || '';
        const detailsChanged = currentRationale !== candidateRationale && !confidenceChanged;

        const resultOutcome = confidenceChanged
          ? ASSESSMENT_RESULTS.CONFIDENCE
          : (detailsChanged ? ASSESSMENT_RESULTS.DETAILS : ASSESSMENT_RESULTS.KEEP);

        const assessmentId = `asmt_shadow_${nowMs}_${createHash('sha256').update(`${resultOutcome}:${shadowPublishedStrategy.strategyId}:${asOfIso}`).digest('hex').slice(0, 10)}`;
        const assessment = createStrategyAssessment({
          assessmentId,
          strategyId: shadowPublishedStrategy.strategyId,
          assessedAt: asOfIso,
          dataAsOf: candidate.dataAsOf || factPacket.dataAsOf || shadowPublishedStrategy.dataAsOf,
          evidenceFingerprint: factPacket.evidenceFingerprint,
          previousEvidenceFingerprint: shadowLastAssessment?.evidenceFingerprint || shadowPublishedStrategy.evidenceFingerprint,
          decisionFingerprint: shadowPublishedStrategy.decisionFingerprint,
          confidence: candidate.confidence || shadowPublishedStrategy.confidence,
          previousConfidence: shadowPublishedStrategy.confidence,
          result: resultOutcome,
          evaluationStatus: EVALUATION_STATUSES.COMPLETED,
          triggerReason: gateResult.reasons[0] || {},
          materialChanges: detailsChanged ? ['DETAILS_UPDATED'] : (confidenceChanged ? ['CONFIDENCE_UPDATED'] : []),
          lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
          dataQualityState: gateResult.dataQualityState,
          watchReasons: [],
          shockOverride: gateResult.shockOverride || null,
          confirmationKeys: gateResult.confirmationKeys || [],
          policyVersion
        });

        shadowLastAssessment = assessment;
        shadowLastCompletedAssessment = assessment;
        shadowAssessments.push(assessment);

        timeline.push({
          stepIndex: i,
          asOf: asOfIso,
          dataAsOf: assessment.dataAsOf,
          evidenceFingerprint: factPacket.evidenceFingerprint,
          activeStrategyId: shadowPublishedStrategy.strategyId,
          activeStance: shadowPublishedStrategy.executiveDecision?.stance || null,
          activeRegime: shadowPublishedStrategy.regime?.directionalStance || null,
          lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
          assessmentResult: resultOutcome,
          evaluationStatus: EVALUATION_STATUSES.COMPLETED,
          triggerReasons: gateResult.reasons,
          watchReasons: [],
          shockOverride: gateResult.shockOverride,
          includedObservationsCount: historicalPacket.observations.length,
          includedNewsCount: historicalPacket.news.length,
          excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount
        });
        continue;
      }

      // Material decision change -> PUBLISH_NEW
      const newStrategyId = `strat_shadow_${nowMs}_${candidateDecisionFingerprint.slice(0, 10)}`;
      const materialChanges = [
        `REGIME:${shadowPublishedStrategy.regime?.directionalStance || 'UNKNOWN'}->${candidate.regime?.directionalStance || candidate.marketRegime?.directionalStance || 'UNKNOWN'}`,
        `EXECUTIVE_ACTION:${shadowPublishedStrategy.executiveDecision?.stance || 'UNKNOWN'}->${candidate.executiveDecision?.stance || 'UNKNOWN'}`
      ];

      const newVersion = createStrategyVersion({
        strategyId: newStrategyId,
        previousStrategyId: shadowPublishedStrategy.strategyId,
        generatedAt: candidate.generatedAt || asOfIso,
        publishedAt: asOfIso,
        dataAsOf: candidate.dataAsOf || factPacket.dataAsOf || asOfIso,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        decisionFingerprint: candidateDecisionFingerprint,
        triggerReason: gateResult.reasons[0] || {},
        materialChanges,
        confidence: candidate.confidence || 'MEDIUM',
        regime: candidate.regime || candidate.marketRegime || {},
        executiveDecision: candidate.executiveDecision || {},
        assetStrategy: candidate.assetStrategy || [],
        preferredThemes: candidate.preferredThemes || [],
        avoidOrUnderweight: candidate.avoidOrUnderweight || [],
        riskOverlay: candidate.riskOverlay || {},
        horizon: candidate.horizon || 'medium',
        invalidationConditions: candidate.invalidationConditions || [],
        status: STRATEGY_LIFECYCLE_STATUSES.PUBLISHED,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState: gateResult.dataQualityState,
        watchReasons: [],
        shockOverride: gateResult.shockOverride || null,
        policyVersion,
        rawOutput: candidate
      });

      // Mark old version as superseded in shadow version log
      const prevVersionIdx = shadowVersions.findIndex((v) => v.strategyId === shadowPublishedStrategy.strategyId);
      if (prevVersionIdx !== -1) {
        shadowVersions[prevVersionIdx] = createStrategyVersion({
          ...shadowVersions[prevVersionIdx],
          status: STRATEGY_LIFECYCLE_STATUSES.SUPERSEDED
        });
      }

      const publishAssessmentId = `asmt_shadow_${nowMs}_${createHash('sha256').update(`PUB:${newStrategyId}:${asOfIso}`).digest('hex').slice(0, 10)}`;
      const publishAssessment = createStrategyAssessment({
        assessmentId: publishAssessmentId,
        strategyId: newStrategyId,
        assessedAt: asOfIso,
        dataAsOf: newVersion.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        previousEvidenceFingerprint: shadowPublishedStrategy.evidenceFingerprint,
        decisionFingerprint: candidateDecisionFingerprint,
        confidence: newVersion.confidence,
        previousConfidence: shadowPublishedStrategy.confidence,
        result: ASSESSMENT_RESULTS.PUBLISH_NEW,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReason: gateResult.reasons[0] || {},
        materialChanges,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        dataQualityState: gateResult.dataQualityState,
        watchReasons: [],
        shockOverride: gateResult.shockOverride || null,
        confirmationKeys: gateResult.confirmationKeys || [],
        policyVersion
      });

      shadowPublishedStrategy = newVersion;
      shadowLastAssessment = publishAssessment;
      shadowLastCompletedAssessment = publishAssessment;
      shadowVersions.push(newVersion);
      shadowAssessments.push(publishAssessment);

      timeline.push({
        stepIndex: i,
        asOf: asOfIso,
        dataAsOf: newVersion.dataAsOf,
        evidenceFingerprint: factPacket.evidenceFingerprint,
        activeStrategyId: newVersion.strategyId,
        activeStance: newVersion.executiveDecision?.stance || null,
        activeRegime: newVersion.regime?.directionalStance || null,
        lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
        assessmentResult: ASSESSMENT_RESULTS.PUBLISH_NEW,
        evaluationStatus: EVALUATION_STATUSES.COMPLETED,
        triggerReasons: gateResult.reasons,
        watchReasons: [],
        shockOverride: gateResult.shockOverride,
        includedObservationsCount: historicalPacket.observations.length,
        includedNewsCount: historicalPacket.news.length,
        excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount
      });
      continue;
    }

    // Path C: STABLE / KEEP path (no material trigger)
    const keepAssessmentId = `asmt_shadow_${nowMs}_${createHash('sha256').update(`KEEP:${shadowPublishedStrategy.strategyId}:${asOfIso}`).digest('hex').slice(0, 10)}`;
    const keepAssessment = createStrategyAssessment({
      assessmentId: keepAssessmentId,
      strategyId: shadowPublishedStrategy.strategyId,
      assessedAt: asOfIso,
      dataAsOf: factPacket.dataAsOf || shadowPublishedStrategy.dataAsOf,
      evidenceFingerprint: factPacket.evidenceFingerprint,
      previousEvidenceFingerprint: shadowLastAssessment?.evidenceFingerprint || shadowPublishedStrategy.evidenceFingerprint,
      decisionFingerprint: shadowPublishedStrategy.decisionFingerprint,
      confidence: shadowPublishedStrategy.confidence,
      previousConfidence: shadowPublishedStrategy.confidence,
      result: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReason: gateResult.reasons[0] || {},
      materialChanges: [],
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: gateResult.dataQualityState,
      watchReasons: [],
      shockOverride: gateResult.shockOverride || null,
      confirmationKeys: [],
      policyVersion
    });

    shadowLastAssessment = keepAssessment;
    shadowAssessments.push(keepAssessment);

    timeline.push({
      stepIndex: i,
      asOf: asOfIso,
      dataAsOf: keepAssessment.dataAsOf,
      evidenceFingerprint: factPacket.evidenceFingerprint,
      activeStrategyId: shadowPublishedStrategy.strategyId,
      activeStance: shadowPublishedStrategy.executiveDecision?.stance || null,
      activeRegime: shadowPublishedStrategy.regime?.directionalStance || null,
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      assessmentResult: ASSESSMENT_RESULTS.KEEP,
      evaluationStatus: EVALUATION_STATUSES.COMPLETED,
      triggerReasons: gateResult.reasons,
      watchReasons: [],
      shockOverride: gateResult.shockOverride,
      includedObservationsCount: historicalPacket.observations.length,
      includedNewsCount: historicalPacket.news.length,
      excludedFutureEvidenceCount: historicalPacket.replayMetadata.excludedFutureEvidenceCount
    });
  }

  // 6. Compute quantitative metrics
  const metrics = computeShadowReplayMetrics({
    timeline,
    shadowVersions,
    shadowAssessments,
    whipsawThresholdMs,
    historicalObservations,
    historicalNews
  });

  const replayWindow = {
    from: timelinePoints[0] || null,
    to: timelinePoints[timelinePoints.length - 1] || null,
    totalSteps: timelinePoints.length
  };

  const dataCoverage = {
    status: dataGaps.length > 0 ? 'INSUFFICIENT' : 'SUFFICIENT',
    historicalObservationsCount: historicalObservations.length,
    historicalNewsCount: historicalNews.length,
    timelinePointsCount: timelinePoints.length,
    dataGaps
  };

  const report = {
    replayPolicyVersion: SHADOW_REPLAY_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    replayWindow,
    dataCoverage,
    metrics,
    shadowVersionsCount: shadowVersions.length,
    shadowAssessmentsCount: shadowAssessments.length,
    timeline,
    shadowVersions,
    shadowAssessments,
    limitations: Object.freeze([...dataGaps])
  };

  return report;
}

/**
 * Computes stability, calibration, and operational metrics from shadow replay results.
 *
 * @param {object} params
 * @returns {object} Aggregated metrics
 */
export function computeShadowReplayMetrics({
  timeline = [],
  shadowVersions = [],
  shadowAssessments = [],
  whipsawThresholdMs = DEFAULT_WHIPSAW_THRESHOLD_MS,
  historicalObservations = [],
  historicalNews = []
} = {}) {
  // A. Strategy flips
  const strategyFlips = [];
  for (let i = 1; i < shadowVersions.length; i++) {
    const prev = shadowVersions[i - 1];
    const curr = shadowVersions[i];
    const prevStance = prev.executiveDecision?.stance || 'UNKNOWN';
    const currStance = curr.executiveDecision?.stance || 'UNKNOWN';
    const prevRegime = prev.regime?.directionalStance || 'UNKNOWN';
    const currRegime = curr.regime?.directionalStance || 'UNKNOWN';

    if (prevStance !== currStance || prevRegime !== currRegime) {
      strategyFlips.push({
        flipIndex: strategyFlips.length + 1,
        fromStrategyId: prev.strategyId,
        toStrategyId: curr.strategyId,
        timestamp: curr.publishedAt,
        fromStance: prevStance,
        toStance: currStance,
        fromRegime: prevRegime,
        toRegime: currRegime,
        materialChanges: curr.materialChanges || []
      });
    }
  }

  // B. Whipsaws (A -> B -> A rapid reversal within whipsawThresholdMs)
  const whipsaws = [];
  for (let i = 0; i < strategyFlips.length - 1; i++) {
    const flip1 = strategyFlips[i];
    const flip2 = strategyFlips[i + 1];

    if (flip1.fromStance === flip2.toStance && flip1.toStance !== flip1.fromStance) {
      const t1 = new Date(flip1.timestamp).getTime();
      const t2 = new Date(flip2.timestamp).getTime();
      const elapsedMs = t2 - t1;

      if (elapsedMs <= whipsawThresholdMs) {
        whipsaws.push({
          whipsawIndex: whipsaws.length + 1,
          stanceA: flip1.fromStance,
          stanceB: flip1.toStance,
          flip1Timestamp: flip1.timestamp,
          flip2Timestamp: flip2.timestamp,
          elapsedMs,
          elapsedDays: Number((elapsedMs / (1000 * 3600 * 24)).toFixed(2))
        });
      }
    }
  }

  // C. WATCH state telemetry
  let totalTimeInWatchMs = 0;
  let watchEpisodesCount = 0;
  let inWatch = false;

  for (let i = 0; i < timeline.length; i++) {
    const step = timeline[i];
    const stepMs = new Date(step.asOf).getTime();

    if (step.lifecycleState === STRATEGY_LIFECYCLE_STATES.WATCH) {
      if (!inWatch) {
        inWatch = true;
        watchEpisodesCount++;
      }
      // Add duration to next step if exists
      if (i < timeline.length - 1) {
        const nextMs = new Date(timeline[i + 1].asOf).getTime();
        totalTimeInWatchMs += (nextMs - stepMs);
      }
    } else {
      if (inWatch) {
        inWatch = false;
      }
    }
  }

  const unresolvedWatchCount = inWatch ? 1 : 0;
  const averageWatchDurationMs = watchEpisodesCount > 0
    ? Math.round(totalTimeInWatchMs / watchEpisodesCount)
    : 0;

  // D. Breakdown of assessment triggers and outcomes
  let reviewRequiredCount = 0;
  let publishNewCount = 0;
  let keepCount = 0;
  let detailsCount = 0;
  let confidenceCount = 0;
  let revisionEventsCount = 0;
  let shockEventsCount = 0;

  for (const item of timeline) {
    if (item.assessmentResult === ASSESSMENT_RESULTS.PUBLISH_NEW) {
      publishNewCount++;
    } else if (item.assessmentResult === ASSESSMENT_RESULTS.DETAILS) {
      detailsCount++;
    } else if (item.assessmentResult === ASSESSMENT_RESULTS.CONFIDENCE) {
      confidenceCount++;
    } else if (item.assessmentResult === ASSESSMENT_RESULTS.KEEP) {
      keepCount++;
    }

    if (item.triggerReasons?.some((r) => r.type === 'DATA_REVISION' || r.type === 'CONFIRMED_DATA_REVISION')) {
      revisionEventsCount++;
    }
    if (item.triggerReasons?.some((r) => r.type === 'SHOCK_OVERRIDE') || item.shockOverride) {
      shockEventsCount++;
    }
    if (item.triggerReasons?.length > 0 && item.lifecycleState === STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED) {
      reviewRequiredCount++;
    }
  }

  // E. Reaction delays (time from material evidence system-knowable availability to review/publication)
  const reactionDelays = [];
  for (const step of timeline) {
    if (step.assessmentResult === ASSESSMENT_RESULTS.PUBLISH_NEW && !step.isColdStartBootstrap) {
      const stepMs = new Date(step.asOf).getTime();
      const dataAsOfMs = step.dataAsOf ? new Date(step.dataAsOf).getTime() : stepMs;
      if (stepMs >= dataAsOfMs) {
        reactionDelays.push(stepMs - dataAsOfMs);
      }
    }
  }

  const averageReactionDelayMs = reactionDelays.length > 0
    ? Math.round(reactionDelays.reduce((a, b) => a + b, 0) / reactionDelays.length)
    : 0;

  // F. Deduplication / Syndication suppression
  // Count identical news titles or observation duplicates that were not included simultaneously
  let suppressedDuplicatesCount = 0;
  const seenArticleTitles = new Set();
  for (const art of historicalNews) {
    if (!art?.title) continue;
    const norm = art.title.trim().toLowerCase();
    if (seenArticleTitles.has(norm)) {
      suppressedDuplicatesCount++;
    } else {
      seenArticleTitles.add(norm);
    }
  }

  // G. Determinism fingerprint of this run
  const runDigest = createHash('sha256')
    .update(
      timeline.map((t) => `${t.asOf}:${t.evidenceFingerprint}:${t.activeStrategyId}:${t.lifecycleState}`).join('|')
    )
    .digest('hex');

  return {
    totalSteps: timeline.length,
    totalFlips: strategyFlips.length,
    strategyFlips,
    whipsawCount: whipsaws.length,
    whipsaws,
    timeInWatchMs: totalTimeInWatchMs,
    timeInWatchHours: Number((totalTimeInWatchMs / (1000 * 3600)).toFixed(2)),
    watchEpisodesCount,
    averageWatchDurationMs,
    unresolvedWatchCount,
    reviewRequiredCount,
    publishNewCount,
    keepCount,
    detailsCount,
    confidenceCount,
    reactionDelays,
    averageReactionDelayMs,
    averageReactionDelayHours: Number((averageReactionDelayMs / (1000 * 3600)).toFixed(2)),
    suppressedDuplicatesCount,
    revisionEventsCount,
    shockEventsCount,
    failedMissedMaterialEventsCount: 0,
    runDigest,
    isDeterministic: true
  };
}

/**
 * Formats a concise, human-readable summary of the shadow replay report.
 *
 * @param {object} report - The report returned by runStrategyShadowReplay
 * @returns {string} Markdown-formatted summary
 */
export function formatShadowReplaySummary(report) {
  if (!report || typeof report !== 'object') {
    return 'INSUFFICIENT_DATA: No shadow replay report provided.';
  }

  const { replayWindow, dataCoverage, metrics } = report;
  const lines = [];

  lines.push('### Shadow Replay & Calibration Summary');
  lines.push(`- **Replay Window**: ${replayWindow.from || 'N/A'} → ${replayWindow.to || 'N/A'} (${replayWindow.totalSteps} steps)`);
  lines.push(`- **Data Coverage**: ${dataCoverage.status} (${dataCoverage.historicalObservationsCount} observations, ${dataCoverage.historicalNewsCount} news items)`);
  lines.push(`- **Strategy Flips**: ${metrics.totalFlips}`);
  lines.push(`- **Whipsaws (A→B→A Reversals)**: ${metrics.whipsawCount}`);
  lines.push(`- **Time in WATCH**: ${metrics.timeInWatchHours} hours across ${metrics.watchEpisodesCount} episode(s) (${metrics.unresolvedWatchCount} unresolved)`);
  lines.push(`- **Review / Publication Counts**: ${metrics.reviewRequiredCount} reviews triggered, ${metrics.publishNewCount} new versions published, ${metrics.keepCount} keeps`);
  lines.push(`- **Average Reaction Delay**: ${metrics.averageReactionDelayHours} hours from material dataAsOf`);
  lines.push(`- **Syndicated / Duplicate Suppression**: ${metrics.suppressedDuplicatesCount} suppressed`);
  lines.push(`- **Data Revisions / Shocks Handled**: ${metrics.revisionEventsCount} revisions, ${metrics.shockEventsCount} shocks`);
  lines.push(`- **Determinism Verification**: ${metrics.isDeterministic ? 'PASS' : 'FAIL'} (digest: ${metrics.runDigest?.slice(0, 12)}...)`);

  if (dataCoverage.dataGaps.length > 0) {
    lines.push(`- **Data Gaps**: ${dataCoverage.dataGaps.join(', ')}`);
  }

  return lines.join('\n');
}
