import { createHash } from 'node:crypto';
import { cleanPlainText } from './text.js';
import { normalizePublishedAt } from './time.js';
import { normalizeUrl } from './url.js';

const SOURCE_DEFAULTS = Object.freeze({
  cafef: Object.freeze({ name: 'CafeF', language: 'vi', geography: 'vietnam', authority: 'FINANCIAL_MEDIA' }),
  coindesk: Object.freeze({ name: 'CoinDesk', language: 'en', geography: 'global', authority: 'FINANCIAL_MEDIA' }),
  'alphavantage-news': Object.freeze({ name: 'Alpha Vantage News', language: 'en', geography: 'global', authority: 'NEWS_AGGREGATOR' })
});

function normalizedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildArticleId({ url, sourceId, title, publishedAt } = {}) {
  const canonicalUrl = normalizeUrl(url);
  const normalizedTitle = cleanPlainText(title);
  const normalizedPublishedAt = normalizePublishedAt(publishedAt);
  const normalizedSourceId = normalizedString(sourceId)?.toLowerCase() || null;
  const identity = canonicalUrl
    ? `url:${canonicalUrl}`
    : (normalizedSourceId && normalizedTitle && normalizedPublishedAt
        ? `fallback:${normalizedSourceId}:${normalizedTitle.toLocaleLowerCase('en-US')}:${normalizedPublishedAt}`
        : null);
  if (!identity) return null;
  return `news_${createHash('sha256').update(identity).digest('hex')}`;
}

export function normalizeRelatedAssets(relationships = []) {
  if (!Array.isArray(relationships)) return [];
  const byAssetId = new Map();
  for (const relationship of relationships) {
    const assetId = normalizedString(relationship?.assetId);
    if (!assetId || byAssetId.has(assetId)) continue;
    byAssetId.set(assetId, {
      assetId,
      symbol: normalizedString(relationship?.symbol)?.toUpperCase() || null,
      name: normalizedString(relationship?.name),
      relevanceReason: normalizedString(relationship?.relevanceReason) || 'DERIVED_TEXT_MATCH'
    });
  }
  return Array.from(byAssetId.values()).sort((left, right) => left.assetId.localeCompare(right.assetId));
}

/**
 * Calculates a deterministic content hash of the article's material content.
 * Distinguishes article versions when content is corrected or updated.
 */
export function calculateArticleContentHash({ title, excerpt, summary, publishedAt, url } = {}) {
  const content = {
    title: cleanPlainText(title) || '',
    excerpt: cleanPlainText(summary || excerpt) || '',
    publishedAt: normalizePublishedAt(publishedAt) || '',
    url: normalizeUrl(url) || ''
  };
  const canonicalJson = JSON.stringify(content, Object.keys(content).sort());
  return createHash('sha256').update(canonicalJson).digest('hex').slice(0, 12);
}

export function normalizeCanonicalArticle(rawArticle, { fetchedAt, sourceStatus = 'ok' } = {}) {
  if (!rawArticle || typeof rawArticle !== 'object') return null;
  const sourceId = normalizedString(rawArticle.sourceId)?.toLowerCase() || null;
  const sourceDefaults = SOURCE_DEFAULTS[sourceId];
  const title = cleanPlainText(rawArticle.title);
  const url = normalizeUrl(rawArticle.url);
  const publishedAt = normalizePublishedAt(rawArticle.publishedAt);
  const normalizedFetchedAt = normalizePublishedAt(fetchedAt || rawArticle.fetchedAt);
  if (!sourceId || !sourceDefaults || !title || !url || !publishedAt || !normalizedFetchedAt) return null;

  const articleId = buildArticleId({ url, sourceId, title, publishedAt });
  if (!articleId) return null;
  const excerpt = cleanPlainText(rawArticle.summary || rawArticle.excerpt) || null;
  const category = normalizedString(rawArticle.category)?.toLowerCase() || null;
  const topic = normalizedString(rawArticle.topic)?.toLowerCase() || category;
  const geography = sourceId === 'cafef' && category === 'global'
    ? 'global'
    : sourceDefaults.geography;
  const sourceName = normalizedString(rawArticle.sourceName || rawArticle.source) || sourceDefaults.name;
  const freshness = sourceStatus === 'stale' ? 'stale' : 'fresh';
  const contentHash = calculateArticleContentHash({ title, excerpt, summary: excerpt, publishedAt, url });
  const versionId = `${articleId}:v_${contentHash}`;

  return Object.freeze({
    articleId,
    id: articleId,
    versionId,
    contentHash,
    sourceId,
    sourceName,
    source: sourceName,
    title,
    excerpt,
    summary: excerpt,
    url,
    publishedAt,
    fetchedAt: normalizedFetchedAt,
    language: normalizedString(rawArticle.language)?.toLowerCase() || sourceDefaults.language,
    category,
    topic,
    relatedAssets: normalizeRelatedAssets(rawArticle.relatedAssets),
    geography,
    sourceAuthority: sourceDefaults.authority,
    quality: 'VALIDATED_METADATA',
    provenance: Object.freeze({
      provider: sourceId,
      providerArticleId: normalizedString(rawArticle.id),
      sourceSummary: excerpt !== null,
      categoryClassification: category ? 'ADAPTER_DERIVED' : 'UNAVAILABLE',
      geographyClassification: 'SOURCE_AND_CATEGORY_DERIVED'
    }),
    status: sourceStatus === 'stale' ? 'stale' : 'available',
    freshness
  });
}

export function deduplicateCanonicalArticles(articles = []) {
  const byId = new Map();
  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article?.articleId) continue;
    const existing = byId.get(article.articleId);
    if (!existing || (!existing.excerpt && article.excerpt)) byId.set(article.articleId, article);
  }
  return Array.from(byId.values());
}
