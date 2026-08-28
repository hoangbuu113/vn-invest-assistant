/**
 * Feature 11: Asset Comparison Helper Functions
 * Pure deterministic helpers for asset selection validation, price normalization, and descriptive labeling.
 */

/**
 * Validates and sanitizes a list of asset symbols selected for comparison.
 * - Prevents duplicate symbols (case-insensitive deduplication).
 * - Enforces minimum 2 and maximum 4 assets limit.
 *
 * @param {Array<string>} symbols - Array of asset symbols
 * @param {Array<string>} availableSymbols - Optional array of valid system symbols to check against
 * @returns {{ valid: boolean, symbols: string[], error: string|null }}
 */
export function validateComparisonSelection(symbols, availableSymbols = null) {
  if (!Array.isArray(symbols)) {
    return {
      valid: false,
      symbols: [],
      error: 'Danh sách tài sản so sánh không hợp lệ.'
    };
  }

  // Deduplicate and normalize
  const seen = new Set();
  const deduped = [];

  for (const rawSym of symbols) {
    if (typeof rawSym !== 'string') continue;
    const sym = rawSym.trim().toUpperCase();
    if (!sym) continue;

    if (availableSymbols && Array.isArray(availableSymbols)) {
      const isAvailable = availableSymbols.some(
        (s) => typeof s === 'string' && s.trim().toUpperCase() === sym
      );
      if (!isAvailable) {
        continue; // skip symbols not in system
      }
    }

    if (!seen.has(sym)) {
      seen.add(sym);
      deduped.push(sym);
    }
  }

  // Cap at maximum 4
  const capped = deduped.slice(0, 4);

  if (capped.length < 2) {
    return {
      valid: false,
      symbols: capped,
      error: 'Chọn từ 2 đến 4 tài sản để so sánh.'
    };
  }

  return {
    valid: true,
    symbols: capped,
    error: null
  };
}

/**
 * Calculates normalized relative prices with Base = 100 at the start of the period.
 * Pure deterministic transformation of daily historical bars for side-by-side visual comparison.
 *
 * Formula: normalizedValue_i = (close_i / baseClose) * 100
 *
 * @param {Array<Object>} bars - Array of historical daily bars with { timestamp, close }
 * @returns {Array<Object>|null} Array of normalized points or null if insufficient valid data
 */
export function normalizeHistoricalPrices(bars) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return null;
  }

  // Filter valid bars with positive close price and valid timestamp
  const validBars = bars.filter(
    (b) => b && typeof b === 'object' && typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0 && b.timestamp
  );

  if (validBars.length < 2) {
    return null;
  }

  const baseBar = validBars[0];
  const baseClose = baseBar.close;

  if (typeof baseClose !== 'number' || !Number.isFinite(baseClose) || baseClose <= 0) {
    return null;
  }

  return validBars.map((bar) => {
    const rawRatio = bar.close / baseClose;
    const normalizedValue = rawRatio * 100;

    return {
      timestamp: bar.timestamp,
      close: bar.close,
      normalizedValue: Number.isFinite(normalizedValue) ? normalizedValue : null
    };
  });
}

/**
 * Descriptive Vietnamese data completeness translation.
 * complete -> Đầy đủ
 * partial -> Một phần
 * limited -> Hạn chế
 * unavailable -> Chưa đủ dữ liệu
 *
 * @param {string} level - Availability level from backend analysis
 * @returns {string} Vietnamese translated label
 */
export function translateDataCompleteness(level) {
  switch (level) {
    case 'complete':
      return 'Đầy đủ';
    case 'partial':
      return 'Một phần';
    case 'limited':
      return 'Hạn chế';
    case 'unavailable':
    default:
      return 'Chưa đủ dữ liệu';
  }
}

