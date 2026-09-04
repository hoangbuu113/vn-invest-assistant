import { OBSERVATION_STATUS, PILLARS } from './factModel.js';
import { globalContextCache } from './cache.js';
import { fetchLatestPersistedObservations } from './repository.js';
import { runMarketContextCollector } from './collector.js';
import { privateSupabase } from '../supabase.js';

export function groupObservationsByPillar(observations) {
  const pillars = {
    macro: [],
    monetary: [],
    market: [],
    intermarket: []
  };

  if (!Array.isArray(observations)) return pillars;

  for (const obs of observations) {
    if (obs && pillars[obs.pillar]) {
      pillars[obs.pillar].push(obs);
    }
  }

  return pillars;
}

/**
 * Dynamically selects high-priority verified available metrics for Market Pulse strip.
 */
export function buildPulseMetrics(pillars) {
  const allFacts = [
    ...(pillars.market || []),
    ...(pillars.monetary || []),
    ...(pillars.macro || []),
    ...(pillars.intermarket || [])
  ];

  // Preferred priority ranking (matches both stable factId and short id)
  const priorityOrder = [
    'vn.market.vnindex.close',
    'market.vnindex',
    'vn.monetary.fx.usd_vnd',
    'monetary.usd_vnd',
    'vn.macro.cpi.yoy',
    'macro.cpi_yoy',
    'vn.monetary.rate.vnd_overnight',
    'monetary.vnd_overnight_rate',
    'global.intermarket.dxy.quote',
    'intermarket.dxy',
    'global.intermarket.brent.futures',
    'intermarket.brent',
    'global.intermarket.gold_spot.price',
    'intermarket.gold_spot',
    'vn.market.vn30.close',
    'market.vn30',
    'global.intermarket.us10y.yield',
    'intermarket.us10y'
  ];

  const availableMap = new Map();
  for (const fact of allFacts) {
    if ((fact.status === OBSERVATION_STATUS.AVAILABLE || fact.status === OBSERVATION_STATUS.STALE) &&
        typeof fact.value === 'number' && Number.isFinite(fact.value)) {
      availableMap.set(fact.factId || fact.id, fact);
      availableMap.set(fact.id, fact);
    }
  }

  const pulse = [];
  const addedIds = new Set();

  for (const id of priorityOrder) {
    if (availableMap.has(id)) {
      const fact = availableMap.get(id);
      const uniqueKey = fact.factId || fact.id;
      if (!addedIds.has(uniqueKey)) {
        pulse.push(fact);
        addedIds.add(uniqueKey);
        if (pulse.length >= 4) break;
      }
    }
  }

  return pulse;
}

/**
 * Fast public reader for Market Context Fabric.
 * Invariant: Reads strictly from in-memory cache and durable persistence.
 * NEVER calls live third-party scraping or background collector on browser request paths!
 */
export async function getMarketContextFabric(clientOrOptions = {}, options = {}) {
  let client;
  let now;
  let cache;

  if (clientOrOptions && (typeof clientOrOptions.from === 'function' || clientOrOptions === null)) {
    client = clientOrOptions;
    now = options.now || new Date();
    cache = options.cache || globalContextCache;
  } else {
    client = clientOrOptions?.client !== undefined ? clientOrOptions.client : privateSupabase;
    now = clientOrOptions?.now || new Date();
    cache = clientOrOptions?.cache || globalContextCache;
  }

  // 1. Try in-memory cache
  const macroCached = cache.get('macro', now);
  const monetaryCached = cache.get('monetary', now);
  const marketCached = cache.get('market', now);
  const intermarketCached = cache.get('intermarket', now);

  const hasMemoryCache = macroCached && monetaryCached && marketCached && intermarketCached;

  if (hasMemoryCache) {
    const pillars = {
      macro: macroCached.data || [],
      monetary: monetaryCached.data || [],
      market: marketCached.data || [],
      intermarket: intermarketCached.data || []
    };
    const pulseMetrics = buildPulseMetrics(pillars);
    const facts = [
      ...pillars.macro,
      ...pillars.monetary,
      ...pillars.market,
      ...pillars.intermarket
    ];
    return { pillars, pulseMetrics, facts, source: 'memory_cache' };
  }

  // 2. Read from durable storage (database / fallback store) with dynamic runtime freshness
  const persisted = await fetchLatestPersistedObservations(client, now);

  if (Array.isArray(persisted) && persisted.length > 0) {
    const pillars = groupObservationsByPillar(persisted);

    // Warm in-memory cache with persisted facts
    if (pillars.macro.length > 0) cache.set('macro', pillars.macro, now);
    if (pillars.monetary.length > 0) cache.set('monetary', pillars.monetary, now);
    if (pillars.market.length > 0) cache.set('market', pillars.market, now);
    if (pillars.intermarket.length > 0) cache.set('intermarket', pillars.intermarket, now);

    const pulseMetrics = buildPulseMetrics(pillars);
    const facts = [
      ...pillars.macro,
      ...pillars.monetary,
      ...pillars.market,
      ...pillars.intermarket
    ];
    return { pillars, pulseMetrics, facts, source: 'durable_persistence' };
  }

  // 3. Storage is empty: strictly return truthful empty/unavailable state without triggering collection
  const emptyPillars = { macro: [], monetary: [], market: [], intermarket: [] };
  return {
    pillars: emptyPillars,
    pulseMetrics: [],
    facts: [],
    source: 'empty'
  };
}
