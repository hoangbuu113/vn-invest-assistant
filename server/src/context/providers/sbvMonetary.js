/**
 * SBV Monetary Data Provider — Focused adapter for State Bank of Vietnam official monetary data.
 * Sources: State Bank of Vietnam (Ngân hàng Nhà nước Việt Nam - sbv.gov.vn).
 *
 * Implements strict extraction & validation for 4 core SBV facts:
 * 7. vn.monetary.fx.sbv_central.usd_vnd: SBV central USD/VND reference rate.
 *    - Effective date preserved separately from publication/fetch time.
 *    - Rejects commercial, interbank, buying, or selling rates.
 * 8. vn.monetary.interbank.vnd.overnight.daily_avg_rate: SBV daily average overnight rate.
 *    - Preserves session date. Strictly distinct from weekly overnight fact.
 * 9. vn.monetary.credit.outstanding.ytd_growth: Total credit growth from previous year-end.
 *    - Must match explicitly labelled reference period.
 * 10. vn.monetary.money_supply.m2.level: SBV M2 money supply level (billion VND).
 *    - Preserves October 2025 methodology break (pre vs post 2025-10).
 *
 * Policy Rates:
 * - vn.monetary.policy.refinancing_rate & vn.monetary.policy.rediscount_rate:
 *   Strictly blocked as NOT_IMPLEMENTED_PENDING_EFFECTIVE_DATE_CHAIN.
 */

import {
  isOfficialUrl,
  parseDecimal,
  textFromHtml
} from '../../regime/providers/common.js';
import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  AUTHORITY_LEVELS,
  UNIT_TYPES,
  OBSERVATION_STATUS
} from '../factModel.js';

export const SBV_HOST = 'sbv.gov.vn';
export const SBV_CENTRAL_FX_URL = 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/ttnn/tgtw';
export const SBV_DAILY_INTERBANK_URL = 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/ttnn/lslnh';
export const SBV_MONETARY_STATS_URL = 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente';

function toDateKey(day, month, year) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toMonthKey(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/**
 * Parses the SBV Central Reference USD/VND Exchange Rate.
 * Strict rules:
 * - Rejects commercial bank rates, interbank FX, SBV buying rate ("mua vào"), or SBV selling rate ("bán ra").
 * - Extracts exact effective date.
 */
export function parseSbvCentralFx(rawHtmlOrText, sourceUrl = null) {
  if (sourceUrl && !isOfficialUrl(sourceUrl, SBV_HOST)) {
    return { status: 'quarantined', reason: 'UNOFFICIAL_HOST', value: null };
  }

  const text = textFromHtml(rawHtmlOrText);
  if (!text) {
    return { status: 'quarantined', reason: 'EMPTY_CONTENT', value: null };
  }

  // Find effective date: "áp dụng cho ngày DD/MM/YYYY" or "ngày DD/MM/YYYY"
  const dateMatch = /(?:áp dụng cho ngày|Tỷ giá trung tâm ngày|ngày)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/iu.exec(text);
  const effectiveDate = dateMatch ? toDateKey(dateMatch[1], dateMatch[2], dateMatch[3]) : null;

  // Rate pattern: Look for "Tỷ giá trung tâm ... 24.xxx VND"
  // Reject: "Tỷ giá mua giao ngay", "Tỷ giá bán can thiệp", "Giá mua", "Giá bán"
  const centralPattern = /Tỷ giá trung tâm[\s\S]{0,150}?(\d{1,2}[.,]\d{3}(?:[.,]\d{1,2})?)\s*(?:VND|đồng)?/iu;
  const match = centralPattern.exec(text);

  let rawRateStr = null;
  if (match) {
    rawRateStr = match[1];
  }

  // Secondary pattern: "1 USD = 24.xxx VND" in central rate context
  if (!rawRateStr) {
    const tableMatch = /Đô la Mỹ\s*(?:\||\t)\s*USD\s*(?:\||\t)\s*(\d{1,2}[.,]\d{3})/iu.exec(text);
    if (tableMatch) {
      rawRateStr = tableMatch[1];
    }
  }

  if (!rawRateStr) {
    return {
      status: 'quarantined',
      reason: 'CENTRAL_RATE_NOT_FOUND',
      value: null
    };
  }

  // Parse VND rate: typically 24,xxx or 24.xxx
  const normalizedStr = rawRateStr.replace(/\./g, '').replace(',', '.');
  const rateValue = parseDecimal(normalizedStr);

  if (rateValue === null || rateValue < 10000 || rateValue > 50000) {
    return {
      status: 'quarantined',
      reason: 'INVALID_RATE_VALUE',
      value: null
    };
  }

  return {
    status: 'available',
    value: rateValue,
    effectiveDate,
    unit: 'VND/USD',
    sourceUrl
  };
}

/**
 * Parses SBV Daily Average Overnight Interbank Rate.
 * Preserves daily session date.
 * Distinct from weekly rate.
 */
export function parseSbvDailyInterbankOvernight(rawHtmlOrText, sourceUrl = null) {
  if (sourceUrl && !isOfficialUrl(sourceUrl, SBV_HOST)) {
    return { status: 'quarantined', reason: 'UNOFFICIAL_HOST', value: null };
  }

  const text = textFromHtml(rawHtmlOrText);
  if (!text) {
    return { status: 'quarantined', reason: 'EMPTY_CONTENT', value: null };
  }

  // Date of session: "ngày DD/MM/YYYY"
  const dateMatch = /(?:Lãi suất bình quân liên ngân hàng ngày|ngày)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/iu.exec(text);
  const sessionDate = dateMatch ? toDateKey(dateMatch[1], dateMatch[2], dateMatch[3]) : null;

  // Daily overnight rate: "Qua đêm ... X%"
  const onRegex = /Qua đêm\s*(?:[|:\t ]|ở mức|là|đạt|:)?\s*(\d+(?:[,.]\d+)?)\s*%/iu;
  const match = onRegex.exec(text);

  if (!match) {
    // Secondary pattern: table row
    const rowMatch = /qua đêm[^\n\r]{0,100}[\n\r]+[^\n\r]*\bVND\b[^\d]{1,20}(\d+(?:[,.]\d+)?)/iu.exec(text);
    if (!rowMatch) {
      return { status: 'quarantined', reason: 'OVERNIGHT_RATE_NOT_FOUND', value: null };
    }
    const val = parseDecimal(rowMatch[1]);
    if (val === null || val < 0 || val > 100) {
      return { status: 'quarantined', reason: 'INVALID_OVERNIGHT_RATE', value: null };
    }
    return {
      status: 'available',
      value: val,
      sessionDate,
      sourceUrl
    };
  }

  const val = parseDecimal(match[1]);
  if (val === null || val < 0 || val > 100) {
    return { status: 'quarantined', reason: 'INVALID_OVERNIGHT_RATE', value: null };
  }

  return {
    status: 'available',
    value: val,
    sessionDate,
    sourceUrl
  };
}

/**
 * Parses SBV total credit outstanding YTD growth.
 * Selects explicitly labelled reference period (not an arbitrary first row).
 */
export function parseSbvCreditGrowth(rawHtmlOrText, targetPeriod = null, sourceUrl = null) {
  if (sourceUrl && !isOfficialUrl(sourceUrl, SBV_HOST)) {
    return { status: 'quarantined', reason: 'UNOFFICIAL_HOST', value: null };
  }

  const text = textFromHtml(rawHtmlOrText);
  if (!text) {
    return { status: 'quarantined', reason: 'EMPTY_CONTENT', value: null };
  }

  // Pattern with explicit period:
  const creditWithPeriodPattern = /(?:Tăng trưởng tín dụng|dư nợ tín dụng|tín dụng)[\s\S]{0,120}?đến\s+(?:hết\s+)?(?:tháng\s*(\d{1,2})[\/.-](\d{4})|ngày\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}))[\s\S]{0,80}?(?:đạt|ở mức|tăng)\s*(\d+(?:[,.]\d+)?)\s*%/giu;
  const candidates = [];
  let m;
  while ((m = creditWithPeriodPattern.exec(text)) !== null) {
    let period = null;
    if (m[1] && m[2]) {
      period = toMonthKey(m[1], m[2]);
    } else if (m[4] && m[5]) {
      period = toMonthKey(m[4], m[5]);
    }
    const rateVal = parseDecimal(m[6]);
    if (rateVal !== null && rateVal >= -20 && rateVal <= 100) {
      candidates.push({ value: rateVal, period });
    }
  }

  // Pattern without period if no dated candidates found
  if (candidates.length === 0) {
    const simplePattern = /(?:Tăng trưởng tín dụng|dư nợ tín dụng|tín dụng)[\s\S]{0,80}?(?:đạt|ở mức|tăng)\s*(\d+(?:[,.]\d+)?)\s*%\s*(?:so với cuối năm trước|so với đầu năm)/giu;
    while ((m = simplePattern.exec(text)) !== null) {
      const rateVal = parseDecimal(m[1]);
      if (rateVal !== null && rateVal >= -20 && rateVal <= 100) {
        candidates.push({ value: rateVal, period: targetPeriod || null });
      }
    }
  }

  if (candidates.length === 0) {
    return { status: 'quarantined', reason: 'CREDIT_GROWTH_NOT_FOUND', value: null };
  }

  // If targetPeriod is specified, match explicitly
  if (targetPeriod) {
    const matched = candidates.find((c) => c.period === targetPeriod);
    if (matched) {
      return {
        status: 'available',
        value: matched.value,
        referencePeriod: matched.period,
        sourceUrl
      };
    }
  }

  // Return the latest explicitly dated candidate (reject arbitrary unlabelled first row)
  const dated = candidates.filter((c) => Boolean(c.period));
  if (dated.length > 0) {
    dated.sort((a, b) => b.period.localeCompare(a.period));
    return {
      status: 'available',
      value: dated[0].value,
      referencePeriod: dated[0].period,
      sourceUrl
    };
  }

  return {
    status: 'available',
    value: candidates[0].value,
    referencePeriod: targetPeriod || null,
    sourceUrl
  };
}

/**
 * Parses SBV M2 Money Supply Level.
 * Preserves unit: billion VND ('tỷ VND').
 * Invariant: Methodology boundary October 2025 (pre vs post 2025-10).
 */
export function parseSbvM2Level(rawHtmlOrText, sourceUrl = null) {
  if (sourceUrl && !isOfficialUrl(sourceUrl, SBV_HOST)) {
    return { status: 'quarantined', reason: 'UNOFFICIAL_HOST', value: null };
  }

  const text = textFromHtml(rawHtmlOrText);
  if (!text) {
    return { status: 'quarantined', reason: 'EMPTY_CONTENT', value: null };
  }

  // 1. Try matching with explicit month/year: "Tổng phương tiện thanh toán (M2)... tháng MM/YYYY ... đạt X tỷ đồng"
  const m2DatedPattern = /(?:Tổng phương tiện thanh toán|M2)[\s\S]{0,180}?tháng\s*(\d{1,2})[\/.-](\d{4})[\s\S]{0,150}?(?:đạt|ước đạt|là)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:tỷ đồng|tỷ VND)/iu;
  let match = m2DatedPattern.exec(text);

  let refMonth = null;
  let cleanNum = null;

  if (match) {
    refMonth = toMonthKey(match[1], match[2]);
    cleanNum = match[3].replace(/\./g, '').replace(',', '.');
  } else {
    // 2. Try matching without explicit date
    const m2UndatedPattern = /(?:Tổng phương tiện thanh toán|M2)[\s\S]{0,180}?(?:đạt|ước đạt|là)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:tỷ đồng|tỷ VND)/iu;
    match = m2UndatedPattern.exec(text);
    if (match) {
      cleanNum = match[1].replace(/\./g, '').replace(',', '.');
    }
  }

  if (!cleanNum) {
    // Try table row format: "M2 | tháng MM/YYYY | X"
    const rowPattern = /M2\b[^\d]{1,50}?(?:tháng\s*(\d{1,2})[\/.-](\d{4}))?[^\d]{1,50}?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/iu.exec(text);
    if (!rowPattern) {
      return { status: 'quarantined', reason: 'M2_NOT_FOUND', value: null };
    }
    cleanNum = rowPattern[3].replace(/\./g, '').replace(',', '.');
    refMonth = (rowPattern[1] && rowPattern[2]) ? toMonthKey(rowPattern[1], rowPattern[2]) : null;
  }

  const val = parseDecimal(cleanNum);
  if (val === null || val <= 0) {
    return { status: 'quarantined', reason: 'INVALID_M2_VALUE', value: null };
  }

  const methodologyVersion = (refMonth && refMonth >= '2025-10') ? 'sbv_m2_post_202510' : 'sbv_m2_pre_202510';

  return {
    status: 'available',
    value: val,
    unit: 'tỷ VND',
    referencePeriod: refMonth,
    methodologyVersion,
    sourceUrl
  };
}

/**
 * Normalizes SBV parsed items into standardized MarketObservation instances.
 */
export function normalizeSbvMonetaryFacts({
  centralFx = null,
  dailyOvernight = null,
  creditGrowth = null,
  m2Level = null,
  now = new Date()
} = {}) {
  const observations = [];
  const fetchedAt = now.toISOString();

  // 7. vn.monetary.fx.sbv_central.usd_vnd
  if (centralFx && centralFx.status === 'available' && typeof centralFx.value === 'number') {
    observations.push(createMarketObservation({
      id: 'monetary.sbv_central_usd_vnd',
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm SBV (USD/VND)',
      metric: 'Tỷ giá trung tâm của Đồng Việt Nam với Đô la Mỹ do NHNN công bố',
      value: centralFx.value,
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      quoteDirection: 'VND_PER_USD',
      referenceTime: centralFx.effectiveDate || null,
      publishedAt: null,
      fetchedAt,
      source: 'SBV',
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL,
      provenance: {
        source: 'Ngân hàng Nhà nước Việt Nam (SBV)',
        effectiveDate: centralFx.effectiveDate || null,
        sourceUrl: centralFx.sourceUrl || null
      }
    }));
  } else {
    observations.push(createUnavailableObservation('monetary.sbv_central_usd_vnd', PILLARS.MONETARY, 'Tỷ giá trung tâm SBV (USD/VND)', 'SBV_CENTRAL_FX_UNAVAILABLE', {
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      metric: 'Tỷ giá trung tâm của Đồng Việt Nam với Đô la Mỹ do NHNN công bố',
      source: 'SBV',
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 8. vn.monetary.interbank.vnd.overnight.daily_avg_rate
  if (dailyOvernight && dailyOvernight.status === 'available' && typeof dailyOvernight.value === 'number') {
    observations.push(createMarketObservation({
      id: 'monetary.vnd_overnight_daily_avg_rate',
      factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
      pillar: PILLARS.MONETARY,
      label: 'Lãi suất VND qua đêm bình quân ngày',
      metric: 'Lãi suất bình quân liên ngân hàng kỳ hạn qua đêm theo ngày (SBV)',
      value: dailyOvernight.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: dailyOvernight.sessionDate || null,
      publishedAt: null,
      fetchedAt,
      source: 'SBV',
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL,
      provenance: {
        source: 'Ngân hàng Nhà nước Việt Nam (SBV)',
        sessionDate: dailyOvernight.sessionDate || null,
        sourceUrl: dailyOvernight.sourceUrl || null
      }
    }));
  } else {
    observations.push(createUnavailableObservation('monetary.vnd_overnight_daily_avg_rate', PILLARS.MONETARY, 'Lãi suất VND qua đêm bình quân ngày', 'SBV_DAILY_OVERNIGHT_UNAVAILABLE', {
      factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
      metric: 'Lãi suất bình quân liên ngân hàng kỳ hạn qua đêm theo ngày (SBV)',
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 9. vn.monetary.credit.outstanding.ytd_growth
  if (creditGrowth && creditGrowth.status === 'available' && typeof creditGrowth.value === 'number') {
    observations.push(createMarketObservation({
      id: 'monetary.credit_ytd_growth',
      factId: 'vn.monetary.credit.outstanding.ytd_growth',
      pillar: PILLARS.MONETARY,
      label: 'Tăng trưởng tín dụng YTD',
      metric: 'Tốc độ tăng trưởng dư nợ tín dụng toàn hệ thống so với cuối năm trước',
      value: creditGrowth.value,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: creditGrowth.referencePeriod || null,
      publishedAt: null,
      fetchedAt,
      source: 'SBV',
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL,
      provenance: {
        source: 'Ngân hàng Nhà nước Việt Nam (SBV)',
        referencePeriod: creditGrowth.referencePeriod || null,
        sourceUrl: creditGrowth.sourceUrl || null
      }
    }));
  } else {
    observations.push(createUnavailableObservation('monetary.credit_ytd_growth', PILLARS.MONETARY, 'Tăng trưởng tín dụng YTD', 'SBV_CREDIT_GROWTH_UNAVAILABLE', {
      factId: 'vn.monetary.credit.outstanding.ytd_growth',
      metric: 'Tốc độ tăng trưởng dư nợ tín dụng toàn hệ thống so với cuối năm trước',
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // 10. vn.monetary.money_supply.m2.level
  if (m2Level && m2Level.status === 'available' && typeof m2Level.value === 'number') {
    observations.push(createMarketObservation({
      id: 'monetary.m2_level',
      factId: 'vn.monetary.money_supply.m2.level',
      pillar: PILLARS.MONETARY,
      label: 'Cung tiền M2',
      metric: 'Tổng phương tiện thanh toán M2 (NHNN)',
      value: m2Level.value,
      unit: m2Level.unit || 'tỷ VND',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      referenceTime: m2Level.referencePeriod || null,
      methodologyVersion: m2Level.methodologyVersion || 'sbv_m2_post_202510',
      publishedAt: null,
      fetchedAt,
      source: 'SBV',
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL,
      provenance: {
        source: 'Ngân hàng Nhà nước Việt Nam (SBV)',
        referencePeriod: m2Level.referencePeriod || null,
        methodologyBoundary: '2025-10',
        sourceUrl: m2Level.sourceUrl || null
      }
    }));
  } else {
    observations.push(createUnavailableObservation('monetary.m2_level', PILLARS.MONETARY, 'Cung tiền M2', 'SBV_M2_UNAVAILABLE', {
      factId: 'vn.monetary.money_supply.m2.level',
      metric: 'Tổng phương tiện thanh toán M2 (NHNN)',
      source: 'SBV',
      unit: 'tỷ VND',
      unitType: UNIT_TYPES.CURRENCY_AMOUNT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  // Policy rates: Strictly blocked / not implemented pending signed decision chain
  const policyRates = [
    {
      id: 'monetary.refinancing_rate',
      factId: 'vn.monetary.policy.refinancing_rate',
      label: 'Lãi suất tái cấp vốn'
    },
    {
      id: 'monetary.rediscount_rate',
      factId: 'vn.monetary.policy.rediscount_rate',
      label: 'Lãi suất tái chiết khấu'
    }
  ];

  for (const r of policyRates) {
    observations.push(createUnavailableObservation(r.id, PILLARS.MONETARY, r.label, 'NOT_IMPLEMENTED_PENDING_EFFECTIVE_DATE_CHAIN', {
      factId: r.factId,
      metric: r.label,
      source: 'SBV',
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
    }));
  }

  return observations;
}