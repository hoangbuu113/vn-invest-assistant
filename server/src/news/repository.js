import { privateSupabase } from '../supabase.js';
import { normalizeCanonicalArticle } from './contract.js';

const memoryArticles = new Map();
const RSS_FRESH_MS = 60 * 60 * 1000;
const ALPHA_FRESH_MS = 30 * 60 * 60 * 1000;

export function articleToRow(article) {
  if (!article?.articleId) return null;
  return {
    article_id: article.articleId,
    version_id: article.versionId || null,
    content_hash: article.contentHash || null,
    source_id: article.sourceId,
    source_name: article.sourceName,
    title: article.title,
    excerpt: article.excerpt,
    canonical_url: article.url,
    published_at: article.publishedAt,
    fetched_at: article.fetchedAt,
    language: article.language,
    category: article.category,
    topic: article.topic,
    related_assets: article.relatedAssets || [],
    geography: article.geography,
    source_authority: article.sourceAuthority,
    quality: article.quality,
    provenance: article.provenance || {},
    status: article.status || 'available',
    freshness: article.freshness || 'fresh',
    last_seen_at: article.fetchedAt
  };
}

export function rowToArticle(row) {
  if (!row) return null;
  const article = normalizeCanonicalArticle({
    id: row.article_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    summary: row.excerpt,
    url: row.canonical_url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    language: row.language,
    category: row.category,
    topic: row.topic,
    relatedAssets: row.related_assets
  }, { fetchedAt: row.fetched_at, sourceStatus: row.freshness === 'stale' ? 'stale' : 'ok' });
  if (!article) return null;
  return Object.freeze({
    ...article,
    articleId: row.article_id,
    id: row.article_id,
    versionId: row.version_id || article.versionId,
    contentHash: row.content_hash || article.contentHash,
    geography: row.geography || article.geography,
    sourceAuthority: row.source_authority || article.sourceAuthority,
    quality: row.quality || article.quality,
    provenance: Object.freeze(row.provenance || article.provenance),
    status: row.status || article.status,
    freshness: row.freshness || article.freshness
  });
}

export function applyNewsFreshness(article, now = new Date()) {
  if (!article) return null;
  // News freshness evaluated by source publication age, never fetch age
  const publishedMs = Date.parse(article.publishedAt);
  const ttl = article.sourceId === 'alphavantage-news' ? ALPHA_FRESH_MS : RSS_FRESH_MS;
  const stale = !Number.isFinite(publishedMs) || now.getTime() - publishedMs > ttl;
  return stale
    ? Object.freeze({ ...article, status: 'stale', freshness: 'stale' })
    : article;
}

export async function persistNewsArticles(articles, client = privateSupabase) {
  const valid = (Array.isArray(articles) ? articles : []).filter((article) => articleToRow(article) !== null);
  for (const article of valid) memoryArticles.set(article.articleId, article);
  if (valid.length === 0) return { isDurable: false, durablyPersisted: 0, memoryAccepted: 0, failedPersistence: 0, error: null };
  if (!client) return { isDurable: false, durablyPersisted: 0, memoryAccepted: valid.length, failedPersistence: 0, error: null };
  try {
    const { error } = await client.from('market_news_articles').upsert(valid.map(articleToRow), { onConflict: 'article_id' });
    if (error) return { isDurable: false, durablyPersisted: 0, memoryAccepted: valid.length, failedPersistence: valid.length, error: { code: error.code || null, message: 'NEWS_PERSISTENCE_FAILED' } };
    return { isDurable: true, durablyPersisted: valid.length, memoryAccepted: valid.length, failedPersistence: 0, error: null };
  } catch {
    return { isDurable: false, durablyPersisted: 0, memoryAccepted: valid.length, failedPersistence: valid.length, error: { code: null, message: 'NEWS_PERSISTENCE_FAILED' } };
  }
}

export async function fetchPersistedNewsArticles({ client = privateSupabase, now = new Date(), limit = 500 } = {}) {
  let articles = [];
  if (client) {
    try {
      const { data, error } = await client.from('market_news_articles').select('*').order('published_at', { ascending: false }).limit(limit);
      if (!error && Array.isArray(data)) {
        articles = data.map(rowToArticle).filter(Boolean);
        for (const article of articles) memoryArticles.set(article.articleId, article);
      }
    } catch {
      articles = [];
    }
  }
  if (articles.length === 0) articles = Array.from(memoryArticles.values());
  return articles
    .map((article) => applyNewsFreshness(article, now))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.articleId.localeCompare(right.articleId))
    .slice(0, limit);
}

export function clearNewsPersistenceStore() {
  memoryArticles.clear();
}
