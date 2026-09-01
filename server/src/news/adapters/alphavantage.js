import { normalizeUrl } from '../url.js';
import { cleanPlainText } from '../text.js';
import { normalizePublishedAt } from '../time.js';
import { getDefaultAlphaVantageQuotaCooldownMs } from '../../providers/alphavantage.js';

export const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
export const ALPHA_VANTAGE_TOPICS = 'economy_macro,commodities,forex';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const MAX_ALPHA_VANTAGE_NEWS_ITEMS = 50;

/**
 * Derives a provider-neutral category from Alpha Vantage topic metadata and headline content.
 * @param {Array<object>} [topics=[]]
 * @param {string} [title='']
 * @returns {string}
 */
function mapAlphaVantageCategory(topics = [], title = '') {
  const topicNames = (topics || []).map((t) => String(t.topic || '').toLowerCase());
  const titleLower = String(title || '').toLowerCase();

  if (titleLower.includes('gold') || titleLower.includes('xau') || titleLower.includes('bullion')) {
    return 'gold';
  }

  if (topicNames.some((t) => t.includes('forex') || t.includes('currency') || t.includes('foreign exchange'))) {
    return 'fx';
  }

  if (topicNames.some((t) => t.includes('macro') || t.includes('monetary') || t.includes('fiscal') || t.includes('economy'))) {
    return 'macro';
  }

  if (topicNames.some((t) => t.includes('commodities') || t.includes('energy') || t.includes('oil'))) {
    return 'macro';
  }

  return 'global';
}

/**
 * Parses raw JSON payload from Alpha Vantage NEWS_SENTIMENT endpoint.
 * Discards all sentiment scores, labels, and relevance scores completely.
 * @param {string|object} jsonPayload
 * @returns {{ items: Array<object>, skippedCount: number, error: string|null }}
 */
export function parseAlphaVantageNews(jsonPayload) {
  let data = jsonPayload;
  if (typeof jsonPayload === 'string') {
    try {
      data = JSON.parse(jsonPayload);
    } catch {
      return { items: [], skippedCount: 0, error: 'SOURCE_MALFORMED' };
    }
  }

  if (!data || typeof data !== 'object') {
    return { items: [], skippedCount: 0, error: 'SOURCE_MALFORMED' };
  }

  // Alpha Vantage sometimes reports quota state in a successful JSON response.
  const providerInfo = data.Note || data.Information;
  if (providerInfo) {
    const isRateLimit = typeof providerInfo === 'string' && /rate|frequency|limit|quota/i.test(providerInfo);
    return {
      items: [],
      skippedCount: 0,
      error: isRateLimit ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR'
    };
  }

  if (data['Error Message']) {
    return { items: [], skippedCount: 0, error: 'PROVIDER_ERROR' };
  }

  const rawFeed = data.feed;
  if (!Array.isArray(rawFeed)) {
    return { items: [], skippedCount: 0, error: 'SOURCE_MALFORMED' };
  }

  const items = [];
  let skippedCount = Math.max(0, rawFeed.length - MAX_ALPHA_VANTAGE_NEWS_ITEMS);

  for (const item of rawFeed.slice(0, MAX_ALPHA_VANTAGE_NEWS_ITEMS)) {
    const rawUrl = item.url;
    const normalizedLink = normalizeUrl(rawUrl);

    const title = cleanPlainText(item.title);
    const summary = cleanPlainText(item.summary) || null;

    const publishedAt = normalizePublishedAt(item.time_published);

    // Validation: non-empty title, valid URL, valid trustworthy timestamp
    if (!title || !normalizedLink || !publishedAt) {
      skippedCount++;
      continue;
    }

    const publisher = cleanPlainText(item.source) || 'Alpha Vantage News';
    const category = mapAlphaVantageCategory(item.topics, title);

    // Create stable canonical ID from URL or publisher-scoped slug
    const id = normalizedLink;

    // Explicitly construct canonical item WITHOUT sentiment or relevance fields
    const candidate = {
      id,
      title,
      summary,
      url: normalizedLink,
      source: publisher, // Display publisher attribution e.g. "Reuters", "Bloomberg"
      sourceId: 'alphavantage-news',
      language: 'en',
      category,
      publishedAt
    };

    items.push(candidate);
  }

  return { items, skippedCount, error: null };
}

/**
 * Fetches and parses Alpha Vantage news feed.
 * Uses a single broad query across macro, commodities, and forex.
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {number} [options.limit=50]
 * @param {number} [options.timeoutMs=8000]
 * @param {Function} [options.fetchFn=fetch]
 * @returns {Promise<object>}
 */
export async function fetchAlphaVantageNews(options = {}) {
  const {
    apiKey = process.env.ALPHA_VANTAGE_API_KEY,
    limit = MAX_ALPHA_VANTAGE_NEWS_ITEMS,
    timeoutMs = 8000,
    fetchFn = fetch,
    nowFn = Date.now
  } = options;
  const usesDefaultFetch = options.fetchFn === undefined;
  const getQuotaCooldownMsFn = options.getQuotaCooldownMsFn || (
    usesDefaultFetch ? getDefaultAlphaVantageQuotaCooldownMs : (() => 0)
  );
  const clockValue = nowFn();
  const nowMs = Number.isFinite(clockValue) ? clockValue : Date.now();
  const fetchedAt = new Date(nowMs).toISOString();

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return {
      sourceId: 'alphavantage-news',
      name: 'Alpha Vantage News',
      language: 'en',
      status: 'error',
      fetchedAt,
      items: [],
      articleCount: 0,
      skippedCount: 0,
      errorCode: 'MISSING_API_KEY'
    };
  }

  const quotaCooldownMs = getQuotaCooldownMsFn(nowMs);
  if (Number.isFinite(quotaCooldownMs) && quotaCooldownMs > 0) {
    return {
      sourceId: 'alphavantage-news',
      name: 'Alpha Vantage News',
      language: 'en',
      status: 'error',
      fetchedAt,
      items: [],
      articleCount: 0,
      skippedCount: 0,
      errorCode: 'PROVIDER_RATE_LIMITED'
    };
  }

  const providerLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_ALPHA_VANTAGE_NEWS_ITEMS)
    : MAX_ALPHA_VANTAGE_NEWS_ITEMS;

  const queryParams = new URLSearchParams({
    function: 'NEWS_SENTIMENT',
    topics: ALPHA_VANTAGE_TOPICS,
    limit: String(providerLimit),
    apikey: apiKey.trim()
  });

  const url = `${ALPHA_VANTAGE_BASE_URL}?${queryParams.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      return {
        sourceId: 'alphavantage-news',
        name: 'Alpha Vantage News',
        language: 'en',
        status: 'error',
        fetchedAt,
        items: [],
        articleCount: 0,
        skippedCount: 0,
        errorCode: res.status === 429 ? 'PROVIDER_RATE_LIMITED' : `HTTP_${res.status}`
      };
    }

    const text = await res.text();
    const { items, skippedCount, error } = parseAlphaVantageNews(text);

    if (error) {
      return {
        sourceId: 'alphavantage-news',
        name: 'Alpha Vantage News',
        language: 'en',
        status: 'error',
        fetchedAt,
        items: [],
        articleCount: 0,
        skippedCount,
        errorCode: error
      };
    }

    return {
      sourceId: 'alphavantage-news',
      name: 'Alpha Vantage News',
      language: 'en',
      status: items.length > 0 ? 'ok' : 'empty',
      fetchedAt,
      items,
      articleCount: items.length,
      skippedCount,
      errorCode: null
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      sourceId: 'alphavantage-news',
      name: 'Alpha Vantage News',
      language: 'en',
      status: 'error',
      fetchedAt,
      items: [],
      articleCount: 0,
      skippedCount: 0,
      errorCode: isTimeout ? 'SOURCE_TIMEOUT' : 'SOURCE_FETCH_FAILED'
    };
  } finally {
    clearTimeout(timeout);
  }
}
