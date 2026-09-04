import { privateSupabase, getAssetById } from '../supabase.js';
import { fetchPersistedNewsArticles } from './repository.js';
import { DEFAULT_NEWS_LIMIT, MAX_NEWS_LIMIT } from './service.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

export class NewsReadCache {
  constructor() {
    this.entry = null;
  }
  get(now) {
    return this.entry && now.getTime() <= this.entry.expiresAt ? this.entry.articles : null;
  }
  set(articles, now) {
    this.entry = { articles, expiresAt: now.getTime() + CACHE_TTL_MS };
  }
  clear() {
    this.entry = null;
  }
}

export const globalNewsReadCache = new NewsReadCache();

function parseLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_NEWS_LIMIT) {
    const error = new Error(`Invalid limit parameter. Must be an integer between 1 and ${MAX_NEWS_LIMIT}.`);
    error.statusCode = 400;
    error.code = 'INVALID_LIMIT';
    throw error;
  }
  return parsed;
}

export class NewsReadService {
  constructor({ client = privateSupabase, cache = globalNewsReadCache, fetchPersistedFn = fetchPersistedNewsArticles, getAssetByIdFn = getAssetById } = {}) {
    this.client = client;
    this.cache = cache;
    this.fetchPersistedFn = fetchPersistedFn;
    this.getAssetByIdFn = getAssetByIdFn;
  }

  async getNewsFeed({ limit = DEFAULT_NEWS_LIMIT, assetId, geography, topic, now = new Date() } = {}) {
    const parsedLimit = parseLimit(limit);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('News reader requires a valid Date');
    if (assetId) {
      const id = typeof assetId === 'string' ? assetId.trim() : '';
      if (!id) {
        const error = new Error('Invalid assetId parameter');
        error.statusCode = 400;
        error.code = 'INVALID_ASSET_ID';
        throw error;
      }
      let asset = null;
      try {
        asset = await this.getAssetByIdFn(id, this.client);
      } catch {
        asset = null;
      }
      if (!asset) {
        const error = new Error(`Asset with ID '${id}' not found`);
        error.statusCode = 404;
        error.code = 'ASSET_NOT_FOUND';
        throw error;
      }
    }

    let articles = this.cache.get(now);
    const source = articles ? 'memory_cache' : 'persisted_or_process_lkg';
    if (!articles) {
      articles = await this.fetchPersistedFn({ client: this.client, now, limit: 500 });
      this.cache.set(articles, now);
    }
    let filtered = articles;
    if (assetId) filtered = filtered.filter((article) => article.relatedAssets.some((item) => item.assetId === assetId.trim()));
    if (geography) filtered = filtered.filter((article) => article.geography === String(geography).trim().toLowerCase());
    if (topic) filtered = filtered.filter((article) => article.topic === String(topic).trim().toLowerCase() || article.category === String(topic).trim().toLowerCase());
    const data = filtered.slice(0, parsedLimit);
    const sources = Array.from(new Set(data.map((article) => article.sourceId))).sort().map((sourceId) => ({
      sourceId,
      name: data.find((article) => article.sourceId === sourceId)?.sourceName || sourceId,
      status: data.some((article) => article.sourceId === sourceId && article.freshness === 'stale') ? 'stale' : 'ok',
      articleCount: data.filter((article) => article.sourceId === sourceId).length
    }));
    const fetchedTimes = data.map((article) => Date.parse(article.fetchedAt)).filter(Number.isFinite);
    return {
      status: 'ok',
      count: data.length,
      data,
      news: data,
      partial: data.some((article) => article.freshness === 'stale'),
      dataAsOf: fetchedTimes.length ? new Date(Math.min(...fetchedTimes)).toISOString() : null,
      sources,
      source
    };
  }
}

export const globalNewsReadService = new NewsReadService();
