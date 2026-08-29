/**
 * Deterministic deduplication for multi-source news articles.
 */

const DEFAULT_SOURCE_PRIORITY = ['cafef', 'coindesk', 'alphavantage-news'];

/**
 * Deduplicates articles using normalized URL, source-scoped GUID, and conservative fallback.
 * @param {Array<object>} articles
 * @param {Array<string>} [sourcePriority=DEFAULT_SOURCE_PRIORITY]
 * @returns {Array<object>} Deduplicated articles
 */
export function deduplicateArticles(articles = [], sourcePriority = DEFAULT_SOURCE_PRIORITY) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  const priorityMap = new Map();
  sourcePriority.forEach((src, idx) => {
    priorityMap.set(src.toLowerCase(), idx);
  });

  const getSourceRank = (item) => {
    const srcId = String(item.sourceId || item.source?.id || item.source || '').toLowerCase();
    return priorityMap.has(srcId) ? priorityMap.get(srcId) : 999;
  };

  /**
   * Evaluates if itemA is preferred over itemB.
   * Lower rank is better. Non-null summary is better. Smaller ID is better.
   */
  const isPreferred = (itemA, itemB) => {
    const rankA = getSourceRank(itemA);
    const rankB = getSourceRank(itemB);
    if (rankA !== rankB) return rankA < rankB;

    const hasSummaryA = Boolean(itemA.summary && itemA.summary.trim().length > 0);
    const hasSummaryB = Boolean(itemB.summary && itemB.summary.trim().length > 0);
    if (hasSummaryA !== hasSummaryB) return hasSummaryA;

    return String(itemA.id || '').localeCompare(String(itemB.id || '')) <= 0;
  };

  const clusters = [];
  const urlToCluster = new Map();
  const guidToCluster = new Map();
  const fallbackToCluster = new Map();

  for (const article of articles) {
    const urlKey = article.url ? `url:${article.url}` : null;
    const srcId = article.sourceId || article.source?.id || 'unknown';
    const guidKey = article.id ? `guid:${srcId}:${article.id}` : null;
    const fallbackKey = (article.title && article.publishedAt)
      ? `fallback:${srcId}:${article.title.trim().toLowerCase()}:${article.publishedAt}`
      : null;

    let targetCluster = null;
    if (urlKey && urlToCluster.has(urlKey)) {
      targetCluster = urlToCluster.get(urlKey);
    } else if (guidKey && guidToCluster.has(guidKey)) {
      targetCluster = guidToCluster.get(guidKey);
    } else if (fallbackKey && fallbackToCluster.has(fallbackKey)) {
      targetCluster = fallbackToCluster.get(fallbackKey);
    }

    if (!targetCluster) {
      targetCluster = { best: article };
      clusters.push(targetCluster);
    } else {
      if (isPreferred(article, targetCluster.best)) {
        targetCluster.best = article;
      }
    }

    if (urlKey) urlToCluster.set(urlKey, targetCluster);
    if (guidKey) guidToCluster.set(guidKey, targetCluster);
    if (fallbackKey) fallbackToCluster.set(fallbackKey, targetCluster);
  }

  return clusters.map((c) => c.best);
}

