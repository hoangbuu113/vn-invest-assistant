/**
 * In-memory caching and request coalescing engine for news source adapters.
 */

export const DEFAULT_CACHE_CONFIGS = {
  'cafef': {
    freshTtlMs: 5 * 60 * 1000,        // 5 minutes
    staleTtlMs: 30 * 60 * 1000,       // 30 minutes
    errorTtlMs: 60 * 1000             // 1-minute retry suppression
  },
  'coindesk': {
    freshTtlMs: 5 * 60 * 1000,        // 5 minutes
    staleTtlMs: 30 * 60 * 1000,       // 30 minutes
    errorTtlMs: 60 * 1000             // 1-minute retry suppression
  },
  'alphavantage-news': {
    // Optional news enrichment receives one normal acquisition per stable
    // process-day so it cannot consume Alpha Vantage capacity needed by Gold.
    freshTtlMs: 24 * 60 * 60 * 1000,  // 24 hours
    staleTtlMs: 72 * 60 * 60 * 1000,  // 72-hour bounded last-good window
    errorTtlMs: 24 * 60 * 60 * 1000   // one optional upstream attempt/day
  }
};

export class NewsCache {
  constructor(configs = DEFAULT_CACHE_CONFIGS, { nowFn = Date.now } = {}) {
    this.configs = {};
    for (const sourceId of new Set([
      ...Object.keys(DEFAULT_CACHE_CONFIGS),
      ...Object.keys(configs || {})
    ])) {
      this.configs[sourceId] = {
        ...(DEFAULT_CACHE_CONFIGS[sourceId] || {}),
        ...(configs?.[sourceId] || {})
      };
    }
    this.cache = new Map();
    this.failures = new Map();
    this.inFlight = new Map();
    this.nowFn = nowFn;
  }

  getFailure(sourceId) {
    const entry = this.failures.get(sourceId);
    if (!entry) return null;

    const now = this.nowMs();
    if (now > entry.expiresAt) {
      this.failures.delete(sourceId);
      return null;
    }

    return {
      ...entry.data,
      cacheStatus: 'negative',
      cacheAgeMs: Math.max(0, now - entry.loadedAtMs)
    };
  }

  setFailure(sourceId, sourceResult) {
    if (!sourceResult || sourceResult.status !== 'error') return sourceResult;
    const cfg = this.configs[sourceId] || {};
    const errorTtlMs = Number.isFinite(cfg.errorTtlMs) && cfg.errorTtlMs > 0
      ? cfg.errorTtlMs
      : 60 * 1000;
    const now = this.nowMs();
    const fetchedAtMs = Date.parse(sourceResult.fetchedAt);
    const failure = {
      ...sourceResult,
      fetchedAt: Number.isFinite(fetchedAtMs)
        ? sourceResult.fetchedAt
        : new Date(now).toISOString(),
      cacheStatus: 'negative',
      cacheAgeMs: 0
    };
    this.failures.set(sourceId, {
      data: failure,
      loadedAtMs: now,
      expiresAt: now + errorTtlMs
    });
    return failure;
  }

  nowMs() {
    const value = this.nowFn();
    if (!Number.isFinite(value)) {
      throw new TypeError('News cache clock must return a finite timestamp');
    }
    return value;
  }

  /**
   * Retrieves cached data for a source if available.
   * @param {string} sourceId
   * @returns {{ isFresh: boolean, isStale: boolean, data: object }|null}
   */
  get(sourceId) {
    const entry = this.cache.get(sourceId);
    if (!entry) return null;

    const now = this.nowMs();
    const isFresh = now <= entry.expiresAt;
    const isStale = now > entry.expiresAt && now <= entry.staleUntil;

    if (!isFresh && !isStale) {
      this.cache.delete(sourceId);
      return null;
    }

    return {
      isFresh,
      isStale,
      cacheAgeMs: Math.max(0, now - entry.loadedAtMs),
      data: {
        ...entry.data,
        cacheStatus: isFresh ? 'fresh' : 'stale',
        cacheAgeMs: Math.max(0, now - entry.loadedAtMs)
      }
    };
  }

  /**
   * Saves successful source result into cache.
   * Does NOT overwrite previously good cache with error/timeout.
   * @param {string} sourceId
   * @param {object} sourceResult
   */
  set(sourceId, sourceResult) {
    if (!sourceResult) return null;

    // Cache only structurally valid source results: ok, empty, degraded
    const isCacheable = (
      sourceResult.status === 'ok' ||
      sourceResult.status === 'empty' ||
      sourceResult.status === 'degraded'
    );

    if (!isCacheable) {
      return null;
    }

    const cfg = this.configs[sourceId] || { freshTtlMs: 5 * 60 * 1000, staleTtlMs: 30 * 60 * 1000 };
    const now = this.nowMs();
    const fetchedAtMs = Date.parse(sourceResult.fetchedAt);
    const cachedResult = {
      ...sourceResult,
      fetchedAt: Number.isFinite(fetchedAtMs)
        ? sourceResult.fetchedAt
        : new Date(now).toISOString(),
      cacheStatus: 'fresh',
      cacheAgeMs: 0
    };

    this.cache.set(sourceId, {
      data: cachedResult,
      loadedAtMs: now,
      expiresAt: now + cfg.freshTtlMs,
      staleUntil: now + cfg.staleTtlMs
    });
    this.failures.delete(sourceId);

    return cachedResult;
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

    const cachedFailure = this.getFailure(sourceId);
    if (cachedFailure) {
      if (cached && cached.isStale) {
        return {
          ...cached.data,
          status: 'stale',
          cachedStatus: cached.data.status,
          staleReason: cachedFailure.errorCode || 'SOURCE_REFRESH_FAILED'
        };
      }
      return cachedFailure;
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
          return this.set(sourceId, liveResult) || liveResult;
        }

        // If live fetch returned error/failure status, check for stale cache fallback
        if (cached && cached.isStale) {
          this.setFailure(sourceId, liveResult);
          return {
            ...cached.data,
            status: 'stale',
            cachedStatus: cached.data.status,
            staleReason: liveResult.errorCode || 'SOURCE_REFRESH_FAILED'
          };
        }

        return this.setFailure(sourceId, liveResult);
      } catch (err) {
        const failure = {
          sourceId,
          name: sourceId,
          language: 'unknown',
          status: 'error',
          fetchedAt: new Date(this.nowMs()).toISOString(),
          items: [],
          articleCount: 0,
          skippedCount: 0,
          errorCode: 'SOURCE_FETCH_FAILED'
        };
        // Exception fallback to stale cache if valid
        if (cached && cached.isStale) {
          this.setFailure(sourceId, failure);
          return {
            ...cached.data,
            status: 'stale',
            cachedStatus: cached.data.status,
            staleReason: 'SOURCE_FETCH_FAILED'
          };
        }

        return this.setFailure(sourceId, failure);
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
    this.failures.clear();
    this.inFlight.clear();
  }
}

export const globalNewsCache = new NewsCache();
