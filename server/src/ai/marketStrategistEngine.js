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
  ALLOWED_STANCES,
  toGeminiSchema
} from './marketStrategistPrompt.js';
import { validateMarketStrategistOutput } from './marketStrategistValidation.js';

export const STRATEGIST_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const STRATEGIST_COOLDOWN_MS = 15 * 1000;       // 15 seconds

/**
 * Builds the closed fact packet for AI Market Strategist.
 * Strictly guarantees ZERO private portfolio/user data enters the packet.
 */
export function buildMarketStrategistFactPacket({
  marketObservations = [],
  newsArticles = [],
  now = new Date()
} = {}) {
  // Security guard: Ensure zero private data is passed
  const allInputs = [...marketObservations, ...newsArticles];
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

    validFactIds.add(observationId);
    if (obs.factId) validFactIds.add(obs.factId);

    evidence.push({
      id: observationId,
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
      source: obs.source || obs.source_id || 'System'
    });
  }

  const validArticleIds = new Set();
  const untrustedNews = [];

  for (const article of newsArticles) {
    if (!article || typeof article !== 'object') continue;
    const articleId = article.articleId || article.id;
    if (!articleId) continue;

    validArticleIds.add(articleId);

    untrustedNews.push({
      articleId,
      title: article.title || 'Untitled',
      excerpt: article.excerpt || article.summary || '',
      sourceName: article.sourceName || article.source || 'News Source',
      publishedAt: article.publishedAt || null,
      geography: article.geography || 'vietnam',
      relatedAssets: Array.isArray(article.relatedAssets)
        ? article.relatedAssets.map((a) => ({ symbol: a.symbol, name: a.name })).filter((a) => a.symbol)
        : []
    });
  }

  const dataAsOf = now.toISOString();

  return {
    now,
    dataAsOf,
    evidence,
    untrustedNews,
    validFactIds,
    validArticleIds
  };
}

/**
 * Computes a deterministic SHA-256 fingerprint for caching.
 * Changes whenever any observation ID or news article ID changes.
 */
export function computeStrategistFingerprint({
  validFactIds = new Set(),
  validArticleIds = new Set(),
  promptVersion = STRATEGIST_PROMPT_VERSION,
  schemaVersion = STRATEGIST_SCHEMA_VERSION
} = {}) {
  const sortedFacts = Array.from(validFactIds).sort().join('|');
  const sortedNews = Array.from(validArticleIds).sort().join('|');
  const rawKey = `${sortedFacts}::${sortedNews}::${promptVersion}::${schemaVersion}`;
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
 * Conforms 100% to MARKET_STRATEGIST_SCHEMA using verified facts and news.
 */
export function generateDeterministicMarketStrategist({ factPacket, now = new Date() }) {
  const { evidence, untrustedNews } = factPacket;

  const obsByFactId = new Map();
  for (const item of evidence) {
    if (item.factId) obsByFactId.set(item.factId, item);
    if (item.id) obsByFactId.set(item.id, item);
  }

  const vnIndexObs = obsByFactId.get('vn.market.vnindex.close');
  const cpiObs = obsByFactId.get('vn.macro.cpi.yoy');
  const usdVndObs = obsByFactId.get('vn.monetary.fx.usd_vnd');
  const dxyObs = obsByFactId.get('global.intermarket.dxy.quote');
  const us10yObs = obsByFactId.get('global.intermarket.us10y.yield');
  const brentObs = obsByFactId.get('global.intermarket.brent.futures');

  const citedFactIds = [];
  if (vnIndexObs) citedFactIds.push(vnIndexObs.id);
  if (cpiObs) citedFactIds.push(cpiObs.id);
  if (usdVndObs) citedFactIds.push(usdVndObs.id);
  if (dxyObs) citedFactIds.push(dxyObs.id);
  if (us10yObs) citedFactIds.push(us10yObs.id);
  if (brentObs) citedFactIds.push(brentObs.id);

  const citedArticleIds = untrustedNews.slice(0, 3).map((a) => a.articleId);

  // Determine market stance deterministically
  let stance = 'neutral';
  const cpiVal = typeof cpiObs?.value === 'number' ? cpiObs.value : null;
  const vnIndexChg = typeof vnIndexObs?.change === 'number' ? vnIndexObs.change : null;

  if (vnIndexChg !== null && vnIndexChg > 0 && (cpiVal === null || cpiVal < 5.0)) {
    stance = 'selective_risk_on';
  } else if (cpiVal !== null && cpiVal >= 5.0) {
    stance = 'defensive';
  }

  const vnIndexProse = vnIndexObs?.value
    ? `Chỉ số VN-Index ghi nhận mức ${vnIndexObs.value} điểm (${vnIndexObs.change !== null && vnIndexObs.change >= 0 ? '+' : ''}${vnIndexObs.change ?? 0} điểm), phản ánh tâm lý giao dịch có sự phân hóa giữa các nhóm ngành.`
    : 'Thị trường chứng khoán Việt Nam duy trì nhịp tích lũy trong bối cảnh các chỉ số thanh khoản cần thêm tín hiệu xác nhận.';

  const cpiProse = cpiObs?.value
    ? `Lạm phát CPI (YoY) ở mức ${cpiObs.value}%, trong vùng kiểm soát của chính sách vĩ mô nhưng vẫn đòi hỏi theo dõi chặt chẽ biến động chi phí đầu vào.`
    : 'Dữ liệu lạm phát chính thức tiếp tục được cập nhật theo kỳ công bố của cơ quan thống kê.';

  const globalProse = dxyObs?.value
    ? `Trên thị trường quốc tế, chỉ số DXY đạt ${dxyObs.value} điểm và lợi suất Trái phiếu Mỹ 10 năm ở mức ${us10yObs?.value ?? 'hiện hành'}%, tác động đến mặt bằng tỷ giá và dòng vốn biên giới.`
    : 'Bối cảnh liên thị trường toàn cầu tiếp tục chịu ảnh hưởng từ định hướng lãi suất của các ngân hàng trung ương lớn.';

  const keyDrivers = [];
  if (vnIndexObs) {
    keyDrivers.push({
      driver: `Diễn biến chỉ số chứng khoán trong nước duy trì vùng vận động tại ${vnIndexObs.value} điểm.`,
      evidenceIds: [vnIndexObs.id]
    });
  }
  if (cpiObs) {
    keyDrivers.push({
      driver: `Lạm phát trong nước được ghi nhận ở mức ${cpiObs.value}%, định hình kỳ vọng chính sách tiền tệ.`,
      evidenceIds: [cpiObs.id]
    });
  }
  if (dxyObs || usdVndObs) {
    const ids = [];
    if (dxyObs) ids.push(dxyObs.id);
    if (usdVndObs) ids.push(usdVndObs.id);
    keyDrivers.push({
      driver: `Áp lực tỷ giá và chỉ số sức mạnh USD (DXY: ${dxyObs?.value ?? 'N/A'}, USD/VND: ${usdVndObs?.value ?? 'N/A'}) chi phối dòng tiền đầu tư.`,
      evidenceIds: ids
    });
  }
  if (keyDrivers.length === 0 && evidence.length > 0) {
    keyDrivers.push({
      driver: `Dữ liệu thị trường cơ sở từ nguồn ${evidence[0].source} được ghi nhận ở trạng thái ${evidence[0].status}.`,
      evidenceIds: [evidence[0].id]
    });
  }

  const orientationEvidenceIds = citedFactIds.slice(0, 4);
  const risksEvidenceIds = citedFactIds.slice(0, 3);

  return {
    marketOverview: {
      vietnam: `${vnIndexProse} ${cpiProse}`.trim(),
      global: globalProse.trim()
    },
    keyDrivers: keyDrivers.length > 0 ? keyDrivers : [
      { driver: 'Thị trường vận động ổn định theo các dữ kiện vĩ mô và liên thị trường đã kiểm chứng.', evidenceIds: [evidence[0]?.id || 'context'] }
    ],
    investmentOrientation: {
      stance,
      preferredThemes: ['Doanh nghiệp dòng tiền mạnh', 'Nhóm hưởng lợi từ thương mại và xuất khẩu'],
      pressuredThemes: ['Nhóm sử dụng đòn bẩy tài chính cao', 'Doanh nghiệp chịu chi phí nợ USD'],
      rationale: 'Ưu tiên phân bổ thận trọng, tập trung vào doanh nghiệp có nền tảng cơ bản vững chắc và khả năng quản trị biến động dòng tiền tốt trong bối cảnh vĩ mô đan xen.',
      evidenceIds: orientationEvidenceIds.length > 0 ? orientationEvidenceIds : [evidence[0]?.id || 'context']
    },
    risksAndInvalidation: {
      keyRisks: [
        'Biến động tỷ giá USD/VND gia tăng làm tăng chi phí vốn ngoại và áp lực lạm phát nhập khẩu.',
        'Lợi suất trái phiếu quốc tế duy trì mức cao kéo dài ảnh hưởng dòng vốn gián tiếp.'
      ],
      invalidationConditions: [
        'DXY hạ nhiệt bền vững hoặc tỷ giá trong nước ổn định trở lại.',
        'Thanh khoản và độ rộng thị trường chứng khoán cải thiện đồng thuận.'
      ],
      evidenceIds: risksEvidenceIds.length > 0 ? risksEvidenceIds : [evidence[0]?.id || 'context']
    },
    watchNext: [
      'Công bố chỉ số giá tiêu dùng CPI kỳ tới của Tổng cục Thống kê',
      'Định hướng điều hành lãi suất và thanh khoản của Ngân hàng Nhà nước',
      'Biến động chỉ số DXY và diễn biến giá dầu thô Brent quốc tế'
    ],
    citations: {
      factObservationIds: citedFactIds.length > 0 ? citedFactIds : [evidence[0]?.id || 'context'],
      articleIds: citedArticleIds
    },
    generatedAt: now.toISOString(),
    dataAsOf: factPacket.dataAsOf,
    generationMode: 'deterministic_fallback',
    methodologyVersion: STRATEGIST_METHODOLOGY_VERSION
  };
}

/**
 * Generates the AI Market Strategist synthesis.
 * Coordinates caching, LLM invocation with strict schema, validation, and deterministic fallback.
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
  const { validFactIds, validArticleIds, evidence } = factPacket;
  const fingerprint = computeStrategistFingerprint({ validFactIds, validArticleIds });

  // 1. Check runtime cache
  if (runtime) {
    const cached = runtime.get(fingerprint, now);
    if (cached) {
      return {
        ...cached,
        generationMode: 'cache',
        evidence
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
                text: `${STRATEGIST_SYSTEM_INSTRUCTIONS}\n\nLƯU Ý QUAN TRỌNG: Bạn BẮT BUỘC phải trả về đúng định dạng JSON theo schema đã cho, không thêm bất kỳ văn bản ngoài JSON. Mọi evidenceId trong keyDrivers, investmentOrientation, risksAndInvalidation và citations PHẢI LẤY CHÍNH XÁC từ danh sách ID có sẵn (availableFactIds và availableArticleIds). Tuyệt đối không tự sửa hoặc rút ngắn ID.`
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    availableFactIds: Array.from(validFactIds),
                    availableArticleIds: Array.from(validArticleIds),
                    marketContext: factPacket.evidence,
                    marketNews: factPacket.untrustedNews,
                    now: factPacket.now
                  })
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: STRATEGIST_MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(MARKET_STRATEGIST_SCHEMA)
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
          let outputText = '';
          if (Array.isArray(candidate?.content?.parts)) {
            for (const part of candidate.content.parts) {
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
            rawLlmOutput = JSON.parse(cleaned);
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
              marketContext: factPacket.evidence,
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
        const validation = validateMarketStrategistOutput(rawLlmOutput, {
          validFactIds,
          validArticleIds
        });

        if (validation.valid) {
          result = {
            ...rawLlmOutput,
            generatedAt: now.toISOString(),
            dataAsOf: factPacket.dataAsOf,
            generationMode: (rawLlmOutput.generationMode && rawLlmOutput.generationMode !== 'deterministic_fallback')
              ? rawLlmOutput.generationMode
              : 'live_ai',
            methodologyVersion: STRATEGIST_METHODOLOGY_VERSION
          };
        } else {
          lastProviderError = `Validation errors: ${validation.errors.join(', ')}`;
        }
      }
    } catch (err) {
      lastProviderError = err?.message || 'LLM execution error';
      result = null;
    }
  }

  // 3. Fall back to deterministic synthesis if LLM was skipped, failed, or invalid
  if (!result) {
    result = generateDeterministicMarketStrategist({ factPacket, now });
    if (lastProviderError) {
      result.lastProviderError = lastProviderError;
    }
  }

  // 4. Cache valid output
  if (runtime && fingerprint) {
    runtime.set(fingerprint, result, now);
  }

  return {
    ...result,
    evidence
  };
}
