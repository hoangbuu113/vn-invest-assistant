import {
  createMarketObservation,
  createUnavailableObservation,
  buildObservationId,
  PILLARS,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES
} from './factModel.js';
import { applyRuntimeFreshness } from './freshnessPolicy.js';
import { globalContextCache } from './cache.js';
import {
  fetchLatestPersistedObservations,
  persistMarketObservations
} from './repository.js';
import { fetchNsoInflation } from '../regime/providers/nso.js';
import { fetchSbvMoneyMarket } from '../regime/providers/sbv.js';
import { fetchVietnamMarketPillar } from './providers/vndirectMarket.js';
import { fetchGlobalMarketPillar, fetchUsdVndObservation } from './providers/globalMarket.js';
import { privateSupabase } from '../supabase.js';

/**
 * Normalizes NSO inflation data into standard MarketObservation instances.
 */
export function normalizeMacroObservations(inflationResult, now = new Date()) {
  const observations = [];
  const usable = inflationResult && (inflationResult.status === 'available' || inflationResult.status === 'stale');
  const yoy = typeof inflationResult?.headlineCpiYoYPct === 'number' && Number.isFinite(inflationResult.headlineCpiYoYPct)
    ? inflationResult.headlineCpiYoYPct
    : null;
  const delta = typeof inflationResult?.threeMonthDeltaPp === 'number' && Number.isFinite(inflationResult.threeMonthDeltaPp)
    ? inflationResult.threeMonthDeltaPp
    : null;

  const factId = 'vn.macro.cpi.yoy';
  const refPeriod = inflationResult?.referencePeriod || null;
  const publishedAt = inflationResult?.publishedAt || null;

  if (usable && yoy !== null) {
    observations.push(createMarketObservation({
      id: 'macro.cpi_yoy',
      factId,
      observationId: buildObservationId({
        factId,
        referenceTime: refPeriod,
        publishedAt,
        methodologyVersion: 'v1.2'
      }),
      pillar: PILLARS.MACRO,
      label: 'Lạm phát CPI (YoY)',
      metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
      value: yoy,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      change: delta,
      changeUnit: 'điểm %',
      changeUnitType: UNIT_TYPES.PERCENTAGE_POINT,
      changeBasis: 'THREE_MONTH_CHANGE',
      referenceTime: refPeriod,
      observedAt: null,
      publishedAt,
      fetchedAt: now.toISOString(),
      source: inflationResult.provenance?.source || 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: {
        source: 'Tổng cục Thống kê / Cơ quan Thống kê Quốc gia (NSO)',
        releaseUrl: inflationResult.provenance?.releaseUrl || null,
        method: inflationResult.provenance?.method || null,
        ...(inflationResult.status === 'stale' ? { cache: 'stale' } : {})
      },
      freshness: inflationResult.status === 'stale' ? OBSERVATION_FRESHNESS.STALE : OBSERVATION_FRESHNESS.FRESH,
      status: inflationResult.status === 'stale' ? OBSERVATION_STATUS.STALE : OBSERVATION_STATUS.AVAILABLE
    }));
  } else {
    observations.push(createUnavailableObservation('macro.cpi_yoy', PILLARS.MACRO, 'Lạm phát CPI (YoY)', 'OFFICIAL_DATA_UNAVAILABLE', {
      factId,
      metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // Defensible non-fabricated unprovisioned indicators
  const unprovisionedMacro = [
    {
      id: 'macro.gdp_growth',
      factId: 'vn.macro.gdp.growth_rate',
      label: 'Tăng trưởng GDP',
      metric: 'Tốc độ tăng trưởng GDP (so với cùng kỳ)'
    },
    {
      id: 'macro.pmi',
      factId: 'vn.macro.pmi.headline',
      label: 'Chỉ số PMI',
      metric: 'Chỉ số nhà quản trị mua hàng PMI sản xuất'
    }
  ];

  for (const item of unprovisionedMacro) {
    observations.push(createUnavailableObservation(item.id, PILLARS.MACRO, item.label, 'SOURCE_NOT_PROVISIONED', {
      factId: item.factId,
      metric: item.metric,
      source: 'NSO/S&P Global'
    }));
  }

  return observations;
}

/**
 * Normalizes SBV money market data and USD/VND reference rate.
 */
export function normalizeMonetaryObservations(sbvResult, usdVndResult, now = new Date()) {
  const observations = [];

  // 1. SBV Overnight Rate
  const onRateUsable = sbvResult && (sbvResult.status === 'available' || sbvResult.status === 'stale');
  const onRate = typeof sbvResult?.vndOvernightRatePct === 'number' && Number.isFinite(sbvResult.vndOvernightRatePct)
    ? sbvResult.vndOvernightRatePct
    : null;
  const onTrend = typeof sbvResult?.trendPp === 'number' && Number.isFinite(sbvResult.trendPp)
    ? sbvResult.trendPp
    : null;

  const onFactId = 'vn.monetary.rate.vnd_overnight';
  const onRef = sbvResult?.referenceWeekStart || null;

  if (onRateUsable && onRate !== null) {
    observations.push(createMarketObservation({
      id: 'monetary.vnd_overnight_rate',
      factId: onFactId,
      observationId: buildObservationId({
        factId: onFactId,
        referenceTime: onRef,
        publishedAt: null,
        methodologyVersion: 'v1.2'
      }),
      pillar: PILLARS.MONETARY,
      label: 'Lãi suất VND qua đêm',
      metric: 'Lãi suất bình quân liên ngân hàng kỳ hạn qua đêm (SBV)',
      value: onRate,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      change: onTrend,
      changeUnit: 'điểm %',
      changeUnitType: UNIT_TYPES.PERCENTAGE_POINT,
      changeBasis: 'FOUR_WEEK_TREND',
      referenceTime: onRef,
      observedAt: onRef ? `${onRef}T00:00:00.000Z` : null,
      fetchedAt: now.toISOString(),
      source: sbvResult.provenance?.source || 'SBV',
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL,
      provenance: {
        source: 'Ngân hàng Nhà nước Việt Nam (SBV)',
        releaseUrl: sbvResult.provenance?.releaseUrl || null
      },
      freshness: sbvResult.status === 'stale' ? OBSERVATION_FRESHNESS.STALE : OBSERVATION_FRESHNESS.FRESH,
      status: sbvResult.status === 'stale' ? OBSERVATION_STATUS.STALE : OBSERVATION_STATUS.AVAILABLE
    }));
  } else {
    observations.push(createUnavailableObservation('monetary.vnd_overnight_rate', PILLARS.MONETARY, 'Lãi suất VND qua đêm', 'OFFICIAL_DATA_UNAVAILABLE', {
      factId: onFactId,
      metric: 'Lãi suất bình quân liên ngân hàng kỳ hạn qua đêm (SBV)',
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 2. USD/VND reference rate
  if (usdVndResult) {
    observations.push(usdVndResult);
  } else {
    observations.push(createUnavailableObservation('monetary.usd_vnd', PILLARS.MONETARY, 'Tỷ giá USD/VND', 'PROVIDER_UNAVAILABLE', {
      factId: 'vn.monetary.fx.usd_vnd',
      metric: 'Tỷ giá giao ngay USD/VND',
      source: 'Twelve Data / Yahoo Reference',
      unit: 'VND',
      unitType: UNIT_TYPES.CURRENCY_RATIO
    }));
  }

  // 3. Unprovisioned monetary indicators
  const unprovisionedMonetary = [
    {
      id: 'monetary.sbv_ref_rate',
      factId: 'vn.monetary.rate.sbv_ref_rate',
      label: 'Tỷ giá trung tâm SBV',
      metric: 'Tỷ giá trung tâm USD/VND do NHNN công bố'
    },
    {
      id: 'monetary.refinancing_rate',
      factId: 'vn.monetary.rate.refinancing',
      label: 'Lãi suất tái cấp vốn',
      metric: 'Lãi suất tái cấp vốn của NHNN'
    }
  ];

  for (const item of unprovisionedMonetary) {
    observations.push(createUnavailableObservation(item.id, PILLARS.MONETARY, item.label, 'SOURCE_NOT_PROVISIONED', {
      factId: item.factId,
      metric: item.metric,
      source: 'SBV'
    }));
  }

  return observations;
}

/**
 * Merges newly acquired observations with persisted last-known-good observations.
 * Union semantics:
 * 1. Current valid observations are used with runtime freshness.
 * 2. Missing/failed observations are substituted with persisted LKG.
 * 3. Entirely omitted provider facts in current batch are preserved from LKG.
 * 4. Runtime freshness is evaluated dynamically without mutating immutable LKG provenance.
 */
export function mergeWithLastKnownGood(currentObservations, lastKnownGoodObservations = [], now = new Date()) {
  const currList = Array.isArray(currentObservations) ? currentObservations : [];
  const lkgList = Array.isArray(lastKnownGoodObservations) ? lastKnownGoodObservations : [];

  const lkgMap = new Map();
  for (const obs of lkgList) {
    if (obs && obs.factId && obs.value !== null && Number.isFinite(obs.value)) {
      lkgMap.set(obs.factId, obs);
    }
  }

  const seenFactIds = new Set();
  const result = [];

  for (const obs of currList) {
    if (!obs || !obs.factId) continue;
    seenFactIds.add(obs.factId);

    // If current observation is valid and available, use it directly with runtime freshness
    if (obs.status !== OBSERVATION_STATUS.UNAVAILABLE && obs.value !== null && Number.isFinite(obs.value)) {
      result.push(applyRuntimeFreshness(obs, now));
      continue;
    }

    // Explicit domain unprovisioned facts remain unavailable
    if (obs.statusReason === 'SOURCE_NOT_PROVISIONED') {
      result.push(obs);
      continue;
    }

    // Check for last-known-good observation in persistence
    const lkg = lkgMap.get(obs.factId);
    if (lkg) {
      // Preserve immutable LKG record without mutating its provenance
      result.push(applyRuntimeFreshness(lkg, now));
    } else {
      result.push(obs);
    }
  }

  // Union: If an entire provider rejects/fails (returning []), retain ALL persisted LKG facts for that domain
  for (const [factId, lkg] of lkgMap.entries()) {
    if (!seenFactIds.has(factId)) {
      result.push(applyRuntimeFreshness(lkg, now));
    }
  }

  return result;
}

/**
 * Background Collector: Fetches live third-party sources, merges with last-known-good,
 * persists to durable storage, and updates memory cache.
 * Truthfully reports: fetched, validated, durablyPersisted, memoryAccepted, failedPersistence.
 */
export async function runMarketContextCollector({
  now = new Date(),
  client = privateSupabase,
  fetchFn = fetch,
  fetchNsoInflationFn = fetchNsoInflation,
  fetchSbvMoneyMarketFn = fetchSbvMoneyMarket,
  fetchMarketPillarFn = fetchVietnamMarketPillar,
  fetchGlobalPillarFn = fetchGlobalMarketPillar,
  fetchUsdVndFn = fetchUsdVndObservation
} = {}) {
  // 1. Fetch persisted last-known-good observations for merge
  const lastKnownGood = await fetchLatestPersistedObservations(client, now);

  // 2. Fetch live data across pillars concurrently with fault isolation
  const [macroRes, sbvRes, usdVndRes, marketRes, intermarketRes] = await Promise.allSettled([
    fetchNsoInflationFn({ now }),
    fetchSbvMoneyMarketFn({ now }),
    fetchUsdVndFn({ now, fetchFn }),
    fetchMarketPillarFn({ now, fetchFn }),
    fetchGlobalPillarFn({ now, fetchFn })
  ]);

  const rawMacro = macroRes.status === 'fulfilled'
    ? normalizeMacroObservations(macroRes.value, now)
    : normalizeMacroObservations(null, now);

  const rawMonetary = normalizeMonetaryObservations(
    sbvRes.status === 'fulfilled' ? sbvRes.value : null,
    usdVndRes.status === 'fulfilled' ? usdVndRes.value : null,
    now
  );

  const rawMarket = marketRes.status === 'fulfilled' && Array.isArray(marketRes.value)
    ? marketRes.value
    : [];

  const rawIntermarket = intermarketRes.status === 'fulfilled' && Array.isArray(intermarketRes.value)
    ? intermarketRes.value
    : [];

  // 3. Identify newly fetched valid finite observations to persist to durable DB
  // (Do NOT re-upsert LKG rows solely because freshness changed)
  const newlyFetchedRaw = [
    ...rawMacro,
    ...rawMonetary,
    ...rawMarket,
    ...rawIntermarket
  ];

  const validToPersist = newlyFetchedRaw.filter(
    (o) => o && typeof o.value === 'number' && Number.isFinite(o.value) && o.status !== OBSERVATION_STATUS.UNAVAILABLE
  );

  // 4. Persist newly fetched observations to DB with visible failure reporting
  const persistResult = await persistMarketObservations(validToPersist, client);

  // 5. Merge raw observations with persisted last-known-good for cache and response
  const mergedMacro = mergeWithLastKnownGood(rawMacro, lastKnownGood, now);
  const mergedMonetary = mergeWithLastKnownGood(rawMonetary, lastKnownGood, now);
  const mergedMarket = mergeWithLastKnownGood(rawMarket, lastKnownGood, now);
  const mergedIntermarket = mergeWithLastKnownGood(rawIntermarket, lastKnownGood, now);

  const allObservations = [
    ...mergedMacro,
    ...mergedMonetary,
    ...mergedMarket,
    ...mergedIntermarket
  ];

  // 6. Update in-memory cache with merged facts
  globalContextCache.set('macro', mergedMacro, now);
  globalContextCache.set('monetary', mergedMonetary, now);
  globalContextCache.set('market', mergedMarket, now);
  globalContextCache.set('intermarket', mergedIntermarket, now);

  const durablyPersistedCount = persistResult.durablyPersisted || 0;
  const memoryAcceptedCount = persistResult.memoryAccepted || 0;
  const failedPersistenceCount = persistResult.failedPersistence || 0;
  const isDurable = Boolean(persistResult.isDurable);

  return {
    success: isDurable,
    isDurable,
    fetched: allObservations.length,
    validated: validToPersist.length,
    durablyPersisted: durablyPersistedCount,
    memoryAccepted: memoryAcceptedCount,
    persisted: durablyPersistedCount,
    totalPersisted: durablyPersistedCount,
    failedPersistence: failedPersistenceCount,
    persistenceError: persistResult.error || null,
    timestamp: now.toISOString()
  };
}
