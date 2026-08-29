/**
 * Unified Multi-Asset News Engine (Feature 23)
 * Provides backward-compatible entry points while delegating to clean modular adapters and services.
 */

import { fetchCafeFNews, isRelevantNewsItem, CAFEF_FEEDS, parseCafeFRss } from './news/adapters/cafef.js';
import { fetchCoinDeskNews, parseCoinDeskRss, COINDESK_RSS_URL } from './news/adapters/coindesk.js';
import { fetchAlphaVantageNews, parseAlphaVantageNews } from './news/adapters/alphavantage.js';
import { normalizeUrl } from './news/url.js';
import { cleanPlainText } from './news/text.js';
import { normalizePublishedAt } from './news/time.js';
import { deduplicateArticles } from './news/dedupe.js';
import { matchArticleAssets, attachRelatedAssets } from './news/relevance.js';
import { NewsCache, globalNewsCache } from './news/cache.js';
import { NewsService, globalNewsService } from './news/service.js';

export {
  CAFEF_FEEDS,
  COINDESK_RSS_URL,
  isRelevantNewsItem,
  parseCafeFRss,
  fetchCafeFNews,
  parseCoinDeskRss,
  fetchCoinDeskNews,
  parseAlphaVantageNews,
  fetchAlphaVantageNews,
  normalizeUrl,
  cleanPlainText,
  normalizePublishedAt,
  deduplicateArticles,
  matchArticleAssets,
  attachRelatedAssets,
  NewsCache,
  globalNewsCache,
  NewsService,
  globalNewsService
};

/**
 * Extracts and deduplicates user assets from holdings and watchlist into a normalized asset universe.
 * (Preserved for backward compatibility with Feature 13 unit tests).
 */
export function getUserAssetUniverse(holdings = [], watchlist = []) {
  const assetMap = new Map();

  const addCandidate = (item) => {
    if (!item) return;
    const asset = item.asset || (item.symbol && item.name ? item : null);
    if (!asset || !asset.symbol) return;
    const symbol = String(asset.symbol).trim().toUpperCase();
    if (!symbol) return;

    if (!assetMap.has(symbol)) {
      assetMap.set(symbol, {
        id: asset.id || item.asset_id || null,
        symbol,
        name: asset.name ? String(asset.name).trim() : symbol,
        asset_type: asset.asset_type || null,
        exchange: asset.exchange || null
      });
    }
  };

  if (Array.isArray(holdings)) {
    for (const h of holdings) addCandidate(h);
  }
  if (Array.isArray(watchlist)) {
    for (const w of watchlist) addCandidate(w);
  }

  return Array.from(assetMap.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Builds Unicode-aware regex boundary patterns for asset metadata.
 * (Preserved for backward compatibility with Feature 13 unit tests).
 */
export function buildAssetMatchers(assets = []) {
  return (assets || []).map((asset) => {
    const symbol = String(asset?.symbol || '').trim();
    const name = String(asset?.name || '').trim();
    const patterns = [];

    if (symbol.length > 0) {
      const symEsc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`(?:^|[^\\p{L}\\p{N}])${symEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu'));
    }

    if (name.length > 0 && name.toUpperCase() !== symbol.toUpperCase()) {
      const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`(?:^|[^\\p{L}\\p{N}])${nameEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu'));

      const parenMatch = name.match(/\(([^)]+)\)/);
      if (parenMatch && parenMatch[1]) {
        const parenTerm = parenMatch[1].trim();
        if (
          parenTerm.length >= 2 &&
          parenTerm.toUpperCase() !== symbol.toUpperCase() &&
          parenTerm.toUpperCase() !== name.toUpperCase()
        ) {
          const parenEsc = parenTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          patterns.push(new RegExp(`(?:^|[^\\p{L}\\p{N}])${parenEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu'));
        }
      }
    }

    return {
      asset: {
        symbol: symbol || asset?.symbol,
        name: name || asset?.name || symbol
      },
      patterns
    };
  });
}

/**
 * Legacy filterPersonalizedNews matching helper (preserved for Feature 13 backward-compatibility).
 */
export function filterPersonalizedNews(newsItems = [], userAssets = []) {
  if (!Array.isArray(newsItems) || newsItems.length === 0 || !Array.isArray(userAssets) || userAssets.length === 0) {
    return [];
  }

  const matchers = buildAssetMatchers(userAssets);
  const personalizedArticles = [];

  for (const item of newsItems) {
    const text = `${item.title || ''} ${item.summary || ''}`.normalize('NFC');
    const matchedAssets = [];

    for (const matcher of matchers) {
      const hasMatch = matcher.patterns.some((p) => p.test(text));
      if (hasMatch) {
        matchedAssets.push({
          symbol: matcher.asset.symbol,
          name: matcher.asset.name
        });
      }
    }

    if (matchedAssets.length > 0) {
      personalizedArticles.push({
        ...item,
        matchedAssets
      });
    }
  }

  return personalizedArticles;
}

/**
 * Primary public news feed getter.
 * Supports limit and assetId filtering.
 */
export async function getNewsFeed(options = {}) {
  if (Array.isArray(options)) {
    const limit = arguments[1] || 30;
    const res = await globalNewsService.getNewsFeed({ limit });
    return res.data;
  }

  if (typeof options === 'number') {
    const res = await globalNewsService.getNewsFeed({ limit: options });
    return res.data;
  }

  return globalNewsService.getNewsFeed(options);
}

/**
 * Primary personalized news feed getter.
 */
export async function getPersonalizedNewsFeed({
  getNewsFeedFn = getNewsFeed,
  getHoldingsFn,
  getWatchlistFn
} = {}) {
  if (!getHoldingsFn || !getWatchlistFn) {
    throw new Error('getHoldingsFn and getWatchlistFn are required to generate personalized news feed');
  }

  // The production path delegates to Feature 23's canonical aggregation and
  // UUID-authoritative personalization service. The injected feed path below
  // exists only for deterministic route tests and applies the same UUID rule.
  if (getNewsFeedFn === getNewsFeed) {
    return globalNewsService.getPersonalizedNewsFeed({ getHoldingsFn, getWatchlistFn });
  }

  const [holdings, watchlist] = await Promise.all([
    getHoldingsFn(),
    getWatchlistFn()
  ]);

  const userAssetMap = new Map();
  const addCanonicalAsset = (item) => {
    if (!item || typeof item !== 'object') return;
    const asset = item.asset && typeof item.asset === 'object' ? item.asset : item;
    const assetId = asset.id ?? item.asset_id ?? item.assetId;
    if (typeof assetId !== 'string' || !assetId.trim()) return;

    const id = assetId.trim();
    if (!userAssetMap.has(id)) {
      const symbol = typeof asset.symbol === 'string' ? asset.symbol.trim().toUpperCase() : null;
      const name = typeof asset.name === 'string' && asset.name.trim()
        ? asset.name.trim()
        : symbol;
      userAssetMap.set(id, { id, symbol, name });
    }
  };

  for (const holding of Array.isArray(holdings) ? holdings : []) addCanonicalAsset(holding);
  for (const item of Array.isArray(watchlist) ? watchlist : []) addCanonicalAsset(item);

  const userAssets = Array.from(userAssetMap.values())
    .sort((left, right) => String(left.symbol || '').localeCompare(String(right.symbol || '')));

  if (userAssets.length === 0) {
    return {
      status: 'ok',
      count: 0,
      data: [],
      news: [],
      userAssetCount: 0,
      userAssets: [],
      partial: false,
      dataAsOf: new Date().toISOString(),
      sources: []
    };
  }

  // Fetch news feed items
  const feedResult = await getNewsFeedFn();
  let rawArticles = [];
  let partial = false;
  let dataAsOf = null;
  let sources = [];

  if (Array.isArray(feedResult)) {
    rawArticles = feedResult;
  } else if (feedResult && Array.isArray(feedResult.data)) {
    rawArticles = feedResult.data;
    partial = feedResult.partial || false;
    dataAsOf = feedResult.dataAsOf || null;
    sources = feedResult.sources || [];
  }

  const userAssetIds = new Set(userAssets.map((asset) => asset.id));
  const personalizedArticles = [];
  for (const article of rawArticles) {
    const relatedAssets = Array.isArray(article?.relatedAssets) ? article.relatedAssets : [];
    const matchingRelationships = relatedAssets.filter((relationship) =>
      typeof relationship?.assetId === 'string' && userAssetIds.has(relationship.assetId)
    );
    if (matchingRelationships.length === 0) continue;

    personalizedArticles.push({
      ...article,
      relatedAssets,
      matchedAssets: matchingRelationships.map((relationship) => ({
        symbol: relationship.symbol ?? null,
        name: relationship.name ?? relationship.symbol ?? null
      }))
    });
  }

  return {
    status: 'ok',
    count: personalizedArticles.length,
    data: personalizedArticles,
    news: personalizedArticles,
    userAssetCount: userAssets.length,
    userAssets: userAssets.map((a) => ({ symbol: a.symbol, name: a.name })),
    partial,
    dataAsOf,
    sources
  };
}
