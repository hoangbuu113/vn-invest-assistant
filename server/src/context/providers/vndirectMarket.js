import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES
} from '../factModel.js';

const VNDIRECT_DCHART_BASE = 'https://dchart-api.vndirect.com.vn/dchart/history';
const TIMEOUT_MS = 7000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const VIETNAM_INDICES = Object.freeze([
  {
    factId: 'vn.market.vnindex.close',
    id: 'market.vnindex',
    symbol: 'VNINDEX',
    label: 'VN-Index',
    metric: 'Chỉ số VN-Index (đóng cửa phiên)',
    exchange: 'HOSE'
  },
  {
    factId: 'vn.market.vn30.close',
    id: 'market.vn30',
    symbol: 'VN30',
    label: 'VN30',
    metric: 'Chỉ số VN30 (đóng cửa phiên)',
    exchange: 'HOSE'
  },
  {
    factId: 'vn.market.hnx.close',
    id: 'market.hnx',
    symbol: 'HNX',
    label: 'HNX-Index',
    metric: 'Chỉ số HNX-Index (đóng cửa phiên)',
    exchange: 'HNX'
  }
]);

/**
 * Evaluates Vietnam stock exchange market session semantics for a timestamp.
 * Timezone: Asia/Ho_Chi_Minh (UTC+7). Closing auction completes at 15:00 ICT.
 */
export function getVietnamSessionInfo(epochSecOrDate, now = new Date()) {
  const d = epochSecOrDate instanceof Date ? epochSecOrDate : new Date(epochSecOrDate * 1000);
  const sessionDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
  const dayOfWeekVn = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(d);
  const isWeekend = dayOfWeekVn === 'Sat' || dayOfWeekVn === 'Sun';

  const vnNowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  const vnNowHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }).format(now));
  const vnNowMinute = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', minute: 'numeric' }).format(now));

  const isTodayInVn = sessionDate === vnNowDate;
  // Session on date D is completed if not weekend AND (date < today, or date == today and time >= 15:00 ICT)
  const isCompleted = !isWeekend && (sessionDate < vnNowDate || (isTodayInVn && (vnNowHour > 15 || (vnNowHour === 15 && vnNowMinute >= 0))));
  const isFuture = sessionDate > vnNowDate;

  return {
    sessionDate,
    isCompleted,
    isTodayInVn,
    isFuture,
    isWeekend,
    timezone: 'Asia/Ho_Chi_Minh'
  };
}

/**
 * Parses VNDirect dchart response and extracts the latest completed session close quote, previous close, and 1D delta.
 * Enforces Asia/Ho_Chi_Minh completed session semantics, excluding ongoing uncompleted sessions.
 */
export function parseVndirectIndexQuote(data, indexDef, now = new Date()) {
  if (!data || typeof data !== 'object' || data.s !== 'ok') {
    return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, 'NO_DATA', {
      factId: indexDef.factId,
      metric: indexDef.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT,
      authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT
    });
  }

  const { t, c, v } = data;
  if (!Array.isArray(t) || !Array.isArray(c) || t.length === 0 || c.length === 0) {
    return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, 'EMPTY_SERIES', {
      factId: indexDef.factId,
      metric: indexDef.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT,
      authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT
    });
  }

  // Filter valid rows and evaluate session completeness
  const validRows = [];
  for (let i = 0; i < t.length; i++) {
    const time = t[i];
    const close = c[i];
    const vol = Array.isArray(v) ? v[i] : null;
    if (typeof time === 'number' && Number.isFinite(time) && time > 0 &&
        typeof close === 'number' && Number.isFinite(close) && close > 0) {
      const sessionInfo = getVietnamSessionInfo(time, now);
      if (!sessionInfo.isFuture) {
        validRows.push({
          epochSec: time,
          close,
          volume: typeof vol === 'number' && Number.isFinite(vol) && vol >= 0 ? vol : null,
          sessionInfo
        });
      }
    }
  }

  if (validRows.length === 0) {
    return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, 'NO_VALID_BARS', {
      factId: indexDef.factId,
      metric: indexDef.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT,
      authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT
    });
  }

  // Sort ascending by epoch
  validRows.sort((a, b) => a.epochSec - b.epochSec);

  // Filter strictly completed sessions for close indicator
  const completedRows = validRows.filter((r) => r.sessionInfo.isCompleted);

  if (completedRows.length === 0) {
    return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, 'NO_COMPLETED_SESSION', {
      factId: indexDef.factId,
      metric: indexDef.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT,
      authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT
    });
  }

  const latest = completedRows[completedRows.length - 1];
  const prev = completedRows.length > 1 ? completedRows[completedRows.length - 2] : null;

  // Unrounded calculation: calculate change and percent at full precision from raw provider numbers
  const rawClose = latest.close;
  const rawPrevClose = prev ? prev.close : null;
  const rawChange = rawPrevClose !== null ? (rawClose - rawPrevClose) : null;
  const rawChangePercent = rawPrevClose !== null && rawPrevClose > 0
    ? (((rawClose - rawPrevClose) / rawPrevClose) * 100)
    : null;

  const value = Math.round(rawClose * 100) / 100;
  const previousValue = rawPrevClose !== null ? Math.round(rawPrevClose * 100) / 100 : null;
  const change = rawChange !== null ? Math.round(rawChange * 100) / 100 : null;
  const changePercent = rawChangePercent !== null ? Math.round(rawChangePercent * 100) / 100 : null;

  const refDate = new Date(latest.epochSec * 1000);
  const sessionDate = latest.sessionInfo.sessionDate;

  return createMarketObservation({
    id: indexDef.id,
    factId: indexDef.factId,
    pillar: PILLARS.MARKET,
    label: indexDef.label,
    metric: indexDef.metric,
    value,
    unit: 'điểm',
    unitType: UNIT_TYPES.INDEX_POINT,
    change,
    changeUnit: 'điểm',
    changeUnitType: UNIT_TYPES.INDEX_POINT,
    changePercent,
    changeBasis: 'PREVIOUS_SESSION_CLOSE',
    previousValue,
    volume: latest.volume,
    volumeUnit: 'cổ phiếu',
    referenceTime: sessionDate,
    observedAt: refDate.toISOString(),
    publishedAt: refDate.toISOString(),
    fetchedAt: now.toISOString(),
    source: 'VNDIRECT',
    authorityLevel: AUTHORITY_LEVELS.MARKET_DIRECT,
    provenance: {
      source: 'VNDIRECT dchart',
      exchange: indexDef.exchange,
      sessionDate,
      timezone: 'Asia/Ho_Chi_Minh',
      semantics: 'Completed daily session close'
    },
    freshness: OBSERVATION_FRESHNESS.DELAYED
  });
}

/**
 * Fetches quotes for an index from VNDirect dchart history API.
 */
export async function fetchVndirectIndex(indexDef, { now = new Date(), fetchFn = fetch } = {}) {
  const toEpoch = Math.floor((now.getTime() + 86400000) / 1000);
  const fromEpoch = toEpoch - (14 * 86400);

  const url = `${VNDIRECT_DCHART_BASE}?resolution=D&symbol=${encodeURIComponent(indexDef.symbol)}&from=${fromEpoch}&to=${toEpoch}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timer);

    if (!res.ok) {
      return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, `HTTP_${res.status}`, {
        factId: indexDef.factId,
        metric: indexDef.metric,
        source: 'VNDIRECT',
        unit: 'điểm',
        unitType: UNIT_TYPES.INDEX_POINT
      });
    }

    const data = await res.json();
    return parseVndirectIndexQuote(data, indexDef, now);
  } catch (err) {
    clearTimeout(timer);
    return createUnavailableObservation(indexDef.id, PILLARS.MARKET, indexDef.label, err.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED', {
      factId: indexDef.factId,
      metric: indexDef.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT
    });
  }
}

/**
 * Fetches all Vietnam equity market index observations and unprovisioned breadth.
 */
export async function fetchVietnamMarketPillar({ now = new Date(), fetchFn = fetch } = {}) {
  const indexPromises = VIETNAM_INDICES.map((idx) => fetchVndirectIndex(idx, { now, fetchFn }));
  const results = await Promise.allSettled(indexPromises);

  const observations = results.map((res, i) => {
    if (res.status === 'fulfilled') return res.value;
    const def = VIETNAM_INDICES[i];
    return createUnavailableObservation(def.id, PILLARS.MARKET, def.label, 'UNHANDLED_REJECTION', {
      factId: def.factId,
      metric: def.metric,
      source: 'VNDIRECT',
      unit: 'điểm',
      unitType: UNIT_TYPES.INDEX_POINT
    });
  });

  // Breadth strictly unavailable per locked architecture
  observations.push(createUnavailableObservation(
    'market.breadth',
    PILLARS.MARKET,
    'Độ rộng thị trường',
    'SOURCE_NOT_PROVISIONED',
    {
      factId: 'vn.market.breadth.advance_decline',
      metric: 'Độ rộng thị trường Việt Nam (tăng/giảm)',
      source: 'HOSE'
    }
  ));

  return observations;
}
