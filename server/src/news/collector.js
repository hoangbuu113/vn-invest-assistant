import { privateSupabase, getAssets } from '../supabase.js';
import { globalNewsService } from './service.js';
import { deduplicateCanonicalArticles, normalizeCanonicalArticle } from './contract.js';
import { fetchPersistedNewsArticles, persistNewsArticles } from './repository.js';
import { globalNewsReadCache } from './reader.js';
import { recordJobHealth, HEALTH_STATES, OBSERVED_JOBS, ERROR_CATEGORIES } from '../observability/dataHealth.js';

function sourceMetadata(sourceResults = []) {
  return sourceResults.map((source) => ({
    sourceId: source?.sourceId || null,
    status: source?.status || 'error',
    articleCount: Number.isInteger(source?.articleCount) ? source.articleCount : 0,
    errorCode: source?.errorCode || null
  }));
}

export async function runNewsCollector({
  now = new Date(),
  client = privateSupabase,
  service = globalNewsService,
  getAssetsFn = getAssets,
  persistFn = persistNewsArticles,
  fetchPersistedFn = fetchPersistedNewsArticles,
  readCache = globalNewsReadCache
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('News collector requires a valid Date');
  }

  let canonicalAssets = [];
  try {
    canonicalAssets = await getAssetsFn(client);
  } catch {
    canonicalAssets = [];
  }

  const sourceResult = await service.fetchAllSources();
  const processed = service.processArticles(sourceResult.allArticles, canonicalAssets);
  const sourceById = new Map(
    sourceResult.sourceResults
      .filter((source) => source?.sourceId)
      .map((source) => [source.sourceId, source])
  );
  const canonicalArticles = deduplicateCanonicalArticles(
    processed.map((article) => {
      const source = sourceById.get(article.sourceId);
      return normalizeCanonicalArticle(article, {
        fetchedAt: source?.fetchedAt || now.toISOString(),
        sourceStatus: source?.status
      });
    }).filter(Boolean)
  );

  const startTime = Date.now();
  const persistence = await persistFn(canonicalArticles, client);
  readCache?.clear?.();
  const retainedArticles = await fetchPersistedFn({ client, now, limit: 500 });
  const success = persistence.failedPersistence === 0
    && (canonicalArticles.length > 0 || retainedArticles.length > 0 || !sourceResult.allFailed);

  const durationMs = Date.now() - startTime;
  let newsHealthStatus = HEALTH_STATES.HEALTHY;
  if (sourceResult.allFailed || (persistence.failedPersistence > 0 && persistence.durablyPersisted === 0)) {
    newsHealthStatus = HEALTH_STATES.FAILED;
  } else if (sourceResult.partial || persistence.failedPersistence > 0) {
    newsHealthStatus = HEALTH_STATES.DEGRADED;
  }

  try {
    await recordJobHealth({
      jobName: OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR,
      status: newsHealthStatus,
      durationMs,
      recordsRead: sourceResult.allArticles.length,
      recordsWritten: persistence.durablyPersisted || 0,
      dataAsOf: now.toISOString(),
      policyVersion: 'v1.3',
      errorCode: sourceResult.allFailed ? 'ALL_PROVIDERS_FAILED' : (sourceResult.partial ? 'PARTIAL_PROVIDERS_FAILED' : null),
      errorCategory: (sourceResult.allFailed || sourceResult.partial) ? ERROR_CATEGORIES.UPSTREAM_PROVIDER : null,
      client,
      now
    });
  } catch {
    // Non-blocking telemetry
  }

  return {
    success,
    fetchedArticleCount: sourceResult.allArticles.length,
    validatedArticleCount: canonicalArticles.length,
    retainedArticleCount: retainedArticles.length,
    isDurable: persistence.isDurable,
    durablyPersisted: persistence.durablyPersisted,
    failedPersistence: persistence.failedPersistence,
    partial: sourceResult.partial || sourceResult.allFailed || persistence.failedPersistence > 0,
    allProvidersFailed: sourceResult.allFailed,
    fetchedAt: now.toISOString(),
    sources: sourceMetadata(sourceResult.sourceResults)
  };
}
