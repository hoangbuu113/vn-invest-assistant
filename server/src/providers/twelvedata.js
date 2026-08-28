import { createUnavailableFxRate, normalizeFxRate, REPORTING_CURRENCY } from '../fx.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetches and normalizes a direct USD/VND exchange rate from Twelve Data.
 *
 * Rules:
 * 1. Strictly handles direct USD -> VND pair only.
 * 2. Normalizes into standard Feature 19 FX contract.
 * 3. Degrades cleanly to explicit unavailable status on missing key, network error, or invalid payload.
 */
export async function getTwelveDataFxRate(baseCurrency, quoteCurrency = REPORTING_CURRENCY, options = {}) {
  const normalizedBase = typeof baseCurrency === 'string' ? baseCurrency.trim().toUpperCase() : '';
  const normalizedQuote = typeof quoteCurrency === 'string' ? quoteCurrency.trim().toUpperCase() : '';

  if (normalizedBase !== 'USD' || normalizedQuote !== 'VND') {
    return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_PAIR_UNSUPPORTED', {
      provider: 'twelvedata'
    });
  }

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_PROVIDER_UNCONFIGURED', {
      provider: 'twelvedata'
    });
  }

  const symbol = `${normalizedBase}/${normalizedQuote}`;
  const url = `https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn || fetch;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_PROVIDER_ERROR', {
        provider: 'twelvedata',
        reason: `Upstream returned status ${response.status}`
      });
    }

    const data = await response.json();
    if (data?.status === 'error' || (typeof data?.code === 'number' && data.code >= 400)) {
      return createUnavailableFxRate(
        normalizedBase,
        normalizedQuote,
        data.message || 'FX_PROVIDER_ERROR',
        { provider: 'twelvedata' }
      );
    }

    const rawRate = Number(data?.rate);
    if (!Number.isFinite(rawRate) || rawRate <= 0) {
      return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_RATE_INVALID', {
        provider: 'twelvedata'
      });
    }

    let sourceTimestamp = null;
    if (typeof data?.timestamp === 'number' && data.timestamp > 0) {
      sourceTimestamp = new Date(data.timestamp * 1000).toISOString();
    } else if (typeof data?.timestamp === 'string' && data.timestamp.trim()) {
      const parsed = Date.parse(data.timestamp.trim());
      if (Number.isFinite(parsed)) {
        sourceTimestamp = new Date(parsed).toISOString();
      }
    }

    if (!sourceTimestamp) {
      return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_TIMESTAMP_INVALID', {
        provider: 'twelvedata'
      });
    }

    return normalizeFxRate(
      {
        baseCurrency: normalizedBase,
        quoteCurrency: normalizedQuote,
        rate: rawRate,
        provider: 'twelvedata',
        sourceTimestamp,
        availability: 'available',
        freshness: 'delayed',
        reason: null
      },
      normalizedBase,
      normalizedQuote
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_PROVIDER_TIMEOUT', {
        provider: 'twelvedata'
      });
    }
    return createUnavailableFxRate(normalizedBase, normalizedQuote, 'FX_PROVIDER_ERROR', {
      provider: 'twelvedata',
      reason: err.message
    });
  }
}

export async function getHistory(asset) {
  const error = new Error(
    `Historical market data for '${asset?.symbol || 'USD/VND'}' is unsupported because Twelve Data daily timezone semantics are not compatible with the canonical market timezone`
  );
  error.status = 422;
  error.code = 'UNSUPPORTED_HISTORY';
  throw error;
}

export const twelvedataProvider = Object.freeze({
  name: 'twelvedata',
  getHistory
});
