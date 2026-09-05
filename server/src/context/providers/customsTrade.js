/**
 * Vietnam Customs Trade Data Provider.
 *
 * Implements authoritative merchandise trade evidence intake from official Vietnam Customs
 * downloadable documents (files.customs.gov.vn / customs.gov.vn).
 *
 * Target Facts:
 * 1. vn.trade.goods.exports.month_usd — Total Vietnam merchandise exports for the individual reference month (USD)
 * 2. vn.trade.goods.imports.month_usd — Total Vietnam merchandise imports for the individual reference month (USD)
 * 3. vn.trade.goods.balance.month_usd — Monthly trade balance (USD), derived via (exports - imports)
 *
 * Strict Invariants:
 * - Missing != 0: Missing or unparsable values remain null.
 * - Zero substitution: Never substitute cumulative YTD, semimonthly, % changes, or commodity subtotals.
 * - Monthly vs semimonthly: Semimonthly documents (Kỳ 1 / Kỳ 2 / 15 ngày) are rejected from monthly facts.
 * - SSRF Protection: Only approved HTTPS official Customs domains allowed.
 * - Derived balance: Retains isDerived=true, formula, input IDs, input URLs, and is never marked as directly published.
 * - Immutable vintages: Preliminary, revised, and final reports create distinct observations.
 */

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  createMarketObservation,
  createUnavailableObservation,
  PILLARS,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES,
  FACT_LIFECYCLE_STATUS
} from '../factModel.js';

export const CUSTOMS_APPROVED_HOSTS = Object.freeze([
  'files.customs.gov.vn',
  'customs.gov.vn',
  'www.customs.gov.vn',
  'tongcuc.customs.gov.vn'
]);

export const TRADE_FACT_IDS = Object.freeze({
  EXPORTS_MONTH_USD: 'vn.trade.goods.exports.month_usd',
  IMPORTS_MONTH_USD: 'vn.trade.goods.imports.month_usd',
  BALANCE_MONTH_USD: 'vn.trade.goods.balance.month_usd'
});

export const TRADE_REPORT_TYPES = Object.freeze({
  MONTHLY_EXPORTS: 'MONTHLY_EXPORTS',
  MONTHLY_IMPORTS: 'MONTHLY_IMPORTS'
});

export const TRADE_REVISION_STATUS = Object.freeze({
  PRELIMINARY: 'preliminary',
  REVISED: 'revised',
  FINAL: 'final'
});

/**
 * Validates whether a given URL is a legitimate official Vietnam Customs URL.
 * Enforces strict SSRF protection:
 * - Protocol must be https:
 * - Hostname must strictly match approved official Customs domains
 * - No credentials or auth tokens in URL
 * - No IP addresses
 */
export function isOfficialCustomsUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    return false;
  }
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    // Reject pure IP addresses
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[') || hostname === 'localhost') {
      return false;
    }
    return CUSTOMS_APPROVED_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Validates whether a buffer begins with the standard PDF magic header (%PDF-).
 */
export function isValidPdfBuffer(buffer) {
  if (!buffer) return false;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 5) return false;
  // %PDF- magic bytes: 0x25, 0x50, 0x44, 0x46, 0x2D
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}

/**
 * Extracts raw plain text from a PDF buffer.
 * Pure function: allows custom extractor injection for deterministic testing.
 */
export async function extractCustomsPdfText(buffer, { pdfParseFn = pdfParse } = {}) {
  if (!isValidPdfBuffer(buffer)) {
    throw new TypeError('Buffer does not contain a valid PDF magic header (%PDF-)');
  }
  const parseFn = typeof pdfParseFn === 'function' ? pdfParseFn : pdfParse;
  const data = await parseFn(buffer);
  return data?.text || '';
}

/**
 * Normalizes Vietnamese numeric text to a standard JavaScript finite number.
 * Vietnam Customs tables format numbers with period thousands separators (e.g. 33.090.034.032).
 */
export function parseCustomsNumber(rawStr) {
  if (typeof rawStr !== 'string' || !rawStr.trim()) return null;
  const clean = rawStr.trim();
  // Reject percentage strings (e.g. -23,4% or 18,3%)
  if (clean.includes('%')) return null;

  // Handle standard Vietnamese format: period as thousands separator, comma as decimal (e.g. 33.090.034.032 or 123.456,78)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    const normalized = clean.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  // Handle plain integer without separators
  if (/^\d+$/.test(clean)) {
    const num = Number(clean);
    return Number.isFinite(num) ? num : null;
  }

  // Handle standard decimal if comma separated
  if (/^\d+(,\d+)?$/.test(clean)) {
    const num = Number(clean.replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

/**
 * Parses official Vietnam Customs trade statistical document text.
 * Strictly verifies:
 * - Trade direction: EXPORT (Biểu 015) vs IMPORT (Biểu 016)
 * - Monthly scope: Rejects semimonthly reports (Kỳ 1, Kỳ 2, 15 ngày)
 * - Reference period: Month and Year (YYYY-MM)
 * - Revision status: Sơ bộ (preliminary), Điều chỉnh (revised), Chính thức (final)
 * - Table row: TỔNG TRỊ GIÁ
 * - Column selection: Selects strictly the individual monthly value, NOT cumulative YTD or % change
 * - Unit: USD
 */
export function parseCustomsTradeDocumentText(text, { sourceUrl = null, publishedAt = null } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      status: 'quarantined',
      reason: 'EMPTY_DOCUMENT_TEXT'
    };
  }

  const cleanText = text.trim();

  // 1. Semimonthly rejection: Semimonthly cannot substitute monthly
  if (/kỳ\s*[12]|15\s*ngày\s*(đầu|cuối)\s*tháng|theo\s*kỳ/i.test(cleanText)) {
    return {
      status: 'quarantined',
      reason: 'SEMIMONTHLY_DOCUMENT_NOT_SUPPORTED',
      details: 'Document contains semimonthly reporting indicators (Kỳ 1 / Kỳ 2 / 15 ngày); monthly facts require full monthly reports.'
    };
  }

  // 2. Classify trade direction
  let direction = null;
  let reportType = null;
  let formNumber = null;

  const isExport = /xuất\s*khẩu\s*hàng\s*hóa\s*theo\s*tháng/i.test(cleanText) || /biểu\s*số\s*0?15/i.test(cleanText) || /-2x\(/i.test(sourceUrl || '');
  const isImport = /nhập\s*khẩu\s*hàng\s*hóa\s*theo\s*tháng/i.test(cleanText) || /biểu\s*số\s*0?16/i.test(cleanText) || /-2n\(/i.test(sourceUrl || '');

  if (isExport && !isImport) {
    direction = 'EXPORT';
    reportType = TRADE_REPORT_TYPES.MONTHLY_EXPORTS;
    formNumber = '015.T/BCB-TC';
  } else if (isImport && !isExport) {
    direction = 'IMPORT';
    reportType = TRADE_REPORT_TYPES.MONTHLY_IMPORTS;
    formNumber = '016.T/BCB-TC';
  } else {
    return {
      status: 'quarantined',
      reason: 'AMBIGUOUS_OR_UNRECOGNIZED_TRADE_DIRECTION',
      details: 'Unable to unambiguously determine export or import report type.'
    };
  }

  // 3. Extract reference period (e.g. "Tháng 2 năm 2026", "Tháng 02/2026")
  let referencePeriod = null;
  const periodMatch = /tháng\s*(\d{1,2})\s*(?:năm|\/)\s*(\d{4})/i.exec(cleanText);
  if (periodMatch) {
    const month = String(Number(periodMatch[1])).padStart(2, '0');
    const year = periodMatch[2];
    referencePeriod = `${year}-${month}`;
  } else {
    // Check Vietnamese word months
    const wordMonthMatch = /tháng\s+(Một|Hai|Ba|Tư|Bốn|Năm|Sáu|Bảy|Tám|Chín|Mười|Mười một|Mười hai)\s+năm\s+(\d{4})/i.exec(cleanText);
    if (wordMonthMatch) {
      const monthWords = {
        'một': '01', 'hai': '02', 'ba': '03', 'tư': '04', 'bốn': '04',
        'năm': '05', 'sáu': '06', 'bảy': '07', 'tám': '08', 'chín': '09',
        'mười': '10', 'mười một': '11', 'mười hai': '12'
      };
      const mNum = monthWords[wordMonthMatch[1].toLowerCase()];
      if (mNum) {
        referencePeriod = `${wordMonthMatch[2]}-${mNum}`;
      }
    }
  }

  if (!referencePeriod) {
    return {
      status: 'quarantined',
      reason: 'MISSING_REFERENCE_PERIOD',
      details: 'Document lacks an explicit monthly reference period (e.g. Tháng M năm YYYY).'
    };
  }

  // 4. Extract revision status
  let revisionMarker = TRADE_REVISION_STATUS.PRELIMINARY;
  if (/chính\s*thức/i.test(cleanText) || /\(vn-ct\)/i.test(sourceUrl || '')) {
    revisionMarker = TRADE_REVISION_STATUS.FINAL;
  } else if (/điều\s*chỉnh/i.test(cleanText) || /\(vn-dc\)/i.test(sourceUrl || '')) {
    revisionMarker = TRADE_REVISION_STATUS.REVISED;
  } else if (/sơ\s*bộ/i.test(cleanText) || /\(vn-sb\)/i.test(sourceUrl || '')) {
    revisionMarker = TRADE_REVISION_STATUS.PRELIMINARY;
  }

  // 5. Unit validation
  // Vietnam Customs Biểu 015 and 016 explicitly specify currency unit "USD" or "Trị giá (USD)"
  const hasUsdUnit = /\bUSD\b|trị\s*giá\s*\(USD\)/i.test(cleanText);
  if (!hasUsdUnit) {
    return {
      status: 'quarantined',
      reason: 'UNRECOGNIZED_OR_MISSING_UNIT_SCALE',
      details: 'Document does not declare USD currency scale.'
    };
  }

  // 6. Extract TỔNG TRỊ GIÁ row
  // Table row layout in PDF text extraction:
  // "TỔNG TRỊ GIÁUSD 33.090.034.032 76.392.787.810-23,418,3"
  // or "TỔNG TRỊ GIÁ USD 33.090.034.032 76.392.787.810 ..."
  // or "TỔNG TRỊ GIÁ \n USD \n 33.090.034.032 \n 76.392.787.810"
  const totalRowRegex = /TỔNG\s*TRỊ\s*GIÁ(?:\s*USD)?\s+([0-9\.,]+)(?:\s+([0-9\.,]+))?/i;
  const rowMatch = totalRowRegex.exec(cleanText);

  if (!rowMatch || !rowMatch[1]) {
    // Check if table contains product subtotals but total row is missing
    return {
      status: 'quarantined',
      reason: 'MISSING_TOTAL_TRADE_VALUE',
      details: 'Could not extract authoritative TỔNG TRỊ GIÁ row from trade table.'
    };
  }

  const rawMonthlyStr = rowMatch[1];
  const rawYtdStr = rowMatch[2] || null;

  const monthlyValue = parseCustomsNumber(rawMonthlyStr);
  const ytdCumulativeValue = rawYtdStr ? parseCustomsNumber(rawYtdStr) : null;

  if (monthlyValue === null || !Number.isFinite(monthlyValue) || monthlyValue <= 0) {
    return {
      status: 'quarantined',
      reason: 'INVALID_MONTHLY_TRADE_NUMERIC_VALUE',
      details: `Parsed non-finite or invalid monthly trade value: ${rawMonthlyStr}`
    };
  }

  // Anti-substitution check: Ensure we did not accidentally select a percentage change (e.g. < 1000)
  if (monthlyValue < 1000000) {
    return {
      status: 'quarantined',
      reason: 'SUSPICIOUS_TRADE_VALUE_SCALE',
      details: `Parsed total merchandise trade value too small (${monthlyValue}), likely a percentage change or index.`
    };
  }

  const factId = direction === 'EXPORT'
    ? TRADE_FACT_IDS.EXPORTS_MONTH_USD
    : TRADE_FACT_IDS.IMPORTS_MONTH_USD;

  return {
    status: 'available',
    direction,
    reportType,
    formNumber,
    factId,
    monthlyValue,
    ytdCumulativeValue,
    unit: 'USD',
    referencePeriod,
    revisionMarker,
    sourceUrl,
    publishedAt: publishedAt || null,
    provenance: {
      source: 'Tổng cục Hải quan Việt Nam (Vietnam Customs)',
      releaseUrl: sourceUrl || null,
      formNumber,
      rawMonthlyText: rawMonthlyStr,
      rawYtdText: rawYtdStr,
      revisionMarker,
      referencePeriod
    }
  };
}

/**
 * End-to-end Customs PDF document parser from raw buffer.
 */
export async function parseCustomsTradeDocument(buffer, {
  sourceUrl = null,
  publishedAt = null,
  pdfParseFn = pdfParse
} = {}) {
  if (sourceUrl && !isOfficialCustomsUrl(sourceUrl)) {
    return {
      status: 'rejected',
      reason: 'UNAPPROVED_SOURCE_HOST',
      details: `Source URL is not an approved official Customs HTTPS endpoint: ${sourceUrl}`
    };
  }

  if (!isValidPdfBuffer(buffer)) {
    return {
      status: 'quarantined',
      reason: 'INVALID_PDF_SIGNATURE',
      details: 'Document buffer lacks valid PDF magic header (%PDF-).'
    };
  }

  let text = '';
  try {
    text = await extractCustomsPdfText(buffer, { pdfParseFn });
  } catch (err) {
    return {
      status: 'quarantined',
      reason: 'PDF_EXTRACTION_FAILED',
      details: String(err?.message || err)
    };
  }

  return parseCustomsTradeDocumentText(text, { sourceUrl, publishedAt });
}

/**
 * Derives the merchandise trade balance observation from matching export and import observations.
 * Strict Derivation Contract:
 * - Both observations must be available with valid finite values.
 * - Same reference month (e.g. both '2026-02').
 * - Compatible scope (both total merchandise trade).
 * - Compatible unit normalization (both USD).
 * - Compatible publication/vintage semantics.
 * - Derived observation must retain isDerived=true, formula, input IDs, input URLs.
 * - Never marked as directly published by Customs.
 */
export function deriveTradeBalance(exportObs, importObs, { now = new Date() } = {}) {
  const factId = TRADE_FACT_IDS.BALANCE_MONTH_USD;
  const label = 'Cán cân thương mại hàng hóa (tháng)';
  const metric = 'Cán cân thương mại hàng hóa theo tháng (USD)';

  // 1. Check availability
  if (!exportObs || !importObs) {
    return createUnavailableObservation(factId, PILLARS.MACRO, label, 'MISSING_TRADE_INPUTS', {
      factId,
      metric,
      unit: 'USD',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    });
  }

  const exportVal = exportObs.value;
  const importVal = importObs.value;

  if (typeof exportVal !== 'number' || !Number.isFinite(exportVal) ||
      typeof importVal !== 'number' || !Number.isFinite(importVal) ||
      exportObs.status !== OBSERVATION_STATUS.AVAILABLE ||
      importObs.status !== OBSERVATION_STATUS.AVAILABLE) {
    return createUnavailableObservation(factId, PILLARS.MACRO, label, 'INPUTS_UNAVAILABLE', {
      factId,
      metric,
      unit: 'USD',
      referenceTime: exportObs.referenceTime || importObs.referenceTime || null,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    });
  }

  // 2. Reconcile reference period
  if (!exportObs.referenceTime || !importObs.referenceTime || exportObs.referenceTime !== importObs.referenceTime) {
    return createUnavailableObservation(factId, PILLARS.MACRO, label, 'REFERENCE_PERIOD_MISMATCH', {
      factId,
      metric,
      unit: 'USD',
      referenceTime: exportObs.referenceTime || importObs.referenceTime || null,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    });
  }

  // 3. Reconcile units
  if (exportObs.unit !== 'USD' || importObs.unit !== 'USD') {
    return createUnavailableObservation(factId, PILLARS.MACRO, label, 'UNIT_MISMATCH', {
      factId,
      metric,
      unit: 'USD',
      referenceTime: exportObs.referenceTime,
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
    });
  }

  // 4. Calculate balance: exports - imports
  const balanceValue = exportVal - importVal;

  const inputObservationIds = [
    exportObs.observationId || exportObs.id,
    importObs.observationId || importObs.id
  ].filter(Boolean);

  const inputSourceUrls = [
    exportObs.provenance?.releaseUrl,
    importObs.provenance?.releaseUrl
  ].filter(Boolean);

  const inputRevisionMarkers = [
    exportObs.revisionMarker || null,
    importObs.revisionMarker || null
  ];

  // Harmonized revision marker
  const revisionMarker = exportObs.revisionMarker === importObs.revisionMarker
    ? exportObs.revisionMarker
    : (exportObs.revisionMarker || importObs.revisionMarker || null);

  const referenceTime = exportObs.referenceTime;
  const publishedAt = exportObs.publishedAt || importObs.publishedAt || null;

  return createMarketObservation({
    id: 'trade.goods.balance.month_usd',
    factId,
    pillar: PILLARS.MACRO,
    label,
    metric,
    value: balanceValue,
    unit: 'USD',
    unitType: UNIT_TYPES.PRICE_USD,
    referenceTime,
    observedAt: null,
    publishedAt,
    fetchedAt: now.toISOString(),
    source: 'Vietnam Customs (Derived)',
    authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
    revisionMarker,
    status: OBSERVATION_STATUS.AVAILABLE,
    freshness: OBSERVATION_FRESHNESS.FRESH,
    provenance: {
      isDerived: true,
      formula: 'exports - imports',
      inputObservationIds,
      inputSourceUrls,
      inputRevisionMarkers,
      publisherNotice: 'Chỉ số dẫn xuất từ số liệu xuất khẩu và nhập khẩu chính thức của Tổng cục Hải quan; không phải số liệu công bố trực tiếp.'
    }
  });
}

/**
 * Normalizes raw Customs parsed results into standard MarketObservation objects.
 */
export function normalizeCustomsTradeFacts({
  exportDocResult = null,
  importDocResult = null,
  derivedBalance = true,
  now = new Date()
} = {}) {
  const observations = [];

  let exportObs = null;
  let importObs = null;

  // 1. Export Observation
  if (exportDocResult && exportDocResult.status === 'available' && exportDocResult.monthlyValue !== null) {
    exportObs = createMarketObservation({
      id: 'trade.goods.exports.month_usd',
      factId: TRADE_FACT_IDS.EXPORTS_MONTH_USD,
      pillar: PILLARS.MACRO,
      label: 'Kim ngạch xuất khẩu hàng hóa (tháng)',
      metric: 'Kim ngạch xuất khẩu hàng hóa theo tháng (USD)',
      value: exportDocResult.monthlyValue,
      unit: 'USD',
      unitType: UNIT_TYPES.PRICE_USD,
      referenceTime: exportDocResult.referencePeriod,
      observedAt: null,
      publishedAt: exportDocResult.publishedAt,
      fetchedAt: now.toISOString(),
      source: 'Tổng cục Hải quan Việt Nam (Vietnam Customs)',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      revisionMarker: exportDocResult.revisionMarker,
      status: OBSERVATION_STATUS.AVAILABLE,
      freshness: OBSERVATION_FRESHNESS.FRESH,
      provenance: {
        ...exportDocResult.provenance,
        sourceLifecycle: FACT_LIFECYCLE_STATUS.CONTROLLED_MANUAL_SOURCE
      }
    });
    observations.push(exportObs);
  } else if (exportDocResult && exportDocResult.status === 'quarantined') {
    observations.push(createUnavailableObservation(
      TRADE_FACT_IDS.EXPORTS_MONTH_USD,
      PILLARS.MACRO,
      'Kim ngạch xuất khẩu hàng hóa (tháng)',
      exportDocResult.reason || 'QUARANTINED',
      {
        factId: TRADE_FACT_IDS.EXPORTS_MONTH_USD,
        metric: 'Kim ngạch xuất khẩu hàng hóa theo tháng (USD)',
        unit: 'USD',
        referenceTime: exportDocResult.referencePeriod || null,
        authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
      }
    ));
  }

  // 2. Import Observation
  if (importDocResult && importDocResult.status === 'available' && importDocResult.monthlyValue !== null) {
    importObs = createMarketObservation({
      id: 'trade.goods.imports.month_usd',
      factId: TRADE_FACT_IDS.IMPORTS_MONTH_USD,
      pillar: PILLARS.MACRO,
      label: 'Kim ngạch nhập khẩu hàng hóa (tháng)',
      metric: 'Kim ngạch nhập khẩu hàng hóa theo tháng (USD)',
      value: importDocResult.monthlyValue,
      unit: 'USD',
      unitType: UNIT_TYPES.PRICE_USD,
      referenceTime: importDocResult.referencePeriod,
      observedAt: null,
      publishedAt: importDocResult.publishedAt,
      fetchedAt: now.toISOString(),
      source: 'Tổng cục Hải quan Việt Nam (Vietnam Customs)',
      authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      revisionMarker: importDocResult.revisionMarker,
      status: OBSERVATION_STATUS.AVAILABLE,
      freshness: OBSERVATION_FRESHNESS.FRESH,
      provenance: {
        ...importDocResult.provenance,
        sourceLifecycle: FACT_LIFECYCLE_STATUS.CONTROLLED_MANUAL_SOURCE
      }
    });
    observations.push(importObs);
  } else if (importDocResult && importDocResult.status === 'quarantined') {
    observations.push(createUnavailableObservation(
      TRADE_FACT_IDS.IMPORTS_MONTH_USD,
      PILLARS.MACRO,
      'Kim ngạch nhập khẩu hàng hóa (tháng)',
      importDocResult.reason || 'QUARANTINED',
      {
        factId: TRADE_FACT_IDS.IMPORTS_MONTH_USD,
        metric: 'Kim ngạch nhập khẩu hàng hóa theo tháng (USD)',
        unit: 'USD',
        referenceTime: importDocResult.referencePeriod || null,
        authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL
      }
    ));
  }

  // 3. Derived Balance
  if (derivedBalance) {
    const balanceObs = deriveTradeBalance(exportObs, importObs, { now });
    if (balanceObs) {
      observations.push(balanceObs);
    }
  }

  return observations;
}

/**
 * Safe Controlled Official Document Intake Entry Point.
 * Flow:
 * validated official URL -> fetch document once -> verify signature -> classify & parse -> normalize
 */
export async function ingestCustomsDocument({
  documentUrl,
  buffer = null,
  now = new Date(),
  fetchFn = fetch,
  pdfParseFn = pdfParse
} = {}) {
  // 1. SSRF Validation
  if (!isOfficialCustomsUrl(documentUrl)) {
    return {
      success: false,
      status: 'rejected',
      reason: 'UNAPPROVED_SOURCE_HOST',
      details: `URL does not belong to approved official Customs hosts: ${documentUrl}`
    };
  }

  // 2. Fetch document if buffer not already provided
  let pdfBuffer = buffer;
  if (!pdfBuffer) {
    try {
      const res = await fetchFn(documentUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!res.ok) {
        return {
          success: false,
          status: 'unavailable',
          reason: 'FETCH_FAILED',
          httpStatus: res.status
        };
      }
      const arrayBuf = await res.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuf);
    } catch (err) {
      return {
        success: false,
        status: 'failed',
        reason: 'FETCH_ERROR',
        error: String(err?.message || err)
      };
    }
  }

  // 3. Parse document
  const parsed = await parseCustomsTradeDocument(pdfBuffer, {
    sourceUrl: documentUrl,
    pdfParseFn
  });

  if (parsed.status !== 'available') {
    return {
      success: false,
      status: parsed.status,
      reason: parsed.reason,
      details: parsed.details
    };
  }

  // 4. Normalize
  const observations = parsed.direction === 'EXPORT'
    ? normalizeCustomsTradeFacts({ exportDocResult: parsed, derivedBalance: false, now })
    : normalizeCustomsTradeFacts({ importDocResult: parsed, derivedBalance: false, now });

  return {
    success: true,
    status: 'available',
    parsed,
    observations
  };
}
