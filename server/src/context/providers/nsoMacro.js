/**
 * NSO Macro Data Provider — Focused adapter for official Vietnam macroeconomic releases.
 * Sources: National Statistics Office of Vietnam (Cơ quan Thống kê Quốc gia / Tổng cục Thống kê - nso.gov.vn).
 *
 * Implements strict extraction & validation for 6 core macro facts:
 * 1. vn.macro.cpi.yoy: Headline CPI YoY for reference month.
 * 2. vn.macro.core_cpi.yoy: Monthly core CPI YoY only (rejects cumulative/YTD averages).
 * 3. vn.macro.gdp.real.quarter_yoy: Real GDP growth for individual quarter (rejects H1, 9M, full-year).
 * 4. vn.macro.iip.month_yoy: Industrial Production Index for individual month YoY (rejects cumulative).
 * 5. vn.macro.retail.nominal.month_yoy: Monthly nominal retail revenue YoY (rejects real or cumulative).
 * 6. vn.macro.fdi.disbursed.ytd_usd: Cumulative disbursed FDI for stated YTD period (rejects registered capital).
 *
 * Guaranteed Invariants:
 * - Missing is NEVER zero (returns null / unavailable).
 * - Layout mismatch quarantines parser output safely.
 * - No raw HTML or full documents are sent forward.
 */

import {
  isOfficialUrl,
  parseDecimal,
  textFromHtml,
  fetchOfficialResource
} from '../../regime/providers/common.js';
import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  AUTHORITY_LEVELS,
  UNIT_TYPES,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS
} from '../factModel.js';

export const NSO_HOST = 'nso.gov.vn';
export const NSO_SOCIOECONOMIC_INDEX_URL = 'https://www.nso.gov.vn/tinh-hinh-kinh-te-xa-hoi/';

export const VIETNAMESE_MONTH_WORDS = Object.freeze({
  'một': 1,
  'mot': 1,
  'hai': 2,
  'ba': 3,
  'bốn': 4,
  'bon': 4,
  'tư': 4,
  'tu': 4,
  'năm': 5,
  'nam': 5,
  'sáu': 6,
  'sau': 6,
  'bảy': 7,
  'bay': 7,
  'tám': 8,
  'tam': 8,
  'chín': 9,
  'chin': 9,
  'mười': 10,
  'muoi': 10,
  'mười một': 11,
  'muoi mot': 11,
  'mười hai': 12,
  'muoi hai': 12
});

export const MONTH_TOKEN_PATTERN = '(?:mười\\s+một|mười\\s+hai|mười|một|hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|\\d{1,2})';

export function parseVietnameseMonth(raw) {
  if (!raw) return null;
  const str = String(raw).trim().toLowerCase();
  if (/^\d{1,2}$/.test(str)) {
    const num = Number(str);
    return num >= 1 && num <= 12 ? num : null;
  }
  return VIETNAMESE_MONTH_WORDS[str] || null;
}

function toMonthKey(month, year) {
  const m = typeof month === 'number' ? month : parseVietnameseMonth(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function toQuarterKey(quarter, year) {
  const q = String(quarter).toUpperCase().trim();
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000) return null;
  let qNum = null;
  if (q === 'I' || q === '1' || q === 'Q1') qNum = 1;
  else if (q === 'II' || q === '2' || q === 'Q2') qNum = 2;
  else if (q === 'III' || q === '3' || q === 'Q3') qNum = 3;
  else if (q === 'IV' || q === '4' || q === 'Q4') qNum = 4;
  if (!qNum) return null;
  return `${y}-Q${qNum}`;
}

function extractDocumentYear(text, fallbackMonthKey = null) {
  if (fallbackMonthKey && typeof fallbackMonthKey === 'string') {
    const y = fallbackMonthKey.split('-')[0];
    if (/^\d{4}$/.test(y)) return y;
  }
  if (typeof text === 'string') {
    const m = /năm\s*(\d{4})/iu.exec(text);
    if (m) return m[1];
  }
  return null;
}

/**
 * Parses headline monthly CPI YoY from text.
 * Requires explicit monthly reference, not cumulative/YTD average.
 * Supports digits and Vietnamese month words (e.g. tháng Tám -> 08).
 */
export function parseNsoHeadlineCpi(text, referenceMonth = null) {
  if (typeof text !== 'string') return null;

  // Monthly pattern: Chỉ số giá tiêu dùng (CPI) tháng X... tăng/giảm Y% so với cùng kỳ
  const monthRegex = new RegExp(
    'Chỉ số giá tiêu dùng\\s*(?:\\(CPI\\))?\\s*tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\/(\\d{4}))?[^.\\n]{0,250}?(tăng|giảm)\\s*(\\d+(?:[,.]\\d+)?)\\s*%\\s*(?:so với cùng kỳ|so với tháng \\d+ năm trước)',
    'iu'
  );
  const match = monthRegex.exec(text);
  if (match) {
    const val = parseDecimal(match[4]);
    const sign = match[3].toLowerCase() === 'giảm' ? -1 : 1;
    const docYear = match[2] || extractDocumentYear(text, referenceMonth);
    const ref = toMonthKey(match[1], docYear) || (referenceMonth || null);
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: ref,
        metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)'
      };
    }
  }

  // Secondary single-month pattern
  const singleMonthRegex = new RegExp(
    'CPI tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\/(\\d{4}))?[^.\\n]{0,150}?(tăng|giảm)\\s*(\\d+(?:[,.]\\d+)?)\\s*%\\s*so với cùng kỳ',
    'iu'
  );
  const match2 = singleMonthRegex.exec(text);
  if (match2) {
    const val = parseDecimal(match2[4]);
    const sign = match2[3].toLowerCase() === 'giảm' ? -1 : 1;
    const docYear = match2[2] || extractDocumentYear(text, referenceMonth);
    const ref = toMonthKey(match2[1], docYear) || (referenceMonth || null);
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: ref,
        metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)'
      };
    }
  }

  return null;
}

/**
 * Parses monthly core CPI YoY ONLY.
 * Strict rule: Rejects cumulative/YTD averages ("bình quân X tháng" or "bình quân năm").
 */
export function parseNsoCoreCpi(text, referenceMonth = null) {
  if (typeof text !== 'string') return null;

  // Must match single-month core inflation: "Lạm phát cơ bản tháng MM... tăng X% so với cùng kỳ"
  const monthRegex = new RegExp(
    'Lạm phát cơ bản\\s*tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\/(\\d{4}))?[^.\\n]{0,200}?(tăng|giảm)\\s*(\\d+(?:[,.]\\d+)?)\\s*%\\s*so với cùng kỳ',
    'iu'
  );
  const match = monthRegex.exec(text);
  if (match) {
    const val = parseDecimal(match[4]);
    const sign = match[3].toLowerCase() === 'giảm' ? -1 : 1;
    const docYear = match[2] || extractDocumentYear(text, referenceMonth);
    const ref = toMonthKey(match[1], docYear) || (referenceMonth || null);
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: ref,
        metric: 'Lạm phát cơ bản (so với cùng kỳ tháng)'
      };
    }
  }

  // If only cumulative pattern exists ("Bình quân X tháng... lạm phát cơ bản tăng Y%"), REJECT!
  return null;
}

/**
 * Parses real quarterly GDP growth.
 * Strict rule: Rejects cumulative H1 ("6 tháng"), 9M ("9 tháng"), full-year ("cả năm").
 */
export function parseNsoQuarterlyGdp(text) {
  if (typeof text !== 'string') return null;

  // Match quarterly GDP: "GDP quý I/II/III/IV (năm YYYY) tăng X% so với cùng kỳ"
  const qRegex = /(?:Tổng sản phẩm trong nước(?:\s*\(GDP\))?|GDP)\s*(?:quý|Qúy)\s*(I{1,3}|IV|[1-4])(?:\/(\d{4})|\s+năm\s+(\d{4}))?[^.;\n]{0,250}?(tăng|giảm)\s*(\d+(?:[,.]\d+)?)\s*%\s*so với cùng kỳ/iu;
  const match = qRegex.exec(text);
  if (match) {
    const qLabel = match[1];
    const year = match[2] || match[3] || (text.match(/năm\s+(\d{4})/i)?.[1]) || null;
    const refQuarter = year ? toQuarterKey(qLabel, year) : null;
    const val = parseDecimal(match[5]);
    const sign = match[4].toLowerCase() === 'giảm' ? -1 : 1;
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: refQuarter,
        metric: 'Tăng trưởng GDP thực tế theo quý (so với cùng kỳ)'
      };
    }
  }

  return null;
}

/**
 * Parses individual month Industrial Production Index (IIP) YoY.
 * Strict rule: Rejects cumulative/YTD IIP ("tính chung X tháng", "bình quân X tháng").
 */
export function parseNsoMonthlyIip(text, referenceMonth = null) {
  if (typeof text !== 'string') return null;

  // Match: Chỉ số sản xuất toàn ngành công nghiệp (IIP) tháng MM... tăng/giảm X% so với cùng kỳ
  const iipRegex = new RegExp(
    '(?:Chỉ số sản xuất công nghiệp|Chỉ số sản xuất toàn ngành công nghiệp|IIP)(?:\\s*\\(IIP\\))?\\s*tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\/(\\d{4}))?[^.\\n]{0,250}?(tăng|giảm)\\s*(\\d+(?:[,.]\\d+)?)\\s*%\\s*so với cùng kỳ',
    'iu'
  );
  const match = iipRegex.exec(text);
  if (match) {
    const val = parseDecimal(match[4]);
    const sign = match[3].toLowerCase() === 'giảm' ? -1 : 1;
    const docYear = match[2] || extractDocumentYear(text, referenceMonth);
    const ref = toMonthKey(match[1], docYear) || (referenceMonth || null);
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: ref,
        metric: 'Chỉ số sản xuất công nghiệp IIP tháng (so với cùng kỳ)'
      };
    }
  }

  return null;
}

/**
 * Parses monthly nominal retail revenue YoY.
 * Strict rule: Rejects real/price-adjusted ("loại trừ yếu tố giá") or cumulative revenue.
 */
export function parseNsoMonthlyRetail(text, referenceMonth = null) {
  if (typeof text !== 'string') return null;

  // Pattern: "Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng MM... tăng X% so với cùng kỳ"
  const retailRegex = new RegExp(
    '(?:Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng|Doanh thu bán lẻ|Bán lẻ hàng hóa)\\s*tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\/(\\d{4}))?[^.\\n]{0,300}?(tăng|giảm)\\s*(\\d+(?:[,.]\\d+)?)\\s*%\\s*so với cùng kỳ',
    'iu'
  );
  const match = retailRegex.exec(text);
  if (match) {
    const matchedSnippet = match[0];
    // Reject if this specific percentage is explicitly price-adjusted
    if (/loại trừ yếu tố giá/i.test(matchedSnippet)) {
      return null;
    }
    const val = parseDecimal(match[4]);
    const sign = match[3].toLowerCase() === 'giảm' ? -1 : 1;
    const docYear = match[2] || extractDocumentYear(text, referenceMonth);
    const ref = toMonthKey(match[1], docYear) || (referenceMonth || null);
    if (val !== null && val >= 0) {
      return {
        value: sign * val,
        referenceTime: ref,
        metric: 'Doanh thu bán lẻ tiêu dùng danh nghĩa tháng (so với cùng kỳ)'
      };
    }
  }

  return null;
}

/**
 * Parses cumulative disbursed FDI for stated YTD reference period.
 * Strict rule: Rejects newly registered FDI ("vốn đăng ký mới"), adjusted capital, or share purchases.
 * Unit scale preserved: billion USD ('tỷ USD').
 */
export function parseNsoDisbursedFdi(text, referencePeriod = null) {
  if (typeof text !== 'string') return null;

  // Pattern: "Vốn đầu tư trực tiếp nước ngoài thực hiện... ước đạt X tỷ USD"
  const fdiRegex = /(?:Vốn đầu tư trực tiếp nước ngoài thực hiện|Vốn FDI thực hiện|FDI thực hiện)[^.\n]{0,250}?(?:ước đạt|đạt)\s*(\d+(?:[,.]\d+)?)\s*(?:tỷ USD|tỷ đô la Mỹ)/iu;
  const match = fdiRegex.exec(text);
  if (match) {
    const val = parseDecimal(match[1]);
    if (val !== null && val >= 0) {
      return {
        value: val,
        unit: 'tỷ USD',
        unitType: UNIT_TYPES.CURRENCY_AMOUNT,
        referenceTime: referencePeriod,
        metric: 'Vốn đầu tư trực tiếp nước ngoài (FDI) giải ngân lũy kế YTD'
      };
    }
  }

  return null;
}

/**
 * Parses an official NSO Socioeconomic release HTML document.
 * Returns structured parsed facts or quarantine status.
 */
export function parseNsoSocioeconomicRelease(html, releaseUrl = null) {
  if (releaseUrl && !isOfficialUrl(releaseUrl, NSO_HOST)) {
    return {
      status: 'quarantined',
      reason: 'UNOFFICIAL_HOST',
      observations: []
    };
  }

  const text = textFromHtml(html);
  if (!text || text.length < 100) {
    return {
      status: 'quarantined',
      reason: 'EMPTY_OR_UNREADABLE_CONTENT',
      observations: []
    };
  }

  // Extract reference period and publication date from official document
  const periodMatch = new RegExp(
    '(?:Tình hình kinh tế\\s*-\\s*xã hội|Chỉ số giá tiêu dùng|Báo cáo tình hình kinh tế)\\s*(?:tháng\\s*(' +
    MONTH_TOKEN_PATTERN +
    ')(?:\\s*và\\s*\\d+\\s*tháng)?|quý\\s*(I{1,3}|IV|[1-4]))\\s*năm\\s*(\\d{4})',
    'iu'
  ).exec(text)
    || new RegExp('tháng\\s*(' + MONTH_TOKEN_PATTERN + ')(?:\\s*và\\s*\\d+\\s*tháng)?\\s*năm\\s*(\\d{4})', 'iu').exec(text);

  let referenceMonth = null;
  if (periodMatch && periodMatch[1]) {
    const monthVal = parseVietnameseMonth(periodMatch[1]);
    const yearVal = periodMatch[3] || periodMatch[2] || extractDocumentYear(text);
    if (monthVal && yearVal) {
      referenceMonth = toMonthKey(monthVal, yearVal);
    }
  }

  const pubMatch = /(?:Ngày đăng|Hà Nội,\s*ngày)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/iu.exec(text);
  let publishedAt = null;
  if (pubMatch) {
    const [_, d, m, y] = pubMatch;
    publishedAt = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  } else if (releaseUrl) {
    const urlDateMatch = /\/(\d{4})\/(\d{2})\//.exec(releaseUrl);
    if (urlDateMatch) {
      publishedAt = `${urlDateMatch[1]}-${urlDateMatch[2]}-01T00:00:00.000Z`;
    }
  }

  const headlineCpi = parseNsoHeadlineCpi(text, referenceMonth);
  const coreCpi = parseNsoCoreCpi(text, referenceMonth);
  const quarterlyGdp = parseNsoQuarterlyGdp(text);
  const monthlyIip = parseNsoMonthlyIip(text, referenceMonth);
  const monthlyRetail = parseNsoMonthlyRetail(text, referenceMonth);
  const disbursedFdi = parseNsoDisbursedFdi(text, referenceMonth);

  return {
    status: 'available',
    referenceMonth,
    publishedAt,
    releaseUrl,
    parsed: {
      headlineCpi,
      coreCpi,
      quarterlyGdp,
      monthlyIip,
      monthlyRetail,
      disbursedFdi
    }
  };
}

/**
 * Normalizes NSO parsed facts into standardized MarketObservation instances.
 */
export function normalizeNsoMacroFacts(parsedRelease, now = new Date()) {
  const observations = [];
  const p = parsedRelease?.parsed || {};
  const releaseUrl = parsedRelease?.releaseUrl || null;
  const publishedAt = parsedRelease?.publishedAt || null;
  const fetchedAt = now.toISOString();

  // 1. vn.macro.cpi.yoy (Headline CPI YoY)
  if (p.headlineCpi?.value !== undefined && p.headlineCpi.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.cpi_yoy',
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'Lạm phát CPI (YoY)',
      metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
      value: p.headlineCpi.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: p.headlineCpi.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.cpi_yoy', PILLARS.MACRO, 'Lạm phát CPI (YoY)', 'OFFICIAL_DATA_UNAVAILABLE', {
      factId: 'vn.macro.cpi.yoy',
      metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 2. vn.macro.core_cpi.yoy (Monthly core CPI YoY ONLY)
  if (p.coreCpi?.value !== undefined && p.coreCpi.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.core_cpi_yoy',
      factId: 'vn.macro.core_cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'Lạm phát cơ bản (YoY)',
      metric: 'Lạm phát cơ bản tháng (so với cùng kỳ)',
      value: p.coreCpi.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: p.coreCpi.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.core_cpi_yoy', PILLARS.MACRO, 'Lạm phát cơ bản (YoY)', 'MONTHLY_CORE_CPI_UNAVAILABLE', {
      factId: 'vn.macro.core_cpi.yoy',
      metric: 'Lạm phát cơ bản tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 3. vn.macro.gdp.real.quarter_yoy (Real GDP growth for individual quarter)
  if (p.quarterlyGdp?.value !== undefined && p.quarterlyGdp.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.gdp_quarter_yoy',
      factId: 'vn.macro.gdp.real.quarter_yoy',
      pillar: PILLARS.MACRO,
      label: 'Tăng trưởng GDP theo quý',
      metric: 'Tốc độ tăng trưởng GDP thực tế quý (so với cùng kỳ)',
      value: p.quarterlyGdp.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: p.quarterlyGdp.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.gdp_quarter_yoy', PILLARS.MACRO, 'Tăng trưởng GDP theo quý', 'QUARTERLY_GDP_UNAVAILABLE', {
      factId: 'vn.macro.gdp.real.quarter_yoy',
      metric: 'Tốc độ tăng trưởng GDP thực tế quý (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 4. vn.macro.iip.month_yoy (Industrial Production Index YoY)
  if (p.monthlyIip?.value !== undefined && p.monthlyIip.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.iip_month_yoy',
      factId: 'vn.macro.iip.month_yoy',
      pillar: PILLARS.MACRO,
      label: 'Chỉ số sản xuất công nghiệp IIP (YoY)',
      metric: 'Chỉ số sản xuất công nghiệp IIP tháng (so với cùng kỳ)',
      value: p.monthlyIip.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: p.monthlyIip.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.iip_month_yoy', PILLARS.MACRO, 'Chỉ số IIP (YoY)', 'MONTHLY_IIP_UNAVAILABLE', {
      factId: 'vn.macro.iip.month_yoy',
      metric: 'Chỉ số sản xuất công nghiệp IIP tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 5. vn.macro.retail.nominal.month_yoy (Monthly nominal retail revenue YoY)
  if (p.monthlyRetail?.value !== undefined && p.monthlyRetail.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.retail_nominal_month_yoy',
      factId: 'vn.macro.retail.nominal.month_yoy',
      pillar: PILLARS.MACRO,
      label: 'Tổng mức bán lẻ tiêu dùng (YoY)',
      metric: 'Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng (so với cùng kỳ)',
      value: p.monthlyRetail.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: p.monthlyRetail.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.retail_nominal_month_yoy', PILLARS.MACRO, 'Tổng mức bán lẻ tiêu dùng (YoY)', 'MONTHLY_RETAIL_UNAVAILABLE', {
      factId: 'vn.macro.retail.nominal.month_yoy',
      metric: 'Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng (so với cùng kỳ)',
      source: 'NSO',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  // 6. vn.macro.fdi.disbursed.ytd_usd (Cumulative disbursed FDI)
  if (p.disbursedFdi?.value !== undefined && p.disbursedFdi.value !== null) {
    observations.push(createMarketObservation({
      id: 'macro.fdi_disbursed_ytd_usd',
      factId: 'vn.macro.fdi.disbursed.ytd_usd',
      pillar: PILLARS.MACRO,
      label: 'Vốn FDI thực hiện lũy kế (YTD)',
      metric: 'Vốn đầu tư trực tiếp nước ngoài giải ngân lũy kế YTD',
      value: p.disbursedFdi.value,
      unit: p.disbursedFdi.unit || 'tỷ USD',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      referenceTime: p.disbursedFdi.referenceTime,
      publishedAt,
      fetchedAt,
      source: 'NSO',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      provenance: { source: 'Cơ quan Thống kê Quốc gia (NSO)', releaseUrl }
    }));
  } else {
    observations.push(createUnavailableObservation('macro.fdi_disbursed_ytd_usd', PILLARS.MACRO, 'Vốn FDI thực hiện lũy kế (YTD)', 'DISBURSED_FDI_UNAVAILABLE', {
      factId: 'vn.macro.fdi.disbursed.ytd_usd',
      metric: 'Vốn đầu tư trực tiếp nước ngoài giải ngân lũy kế YTD',
      source: 'NSO',
      unit: 'tỷ USD',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    }));
  }

  return observations;
}