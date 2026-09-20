/**
 * Centralized Financial & Native Currency Formatting Utilities
 *
 * Rules:
 * 1. NATIVE MARKET PRICE / CHANGE:
 *    - Always display using the asset's native quoteCurrency (USD, USDT, VND, etc.)
 *    - Never infer currency from asset class or hardcode ₫ / VND for USD/USDT assets.
 *    - Adaptive decimal precision:
 *      * VND: 0 decimals (or explicit)
 *      * USD / USDT:
 *        - >= 1000: 2 decimals (e.g. 77,693.50 USDT, 80,268.37 USD)
 *        - >= 1: 2 to 4 decimals (e.g. 185.50 USD, 0.5234 USD)
 *        - < 1: 4 to 8 decimals to avoid showing 0 for micro-assets (e.g. 0.00001423 USD)
 * 2. REPORTING PORTFOLIO VALUE:
 *    - Explicitly VND (₫)
 * 3. Fallbacks:
 *    - Unavailable / null / non-finite numbers return '—' or 'N/A' without fabricating numbers.
 */

const ASSET_TYPE_LABELS = {
  stock: 'Cổ phiếu',
  etf: 'ETF',
  fund: 'Quỹ đầu tư',
  gold: 'Vàng',
  crypto: 'Crypto',
  fx: 'Ngoại hối',
  deposit: 'Tiền gửi',
  bank_deposit: 'Tiền gửi',
  bond: 'Trái phiếu',
  unknown: 'Khác'
};

export function formatAssetType(assetType) {
  if (!assetType) return 'N/A';
  return ASSET_TYPE_LABELS[String(assetType).toLowerCase()] || assetType;
}

export function formatMarketContext(asset) {
  if (!asset) return '—';
  const policy = asset.market_policy || asset.marketPolicy;
  if (policy === 'VN_EXCHANGE') {
    return asset.exchange || asset.market_code || asset.marketCode || 'HOSE';
  }
  if (policy === 'CONTINUOUS_24_7') {
    return '24/7';
  }
  if (policy === 'GLOBAL_24_5' || policy === 'GLOBAL_24_5_GOLD' || policy === 'GLOBAL_24_5_FX') {
    return '24/5';
  }
  if (policy === 'NAV_SCHEDULED') {
    return 'NAV';
  }
  if (asset.exchange) {
    return asset.exchange;
  }
  return '—';
}

export function getMarketDisplayDecimals(value, currency = 'VND') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const cur = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'VND';
  if (cur === 'VND') return 0;

  const abs = Math.abs(value);
  if (abs < 0.0001) return 8;
  if (abs < 1) return 6;
  if (abs < 100) return 4;
  if (abs < 1000) return 2;
  return value % 1 === 0 ? 0 : 2;
}

export function formatNativeAmount(value, currency = 'VND', options = {}) {
  if (value === null || value === undefined || isNaN(value) || !Number.isFinite(Number(value))) {
    return options.fallback ?? '—';
  }

  const num = Number(value);
  const cur = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'VND';
  const abs = Math.abs(num);

  let decimals = 0;
  if (options.decimals !== undefined) {
    decimals = options.decimals;
  } else if (cur === 'VND') {
    decimals = 0;
  } else if (cur === 'USD' || cur === 'USDT') {
    if (abs >= 1000) {
      decimals = num % 1 === 0 ? 0 : 2;
    } else if (abs >= 1) {
      decimals = 4;
    } else {
      decimals = 8;
    }
  } else {
    decimals = abs < 1 ? 4 : 2;
  }

  const formattedNumber = num.toLocaleString('vi-VN', {
    minimumFractionDigits: options.minDecimals ?? 0,
    maximumFractionDigits: decimals
  });

  const showCurrency = options.showCurrency !== false;
  if (!showCurrency) return formattedNumber;

  return `${formattedNumber} ${cur}`;
}

export function formatMarketChange(value, currency = 'VND', options = {}) {
  if (value === null || value === undefined || isNaN(value) || !Number.isFinite(Number(value))) {
    return options.fallback ?? '—';
  }

  const num = Number(value);
  const cur = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'VND';
  const abs = Math.abs(num);

  let decimals = 2;
  if (options.decimals !== undefined) {
    decimals = options.decimals;
  } else if (cur === 'VND') {
    decimals = 0;
  } else if (abs >= 1000) {
    decimals = 2;
  } else if (abs >= 1) {
    decimals = 4;
  } else {
    decimals = 6;
  }

  const sign = num > 0 ? '+' : num < 0 ? '−' : '';
  const formattedNumber = Math.abs(num).toLocaleString('vi-VN', {
    maximumFractionDigits: decimals
  });

  const showCurrency = options.showCurrency !== false;
  return `${sign}${formattedNumber}${showCurrency ? ` ${cur}` : ''}`;
}

export function formatVNDReporting(value, options = {}) {
  if (value === null || value === undefined || isNaN(value) || !Number.isFinite(Number(value))) {
    return options.fallback ?? '—';
  }
  const num = Number(value);
  return `${num.toLocaleString('vi-VN', { maximumFractionDigits: options.decimals ?? 0 })} ₫`;
}

export function formatPercentVN(val, showSign = true) {
  if (val === null || val === undefined || isNaN(val) || !Number.isFinite(Number(val))) return '—';
  const num = Number(val);
  const formatted = Math.abs(num).toFixed(2).replace('.', ',');
  if (num > 0) return showSign ? `+${formatted}%` : `${formatted}%`;
  if (num < 0) return `-${formatted}%`;
  return `0,00%`;
}

export function formatPublishedTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return isoString;
  }
}
