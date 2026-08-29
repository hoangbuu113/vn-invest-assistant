/**
 * In-memory caching and request coalescing engine for news source adapters.
 */

export const DEFAULT_CACHE_CONFIGS = {
  'cafef': {
    freshTtlMs: 5 * 60 * 1000,        // 5 minutes
    staleTtlMs: 30 * 60 * 1000        // 30 minutes
  },
  'coindesk': {
    freshTtlMs: 5 * 60 * 1000,        // 5 minutes
    staleTtlMs: 30 * 60 * 1000        // 30 minutes
  },
  'alphavantage-news': {
    freshTtlMs: 4 * 60 * 60 * 1000,   // 4 hours
    staleTtlMs: 24 * 60 * 60 * 1000   // 24 hours
  }
};

export class NewsCache {
  constructor(configs = DEFAULT_CACHE_CONFIGS) {
    this.configs = { ...DEFAULT_CACHE_CONFIGS, ...configs };
    this.cache = new Map();
    this.inFlight = new Map();
  }

  /**
   * Retrieves cached data for a source if available.
   * @param {string} sourceId
   * @returns {{ isFresh: boolean, isStale: boolean, data: object }|null}
   */
  get(sourceId) {
    const entry = this.cache.get(sourceId);
    if (!entry) return null;

    const now = Date.now();
    const isFresh = now <= entry.expiresAt;
    const isStale = now > entry.expiresAt && now <= entry.staleUntil;

    if (!isFresh && !isStale) {
      return null;
    }

    return {
      isFresh,
      isStale,
      data: entry.data
    };
  }

  /**
   * Saves successful source result into cache.
   * Does NOT overwrite previously good cache with error/timeout.
   * @param {string} sourceId
   * @param {object} sourceResult
   */
  set(sourceId, sourceResult) {
    if (!sourceResult) return;

    // Cache only structurally valid source results: ok, empty, degraded
    const isCacheable = (
      sourceResult.status === 'ok' ||
      sourceResult.status === 'empty' ||
      sourceResult.status === 'degraded'
    );

    if (!isCacheable) {
      return;
    }

    const cfg = this.configs[sourceId] || { freshTtlMs: 5 * 60 * 1000, staleTtlMs: 30 * 60 * 1000 };
    const now = Date.now();

    this.cache.set(sourceId, {
      data: sourceResult,
      fetchedAt: sourceResult.fetchedAt || new Date(now).toISOString(),
      expiresAt: now + cfg.freshTtlMs,
      staleUntil: now + cfg.staleTtlMs
    });
  }

  /**
   * Coalesces and caches external fetch calls for a given source.
   * @param {string} sourceId
   * @param {() => Promise<object>} fetchFn
   * @returns {Promise<object>}
   */
  async fetchWithCache(sourceId, fetchFn) {
    // 1. Check fresh cache hit
    const cached = this.get(sourceId);
    if (cached && cached.isFresh) {
      return cached.data;
    }

    // 2. Coalesce in-flight requests
    if (this.inFlight.has(sourceId)) {
      return this.inFlight.get(sourceId);
    }

    const promise = (async () => {
      try {
        const liveResult = await fetchFn();

        if (
          liveResult.status === 'ok' ||
          liveResult.status === 'empty' ||
          liveResult.status === 'degraded'
        ) {
          this.set(sourceId, liveResult);
          return liveResult;
        }

        // If live fetch returned error/failure status, check for stale cache fallback
        if (cached && cached.isStale) {
          return {
            ...cached.data,
            status: 'stale'
          };
        }

        return liveResult;
      } catch (err) {
        // Exception fallback to stale cache if valid
        if (cached && cached.isStale) {
          return {
            ...cached.data,
            status: 'stale'
          };
        }

        return {
          sourceId,
          name: sourceId,
          language: 'unknown',
          status: 'error',
          fetchedAt: new Date().toISOString(),
          items: [],
          articleCount: 0,
          skippedCount: 0,
          errorCode: err.message || 'SOURCE_FETCH_EXCEPTION'
        };
      } finally {
        this.inFlight.delete(sourceId);
      }
    })();

    this.inFlight.set(sourceId, promise);
    return promise;
  }

  /**
   * Clears in-memory cache and in-flight promises.
   */
  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export const globalNewsCache = new NewsCache();

