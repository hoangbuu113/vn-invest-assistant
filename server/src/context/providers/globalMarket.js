import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES
} from '../factModel.js';
import { getSnapshot as fetchAlphaVantageGoldSpot } from '../../providers/alphavantage.js';

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const GLOBAL_INDICATORS = Object.freeze([
  {
    factId: 'global.intermarket.dxy.quote',
    id: 'intermarket.dxy',
    symbol: 'DX-Y.NYB',
    label: 'Chỉ số USD (DXY)',
    metric: 'Chỉ số sức mạnh đồng USD (DXY)',
    unit: 'điểm',
    unitType: UNIT_TYPES.INDEX_POINT,
    changeUnit: 'điểm',
    changeUnitType: UNIT_TYPES.INDEX_POINT,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    decimals: 2,
    source: 'Yahoo Finance (ICE DXY Reference)'
  },
  {
    factId: 'global.intermarket.us10y.yield',
    id: 'intermarket.us10y',
    symbol: '^TNX',
    label: 'Lợi suất TP Mỹ 10 năm',
    metric: 'Lợi suất Trái phiếu Chính phủ Mỹ 10 năm',
    unit: '%',
    unitType: UNIT_TYPES.PERCENT,
    changeUnit: 'điểm %',
    changeUnitType: UNIT_TYPES.PERCENTAGE_POINT,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    decimals: 2,
    source: 'Yahoo Finance (CBOE 10Y Treasury Yield)'
  },
  {
    factId: 'global.intermarket.brent.futures',
    id: 'intermarket.brent',
    symbol: 'BZ=F',
    label: 'Dầu thô Brent (Tương lai)',
    metric: 'Hợp đồng tương lai dầu thô Brent (BZ=F)',
    unit: 'USD/thùng',
    unitType: UNIT_TYPES.PRICE_USD,
    changeUnit: 'USD/thùng',
    changeUnitType: UNIT_TYPES.PRICE_USD,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    decimals: 2,
    source: 'Yahoo Finance (ICE Brent Futures Reference)'
  },
  {
    factId: 'global.intermarket.gold_futures.price',
    id: 'intermarket.gold_futures',
    symbol: 'GC=F',
    label: 'Vàng tương lai COMEX (GC=F)',
    metric: 'Hợp đồng tương lai vàng COMEX (GC=F)',
    unit: 'USD/oz',
    unitType: UNIT_TYPES.PRICE_USD,
    changeUnit: 'USD/oz',
    changeUnitType: UNIT_TYPES.PRICE_USD,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    decimals: 2,
    source: 'Yahoo Finance (COMEX Gold Futures)'
  },
  {
    factId: 'global.intermarket.fx.usd_cny',
    id: 'intermarket.usd_cny',
    symbol: 'CNY=X',
    label: 'Tỷ giá USD/CNY',
    metric: 'Tỷ giá USD/CNY giao ngay',
    unit: 'CNY',
    unitType: UNIT_TYPES.CURRENCY_RATIO,
    changeUnit: 'CNY',
    changeUnitType: UNIT_TYPES.CURRENCY_RATIO,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    quoteDirection: 'CNY_PER_USD',
    decimals: 4,
    source: 'Yahoo Finance (Forex Reference)'
  }
]);

/**
 * Parses Yahoo Finance Chart API meta quote.
 * Performs unrounded calculations at full precision from raw provider numbers.
 */
export function parseYahooQuote(data, def, now = new Date()) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta || typeof meta !== 'object') {
    return createUnavailableObservation(def.id, PILLARS.INTERMARKET, def.label, 'NO_META', {
      factId: def.factId,
      metric: def.metric,
      source: def.source,
      unit: def.unit,
      unitType: def.unitType
    });
  }

  const rawPrice = meta.regularMarketPrice;
  if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) {
    return createUnavailableObservation(def.id, PILLARS.INTERMARKET, def.label, 'INVALID_PRICE', {
      factId: def.factId,
      metric: def.metric,
      source: def.source,
      unit: def.unit,
      unitType: def.unitType
    });
  }

  const rawPrev = meta.previousClose ?? meta.chartPreviousClose;
  const hasPrev = typeof rawPrev === 'number' && Number.isFinite(rawPrev) && rawPrev > 0;

  // Unrounded calculations
  const rawChange = hasPrev ? (rawPrice - rawPrev) : null;
  const rawChangePercent = hasPrev && rawPrev > 0 ? (((rawPrice - rawPrev) / rawPrev) * 100) : null;

  const factor = Math.pow(10, def.decimals);
  const value = Math.round(rawPrice * factor) / factor;
  const previousValue = hasPrev ? Math.round(rawPrev * factor) / factor : null;
  const change = rawChange !== null ? Math.round(rawChange * factor) / factor : null;
  const changePercent = rawChangePercent !== null ? Math.round(rawChangePercent * 100) / 100 : null;

  const marketTimeSec = meta.regularMarketTime;
  const refDate = typeof marketTimeSec === 'number' && Number.isFinite(marketTimeSec) && marketTimeSec > 0
    ? new Date(marketTimeSec * 1000).toISOString()
    : now.toISOString();

  const refDay = refDate.slice(0, 10);

  return createMarketObservation({
    id: def.id,
    factId: def.factId,
    pillar: PILLARS.INTERMARKET,
    label: def.label,
    metric: def.metric,
    value,
    unit: def.unit,
    unitType: def.unitType,
    change,
    changeUnit: def.changeUnit || def.unit,
    changeUnitType: def.changeUnitType || def.unitType,
    changePercent,
    changeBasis: def.changeBasis || 'PREVIOUS_SESSION_CLOSE',
    previousValue,
    quoteDirection: def.quoteDirection || null,
    referenceTime: refDay,
    observedAt: refDate,
    fetchedAt: now.toISOString(),
    source: def.source,
    authorityLevel: AUTHORITY_LEVELS.MARKET_REFERENCE,
    provenance: {
      source: 'Yahoo Finance Chart API',
      symbol: def.symbol,
      quoteTime: refDate,
      disclaimer: 'Chỉ số tham chiếu liên thị trường'
    },
    freshness: OBSERVATION_FRESHNESS.DELAYED
  });
}

/**
 * Fetches a single global indicator quote from Yahoo Finance.
 */
export async function fetchYahooIndicator(def, { now = new Date(), fetchFn = fetch } = {}) {
  const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(def.symbol)}?interval=1d&range=5d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);

    if (!res.ok) {
      return createUnavailableObservation(def.id, PILLARS.INTERMARKET, def.label, `HTTP_${res.status}`, {
        factId: def.factId,
        metric: def.metric,
        source: def.source,
        unit: def.unit,
        unitType: def.unitType
      });
    }

    const data = await res.json();
    return parseYahooQuote(data, def, now);
  } catch (err) {
    clearTimeout(timer);
    return createUnavailableObservation(def.id, PILLARS.INTERMARKET, def.label, err.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED', {
      factId: def.factId,
      metric: def.metric,
      source: def.source,
      unit: def.unit,
      unitType: def.unitType
    });
  }
}

/**
 * Fetches USD/VND reference rate observation.
 */
export async function fetchUsdVndObservation({ now = new Date(), fetchFn = fetch } = {}) {
  const def = {
    factId: 'vn.monetary.fx.usd_vnd',
    id: 'monetary.usd_vnd',
    symbol: 'USDVND=X',
    label: 'Tỷ giá USD/VND',
    metric: 'Tỷ giá USD/VND giao ngay',
    unit: 'VND',
    unitType: UNIT_TYPES.CURRENCY_RATIO,
    changeUnit: 'VND',
    changeUnitType: UNIT_TYPES.CURRENCY_RATIO,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    quoteDirection: 'VND_PER_USD',
    decimals: 0,
    source: 'Yahoo Finance (Forex Reference)'
  };

  const obs = await fetchYahooIndicator(def, { now, fetchFn });
  if (obs.status !== 'unavailable') {
    return createMarketObservation({
      ...obs,
      pillar: PILLARS.MONETARY
    });
  }
  return createUnavailableObservation('monetary.usd_vnd', PILLARS.MONETARY, 'Tỷ giá USD/VND', obs.statusReason || 'FETCH_FAILED', {
    factId: 'vn.monetary.fx.usd_vnd',
    metric: 'Tỷ giá USD/VND giao ngay',
    source: 'Yahoo Finance',
    unit: 'VND',
    unitType: UNIT_TYPES.CURRENCY_RATIO
  });
}

/**
 * Fetches canonical Spot Gold (XAU/USD) using Alpha Vantage.
 * Explicitly distinguished from Gold Futures (GC=F).
 */
export async function fetchCanonicalGoldSpot({ now = new Date(), fetchFn = fetch, apiKey = process.env.ALPHA_VANTAGE_API_KEY } = {}) {
  const factId = 'global.intermarket.gold_spot.price';
  const id = 'intermarket.gold_spot';
  const label = 'Vàng giao ngay (XAU/USD)';
  const metric = 'Giá vàng giao ngay quốc tế (XAU/USD)';

  try {
    const snapshot = await fetchAlphaVantageGoldSpot(
      { symbol: 'GOLD' },
      { providerSymbol: 'XAU' },
      { apiKey, fetchFn }
    );

    if (snapshot && typeof snapshot.price === 'number' && Number.isFinite(snapshot.price) && snapshot.price > 0) {
      const refTime = snapshot.priceAsOf ? snapshot.priceAsOf.slice(0, 10) : now.toISOString().slice(0, 10);
      return createMarketObservation({
        id,
        factId,
        pillar: PILLARS.INTERMARKET,
        label,
        metric,
        value: snapshot.price,
        unit: 'USD/oz',
        unitType: UNIT_TYPES.PRICE_USD,
        change: snapshot.change,
        changeUnit: 'USD/oz',
        changeUnitType: UNIT_TYPES.PRICE_USD,
        changePercent: snapshot.changePercent,
        changeBasis: 'PREVIOUS_CLOSE',
        previousValue: snapshot.previousClose,
        referenceTime: refTime,
        observedAt: snapshot.priceAsOf || now.toISOString(),
        fetchedAt: now.toISOString(),
        source: 'Alpha Vantage (Spot)',
        authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT,
        provenance: {
          provider: 'Alpha Vantage',
          function: 'GOLD_SILVER_SPOT',
          symbol: 'XAU',
          note: 'Giá vàng giao ngay quốc tế chính thức tính theo ounce troy'
        },
        freshness: snapshot.freshness === 'stale' ? OBSERVATION_FRESHNESS.STALE : OBSERVATION_FRESHNESS.DELAYED
      });
    }

    return createUnavailableObservation(id, PILLARS.INTERMARKET, label, 'SPOT_PRICE_INVALID', {
      factId,
      metric,
      source: 'Alpha Vantage (Spot)',
      unit: 'USD/oz',
      unitType: UNIT_TYPES.PRICE_USD
    });
  } catch (error) {
    return createUnavailableObservation(
      id,
      PILLARS.INTERMARKET,
      label,
      error?.code || 'FETCH_FAILED',
      {
        factId,
        metric,
        source: 'Alpha Vantage (Spot)',
        unit: 'USD/oz',
        unitType: UNIT_TYPES.PRICE_USD
      }
    );
  }
}

/**
 * Fetches all cross-market global indicator observations including both
 * canonical Spot Gold (Alpha Vantage) and COMEX Gold Futures (Yahoo).
 */
export async function fetchGlobalMarketPillar({ now = new Date(), fetchFn = fetch, apiKey = process.env.ALPHA_VANTAGE_API_KEY } = {}) {
  const yahooPromises = GLOBAL_INDICATORS.map((indicator) => fetchYahooIndicator(indicator, { now, fetchFn }));
  const goldSpotPromise = fetchCanonicalGoldSpot({ now, fetchFn, apiKey });

  const [yahooResults, goldSpotResult] = await Promise.all([
    Promise.allSettled(yahooPromises),
    Promise.allSettled([goldSpotPromise])
  ]);

  const observations = yahooResults.map((res, i) => {
    if (res.status === 'fulfilled') return res.value;
    const def = GLOBAL_INDICATORS[i];
    return createUnavailableObservation(def.id, PILLARS.INTERMARKET, def.label, 'UNHANDLED_REJECTION', {
      factId: def.factId,
      metric: def.metric,
      source: def.source,
      unit: def.unit,
      unitType: def.unitType
    });
  });

  if (goldSpotResult[0].status === 'fulfilled') {
    observations.push(goldSpotResult[0].value);
  } else {
    observations.push(createUnavailableObservation(
      'intermarket.gold_spot',
      PILLARS.INTERMARKET,
      'Vàng giao ngay (XAU/USD)',
      'UNHANDLED_REJECTION',
      {
        factId: 'global.intermarket.gold_spot.price',
        metric: 'Vàng giao ngay quốc tế (XAU/USD)',
        source: 'Alpha Vantage (Spot)',
        unit: 'USD/oz',
        unitType: UNIT_TYPES.PRICE_USD
      }
    ));
  }

  return observations;
}
