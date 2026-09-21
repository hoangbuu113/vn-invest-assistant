/**
 * Centralized Financial & Currency Input Parser & Validator
 *
 * Rules:
 * 1. VND MONETARY INPUT:
 *    - Strictly integer-based (no fractional xu/cents in accounting or transactions).
 *    - Supports dot-grouped thousands: "68.603" -> 68603, "1.000.000" -> 1000000.
 *    - Supports space-grouped thousands: "68 603" -> 68603, "1 000 000" -> 1000000.
 *    - Supports plain integer digits: "68603" -> 68603.
 *    - Strips currency suffixes ("đ", "₫", "VND").
 *    - Rejects ambiguous inputs with helpful guidance:
 *      * Commas: "68,603" (ambiguous between EN thousands and VN decimal).
 *      * Incomplete decimals: "68.5", "68.50" (warns user to enter 68.500 or 68500).
 *      * Malformed grouping: "68.60.3", "1.00.000".
 *      * Negatives: "-50000".
 * 2. FOREIGN / CRYPTO DECIMAL INPUT:
 *    - Supports standard floating-point numbers (e.g. 0.4265 USDT, 2650.50 USD).
 *    - Normalizes single comma to dot for VN keyboard users (e.g. 0,4265 -> 0.4265).
 *    - Strictly isolates decimal parsing from VND grouping rules.
 */

/**
 * Parse and validate VND monetary input string.
 *
 * @param {string|number} rawInput - Raw user input string or number
 * @param {Object} options
 * @param {boolean} [options.allowZero=false] - Whether 0 is considered a valid amount
 * @param {boolean} [options.allowEmpty=false] - Whether empty/null returns valid null
 * @returns {{ value: number|null, isValid: boolean, error: string|null }}
 */
export function parseVndInput(rawInput, { allowZero = false, allowEmpty = false } = {}) {
  if (rawInput === null || rawInput === undefined) {
    if (allowEmpty) return { value: null, isValid: true, error: null };
    return { value: null, isValid: false, error: 'Vui lòng nhập số tiền.' };
  }

  // Handle number type passed directly
  if (typeof rawInput === 'number') {
    if (!Number.isFinite(rawInput)) {
      return { value: null, isValid: false, error: 'Số tiền không hợp lệ.' };
    }
    if (rawInput < 0) {
      return { value: null, isValid: false, error: 'Số tiền không được âm.' };
    }
    if (rawInput === 0 && !allowZero) {
      return { value: null, isValid: false, error: 'Số tiền phải lớn hơn 0.' };
    }
    return { value: Math.round(rawInput), isValid: true, error: null };
  }

  let s = String(rawInput).trim();
  if (s === '') {
    if (allowEmpty) return { value: null, isValid: true, error: null };
    return { value: null, isValid: false, error: 'Vui lòng nhập số tiền.' };
  }

  // Strip currency prefixes or suffixes (₫, đ, Đ, VND, vnd)
  s = s.replace(/^(₫|đ|Đ|VND|vnd)\s*/i, '').replace(/\s*(₫|đ|Đ|VND|vnd)$/i, '').trim();
  if (s === '') {
    return { value: null, isValid: false, error: 'Vui lòng nhập số tiền.' };
  }

  // Negative check
  if (s.startsWith('-')) {
    return { value: null, isValid: false, error: 'Số tiền không được âm.' };
  }

  // Check for disallowed characters
  if (/[^\d.,\s]/.test(s)) {
    return { value: null, isValid: false, error: 'Số tiền chứa ký tự không hợp lệ.' };
  }

  // Check for commas (Ambiguous between EN thousands separator and VN decimal comma)
  if (s.includes(',')) {
    return {
      value: null,
      isValid: false,
      error: 'Vui lòng không dùng dấu phẩy (,). Dùng dấu chấm (.) phân cách hàng nghìn (ví dụ: 68.603) hoặc viết liền (ví dụ: 68603).'
    };
  }

  // Handle space-grouped numbers (e.g. "68 603", "1 000 000")
  if (s.includes(' ')) {
    if (/^\d{1,3}( \d{3})+$/.test(s)) {
      s = s.replace(/\s+/g, '');
    } else if (/^\d[\d\s]*\d$/.test(s)) {
      return {
        value: null,
        isValid: false,
        error: 'Định dạng phân cách khoảng trắng không hợp lệ. Mỗi nhóm phải có đúng 3 chữ số (ví dụ: 68 603).'
      };
    } else {
      return { value: null, isValid: false, error: 'Định dạng số không hợp lệ.' };
    }
  }

  // Handle dot-grouped numbers (e.g. "68.603", "1.000.000")
  if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    } else {
      if (/^\d+\.\d{1,2}$/.test(s)) {
        return {
          value: null,
          isValid: false,
          error: 'Số tiền VND không có phần thập phân. Nếu bạn muốn nhập hàng nghìn, vui lòng nhập đủ 3 chữ số sau dấu chấm (ví dụ: 68.500 hoặc 68500).'
        };
      }
      return {
        value: null,
        isValid: false,
        error: 'Định dạng phân cách hàng nghìn không hợp lệ. Mỗi nhóm sau dấu chấm phải có đúng 3 chữ số (ví dụ: 68.603).'
      };
    }
  }

  // At this point, s must be purely digits
  if (!/^\d+$/.test(s)) {
    return { value: null, isValid: false, error: 'Vui lòng nhập số hợp lệ.' };
  }

  const num = parseInt(s, 10);
  if (!Number.isSafeInteger(num)) {
    return { value: null, isValid: false, error: 'Số tiền vượt quá giới hạn cho phép.' };
  }

  if (num === 0 && !allowZero) {
    return { value: null, isValid: false, error: 'Số tiền phải lớn hơn 0.' };
  }

  return { value: num, isValid: true, error: null };
}

/**
 * Parse and validate decimal input string (for Crypto USDT, Gold USD, etc.).
 *
 * @param {string|number} rawInput
 * @param {Object} options
 * @param {boolean} [options.allowZero=false]
 * @param {boolean} [options.allowEmpty=false]
 * @returns {{ value: number|null, isValid: boolean, error: string|null }}
 */
export function parseDecimalInput(rawInput, { allowZero = false, allowEmpty = false } = {}) {
  if (rawInput === null || rawInput === undefined) {
    if (allowEmpty) return { value: null, isValid: true, error: null };
    return { value: null, isValid: false, error: 'Vui lòng nhập giá trị.' };
  }

  if (typeof rawInput === 'number') {
    if (!Number.isFinite(rawInput)) {
      return { value: null, isValid: false, error: 'Giá trị không hợp lệ.' };
    }
    if (rawInput < 0) {
      return { value: null, isValid: false, error: 'Giá trị không được âm.' };
    }
    if (rawInput === 0 && !allowZero) {
      return { value: null, isValid: false, error: 'Giá trị phải lớn hơn 0.' };
    }
    return { value: rawInput, isValid: true, error: null };
  }

  let s = String(rawInput).trim();
  if (s === '') {
    if (allowEmpty) return { value: null, isValid: true, error: null };
    return { value: null, isValid: false, error: 'Vui lòng nhập giá trị.' };
  }

  // Strip currency prefixes or suffixes (USDT, USD, $, etc.)
  s = s.replace(/^(USDT|USD|\$)\s*/i, '').replace(/\s*(USDT|USD|\$)$/i, '').trim();
  if (s === '') {
    return { value: null, isValid: false, error: 'Vui lòng nhập giá trị.' };
  }

  // Negative check
  if (s.startsWith('-')) {
    return { value: null, isValid: false, error: 'Giá trị không được âm.' };
  }

  // Normalize single comma to dot if no dot is present (convenient for VN keyboards entering decimal 0,4265)
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    if (parts.length === 2) {
      s = `${parts[0]}.${parts[1]}`;
    }
  }

  const num = Number(s);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { value: null, isValid: false, error: 'Vui lòng nhập số hợp lệ.' };
  }

  if (num < 0) {
    return { value: null, isValid: false, error: 'Giá trị không được âm.' };
  }

  if (num === 0 && !allowZero) {
    return { value: null, isValid: false, error: 'Giá trị phải lớn hơn 0.' };
  }

  return { value: num, isValid: true, error: null };
}

/**
 * Universal dispatcher for financial inputs based on quote currency.
 *
 * @param {string|number} rawInput
 * @param {string} [currency='VND']
 * @param {Object} [options={}]
 * @returns {{ value: number|null, isValid: boolean, error: string|null }}
 */
export function parseFinancialInput(rawInput, currency = 'VND', options = {}) {
  const cur = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'VND';
  if (cur === 'VND') {
    return parseVndInput(rawInput, options);
  }
  return parseDecimalInput(rawInput, options);
}

/**
 * Formats a normalized VND preview string.
 *
 * @param {number|null} value
 * @param {string} [unitLabel='']
 * @returns {string}
 */
export function formatVndPreview(value, unitLabel = '') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  const formatted = Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
  const unit = unitLabel ? ` / ${unitLabel}` : '';
  return `${formatted} đ${unit}`;
}

/**
 * Derives user-friendly asset unit label (e.g. 'cp', 'ccq', 'oz', 'coin', 'đơn vị').
 *
 * @param {Object} asset
 * @returns {string}
 */
export function getAssetUnitLabel(asset) {
  const type = (asset?.asset_type || asset?.assetType || '').toLowerCase();
  const symbol = (asset?.symbol || '').toUpperCase();

  if (type === 'stock') return 'cp';
  if (type === 'etf' || type === 'fund') return 'ccq';
  if (type === 'gold' || symbol === 'XAU/USD') return 'oz';
  if (type === 'crypto') return 'coin';
  return 'đơn vị';
}

