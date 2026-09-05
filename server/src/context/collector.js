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
import { normalizeNsoMacroFacts } from './providers/nsoMacro.js';
import { normalizeSbvMonetaryFacts } from './providers/sbvMonetary.js';
import { isSourceDue, recordCheckpoint, SOURCE_KEYS } from './collectorCheckpoints.js';
import { privateSupabase } from '../supabase.js';

/**
 * Normalizes NSO inflation and macroeconomic data into standard MarketObservation instances.
 */
export function normalizeMacroObservations(inflationResult, now = new Date(), nsoMacroResult = null) {
  const observations = [];

  // Check if explicit nsoMacroResult was provided (either array of observations or parsed object)
  const officialObsList = Array.isArray(nsoMacroResult)
    ? nsoMacroResult
    : (nsoMacroResult && typeof nsoMacroResult === 'object' ? normalizeNsoMacroFacts(nsoMacroResult, now) : []);

  const officialByFact = new Map();
  for (const obs of officialObsList) {
    if (obs && obs.factId) officialByFact.set(obs.factId, obs);
  }

  // 1. vn.macro.cpi.yoy (Headline monthly CPI YoY)
  if (officialByFact.has('vn.macro.cpi.yoy') && officialByFact.get('vn.macro.cpi.yoy').status !== OBSERVATION_STATUS.UNAVAILABLE) {
    observations.push(officialByFact.get('vn.macro.cpi.yoy'));
  } else {
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
  }

  // 2. vn.macro.core_cpi.yoy (Monthly core CPI YoY)
  if (officialByFact.has('vn.macro.core_cpi.yoy')) {
    observations.push(officialByFact.get('vn.macro.core_cpi.yoy'));
  } else {
    observations.push(createUnavailableObservation('macro.core_cpi_yoy', PILLARS.MACRO, 'Lạm phát cơ bản (YoY)', 'MONTHLY_CORE_CPI_UNAVAILABLE', {
      factId: 'vn.macro.core_cpi.yoy',
      metric: 'Lạm phát cơ bản tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 3. vn.macro.gdp.real.quarter_yoy (Real GDP growth for individual quarter)
  if (officialByFact.has('vn.macro.gdp.real.quarter_yoy')) {
    observations.push(officialByFact.get('vn.macro.gdp.real.quarter_yoy'));
  } else {
    observations.push(createUnavailableObservation('macro.gdp_quarter_yoy', PILLARS.MACRO, 'Tăng trưởng GDP theo quý', 'QUARTERLY_GDP_UNAVAILABLE', {
      factId: 'vn.macro.gdp.real.quarter_yoy',
      metric: 'Tốc độ tăng trưởng GDP thực tế quý (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 4. vn.macro.iip.month_yoy (Monthly IIP YoY)
  if (officialByFact.has('vn.macro.iip.month_yoy')) {
    observations.push(officialByFact.get('vn.macro.iip.month_yoy'));
  } else {
    observations.push(createUnavailableObservation('macro.iip_month_yoy', PILLARS.MACRO, 'Chỉ số IIP (YoY)', 'MONTHLY_IIP_UNAVAILABLE', {
      factId: 'vn.macro.iip.month_yoy',
      metric: 'Chỉ số sản xuất công nghiệp IIP tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 5. vn.macro.retail.nominal.month_yoy (Monthly nominal retail revenue YoY)
  if (officialByFact.has('vn.macro.retail.nominal.month_yoy')) {
    observations.push(officialByFact.get('vn.macro.retail.nominal.month_yoy'));
  } else {
    observations.push(createUnavailableObservation('macro.retail_nominal_month_yoy', PILLARS.MACRO, 'Tổng mức bán lẻ tiêu dùng (YoY)', 'MONTHLY_RETAIL_UNAVAILABLE', {
      factId: 'vn.macro.retail.nominal.month_yoy',
      metric: 'Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 6. vn.macro.fdi.disbursed.ytd_usd (Cumulative disbursed FDI)
  if (officialByFact.has('vn.macro.fdi.disbursed.ytd_usd')) {
    observations.push(officialByFact.get('vn.macro.fdi.disbursed.ytd_usd'));
  } else {
    observations.push(createUnavailableObservation('macro.fdi_disbursed_ytd_usd', PILLARS.MACRO, 'Vốn FDI thực hiện lũy kế (YTD)', 'DISBURSED_FDI_UNAVAILABLE', {
      factId: 'vn.macro.fdi.disbursed.ytd_usd',
      metric: 'Vốn đầu tư trực tiếp nước ngoài giải ngân lũy kế YTD',
      source: 'NSO',
      unit: 'tỷ USD',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // Unprovisioned indicators (PMI)
  observations.push(createUnavailableObservation('macro.pmi', PILLARS.MACRO, 'Chỉ số PMI', 'SOURCE_NOT_PROVISIONED', {
    factId: 'vn.macro.pmi.headline',
    metric: 'Chỉ số nhà quản trị mua hàng PMI sản xuất',
    source: 'S&P Global'
  }));

  return observations;
}

/**
 * Normalizes SBV money market data, USD/VND reference rate, and official SBV monetary observations.
 */
export function normalizeMonetaryObservations(sbvResult, usdVndResult, now = new Date(), sbvOfficialResult = null) {
  const observations = [];

  // 1. SBV Overnight Rate (weekly - preserved existing identity)
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
      observedAt: null,
      publishedAt: null,
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

  // 3. Official SBV Facts (Central FX, Daily Overnight, Credit Growth, M2, and Blocked Policy Rates)
  const sbvOfficialList = Array.isArray(sbvOfficialResult)
    ? sbvOfficialResult
    : (sbvOfficialResult && typeof sbvOfficialResult === 'object' ? normalizeSbvMonetaryFacts(sbvOfficialResult) : []);

  const sbvByFact = new Map();
  for (const obs of sbvOfficialList) {
    if (obs && obs.factId) sbvByFact.set(obs.factId, obs);
  }

  // 7. vn.monetary.fx.sbv_central.usd_vnd (SBV Central FX)
  if (sbvByFact.has('vn.monetary.fx.sbv_central.usd_vnd')) {
    observations.push(sbvByFact.get('vn.monetary.fx.sbv_central.usd_vnd'));
  } else {
    observations.push(createUnavailableObservation('monetary.sbv_central_usd_vnd', PILLARS.MONETARY, 'Tỷ giá trung tâm SBV (USD/VND)', 'SBV_CENTRAL_FX_UNAVAILABLE', {
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      metric: 'Tỷ giá trung tâm của Đồng Việt Nam với Đô la Mỹ do NHNN công bố',
      source: 'SBV',
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 8. vn.monetary.interbank.vnd.overnight.daily_avg_rate (Daily Overnight Rate)
  if (sbvByFact.has('vn.monetary.interbank.vnd.overnight.daily_avg_rate')) {
    observations.push(sbvByFact.get('vn.monetary.interbank.vnd.overnight.daily_avg_rate'));
  } else {
    observations.push(createUnavailableObservation('monetary.vnd_overnight_daily_avg_rate', PILLARS.MONETARY, 'Lãi suất VND qua đêm bình quân ngày', 'SBV_DAILY_OVERNIGHT_UNAVAILABLE', {
      factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
      metric: 'Lãi suất bình quân liên ngân hàng kỳ hạn qua đêm theo ngày (SBV)',
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 9. vn.monetary.credit.outstanding.ytd_growth (Credit Growth YTD)
  if (sbvByFact.has('vn.monetary.credit.outstanding.ytd_growth')) {
    observations.push(sbvByFact.get('vn.monetary.credit.outstanding.ytd_growth'));
  } else {
    observations.push(createUnavailableObservation('monetary.credit_ytd_growth', PILLARS.MONETARY, 'Tăng trưởng tín dụng YTD', 'SBV_CREDIT_GROWTH_UNAVAILABLE', {
      factId: 'vn.monetary.credit.outstanding.ytd_growth',
      metric: 'Tốc độ tăng trưởng dư nợ tín dụng toàn hệ thống so với cuối năm trước',
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 10. vn.monetary.money_supply.m2.level (M2 Money Supply Level)
  if (sbvByFact.has('vn.monetary.money_supply.m2.level')) {
    observations.push(sbvByFact.get('vn.monetary.money_supply.m2.level'));
  } else {
    observations.push(createUnavailableObservation('monetary.m2_level', PILLARS.MONETARY, 'Cung tiền M2', 'SBV_M2_UNAVAILABLE', {
      factId: 'vn.monetary.money_supply.m2.level',
      metric: 'Tổng phương tiện thanh toán M2 (NHNN)',
      source: 'SBV',
      unit: 'tỷ VND',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // Blocked Policy Rates (refinancing & rediscount)
  const policyRates = [
    {
      id: 'monetary.refinancing_rate',
      factId: 'vn.monetary.policy.refinancing_rate',
      label: 'Lãi suất tái cấp vốn'
    },
    {
      id: 'monetary.rediscount_rate',
      factId: 'vn.monetary.policy.rediscount_rate',
      label: 'Lãi suất tái chiết khấu'
    }
  ];

  for (const item of policyRates) {
    observations.push(createUnavailableObservation(item.id, PILLARS.MONETARY, item.label, 'NOT_IMPLEMENTED_PENDING_EFFECTIVE_DATE_CHAIN', {
      factId: item.factId,
      metric: item.label,
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
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
export function mergeWithLastKnownGood(currentObservations, lastKnownGoodObservations = [], now = new Date(), pillar = null) {
  const currList = Array.isArray(currentObservations) ? currentObservations : [];
  let lkgList = Array.isArray(lastKnownGoodObservations) ? lastKnownGoodObservations : [];

  // Scoped isolation: If pillar is specified, isolate LKG strictly to that pillar.
  // A macro failure must never import market, monetary, or intermarket facts.
  if (pillar) {
    lkgList = lkgList.filter((obs) => obs && obs.pillar === pillar);
  }

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
  fetchUsdVndFn = fetchUsdVndObservation,
  fetchNsoMacroFn = null,
  fetchSbvOfficialFn = null,
  forceRefresh = false
} = {}) {
  // 1. Check due gating for slow-moving official sources
  const [macroDue, sbvDue] = await Promise.all([
    forceRefresh ? Promise.resolve(true) : isSourceDue(SOURCE_KEYS.NSO_MONTHLY, { now, client }),
    forceRefresh ? Promise.resolve(true) : isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now, client })
  ]);

  // 2. Fetch persisted last-known-good observations for merge
  const lastKnownGood = await fetchLatestPersistedObservations(client, now);

  // 3. Fetch live data across pillars concurrently with fault isolation
  const [macroRes, sbvRes, sbvOfficialRes, usdVndRes, marketRes, intermarketRes] = await Promise.allSettled([
    macroDue
      ? (fetchNsoMacroFn ? fetchNsoMacroFn({ now, fetchFn }) : fetchNsoInflationFn({ now }))
      : Promise.resolve(null),
    sbvDue
      ? fetchSbvMoneyMarketFn({ now })
      : Promise.resolve(null),
    sbvDue && fetchSbvOfficialFn
      ? fetchSbvOfficialFn({ now, fetchFn })
      : Promise.resolve(null),
    fetchUsdVndFn({ now, fetchFn }),
    fetchMarketPillarFn({ now, fetchFn }),
    fetchGlobalPillarFn({ now, fetchFn })
  ]);

  // Record checkpoints if due sources ran
  if (macroDue) {
    if (macroRes.status === 'fulfilled' && macroRes.value) {
      await recordCheckpoint(SOURCE_KEYS.NSO_MONTHLY, { status: 'success', client, now });
    } else if (macroRes.status === 'rejected') {
      await recordCheckpoint(SOURCE_KEYS.NSO_MONTHLY, { status: 'failed', client, now, metadata: { error: String(macroRes.reason) } });
    }
  }

  if (sbvDue) {
    if ((sbvRes.status === 'fulfilled' && sbvRes.value) || (sbvOfficialRes.status === 'fulfilled' && sbvOfficialRes.value)) {
      await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, { status: 'success', client, now });
    } else if (sbvRes.status === 'rejected') {
      await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, { status: 'failed', client, now, metadata: { error: String(sbvRes.reason) } });
    }
  }

  // When macro is not due, omit newly fetched macro so LKG retains all persisted macro facts
  const rawMacro = macroDue
    ? (macroRes.status === 'fulfilled'
        ? normalizeMacroObservations(
            fetchNsoMacroFn ? null : macroRes.value,
            now,
            fetchNsoMacroFn ? macroRes.value : null
          )
        : normalizeMacroObservations(null, now))
    : [];

  const rawMonetary = sbvDue
    ? normalizeMonetaryObservations(
        sbvRes.status === 'fulfilled' ? sbvRes.value : null,
        usdVndRes.status === 'fulfilled' ? usdVndRes.value : null,
        now,
        sbvOfficialRes.status === 'fulfilled' ? sbvOfficialRes.value : null
      )
    : (usdVndRes.status === 'fulfilled' && usdVndRes.value ? [usdVndRes.value] : []);

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

  // 5. Merge raw observations with persisted last-known-good with strict pillar isolation
  const mergedMacro = mergeWithLastKnownGood(rawMacro, lastKnownGood, now, PILLARS.MACRO);
  const mergedMonetary = mergeWithLastKnownGood(rawMonetary, lastKnownGood, now, PILLARS.MONETARY);
  const mergedMarket = mergeWithLastKnownGood(rawMarket, lastKnownGood, now, PILLARS.MARKET);
  const mergedIntermarket = mergeWithLastKnownGood(rawIntermarket, lastKnownGood, now, PILLARS.INTERMARKET);

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
