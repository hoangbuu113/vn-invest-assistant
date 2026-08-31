import { globalRegimeCache } from './regime/cache.js';
import { fetchNsoInflation, unavailableInflation } from './regime/providers/nso.js';
import { fetchSbvMoneyMarket, unavailableMoneyMarket } from './regime/providers/sbv.js';

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

export function buildVietnamRegime({ moneyMarket, inflation, now }) {
  requireNow(now);
  const safeMoneyMarket = moneyMarket || unavailableMoneyMarket();
  const safeInflation = inflation || unavailableInflation();
  const marketBreadth = { ...MARKET_BREADTH_UNAVAILABLE };
  const domains = [safeMoneyMarket, safeInflation, marketBreadth];
  const usableDomainCount = domains.filter(isUsableRegimeDomain).length;

  return {
    status: usableDomainCount > 0 ? 'ok' : 'unavailable',
    partial: domains.some((domain) => domain.status !== 'available'),
    fetchedAt: now.toISOString(),
    moneyMarket: safeMoneyMarket,
    inflation: safeInflation,
    marketBreadth
  };
}

export async function getVietnamRegime({
  now = new Date(),
  cache = globalRegimeCache,
  fetchNsoInflationFn = fetchNsoInflation,
  fetchSbvMoneyMarketFn = fetchSbvMoneyMarket
} = {}) {
  requireNow(now);
  const [moneyMarket, inflation] = await Promise.all([
    cache.fetchWithCache('moneyMarket', fetchSbvMoneyMarketFn, { now }),
    cache.fetchWithCache('inflation', fetchNsoInflationFn, { now })
  ]);
  return buildVietnamRegime({ moneyMarket, inflation, now });
}
