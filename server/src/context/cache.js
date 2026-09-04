/**
 * Context Cache — In-memory coalesced TTL cache with stale-while-revalidate semantics.
 */

const DEFAULT_CACHE_CONFIG = Object.freeze({
  freshTtlMs: 15 * 60 * 1000,        // 15 minutes
  staleTtlMs: 7 * 24 * 60 * 60 * 1000 // 7 days
});

export const DOMAIN_CACHE_CONFIGS = Object.freeze({
  macro: Object.freeze({
    freshTtlMs: 6 * 60 * 60 * 1000,       // 6 hours
    staleTtlMs: 45 * 24 * 60 * 60 * 1000  // 45 days
  }),
  monetary: Object.freeze({
    freshTtlMs: 15 * 60 * 1000,           // 15 minutes
    staleTtlMs: 14 * 24 * 60 * 60 * 1000  // 14 days
  }),
  market: Object.freeze({
    freshTtlMs: 15 * 60 * 1000,           // 15 minutes
    staleTtlMs: 7 * 24 * 60 * 60 * 1000   // 7 days
  }),
  intermarket: Object.freeze({
    freshTtlMs: 15 * 60 * 1000,           // 15 minutes
    staleTtlMs: 7 * 24 * 60 * 60 * 1000   // 7 days
  })
});

function requireNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Context cache requires a valid Date');
  }
  return now.getTime();
}

function hasUsableObservations(data) {
  if (!Array.isArray(data)) return Boolean(data && data.status === 'available');
  return data.some((obs) => obs && (obs.status === 'available' || Number.isFinite(obs.value)));
}

function markObservationsStale(data) {
  if (Array.isArray(data)) {
    return data.map((obs) => ({
      ...obs,
      freshness: 'stale',
      provenance: {
        ...(obs.provenance || {}),
        cache: 'stale'
      }
    }));
  }
  if (data && typeof data === 'object') {
    return {
      ...data,
      freshness: 'stale',
      provenance: {
        ...(data.provenance || {}),
        cache: 'stale'
      }
    };
  }
  return data;
}

export class ContextCache {
  constructor(configs = DOMAIN_CACHE_CONFIGS) {
    this.configs = { ...DOMAIN_CACHE_CONFIGS, ...configs };
    this.entries = new Map();
    this.inFlight = new Map();
  }

  get(key, now = new Date()) {
    const nowMs = requireNow(now);
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (nowMs <= entry.freshUntilMs) {
      return { data: entry.data, freshness: 'fresh' };
    }
    if (nowMs <= entry.staleUntilMs) {
      return { data: markObservationsStale(entry.data), freshness: 'stale' };
    }

    this.entries.delete(key);
    return null;
  }

  set(key, data, now = new Date()) {
    if (!hasUsableObservations(data)) return;
    const nowMs = requireNow(now);
    const config = this.configs[key] || DEFAULT_CACHE_CONFIG;
    this.entries.set(key, {
      data,
      freshUntilMs: nowMs + config.freshTtlMs,
      staleUntilMs: nowMs + config.staleTtlMs
    });
  }

  async fetchWithCache(key, fetchFn, { now = new Date() } = {}) {
    const cached = this.get(key, now);
    if (cached?.freshness === 'fresh') return cached.data;

    // In-flight coalescing
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const request = (async () => {
      try {
        const live = await fetchFn();
        if (hasUsableObservations(live)) {
          this.set(key, live, now);
          return live;
        }
        if (cached?.freshness === 'stale') {
          return cached.data;
        }
        return live;
      } catch {
        if (cached?.freshness === 'stale') {
          return cached.data;
        }
        return null;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, request);
    return request;
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const globalContextCache = new ContextCache();

