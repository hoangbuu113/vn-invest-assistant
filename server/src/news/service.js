import { fetchCafeFNews } from './adapters/cafef.js';
import { fetchCoinDeskNews } from './adapters/coindesk.js';
import { fetchAlphaVantageNews } from './adapters/alphavantage.js';
import { attachRelatedAssets } from './relevance.js';
import { deduplicateArticles } from './dedupe.js';
import { globalNewsCache } from './cache.js';
import { getAssets, getAssetById } from '../supabase.js';

export const DEFAULT_NEWS_LIMIT = 30;
export const MAX_NEWS_LIMIT = 100;
export const MAX_SOURCE_ARTICLES = 100;

function parseNewsLimit(limit) {
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_NEWS_LIMIT) {
    const err = new Error(`Invalid limit parameter. Must be an integer between 1 and ${MAX_NEWS_LIMIT}.`);
    err.statusCode = 400;
    err.code = 'INVALID_LIMIT';
    throw err;
  }
  return parsedLimit;
}

function validTimestampMs(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export class NewsService {
  constructor({
    cache = globalNewsCache,
    getAssetsFn = getAssets,
    getAssetByIdFn = getAssetById,
    fetchCafeFFn = fetchCafeFNews,
    fetchCoinDeskFn = fetchCoinDeskNews,
    fetchAlphaVantageFn = fetchAlphaVantageNews
  } = {}) {
    this.cache = cache;
    this.getAssetsFn = getAssetsFn;
    this.getAssetByIdFn = getAssetByIdFn;
    this.fetchCafeFFn = fetchCafeFFn;
    this.fetchCoinDeskFn = fetchCoinDeskFn;
    this.fetchAlphaVantageFn = fetchAlphaVantageFn;
  }

  /**
   * Fetches news from all configured sources through the cache layer.
   * @returns {Promise<{ sourceResults: Array<object>, allArticles: Array<object>, partial: boolean, dataAsOf: string|null, allFailed: boolean }>}
   */
  async fetchAllSources() {
    const [cafefRes, coindeskRes, avRes] = await Promise.all([
      this.cache.fetchWithCache('cafef', () => this.fetchCafeFFn()),
      this.cache.fetchWithCache('coindesk', () => this.fetchCoinDeskFn()),
      this.cache.fetchWithCache('alphavantage-news', () => this.fetchAlphaVantageFn())
    ]);

    const sourceResults = [cafefRes, coindeskRes, avRes];

    let hasSuccess = false;
    let hasDegradedOrErrorOrStale = false;
    const rawArticles = [];
    const contributingTimestamps = [];

    for (const src of sourceResults) {
      if (!src || typeof src !== 'object') {
        hasDegradedOrErrorOrStale = true;
        continue;
      }

      if (src.status === 'ok' || src.status === 'empty' || src.status === 'degraded' || src.status === 'stale') {
        hasSuccess = true;
        if (Array.isArray(src.items) && src.items.length > 0) {
          rawArticles.push(...src.items.slice(0, MAX_SOURCE_ARTICLES));
          const fetchedAtMs = validTimestampMs(src.fetchedAt);
          if (fetchedAtMs !== null) contributingTimestamps.push(fetchedAtMs);
        }
      }

      if (src.status === 'error' || src.status === 'degraded' || src.status === 'stale') {
        hasDegradedOrErrorOrStale = true;
      }
    }

    const allFailed = !hasSuccess;

    // dataAsOf is the oldest fetchedAt among contributing sources (or oldest successful source if empty)
    let dataAsOf = null;
    if (contributingTimestamps.length > 0) {
      const oldestTime = Math.min(...contributingTimestamps);
      dataAsOf = new Date(oldestTime).toISOString();
    } else {
      const validTimes = sourceResults
        .filter((s) => s && (
          s.status === 'ok' ||
          s.status === 'empty' ||
          s.status === 'degraded' ||
          s.status === 'stale'
        ))
        .map((s) => validTimestampMs(s.fetchedAt))
        .filter((t) => t !== null);
      if (validTimes.length > 0) {
        dataAsOf = new Date(Math.min(...validTimes)).toISOString();
      }
    }

    const partial = hasSuccess && hasDegradedOrErrorOrStale;

    return {
      sourceResults,
      allArticles: rawArticles,
      partial,
      dataAsOf,
      allFailed
    };
  }

  /**
   * Normalizes, annotates, deduplicates, and sorts articles.
   * @param {Array<object>} rawArticles
   * @param {Array<object>} canonicalAssets
   * @returns {Array<object>}
   */
  processArticles(rawArticles = [], canonicalAssets = []) {
    // 1. Attach relatedAssets using canonical asset UUIDs
    const annotated = attachRelatedAssets(rawArticles, canonicalAssets);

    // 2. Deduplicate articles
    const deduped = deduplicateArticles(annotated);

    // 3. Sort newest first, with deterministic tie-breakers (sourceId, then id)
    deduped.sort((a, b) => {
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      const srcCmp = String(a.sourceId || '').localeCompare(String(b.sourceId || ''));
      if (srcCmp !== 0) return srcCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return deduped;
  }

  /**
   * Formats source results for API response.
   * @param {Array<object>} sourceResults
   * @returns {Array<object>}
   */
  formatSourcesMetadata(sourceResults = []) {
    return sourceResults.map((s) => ({
      sourceId: s.sourceId,
      name: s.name,
      status: s.status,
      fetchedAt: s.fetchedAt,
      articleCount: s.articleCount || 0,
      skippedCount: s.skippedCount || 0,
      errorCode: s.errorCode || null,
      cacheStatus: s.cacheStatus || null,
      cacheAgeMs: Number.isFinite(s.cacheAgeMs) ? s.cacheAgeMs : null,
      cachedStatus: s.cachedStatus || null,
      staleReason: s.staleReason || null,
      feeds: Array.isArray(s.feeds)
        ? s.feeds.slice(0, 4).map((feed) => ({
            category: feed.category,
            status: feed.status,
            articleCount: feed.articleCount || 0,
            skippedCount: feed.skippedCount || 0,
            errorCode: feed.errorCode || null
          }))
        : undefined
    }));
  }

  /**
   * Generates public news feed for GET /api/news.
   * @param {object} [options]
   * @param {number} [options.limit=30]
   * @param {string} [options.assetId]
   * @returns {Promise<object>}
   */
  async getNewsFeed({ limit = DEFAULT_NEWS_LIMIT, assetId } = {}) {
    // 1. Validate limit
    const parsedLimit = parseNewsLimit(limit);

    // 2. Fetch canonical assets
    let canonicalAssets = [];
    try {
      canonicalAssets = await this.getAssetsFn();
    } catch (e) {
      canonicalAssets = [];
    }

    // 3. If assetId is supplied, verify canonical asset exists
    if (assetId) {
      if (typeof assetId !== 'string' || !assetId.trim()) {
        const err = new Error('Invalid assetId parameter');
        err.statusCode = 400;
        err.code = 'INVALID_ASSET_ID';
        throw err;
      }

      const trimmedAssetId = assetId.trim();
      let matchedAsset = canonicalAssets.find((a) => a.id === trimmedAssetId);
      if (!matchedAsset && this.getAssetByIdFn) {
        try {
          matchedAsset = await this.getAssetByIdFn(trimmedAssetId);
        } catch {
          matchedAsset = null;
        }
      }

      if (!matchedAsset) {
        const err = new Error(`Asset with ID '${trimmedAssetId}' not found`);
        err.statusCode = 404;
        err.code = 'ASSET_NOT_FOUND';
        throw err;
      }
    }

    // 4. Fetch sources
    const { sourceResults, allArticles, partial, dataAsOf, allFailed } = await this.fetchAllSources();

    if (allFailed) {
      const err = new Error('News sources unavailable');
      err.statusCode = 503;
      err.code = 'NEWS_SOURCES_UNAVAILABLE';
      throw err;
    }

    // 5. Process articles
    let processed = this.processArticles(allArticles, canonicalAssets);

    // 6. Filter by assetId if requested
    if (assetId) {
      const trimmedAssetId = assetId.trim();
      processed = processed.filter((item) =>
        Array.isArray(item.relatedAssets) && item.relatedAssets.some((r) => r.assetId === trimmedAssetId)
      );
    }

    // 7. Apply limit
    const finalArticles = processed.slice(0, parsedLimit);

    return {
      status: 'ok',
      count: finalArticles.length,
      data: finalArticles,
      partial,
      dataAsOf,
      sources: this.formatSourcesMetadata(sourceResults)
    };
  }

  /**
   * Generates personalized news feed for GET /api/news/personalized.
   * @param {object} options
   * @param {Function} options.getHoldingsFn
   * @param {Function} options.getWatchlistFn
   * @returns {Promise<object>}
   */
  async getPersonalizedNewsFeed({
    getHoldingsFn,
    getWatchlistFn,
    limit = DEFAULT_NEWS_LIMIT
  }) {
    if (!getHoldingsFn || !getWatchlistFn) {
      throw new Error('getHoldingsFn and getWatchlistFn are required for personalized news');
    }
    const parsedLimit = parseNewsLimit(limit);

    const [holdings, watchlist, canonicalAssets] = await Promise.all([
      getHoldingsFn(),
      getWatchlistFn(),
      this.getAssetsFn().catch(() => [])
    ]);

    // Extract user asset IDs
    const userAssetMap = new Map();
    const addCandidate = (item) => {
      if (!item) return;
      const asset = item.asset || (item.symbol && item.name ? item : null);
      if (!asset) return;

      let canonical = null;
      if (asset.id || item.asset_id) {
        const id = asset.id || item.asset_id;
        canonical = canonicalAssets.find((a) => a.id === id);
      }
      if (!canonical && asset.symbol) {
        const sym = String(asset.symbol).trim().toUpperCase();
        canonical = canonicalAssets.find((a) => String(a.symbol).trim().toUpperCase() === sym);
      }

      if (canonical && canonical.id) {
        if (!userAssetMap.has(canonical.id)) {
          userAssetMap.set(canonical.id, {
            id: canonical.id,
            symbol: canonical.symbol,
            name: canonical.name || canonical.symbol
          });
        }
      } else if (asset.symbol) {
        const sym = String(asset.symbol).trim().toUpperCase();
        const fallbackId = asset.id || item.asset_id || sym;
        if (!userAssetMap.has(fallbackId)) {
          userAssetMap.set(fallbackId, {
            id: fallbackId,
            symbol: sym,
            name: asset.name || sym
          });
        }
      }
    };

    if (Array.isArray(holdings)) {
      for (const h of holdings) addCandidate(h);
    }
    if (Array.isArray(watchlist)) {
      for (const w of watchlist) addCandidate(w);
    }

    const userAssets = Array.from(userAssetMap.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
    const userAssetIds = new Set(userAssets.map((a) => a.id));

    if (userAssets.length === 0) {
      return {
        status: 'ok',
        count: 0,
        data: [],
        userAssetCount: 0,
        userAssets: [],
        partial: false,
        dataAsOf: null,
        sources: []
      };
    }

    const { sourceResults, allArticles, partial, dataAsOf, allFailed } = await this.fetchAllSources();

    if (allFailed) {
      const err = new Error('News sources unavailable');
      err.statusCode = 503;
      err.code = 'NEWS_SOURCES_UNAVAILABLE';
      throw err;
    }

    const processed = this.processArticles(allArticles, canonicalAssets);

    // Filter to articles that match at least one user asset UUID
    const personalizedArticles = [];
    for (const item of processed) {
      const matchingRelationships = (item.relatedAssets || []).filter((r) => userAssetIds.has(r.assetId));
      if (matchingRelationships.length > 0) {
        personalizedArticles.push({
          ...item,
          matchedAssets: matchingRelationships.map((r) => ({
            symbol: r.symbol,
            name: r.name
          }))
        });
      }
    }

    return {
      status: 'ok',
      count: Math.min(personalizedArticles.length, parsedLimit),
      data: personalizedArticles.slice(0, parsedLimit),
      userAssetCount: userAssets.length,
      userAssets: userAssets.map((a) => ({ symbol: a.symbol, name: a.name })),
      partial,
      dataAsOf,
      sources: this.formatSourcesMetadata(sourceResults)
    };
  }
}

export const globalNewsService = new NewsService();
