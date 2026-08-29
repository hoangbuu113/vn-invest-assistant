/**
 * VNDIRECT dchart-api provider adapter — Feature 25C benchmark history.
 *
 * Fetches completed VN-Exchange daily OHLCV bars for benchmark indices (VNINDEX).
 *
 * Verified endpoint contract (Feature 25C.1 authority gate):
 *   GET https://dchart-api.vndirect.com.vn/dchart/history
 *       ?resolution=D&symbol=VNINDEX&from=<unix_s>&to=<unix_s>
 *
 * Response (text/plain body, valid JSON):
 *   { s: "ok"|"no_data", t: [], o: [], h: [], l: [], c: [], v: [] }
 *
 * IMPORTANT: Must NOT send Accept: application/json — endpoint returns 406.
 * Must send Accept: * / * or omit Accept entirely.
 *
 * Access: keyless, no cookie, no Origin/Referer required.
 * Ascending order, weekends/holidays absent, current incomplete session excluded.
 */

import { getCanonicalDate } from '../history.js';

const VNDIRECT_DCHART_BASE = 'https://dchart-api.vndirect.com.vn/dchart/history';
const TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; vn-invest-assistant/1.0)';

function benchmarkProviderError(message, code, status = 502) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normalizedOptionalPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function hasContradictoryOhlc({ open, high, low, close }) {
  if (high !== null && low !== null && high < low) return true;
  if (high !== null && [open, low, close].some((value) => value !== null && value > high)) return true;
  if (low !== null && [open, high, close].some((value) => value !== null && value < low)) return true;
  return false;
}

/**
 * Parses a VNDIRECT dchart parallel-array response into structured bar objects.
 * Validates structural consistency, per-row validity, and excludes invalid rows.
 *
 * @param {Object} data - Parsed JSON response body
 * @param {string} symbol - Identifier for error messages
 * @returns {{ bars: Array<{timestamp:string, date:string, open:number|null, high:number|null, low:number|null, close:number, volume:number|null}> }}
 */
export function parseVndirectResponse(data, symbol) {
  if (!data || typeof data !== 'object') {
    throw benchmarkProviderError(
      `Malformed response from VNDIRECT for '${symbol}'`,
      'PROVIDER_MALFORMED_RESPONSE'
    );
  }

  if (data.s === 'no_data') {
    return { bars: [] };
  }

  if (data.s !== 'ok') {
    throw benchmarkProviderError(
      `VNDIRECT returned an unexpected provider status for '${symbol}'`,
      'PROVIDER_ERROR'
    );
  }

  const t = data.t;
  const o = data.o;
  const h = data.h;
  const l = data.l;
  const c = data.c;
  const v = data.v;

  // Parallel arrays must all exist and have equal length
  if (
    !Array.isArray(t) ||
    !Array.isArray(o) ||
    !Array.isArray(h) ||
    !Array.isArray(l) ||
    !Array.isArray(c) ||
    !Array.isArray(v)
  ) {
    throw benchmarkProviderError(
      `VNDIRECT response missing required parallel arrays for '${symbol}'`,
      'PROVIDER_MALFORMED_RESPONSE'
    );
  }

  const len = t.length;
  if (
    o.length !== len ||
    h.length !== len ||
    l.length !== len ||
    c.length !== len ||
    v.length !== len
  ) {
    throw benchmarkProviderError(
      `VNDIRECT response has inconsistent parallel array lengths for '${symbol}'`,
      'PROVIDER_MALFORMED_RESPONSE'
    );
  }

  const bars = [];

  for (let i = 0; i < len; i++) {
    const epochSec = t[i];

    // Timestamp must be a finite positive number
    if (typeof epochSec !== 'number' || !Number.isFinite(epochSec) || epochSec <= 0) {
      // Skip invalid timestamp row — do not fabricate
      continue;
    }

    // Close must be finite and > 0
    const closeRaw = c[i];
    if (typeof closeRaw !== 'number' || !Number.isFinite(closeRaw) || closeRaw <= 0) {
      // Invalid close — exclude row
      continue;
    }

    // OHLC: preserve genuine valid values, never substitute close into missing fields.
    const openVal = normalizedOptionalPrice(o[i]);
    const highVal = normalizedOptionalPrice(h[i]);
    const lowVal = normalizedOptionalPrice(l[i]);
    if (hasContradictoryOhlc({ open: openVal, high: highVal, low: lowVal, close: closeRaw })) {
      continue;
    }

    // Volume: finite >= 0, null otherwise
    const volRaw = v[i];
    const volVal = typeof volRaw === 'number' && Number.isFinite(volRaw) && volRaw >= 0
      ? volRaw : null;

    // Derive date key from UTC-midnight epoch
    // VNDIRECT uses UTC-midnight timestamps: 2026-08-28T00:00:00Z = 1787875200
    // UTC date == ICT (Asia/Ho_Chi_Minh) date for VN sessions
    const d = new Date(epochSec * 1000);
    if (!Number.isFinite(d.getTime())) continue;
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    const timestamp = d.toISOString();

    bars.push({
      timestamp,
      date: dateKey,
      open: openVal,
      high: highVal,
      low: lowVal,
      close: closeRaw,
      volume: volVal,
      isComplete: true
    });
  }

  bars.sort((left, right) => (
    left.date.localeCompare(right.date) || Date.parse(left.timestamp) - Date.parse(right.timestamp)
  ));

  return { bars };
}

/**
 * Fetches completed daily benchmark history from VNDIRECT dchart-api.
 *
 * @param {string} symbol - Provider identifier (e.g. 'VNINDEX')
 * @param {Date} fromDate - Start of requested window (inclusive)
 * @param {Date} toDate - End of requested window (exclusive — provider auto-excludes current session)
 * @param {Object} [options] - Injectable options for testing
 * @param {Function} [options.fetchFn] - Replacement fetch implementation
 * @returns {Promise<{ bars: Array }>}
 */
export async function fetchVndirectHistory(symbol, fromDate, toDate, options = {}) {
  if (!symbol || typeof symbol !== 'string') {
    throw benchmarkProviderError('VNDIRECT symbol is required', 'PROVIDER_INVALID_SYMBOL', 400);
  }
  if (!(fromDate instanceof Date) || !Number.isFinite(fromDate.getTime())) {
    throw benchmarkProviderError('VNDIRECT fromDate must be a valid Date', 'PROVIDER_INVALID_PARAMS', 400);
  }
  if (!(toDate instanceof Date) || !Number.isFinite(toDate.getTime())) {
    throw benchmarkProviderError('VNDIRECT toDate must be a valid Date', 'PROVIDER_INVALID_PARAMS', 400);
  }
  if (fromDate.getTime() >= toDate.getTime()) {
    throw benchmarkProviderError('VNDIRECT date window must have fromDate before toDate', 'PROVIDER_INVALID_PARAMS', 400);
  }

  const fromEpoch = Math.floor(fromDate.getTime() / 1000);
  const toEpoch = Math.floor(toDate.getTime() / 1000);

  const url = `${VNDIRECT_DCHART_BASE}?resolution=D&symbol=${encodeURIComponent(symbol)}&from=${fromEpoch}&to=${toEpoch}`;

  const fetchFn = options.fetchFn || fetch;

  let response;
  let controller;
  let timeoutHandle;

  try {
    controller = new AbortController();
    timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);

    response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        // IMPORTANT: Accept: application/json returns 406 from this endpoint.
        // Accept: */* receives text/plain body containing valid JSON.
        'Accept': '*/*'
      }
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.name === 'AbortError') {
      throw benchmarkProviderError(
        `VNDIRECT benchmark data request timed out for '${symbol}'`,
        'PROVIDER_TIMEOUT',
        504
      );
    }
    throw benchmarkProviderError(
      `VNDIRECT benchmark data request failed for '${symbol}'`,
      'PROVIDER_CONNECTION_ERROR',
      502
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    // Do not leak raw response body
    throw benchmarkProviderError(
      `VNDIRECT benchmark provider returned HTTP ${response.status} for '${symbol}'`,
      response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR',
      response.status === 429 ? 503 : 502
    );
  }

  let text;
  try {
    text = await response.text();
  } catch (err) {
    throw benchmarkProviderError(
      `Failed to read VNDIRECT response body for '${symbol}'`,
      'PROVIDER_READ_ERROR',
      502
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Do not leak raw body
    throw benchmarkProviderError(
      `VNDIRECT returned non-JSON body for '${symbol}'`,
      'PROVIDER_MALFORMED_RESPONSE',
      502
    );
  }

  const parsed = parseVndirectResponse(data, symbol);
  const now = options.now === undefined ? new Date() : options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw benchmarkProviderError('VNDIRECT now must be a valid Date', 'PROVIDER_INVALID_PARAMS', 400);
  }
  const currentVietnamDate = getCanonicalDate(now, 'Asia/Ho_Chi_Minh');
  return {
    bars: parsed.bars.filter((bar) => bar.date < currentVietnamDate)
  };
}
