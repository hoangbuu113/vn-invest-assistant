import { getMarketContextFabric } from './context/fabric.js';
import { getNewsFeed } from './news.js';
import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  generateMarketStrategist,
  globalMarketStrategistRuntime,
  MarketStrategistRuntime
} from './ai/marketStrategistEngine.js';
import { evaluateAndApplyStrategyStability } from './ai/strategyStabilityService.js';
import {
  getCurrentPublishedStrategy,
  getLatestStrategyAssessment
} from './ai/strategyStabilityRepository.js';
import { recordJobHealth, HEALTH_STATES, OBSERVED_JOBS, ERROR_CATEGORIES } from './observability/dataHealth.js';
import { attachMarketStrategyConfidence } from './ai/confidenceService.js';

export {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  generateMarketStrategist,
  globalMarketStrategistRuntime,
  MarketStrategistRuntime,
  evaluateAndApplyStrategyStability,
  getCurrentPublishedStrategy,
  getLatestStrategyAssessment
};

/**
 * Top-level facade for AI Market Strategist with Strategy Stability (Two Clocks).
 * Gathers validated public market observations from context fabric,
 * normalized news articles from news reader, builds closed fact packet,
 * evaluates pre-AI stability gate, and synthesizes or reuses published strategy.
 *
 * GUARANTEE: Operates strictly on public context and news; ZERO user/portfolio data is consumed.
 */
export async function getMarketStrategist({
  now = new Date(),
  getMarketContextFabricFn = getMarketContextFabric,
  getNewsFeedFn = getNewsFeed,
  geminiApiKey = process.env.GEMINI_API_KEY,
  geminiModel = process.env.GEMINI_MODEL,
  openAiApiKey = process.env.OPENAI_API_KEY,
  apiKey,
  runtime = globalMarketStrategistRuntime,
  generateLlmFn = null,
  fetchFn = globalThis.fetch,
  aiEnabled = process.env.AI_BRIEF_ENABLED !== 'false',
  allowLlm = true,
  client = undefined,
  isReadOnly = false,
  idempotencyKey = null,
  attachConfidenceFn = attachMarketStrategyConfidence
} = {}) {
  const startTime = Date.now();
  // 1. Fetch validated market context facts from the fabric (L1 cache / persistence only)
  let marketObservations = [];
  try {
    const fabricResult = await getMarketContextFabricFn({ now });
    marketObservations = Array.isArray(fabricResult?.facts)
      ? fabricResult.facts
      : [];
  } catch {
    marketObservations = [];
  }

  // 2. Fetch normalized news articles from the reader (L1 cache / persistence only)
  let newsArticles = [];
  try {
    const newsResult = await getNewsFeedFn({ limit: 40, now });
    newsArticles = Array.isArray(newsResult?.data)
      ? newsResult.data
      : (Array.isArray(newsResult?.news) ? newsResult.news : []);
  } catch {
    newsArticles = [];
  }

  // 3. Build strictly bounded, closed fact packet (ZERO private data)
  const factPacket = buildMarketStrategistFactPacket({
    marketObservations,
    newsArticles,
    now
  });

  // Authoritative evidence resolver for stale-evaluation protection (read-only requests perform no publication)
  // Re-reads current persisted/cached validated evidence and computes fresh fingerprint immediately before publication
  const getAuthoritativeEvidenceFingerprint = !isReadOnly
    ? async () => {
        const revalNow = new Date();
        let freshObs = [];
        try {
          const freshFabric = await getMarketContextFabricFn({ now: revalNow });
          freshObs = Array.isArray(freshFabric?.facts) ? freshFabric.facts : [];
        } catch {
          freshObs = [];
        }

        let freshNews = [];
        try {
          const freshNewsResult = await getNewsFeedFn({ limit: 40, now: revalNow });
          freshNews = Array.isArray(freshNewsResult?.data)
            ? freshNewsResult.data
            : (Array.isArray(freshNewsResult?.news) ? freshNewsResult.news : []);
        } catch {
          freshNews = [];
        }

        const freshPacket = buildMarketStrategistFactPacket({
          marketObservations: freshObs,
          newsArticles: freshNews,
          now: revalNow
        });

        return freshPacket?.evidenceFingerprint || computeStrategistFingerprint({
          validFactIds: freshPacket?.validFactIds,
          validArticleIds: freshPacket?.validArticleIds,
          validSignalIds: freshPacket?.validSignalIds,
          validClaimIds: freshPacket?.validClaimIds,
          evidence: freshPacket?.evidence || freshObs,
          untrustedNews: freshPacket?.untrustedNews || freshNews,
          derivedSignals: freshPacket?.derivedSignals || [],
          claims: freshPacket?.claims || []
        });
      }
    : null;

  // 4. Evaluate Strategy Stability lifecycle
  let stabilityResult;
  try {
    stabilityResult = await evaluateAndApplyStrategyStability({
      factPacket,
      now,
      allowLlm,
      geminiApiKey,
      geminiModel,
      openAiApiKey,
      apiKey,
      runtime,
      generateLlmFn,
      fetchFn,
      aiEnabled,
      client,
      isReadOnly,
      idempotencyKey,
      getAuthoritativeEvidenceFingerprint
    });
    stabilityResult = await attachConfidenceFn({
      factPacket,
      strategyResult: stabilityResult,
      now,
      client,
      isReadOnly
    });
  } catch (strategyErr) {
    const durationMs = Date.now() - startTime;
    try {
      await recordJobHealth({
        jobName: OBSERVED_JOBS.MARKET_STRATEGIST_REFRESH,
        status: HEALTH_STATES.FAILED,
        durationMs,
        recordsRead: (marketObservations.length || 0) + (newsArticles.length || 0),
        recordsWritten: 0,
        dataAsOf: factPacket?.dataAsOf || now.toISOString(),
        policyVersion: 'strategy-stability-v2',
        error: strategyErr,
        client,
        now
      });
    } catch {
      // Non-blocking telemetry
    }
    throw strategyErr;
  }

  const durationMs = Date.now() - startTime;
  const isFailed = stabilityResult?.assessment?.decisionOutcome === 'FAILED' || stabilityResult?.action === 'FAILED';
  const isDataDegraded = stabilityResult?.assessment?.dataQualityState === 'DEGRADED' || stabilityResult?.assessment?.decisionOutcome === 'DEGRADED';
  const strategistStatus = isFailed
    ? HEALTH_STATES.FAILED
    : (isDataDegraded ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY);

  try {
    await recordJobHealth({
      jobName: OBSERVED_JOBS.MARKET_STRATEGIST_REFRESH,
      status: strategistStatus,
      durationMs,
      recordsRead: (marketObservations.length || 0) + (newsArticles.length || 0),
      recordsWritten: stabilityResult?.action === 'PUBLISH_NEW' ? 1 : 0,
      dataAsOf: factPacket?.dataAsOf || now.toISOString(),
      policyVersion: 'strategy-stability-v2',
      errorCode: isFailed ? 'STRATEGY_ASSESSMENT_FAILED' : null,
      errorCategory: isFailed ? ERROR_CATEGORIES.INTERNAL : null,
      client,
      now
    });
  } catch {
    // Non-blocking telemetry
  }

  return stabilityResult;
}
