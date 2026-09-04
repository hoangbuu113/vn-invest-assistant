import { getMarketContextFabric } from './context/fabric.js';
import { getNewsFeed } from './news.js';
import {
  buildMarketStrategistFactPacket,
  generateMarketStrategist,
  globalMarketStrategistRuntime,
  MarketStrategistRuntime
} from './ai/marketStrategistEngine.js';

export {
  buildMarketStrategistFactPacket,
  generateMarketStrategist,
  globalMarketStrategistRuntime,
  MarketStrategistRuntime
};

/**
 * Top-level facade for AI Market Strategist.
 * Gathers validated public market observations from context fabric,
 * normalized news articles from news reader, builds closed fact packet,
 * and synthesizes the strategist output with safety guards.
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
  allowLlm = true
} = {}) {
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

  // 4. Generate structured strategist brief
  return generateMarketStrategist({
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
}
