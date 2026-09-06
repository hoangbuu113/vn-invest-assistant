import { createHash } from 'node:crypto';
import {
  STRATEGIST_MODEL,
  STRATEGIST_REASONING_EFFORT,
  STRATEGIST_MAX_OUTPUT_TOKENS,
  STRATEGIST_PROMPT_VERSION,
  STRATEGIST_SCHEMA_VERSION,
  STRATEGIST_METHODOLOGY_VERSION,
  MARKET_STRATEGIST_SCHEMA,
  STRATEGIST_SYSTEM_INSTRUCTIONS,
  toGeminiSchema
} from './marketStrategistPrompt.js';
import {
  validateMarketStrategistOutput,
  applySharedPublicationGate,
  buildSafeInsufficientEvidenceBrief
} from './marketStrategistValidation.js';
import { buildDeterministicMarketBrief } from './marketStrategistBrief.js';
import { deriveMarketSignals } from './derivedSignals.js';
import { normalizeReferencePeriodKey } from '../context/factModel.js';
import { persistRunManifest } from './marketStrategistManifest.js';
import { calculateArticleContentHash } from '../news/contract.js';
import { FACT_POLICY_MAP, CADENCE_POLICIES } from '../context/freshnessPolicy.js';
import {
  extractClaimsFromObservation,
  extractClaimsFromArticle,
  reconcileClaims,
  classifySourceFamily,
  resolveClaimDependency,
  SOURCE_FAMILIES,
  DEPENDENCY_GROUPS
} from '../claims/index.js';

export const STRATEGIST_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const STRATEGIST_COOLDOWN_MS = 15 * 1000;       // 15 seconds
export const STRATEGIST_SELECTION_POLICY_VERSION = 'v1.2';

/**
 * Builds the closed fact packet for AI Market Strategist.
 * Strictly guarantees ZERO private portfolio/user data enters the packet.
 * Strictly enforces exact observation ID scope (no generic fact IDs).
 * Strictly restricts news scope to bounded selection (excluded articles are rejected).
 * Attaches explicit server-side derived signals.
 */
export function buildMarketStrategistFactPacket({
  marketObservations = [],
  newsArticles = [],
  claims: customClaims = null,
  now = new Date()
} = {}) {
  // Security guard: Ensure zero private data is passed
  const allInputs = [
    ...marketObservations,
    ...newsArticles,
    ...(Array.isArray(customClaims) ? customClaims : [])
  ];
  for (const item of allInputs) {
    if (!item || typeof item !== 'object') continue;
    if (
      'portfolio' in item ||
      'holdings' in item ||
      'cash' in item ||
      'transactions' in item ||
      'userId' in item ||
      'user_id' in item ||
      'email' in item
    ) {
      const err = new Error('FORBIDDEN_USER_DATA_IN_STRATEGIST_INPUT: Private data is prohibited from AI Market Strategist');
      err.code = 'FORBIDDEN_USER_DATA';
      throw err;
    }
  }

  const validFactIds = new Set();
  const evidence = [];

  for (const obs of marketObservations) {
    if (!obs || typeof obs !== 'object') continue;
    const observationId = obs.observationId || obs.id;
    if (!observationId) continue;

    // EXACT SCOPE: Only exact observation ID is added. Generic factId is strictly prohibited as citation.
    validFactIds.add(observationId);

    evidence.push({
      id: observationId,
      observationId,
      factId: obs.factId || null,
      pillar: obs.pillar || 'market',
      label: obs.label || obs.metric || observationId,
      value: obs.value ?? null,
      unit: obs.unit || null,
      change: obs.change ?? null,
      changeUnit: obs.changeUnit || null,
      changePercent: obs.changePercent ?? null,
      changeBasis: obs.changeBasis || null,
      status: obs.status || 'available',
      freshness: obs.freshness || 'fresh',
      source: obs.source || obs.source_id || 'System',
      referenceTime: obs.referenceTime || obs.reference_time || null,
      observedAt: obs.observedAt || obs.observed_at || null,
      publishedAt: obs.publishedAt || obs.published_at || null,
      publishedTime: obs.publishedTime || obs.published_at || obs.recordedAt || null,
      revision: obs.revision || obs.quality || 'verified',
      limitations: obs.limitations || null
    });
  }

  // Derive explicit intermediate market signals deterministically on server
  const derivedSignals = deriveMarketSignals({ observations: marketObservations, now });
  const validSignalIds = new Set(derivedSignals.map((s) => s.signalId));

  const validTickers = new Set();
  const categorizedNews = {
    vnMacro: [],
    vnMarket: [],
    globalIntermarket: [],
    crypto: [],
    other: []
  };

  for (const article of newsArticles) {
    if (!article || typeof article !== 'object') continue;
    const articleId = article.articleId || article.id;
    if (!articleId) continue;

    const relatedAssets = Array.isArray(article.relatedAssets)
      ? article.relatedAssets.map((a) => ({ symbol: a.symbol, name: a.name })).filter((a) => a.symbol)
      : [];

    for (const a of relatedAssets) {
      if (typeof a.symbol === 'string' && a.symbol.length >= 2 && a.symbol.length <= 5) {
        validTickers.add(a.symbol.toUpperCase());
      }
    }

    const titleLower = (article.title || '').toLowerCase();
    const excerptLower = (article.excerpt || article.summary || '').toLowerCase();
    const text = `${titleLower} ${excerptLower}`;

    const contentHash = article.contentHash || calculateArticleContentHash(article);
    const versionId = article.versionId || `${articleId}:v_${contentHash}`;
    const normalized = {
      articleId,
      id: articleId,
      versionId,
      contentHash,
      title: article.title || 'Untitled',
      excerpt: article.excerpt || article.summary || '',
      sourceName: article.sourceName || article.source || 'News Source',
      publishedAt: article.publishedAt || null,
      geography: article.geography || 'vietnam',
      relatedAssets
    };

    if (/bitcoin|btc|crypto|tiền mã hóa|ethereum|eth/.test(text)) {
      categorizedNews.crypto.push(normalized);
    } else if (article.geography === 'global' || /fed|dxy|lãi suất mỹ|trung quốc|dầu thô|brent|wall street|lạm phát mỹ/.test(text)) {
      categorizedNews.globalIntermarket.push(normalized);
    } else if (/chính sách|thủ tướng|chính phủ|ngân hàng nhà nước|đầu tư công|gdp|cpi|vĩ mô|thuế/.test(text)) {
      categorizedNews.vnMacro.push(normalized);
    } else if (/vn-index|hose|hnx|cổ phiếu|chứng khoán|lợi nhuận|doanh thu|kết quả kinh doanh/.test(text)) {
      categorizedNews.vnMarket.push(normalized);
    } else {
      categorizedNews.other.push(normalized);
    }
  }

  // Bounded diversification selection (up to 12 high-signal articles)
  const MAX_NEWS_COUNT = 12;
  const selectedNews = [
    ...categorizedNews.vnMacro.slice(0, 4),
    ...categorizedNews.vnMarket.slice(0, 4),
    ...categorizedNews.globalIntermarket.slice(0, 3),
    ...categorizedNews.crypto.slice(0, 1)
  ];

  if (selectedNews.length < MAX_NEWS_COUNT) {
    const selectedIds = new Set(selectedNews.map((a) => a.articleId));
    for (const pool of [categorizedNews.vnMacro, categorizedNews.vnMarket, categorizedNews.globalIntermarket, categorizedNews.other]) {
      for (const item of pool) {
        if (!selectedIds.has(item.articleId) && selectedNews.length < MAX_NEWS_COUNT) {
          selectedNews.push(item);
          selectedIds.add(item.articleId);
        }
      }
    }
  }

  // EXACT SCOPE: Only articles SELECTED into packet are valid citations.
  // Excluded articles are strictly prohibited.
  const validArticleIds = new Set(selectedNews.map((a) => a.articleId));
  const validArticleVersionIds = new Set(selectedNews.map((a) => a.versionId).filter(Boolean));

  const untrustedNews = selectedNews.length > 0 ? selectedNews : [];
  const evidenceCoverage = computeEvidenceCoverage({ evidence, untrustedNews, now });
  const dataAsOf = evidenceCoverage.dataAsOf;

  // Reconcile claims deterministically
  const observationClaimItems = marketObservations.flatMap(extractClaimsFromObservation);
  const articleClaimItems = selectedNews.flatMap(extractClaimsFromArticle);
  const candidateClaims = [
    ...observationClaimItems.map((i) => i.claim),
    ...articleClaimItems.map((i) => i.claim),
    ...(Array.isArray(customClaims) ? customClaims : [])
  ];

  const evidenceForReconciliation = [
    ...marketObservations.map((obs) => {
      const factId = obs.factId || obs.id;
      const directFamily = classifySourceFamily({
        url: obs.provenance?.documentUrl || obs.provenance?.url,
        sourceId: obs.source,
        publisher: obs.provenance?.authority
      });
      const depGroup = resolveClaimDependency({
        publisherFamily: directFamily,
        subject: factId,
        url: obs.provenance?.documentUrl || obs.provenance?.url,
        sourceId: obs.source,
        publisher: obs.provenance?.authority
      });
      const effectiveFamily =
        directFamily !== SOURCE_FAMILIES.UNKNOWN
          ? directFamily
          : depGroup !== DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY
          ? depGroup
          : SOURCE_FAMILIES.UNKNOWN;
      return {
        evidenceId: obs.observationId || obs.id,
        evidenceType: 'observation',
        sourceFamily: effectiveFamily,
        dependencyGroup: depGroup,
        ...obs
      };
    }),
    ...selectedNews.map((art) => ({
      evidenceId: art.articleId || art.id,
      evidenceType: 'article',
      sourceFamily: classifySourceFamily({
        url: art.url,
        sourceId: art.sourceId || art.source,
        publisher: art.publisher,
        title: art.title,
        summary: art.excerpt || art.summary
      }),
      ...art
    }))
  ];

  const reconciledResults = reconcileClaims(candidateClaims, evidenceForReconciliation);
  const claims = reconciledResults.map(({ claim, sourceFamilies, independentFamilies }) => ({
    claimId: claim.claimId,
    claimType: claim.claimType,
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.numericValue,
    numericValue: claim.numericValue,
    valueText: claim.valueText,
    unit: claim.unit,
    referencePeriod: claim.referencePeriod,
    scope: claim.scope,
    authorityLevel: claim.authorityLevel,
    supportStatus: claim.supportStatus,
    sourceCount: claim.sourceCount,
    independentSourceCount: claim.independentSourceCount,
    contradictionCount: claim.contradictionCount,
    sourceFamilies: sourceFamilies || [],
    independentFamilies: independentFamilies || [],
    revisionOf: claim.revisionOf,
    limitations: claim.limitations,
    confidenceDimensions: claim.confidenceDimensions
  }));

  const validClaimIds = new Set(claims.map((c) => c.claimId));

  return {
    now,
    dataAsOf,
    evidenceCoverage,
    evidence,
    untrustedNews,
    derivedSignals,
    claims,
    validFactIds,
    validArticleIds,
    validArticleVersionIds,
    validSignalIds,
    validClaimIds,
    validTickers
  };
}

/**
 * Resolves an observation or news item to its standardized reporting cadence category.
 * Used to distinguish genuine cadence disparity from harmless same-cadence intraday timestamp dispersion.
 */
export function resolveEvidenceCadenceCategory(obs) {
  if (!obs) return 'UNKNOWN';
  if (obs.pillar === 'news' || obs.sourceAuthority === 'FINANCIAL_MEDIA' || obs.sourceAuthority === 'NEWS_AGGREGATOR') {
    return 'STREAMING_NEWS';
  }
  const factId = obs.factId || obs.id;
  const policy = obs.cadencePolicy || (factId ? FACT_POLICY_MAP[factId] : null);
  if (policy === CADENCE_POLICIES.MONTHLY_MACRO || policy === CADENCE_POLICIES.QUARTERLY_MACRO || obs.pillar === 'macro') {
    return 'MACRO_PERIODIC';
  }
  if (policy === CADENCE_POLICIES.DAILY_VN_EQUITY || obs.pillar === 'market') {
    return 'DAILY_EQUITY';
  }
  if (
    policy === CADENCE_POLICIES.CURRENT_MARKET_FX ||
    policy === CADENCE_POLICIES.DAILY_MONETARY ||
    policy === CADENCE_POLICIES.WEEKLY_MONETARY ||
    obs.pillar === 'monetary' ||
    obs.pillar === 'intermarket'
  ) {
    return 'INTRADAY_MARKET';
  }
  return obs.pillar ? obs.pillar.toUpperCase() : 'UNKNOWN';
}

/**
 * Computes comprehensive evidence coverage and cadence limitations across all selected facts and news.
 * Guarantees that public strategist consumers are never misled into believing older monthly macro facts
 * share the intraday timestamp of real-time indicators.
 */
export function computeEvidenceCoverage({ evidence = [], untrustedNews = [], now = new Date() } = {}) {
  let newestMs = 0;
  let oldestMs = Infinity;
  let limitingEvidence = null;
  const cadenceBreakdown = {};
  const cadenceCategories = new Set();

  for (const obs of Array.isArray(evidence) ? evidence : []) {
    if (!obs) continue;
    cadenceCategories.add(resolveEvidenceCadenceCategory(obs));
    let obsTimeMs = null;
    let foundExact = false;
    const timeCandidates = [obs.publishedTime, obs.publishedAt, obs.observedAt];
    for (const cand of timeCandidates) {
      if (typeof cand === 'string' && cand.trim()) {
        const ms = Date.parse(cand.trim());
        if (Number.isFinite(ms)) {
          obsTimeMs = ms;
          foundExact = true;
          break;
        }
      }
    }
    // Only fall back to referenceTime if no exact timestamp was present on this observation
    if (!foundExact && typeof obs.referenceTime === 'string' && obs.referenceTime.trim()) {
      const trimmed = obs.referenceTime.trim();
      const ms = Date.parse(trimmed) || Date.parse(`${trimmed}T00:00:00.000Z`);
      if (Number.isFinite(ms)) {
        obsTimeMs = ms;
      }
    }

    if (obsTimeMs !== null) {
      if (obsTimeMs > newestMs) {
        newestMs = obsTimeMs;
      }
      if (obsTimeMs < oldestMs) {
        oldestMs = obsTimeMs;
        limitingEvidence = {
          factId: obs.factId || obs.id,
          observationId: obs.observationId || obs.id,
          pillar: obs.pillar || 'unknown',
          referenceTime: obs.referenceTime || null,
          timestamp: new Date(obsTimeMs).toISOString()
        };
      }
      if (obs.pillar) {
        if (!cadenceBreakdown[obs.pillar] || obsTimeMs > cadenceBreakdown[obs.pillar].timestampMs) {
          cadenceBreakdown[obs.pillar] = {
            asOf: new Date(obsTimeMs).toISOString(),
            timestampMs: obsTimeMs,
            referenceTime: obs.referenceTime || null
          };
        }
      }
    }
  }

  for (const article of Array.isArray(untrustedNews) ? untrustedNews : []) {
    if (!article) continue;
    cadenceCategories.add('STREAMING_NEWS');
    if (typeof article.publishedAt === 'string' && article.publishedAt.trim()) {
      const ms = Date.parse(article.publishedAt.trim());
      if (Number.isFinite(ms)) {
        if (ms > newestMs) newestMs = ms;
        if (ms < oldestMs) {
          oldestMs = ms;
          limitingEvidence = {
            factId: 'news',
            observationId: article.versionId || article.articleId,
            pillar: 'news',
            referenceTime: null,
            timestamp: new Date(ms).toISOString()
          };
        }
      }
    }
  }

  const hasEvidence = newestMs > 0;
  const newestIso = hasEvidence ? new Date(newestMs).toISOString() : (now instanceof Date ? now : new Date()).toISOString();
  const oldestIso = hasEvidence && oldestMs !== Infinity ? new Date(oldestMs).toISOString() : newestIso;

  const cadenceLimitations = [];
  if (cadenceBreakdown.macro && cadenceBreakdown.market && cadenceBreakdown.macro.timestampMs < cadenceBreakdown.market.timestampMs) {
    cadenceLimitations.push(`Dữ liệu vĩ mô (kỳ ${cadenceBreakdown.macro.referenceTime || cadenceBreakdown.macro.asOf}) công bố định kỳ theo tháng/quý, có độ trễ so với diễn biến thị trường đóng cửa phiên gần nhất (${cadenceBreakdown.market.referenceTime || cadenceBreakdown.market.asOf}).`);
  }
  if (cadenceBreakdown.market && (cadenceBreakdown.intermarket || cadenceBreakdown.monetary)) {
    const newerTime = Math.max(cadenceBreakdown.intermarket?.timestampMs || 0, cadenceBreakdown.monetary?.timestampMs || 0);
    if (newerTime > cadenceBreakdown.market.timestampMs) {
      cadenceLimitations.push('Chỉ số chứng khoán cơ sở phản ánh phiên đóng cửa gần nhất; tỷ giá và chỉ số liên thị trường quốc tế có thể tiếp tục biến động trong phiên hiện tại.');
    }
  }

  // hasMixedCadence is derived from actual cadence category diversity across evidence,
  // not merely minor timestamp variance between same-cadence series.
  const hasMixedCadence = cadenceCategories.size > 1 && (oldestMs !== newestMs || cadenceLimitations.length > 0);
  const hasTimestampDispersion = oldestIso !== newestIso;

  return {
    dataAsOf: newestIso,
    newestEvidenceAt: newestIso,
    oldestEvidenceAt: oldestIso,
    limitingEvidence,
    cadenceLimitations,
    hasMixedCadence,
    hasTimestampDispersion
  };
}

/**
 * Computes dataAsOf from the actual timestamps of selected evidence and news.
 * Guarantees that dataAsOf is historically truthful and does not advance simply because request time changed.
 */
export function computeEvidenceDataAsOf({ evidence = [], untrustedNews = [], now = new Date() } = {}) {
  return computeEvidenceCoverage({ evidence, untrustedNews, now }).dataAsOf;
}

/**
 * Computes a deterministic SHA-256 fingerprint for caching.
 * Changes whenever any decision-relevant input changes:
 * - observation vintage, status, or freshness
 * - article version or ID
 * - derived signal ID, state, or status
 * - selection policy, model, prompt, or schema
 * Excludes volatile request times.
 */
export function computeStrategistFingerprint({
  validFactIds = new Set(),
  validArticleIds = new Set(),
  validSignalIds = new Set(),
  validClaimIds = new Set(),
  evidence = [],
  untrustedNews = [],
  derivedSignals = [],
  claims = [],
  selectionPolicyVersion = STRATEGIST_SELECTION_POLICY_VERSION,
  model = STRATEGIST_MODEL,
  promptVersion = STRATEGIST_PROMPT_VERSION,
  schemaVersion = STRATEGIST_SCHEMA_VERSION
} = {}) {
  let factTokens = [];
  if (Array.isArray(evidence) && evidence.length > 0) {
    factTokens = evidence.map((e) => `${e.observationId || e.id}:${e.status || 'available'}:${e.freshness || 'fresh'}`);
  } else {
    factTokens = Array.from(validFactIds);
  }

  let newsTokens = [];
  if (Array.isArray(untrustedNews) && untrustedNews.length > 0) {
    newsTokens = untrustedNews.map((a) => a.versionId || a.articleId || a.id);
  } else {
    newsTokens = Array.from(validArticleIds);
  }

  let signalTokens = [];
  if (Array.isArray(derivedSignals) && derivedSignals.length > 0) {
    signalTokens = derivedSignals.map((s) => `${s.signalId}:${s.state || 'neutral'}:${s.status || 'active'}`);
  } else {
    signalTokens = Array.from(validSignalIds);
  }

  let claimTokens = [];
  if (Array.isArray(claims) && claims.length > 0) {
    claimTokens = claims.map(
      (c) =>
        `${c.claimId}:${c.supportStatus || 'unknown'}:${c.independentSourceCount ?? 0}:${c.contradictionCount ?? 0}:${c.revisionOf || 'none'}:${c.authorityLevel || 'unknown'}`
    );
  } else if (validClaimIds && validClaimIds.size > 0) {
    claimTokens = Array.from(validClaimIds);
  }

  const sortedFacts = Array.from(new Set(factTokens)).sort().join('|');
  const sortedNews = Array.from(new Set(newsTokens)).sort().join('|');
  const sortedSignals = Array.from(new Set(signalTokens)).sort().join('|');
  const sortedClaims = Array.from(new Set(claimTokens)).sort().join('|');

  const rawKey = `${sortedFacts}::${sortedNews}::${sortedSignals}::${sortedClaims}::${selectionPolicyVersion}::${model}::${promptVersion}::${schemaVersion}`;
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * In-memory cache runtime for AI Market Strategist.
 */
export class MarketStrategistRuntime {
  constructor({
    ttlMs = STRATEGIST_CACHE_TTL_MS,
    cooldownMs = STRATEGIST_COOLDOWN_MS
  } = {}) {
    this.ttlMs = ttlMs;
    this.cooldownMs = cooldownMs;
    this.cache = new Map();
    this.lastRunAt = 0;
  }

  get(fingerprint, now = new Date()) {
    const entry = this.cache.get(fingerprint);
    if (!entry) return null;
    if (now.getTime() > entry.expiresAt) {
      this.cache.delete(fingerprint);
      return null;
    }
    return entry.data;
  }

  set(fingerprint, data, now = new Date()) {
    this.cache.set(fingerprint, {
      data,
      storedAt: now.getTime(),
      expiresAt: now.getTime() + this.ttlMs
    });
    this.lastRunAt = now.getTime();
  }

  isCooldownActive(now = new Date()) {
    return (now.getTime() - this.lastRunAt) < this.cooldownMs;
  }

  clear() {
    this.cache.clear();
    this.lastRunAt = 0;
  }
}

export const globalMarketStrategistRuntime = new MarketStrategistRuntime();

/**
 * High-quality deterministic fallback engine.
 * Conforms 100% to MARKET_STRATEGIST_SCHEMA and Evidence Integrity Core.
 * Evaluates observation evidence and derived signals, respects confidence states,
 * never fabricates allocation percentages or unevidenced themes.
 */
export function generateDeterministicMarketStrategist({ factPacket, now = new Date() }) {
  const { evidence = [] } = factPacket || {};

  // If evidence is empty: return safe INSUFFICIENT_EVIDENCE brief immediately
  if (evidence.length === 0) {
    return buildSafeInsufficientEvidenceBrief({
      factPacket,
      reason: 'Không có dữ kiện quan sát thị trường.',
      now
    });
  }

  return buildDeterministicMarketBrief({ factPacket, now });
}

/**
 * Generates the AI Market Strategist synthesis.
 * Coordinates caching, LLM invocation with strict schema, validation, and deterministic fallback.
 * Guaranteed: BOTH LLM and Fallback outputs pass through the same shared publication gate.
 */
export async function generateMarketStrategist({
  factPacket,
  now = new Date(),
  geminiApiKey = process.env.GEMINI_API_KEY,
  geminiModel = process.env.GEMINI_MODEL || STRATEGIST_MODEL,
  openAiApiKey = process.env.OPENAI_API_KEY,
  apiKey,
  runtime = globalMarketStrategistRuntime,
  generateLlmFn = null,
  fetchFn = globalThis.fetch,
  aiEnabled = true,
  allowLlm = true
} = {}) {
  const {
    validFactIds,
    validArticleIds,
    validSignalIds,
    validClaimIds,
    evidence,
    untrustedNews,
    derivedSignals,
    claims
  } = factPacket;
  const effectiveModel = geminiModel || STRATEGIST_MODEL;
  const fingerprint = computeStrategistFingerprint({
    validFactIds,
    validArticleIds,
    validSignalIds,
    validClaimIds,
    evidence,
    untrustedNews,
    derivedSignals,
    claims,
    model: effectiveModel
  });

  // 1. Check runtime cache
  if (runtime) {
    const cached = runtime.get(fingerprint, now);
    if (cached && !(allowLlm && cached.generationMode === 'deterministic_fallback')) {
      return {
        ...cached,
        generationMode: 'cache',
        evidenceCoverage: cached.evidenceCoverage || factPacket.evidenceCoverage || null,
        evidence,
        derivedSignals: derivedSignals || []
      };
    }
  }

  let result = null;
  let lastProviderError = null;

  const effectiveGeminiKey = (typeof geminiApiKey === 'string' && geminiApiKey.trim())
    ? geminiApiKey.trim()
    : (typeof apiKey === 'string' && apiKey.startsWith('AIza') ? apiKey.trim() : null);

  const effectiveOpenAiKey = (typeof openAiApiKey === 'string' && openAiApiKey.trim())
    ? openAiApiKey.trim()
    : (typeof apiKey === 'string' && !apiKey.startsWith('AIza') ? apiKey.trim() : null);

  const hasAnyKey = Boolean(effectiveGeminiKey || effectiveOpenAiKey);

  // 2. Attempt LLM generation if enabled, allowed, and configured
  if (aiEnabled && allowLlm && (hasAnyKey || typeof generateLlmFn === 'function')) {
    try {
      let rawLlmOutput = null;

      if (typeof generateLlmFn === 'function') {
        rawLlmOutput = await generateLlmFn({
          apiKey: effectiveGeminiKey || effectiveOpenAiKey || apiKey,
          factPacket,
          fetchFn,
          instructions: STRATEGIST_SYSTEM_INSTRUCTIONS,
          schema: MARKET_STRATEGIST_SCHEMA
        });
      } else if (effectiveGeminiKey) {
        // Direct Gemini REST invocation with structured JSON output
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(effectiveGeminiKey)}`;
        const geminiBody = {
          systemInstruction: {
            parts: [
              {
                text: `${STRATEGIST_SYSTEM_INSTRUCTIONS}\n\nLƯU Ý QUAN TRỌNG: Bạn BẮT BUỘC phải trả về đúng định dạng JSON theo schema đã cho, không thêm bất kỳ văn bản ngoài JSON. Mọi evidenceId PHẢI LẤY CHÍNH XÁC từ danh sách ID có sẵn (availableObservationIds, availableArticleIds, availableSignalIds). Tuyệt đối không tự sửa, rút ngắn ID, hoặc sáng tạo số liệu. TUYỆT ĐỐI KHÔNG đề cập mã cổ phiếu riêng lẻ nào (như VIC, STB, VCB, SSI...); chỉ phân tích cấp lớp tài sản và nhóm ngành.`
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    availableObservationIds: Array.from(validFactIds),
                    availableArticleIds: Array.from(validArticleIds),
                    availableSignalIds: Array.from(validSignalIds),
                    marketContext: factPacket.evidence,
                    derivedSignals: factPacket.derivedSignals || [],
                    marketNews: factPacket.untrustedNews,
                    now: factPacket.now
                  })
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: STRATEGIST_MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(MARKET_STRATEGIST_SCHEMA),
            thinkingConfig: {
              thinkingLevel: 'minimal'
            }
          }
        };

        const response = await fetchFn(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(geminiBody)
        });

        if (response.ok) {
          const payload = await response.json();
          const candidate = payload?.candidates?.[0];
          const finishReason = candidate?.finishReason || null;
          let outputText = '';
          if (Array.isArray(candidate?.content?.parts)) {
            const nonThoughtParts = candidate.content.parts.filter((p) => !p?.thought);
            const targetParts = nonThoughtParts.length > 0 ? nonThoughtParts : candidate.content.parts;
            for (const part of targetParts) {
              if (typeof part?.text === 'string') {
                outputText += part.text;
              }
            }
          }
          if (outputText) {
            let cleaned = outputText.trim();
            if (cleaned.startsWith('```')) {
              cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            }
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              cleaned = cleaned.slice(firstBrace, lastBrace + 1);
            }
            try {
              rawLlmOutput = JSON.parse(cleaned);
              if (finishReason) {
                rawLlmOutput.finishReason = finishReason;
              }
            } catch (parseErr) {
              lastProviderError = finishReason === 'MAX_TOKENS'
                ? `Truncated output: MAX_TOKENS reached (${parseErr.message})`
                : `JSON parse error: ${parseErr.message}`;
            }
          } else if (finishReason) {
            lastProviderError = `Empty output with finishReason: ${finishReason}`;
          }
        } else {
          const errData = await response.json().catch(() => null);
          lastProviderError = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
        }
      } else if (effectiveOpenAiKey) {
        // Direct OpenAI invocation with structured outputs
        const response = await fetchFn('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${effectiveOpenAiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-5.6-luna',
            reasoning: { effort: STRATEGIST_REASONING_EFFORT },
            instructions: STRATEGIST_SYSTEM_INSTRUCTIONS,
            input: JSON.stringify({
              availableObservationIds: Array.from(validFactIds),
              availableArticleIds: Array.from(validArticleIds),
              availableSignalIds: Array.from(validSignalIds),
              marketContext: factPacket.evidence,
              derivedSignals: factPacket.derivedSignals || [],
              marketNews: factPacket.untrustedNews,
              now: factPacket.now
            }),
            text: {
              format: {
                type: 'json_schema',
                name: 'market_strategist_brief',
                strict: true,
                schema: MARKET_STRATEGIST_SCHEMA
              }
            },
            tools: [],
            tool_choice: 'none',
            parallel_tool_calls: false,
            store: false,
            max_output_tokens: STRATEGIST_MAX_OUTPUT_TOKENS,
            truncation: 'disabled'
          })
        });

        if (response.ok) {
          const payload = await response.json();
          let outputText = payload?.output_text;
          if (!outputText && Array.isArray(payload?.output)) {
            for (const item of payload.output) {
              for (const content of Array.isArray(item?.content) ? item.content : []) {
                if (content?.type === 'output_text' && typeof content.text === 'string') {
                  outputText = content.text;
                }
              }
            }
          }
          if (outputText) {
            rawLlmOutput = JSON.parse(outputText);
          }
        } else {
          const errData = await response.json().catch(() => null);
          lastProviderError = errData?.error?.message || `HTTP ${response.status}`;
        }
      }

      if (rawLlmOutput && typeof rawLlmOutput === 'object') {
        // Pass LLM output through shared publication gate
        const publication = applySharedPublicationGate(rawLlmOutput, factPacket, now);
        if (publication.published) {
          result = {
            ...publication.output,
            generatedAt: now instanceof Date ? now.toISOString() : new Date().toISOString(),
            dataAsOf: factPacket.dataAsOf,
            evidenceCoverage: factPacket.evidenceCoverage || null,
            generationMode: (rawLlmOutput.generationMode && rawLlmOutput.generationMode !== 'deterministic_fallback')
              ? rawLlmOutput.generationMode
              : 'live_ai',
            methodologyVersion: STRATEGIST_METHODOLOGY_VERSION,
            ...(rawLlmOutput.finishReason ? { finishReason: rawLlmOutput.finishReason } : {})
          };
        } else {
          lastProviderError = `Publication gate rejected LLM output: ${publication.errors.join(', ')}`;
        }
      }
    } catch (err) {
      lastProviderError = err?.message || 'LLM execution error';
      result = null;
    }
  }

  // 3. Fall back to deterministic synthesis if LLM was skipped, failed, or rejected by publication gate
  if (!result) {
    const candidateFallback = generateDeterministicMarketStrategist({ factPacket, now });
    const publication = applySharedPublicationGate(candidateFallback, factPacket, now);
    result = publication.output;
    if (lastProviderError) {
      result.lastProviderError = lastProviderError;
    }
  }

  // Ensure backward compatibility for any consumers expecting investmentOrientation
  if (result.executiveDecision && !result.investmentOrientation) {
    result.investmentOrientation = {
      stance: result.executiveDecision.stance,
      preferredThemes: (result.preferredThemes || []).map((t) => typeof t === 'string' ? t : t.theme),
      pressuredThemes: (result.avoidOrUnderweight || []).map((t) => typeof t === 'string' ? t : t.theme),
      rationale: result.executiveDecision.actionNow || result.executiveDecision.oneLineDecision,
      evidenceIds: (result.assetStrategy || []).flatMap((a) => a.evidenceIds || []).slice(0, 6)
    };
  }

  // Ensure Always-Available Brief contract is fully populated on all execution paths
  if (!result.brief) {
    const enriched = buildDeterministicMarketBrief({
      strategy: result,
      factPacket,
      now
    });
    result.brief = enriched.brief;
    result.marketView = enriched.marketView;
    result.why = enriched.why;
    result.whatChanged = enriched.whatChanged;
    result.risks = enriched.risks;
    result.whatToWatch = enriched.whatToWatch;
    result.dataContext = enriched.dataContext;
    result.sources = enriched.sources;
  }

  // 4. Record run manifest
  const manifest = {
    runId: `run_${Date.now()}_${createHash('sha256').update(fingerprint + (result.generatedAt || now.toISOString())).digest('hex').slice(0, 12)}`,
    packetFingerprint: fingerprint,
    selectedObservationIds: (evidence || []).map((e) => e.observationId || e.id),
    selectedArticleIds: (untrustedNews || []).map((a) => a.versionId || a.articleId),
    signalIds: (derivedSignals || []).map((s) => s.signalId),
    promptVersion: STRATEGIST_PROMPT_VERSION,
    schemaVersion: STRATEGIST_SCHEMA_VERSION,
    selectionPolicyVersion: STRATEGIST_SELECTION_POLICY_VERSION,
    model: result.generationMode === 'live_ai' ? effectiveModel : 'deterministic_fallback',
    generationMode: result.generationMode,
    generatedAt: result.generatedAt || (now instanceof Date ? now.toISOString() : new Date().toISOString()),
    dataAsOf: result.dataAsOf,
    validationResult: result.gateAudit || { valid: true }
  };

  try {
    await persistRunManifest(manifest);
  } catch {
    // Non-blocking manifest persistence
  }

  result.runId = manifest.runId;

  // 5. Cache valid published output
  if (runtime && fingerprint) {
    runtime.set(fingerprint, result, now);
  }

  return {
    ...result,
    runId: manifest.runId,
    dataAsOf: result.dataAsOf || factPacket.dataAsOf,
    evidenceCoverage: result.evidenceCoverage || factPacket.evidenceCoverage || null,
    evidence,
    derivedSignals: derivedSignals || []
  };
}
