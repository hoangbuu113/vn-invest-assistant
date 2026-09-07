import { unavailableInflation } from './regime/providers/nso.js';
import { unavailableMoneyMarket } from './regime/providers/sbv.js';
import { getMarketContextFabric } from './context/fabric.js';

export const MARKET_BREADTH_UNAVAILABLE = Object.freeze({
  status: 'unavailable',
  reason: 'SOURCE_NOT_PROVISIONED',
  provenance: null
});

function requireNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Vietnam regime calculation requires a valid Date');
  }
  return now;
}

export function isUsableRegimeDomain(domain) {
  if (!domain || typeof domain !== 'object') return false;
  if (!['available', 'insufficient_history', 'stale'].includes(domain.status)) return false;
  return Number.isFinite(domain.headlineCpiYoYPct) || Number.isFinite(domain.vndOvernightRatePct);
}

export function buildVietnamRegime({ moneyMarket, inflation, now, fabric = null }) {
  requireNow(now);
  const safeMoneyMarket = moneyMarket || unavailableMoneyMarket();
  const safeInflation = inflation || unavailableInflation();
  const marketBreadth = { ...MARKET_BREADTH_UNAVAILABLE };
  const domains = [safeMoneyMarket, safeInflation, marketBreadth];
  const usableDomainCount = domains.filter(isUsableRegimeDomain).length;

  const defaultPillars = {
    macro: [],
    monetary: [],
    market: [],
    intermarket: []
  };

  const pillars = (fabric && fabric.pillars) ? fabric.pillars : defaultPillars;
  const pulseMetrics = (fabric && Array.isArray(fabric.pulseMetrics)) ? fabric.pulseMetrics : [];
  const facts = (fabric && Array.isArray(fabric.facts)) ? fabric.facts : [];

  const isUsable = usableDomainCount > 0 || pulseMetrics.length > 0;

  return {
    status: isUsable ? 'ok' : 'unavailable',
    partial: domains.some((domain) => domain.status !== 'available'),
    fetchedAt: now.toISOString(),
    moneyMarket: safeMoneyMarket,
    inflation: safeInflation,
    marketBreadth,
    pillars,
    pulseMetrics,
    facts
  };
}

export function mapFabricToLegacyInflation(macroObs) {
  if (!macroObs || macroObs.value === null || macroObs.status === 'unavailable') {
    return unavailableInflation();
  }
  return {
    status: macroObs.status === 'stale' ? 'stale' : 'available',
    headlineCpiYoYPct: macroObs.value,
    threeMonthDeltaPp: macroObs.change,
    referencePeriod: macroObs.referenceTime,
    publishedAt: macroObs.publishedAt,
    provenance: macroObs.provenance || { source: macroObs.source }
  };
}

export function mapFabricToLegacyMoneyMarket(monetaryObs) {
  if (!monetaryObs || monetaryObs.value === null || monetaryObs.status === 'unavailable') {
    return unavailableMoneyMarket(
      monetaryObs?.statusReason || monetaryObs?.provenance?.reason || 'OFFICIAL_DATA_UNAVAILABLE'
    );
  }
  return {
    status: monetaryObs.status === 'stale' ? 'stale' : 'available',
    underlyingStatus: 'available',
    vndOvernightRatePct: monetaryObs.value,
    trendPp: monetaryObs.change,
    referenceWeekStart: monetaryObs.referenceTime,
    referenceWeekEnd: null,
    provenance: monetaryObs.provenance || { source: monetaryObs.source }
  };
}

export async function getVietnamRegime({
  now = new Date(),
  getFabricFn = getMarketContextFabric,
  client = undefined,
  fetchFn = fetch
} = {}) {
  requireNow(now);

  let fabric = null;
  if (typeof getFabricFn === 'function') {
    fabric = await getFabricFn({ now, client, fetchFn }).catch(() => null);
  }

  let inflation = unavailableInflation();
  let moneyMarket = unavailableMoneyMarket();

  if (fabric && Array.isArray(fabric.facts) && fabric.facts.length > 0) {
    const cpiFact = fabric.facts.find((f) => f.factId === 'vn.macro.cpi.yoy' || f.id === 'macro.cpi_yoy');
    const onFact = fabric.facts.find((f) => f.factId === 'vn.monetary.rate.vnd_overnight' || f.id === 'monetary.vnd_overnight_rate');
    inflation = mapFabricToLegacyInflation(cpiFact);
    moneyMarket = mapFabricToLegacyMoneyMarket(onFact);
  }

  return buildVietnamRegime({ moneyMarket, inflation, now, fabric });
}
