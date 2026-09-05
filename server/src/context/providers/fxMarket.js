import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES
} from '../factModel.js';
import { getTwelveDataFxRate } from '../../providers/twelvedata.js';
import { fetchYahooIndicator } from './globalMarket.js';

export async function fetchUsdVndObservation({ now = new Date(), fetchFn = fetch, apiKey = process.env.TWELVE_DATA_API_KEY } = {}) {
  const factId = 'vn.monetary.fx.usd_vnd';
  const id = 'monetary.usd_vnd';
  const label = 'Tỷ giá USD/VND';
  const metric = 'Tỷ giá giao dịch USD/VND giao ngay';

  // 1. Primary: Twelve Data direct market FX
  try {
    const fx = await getTwelveDataFxRate('USD', 'VND', { apiKey, fetchFn });
    const isAvailable = fx && (fx.availability === 'available' || fx.status === 'available');
    if (isAvailable && typeof fx.rate === 'number' && Number.isFinite(fx.rate) && fx.rate > 0) {
      const roundedRate = Math.round(fx.rate);
      const observedAt = typeof fx.asOf === 'string' && fx.asOf.trim() ? fx.asOf.trim() : null;
      const refTime = observedAt ? observedAt.slice(0, 10) : null;
      return createMarketObservation({
        id,
        factId,
        pillar: PILLARS.MONETARY,
        label,
        metric,
        value: roundedRate,
        unit: 'VND',
        unitType: UNIT_TYPES.CURRENCY_RATIO,
        quoteDirection: 'VND_PER_USD',
        referenceTime: refTime,
        observedAt,
        publishedAt: null,
        fetchedAt: now.toISOString(),
        source: 'Twelve Data',
        authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT,
        provenance: {
          provider: 'twelvedata',
          asOf: fx.asOf,
          rate: fx.rate,
          note: 'Tỷ giá giao ngay thị trường tự do/ngân hàng (VND đổi 1 USD), không phải tỷ giá trung tâm SBV'
        },
        freshness: OBSERVATION_FRESHNESS.FRESH
      });
    }
  } catch {
    // Fall back to Yahoo Finance
  }

  // 2. Fallback: Yahoo Finance VND=X
  try {
    const yahooDef = {
      factId,
      id,
      symbol: 'VND=X',
      label,
      metric,
      unit: 'VND',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      quoteDirection: 'VND_PER_USD',
      decimals: 0,
      source: 'Yahoo Finance (Forex Reference)'
    };
    const yahooObs = await fetchYahooIndicator(yahooDef, { now, fetchFn });
    if (yahooObs.status === 'available' && typeof yahooObs.value === 'number' && yahooObs.value > 0) {
      return createMarketObservation({
        ...yahooObs,
        pillar: PILLARS.MONETARY,
        source: 'Yahoo Finance (dự phòng)',
        authorityLevel: AUTHORITY_LEVELS.MARKET_REFERENCE,
        provenance: {
          ...yahooObs.provenance,
          fallbackReason: 'Twelve Data rate-limited or unconfigured'
        }
      });
    }
  } catch {
    // Both failed
  }

  return createUnavailableObservation(id, PILLARS.MONETARY, label, 'RATE_UNAVAILABLE', {
    factId,
    metric,
    unit: 'VND',
    unitType: UNIT_TYPES.CURRENCY_RATIO,
    source: 'Twelve Data / Yahoo Finance'
  });
}
