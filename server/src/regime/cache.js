const DEFAULT_CONFIG = Object.freeze({
  freshTtlMs: 6 * 60 * 60 * 1000,
  staleTtlMs: 14 * 24 * 60 * 60 * 1000
});

export const REGIME_CACHE_CONFIGS = Object.freeze({
  inflation: Object.freeze({
    freshTtlMs: 6 * 60 * 60 * 1000,
    staleTtlMs: 45 * 24 * 60 * 60 * 1000
  }),
  moneyMarket: Object.freeze({
    freshTtlMs: 6 * 60 * 60 * 1000,
    staleTtlMs: 14 * 24 * 60 * 60 * 1000
  })
});

function requireNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Regime cache requires a valid Date');
  }
  return now.getTime();
}

function isUsableDomain(domain) {
  if (!domain || typeof domain !== 'object') return false;
  if (domain.status === 'available') return true;
  if (domain.status !== 'insufficient_history') return false;
  return Number.isFinite(domain.headlineCpiYoYPct) || Number.isFinite(domain.vndOvernightRatePct);
}

export class RegimeCache {
  constructor(configs = REGIME_CACHE_CONFIGS) {
    this.configs = { ...REGIME_CACHE_CONFIGS, ...configs };
    this.entries = new Map();
    this.inFlight = new Map();
  }

  get(key, now) {
    const nowMs = requireNow(now);
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (nowMs <= entry.freshUntilMs) {
      return { data: entry.data, freshness: 'fresh' };
    }
    if (nowMs <= entry.staleUntilMs) {
      return { data: entry.data, freshness: 'stale' };
    }

    this.entries.delete(key);
    return null;
  }

  set(key, data, now) {
    if (!isUsableDomain(data)) return;
    const nowMs = requireNow(now);
    const config = this.configs[key] || DEFAULT_CONFIG;
    this.entries.set(key, {
      data,
      freshUntilMs: nowMs + config.freshTtlMs,
      staleUntilMs: nowMs + config.staleTtlMs
    });
  }

  async fetchWithCache(key, fetchFn, { now }) {
    const cached = this.get(key, now);
    if (cached?.freshness === 'fresh') return cached.data;
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const request = (async () => {
      try {
        const live = await fetchFn();
        if (isUsableDomain(live)) {
          this.set(key, live, now);
          return live;
        }
        if (cached?.freshness === 'stale') {
          return this.asStale(cached.data);
        }
        return live;
      } catch {
        if (cached?.freshness === 'stale') {
          return this.asStale(cached.data);
        }
        return null;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, request);
    return request;
  }

  asStale(data) {
    return {
      ...data,
      status: 'stale',
      underlyingStatus: data.status,
      provenance: {
        ...(data.provenance || {}),
        cache: 'stale'
      }
    };
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const globalRegimeCache = new RegimeCache();
