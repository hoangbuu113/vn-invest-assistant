import {
  extractLinks,
  fetchOfficialResource,
  isOfficialUrl,
  parseDecimal,
  textFromHtml
} from './common.js';

export const SBV_RELEASE_INDEX_URL = 'https://www.sbv.gov.vn/vi/thong-cao-bao-chi';
const SBV_HOST = 'sbv.gov.vn';
const SBV_SOURCE_NAME = 'Ngân hàng Nhà nước Việt Nam';
const DAY_MS = 24 * 60 * 60 * 1000;

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

function parseReferenceWeek(text) {
  const match = /(?:tuần\s+)?từ(?:\s+ngày)?\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?\s*(?:đến|tới|[-–—])\s*(?:ngày\s*)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/iu.exec(text);
  if (!match) return null;

  const endYear = Number(match[6]);
  const startMonth = Number(match[2]);
  const endMonth = Number(match[5]);
  const startYear = match[3]
    ? Number(match[3])
    : (startMonth > endMonth ? endYear - 1 : endYear);
  const start = toDateKey(match[1], match[2], startYear);
  const end = toDateKey(match[4], match[5], endYear);
  if (!start || !end || start > end) return null;
  return { referenceWeekStart: start, referenceWeekEnd: end };
}

function parseOvernightRate(text) {
  const patterns = [
    /(?:lãi suất[^.;]{0,180})?kỳ hạn\s+qua đêm\s*(?:ở mức|là|đạt|:)?\s*(\d+(?:[,.]\d+)?)\s*%/iu,
    /lãi suất[^.;]{0,220}?qua đêm[^0-9]{0,30}(\d+(?:[,.]\d+)?)\s*%/iu,
    /qua đêm\s*[|:]\s*(\d+(?:[,.]\d+)?)\s*%?/iu
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match ? parseDecimal(match[1]) : null;
    if (value !== null && value >= 0 && value <= 100) return value;
  }

  const tableMatch = /qua đêm[^\n\r]{0,180}[\n\r]+[^\n\r]*\bVND\b\s*[|:\t ]+\s*(\d+(?:[,.]\d+)?)/iu.exec(text);
  const tableValue = tableMatch ? parseDecimal(tableMatch[1]) : null;
  return tableValue !== null && tableValue >= 0 && tableValue <= 100 ? tableValue : null;
}

export function parseSbvWeeklyRelease(rawText, releaseUrl, pdfUrl = null) {
  if (!isOfficialUrl(releaseUrl, SBV_HOST)) return null;
  if (pdfUrl && !isOfficialUrl(pdfUrl, SBV_HOST)) return null;
  const text = textFromHtml(rawText);
  if (!text) return null;
  const week = parseReferenceWeek(text);
  const vndOvernightRatePct = parseOvernightRate(text);
  if (!week || vndOvernightRatePct === null) return null;
  return {
    ...week,
    vndOvernightRatePct,
    releaseUrl,
    pdfUrl
  };
}

function areConsecutiveOfficialWeeks(observations) {
  for (let index = 1; index < observations.length; index += 1) {
    const previousEnd = Date.parse(`${observations[index - 1].referenceWeekEnd}T00:00:00Z`);
    const currentStart = Date.parse(`${observations[index].referenceWeekStart}T00:00:00Z`);
    const gapDays = (currentStart - previousEnd) / DAY_MS;
    if (!Number.isInteger(gapDays) || gapDays < 1 || gapDays > 4) return false;
  }
  return true;
}

export function buildMoneyMarketDomain(observations = []) {
  const byWeek = new Map();
  for (const observation of observations) {
    if (
      observation &&
      /^\d{4}-\d{2}-\d{2}$/.test(observation.referenceWeekStart || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(observation.referenceWeekEnd || '') &&
      observation.referenceWeekStart <= observation.referenceWeekEnd &&
      Number.isFinite(observation.vndOvernightRatePct) &&
      observation.vndOvernightRatePct >= 0 &&
      isOfficialUrl(observation.releaseUrl, SBV_HOST) &&
      (!observation.pdfUrl || isOfficialUrl(observation.pdfUrl, SBV_HOST))
    ) {
      const key = `${observation.referenceWeekStart}/${observation.referenceWeekEnd}`;
      if (!byWeek.has(key)) byWeek.set(key, observation);
    }
  }

  const ordered = [...byWeek.values()].sort((a, b) => (
    a.referenceWeekStart.localeCompare(b.referenceWeekStart) ||
    a.referenceWeekEnd.localeCompare(b.referenceWeekEnd)
  ));
  const latest = ordered.at(-1);
  if (!latest) return unavailableMoneyMarket();

  const latestEight = ordered.slice(-8);
  const sufficient = latestEight.length === 8 && areConsecutiveOfficialWeeks(latestEight);
  const latest4WeekMeanPct = sufficient
    ? latestEight.slice(4).reduce((sum, item) => sum + item.vndOvernightRatePct, 0) / 4
    : null;
  const previous4WeekMeanPct = sufficient
    ? latestEight.slice(0, 4).reduce((sum, item) => sum + item.vndOvernightRatePct, 0) / 4
    : null;

  return {
    referenceWeekStart: latest.referenceWeekStart,
    referenceWeekEnd: latest.referenceWeekEnd,
    vndOvernightRatePct: latest.vndOvernightRatePct,
    latest4WeekMeanPct,
    previous4WeekMeanPct,
    trendPp: sufficient ? latest4WeekMeanPct - previous4WeekMeanPct : null,
    observationCount: ordered.length,
    status: sufficient ? 'available' : 'insufficient_history',
    provenance: {
      sourceId: 'sbv',
      source: SBV_SOURCE_NAME,
      indexUrl: SBV_RELEASE_INDEX_URL,
      releaseUrl: latest.releaseUrl,
      pdfUrl: latest.pdfUrl || null
    }
  };
}

export function unavailableMoneyMarket(reason = 'OFFICIAL_DATA_UNAVAILABLE') {
  return {
    referenceWeekStart: null,
    referenceWeekEnd: null,
    vndOvernightRatePct: null,
    latest4WeekMeanPct: null,
    previous4WeekMeanPct: null,
    trendPp: null,
    observationCount: 0,
    status: 'unavailable',
    reason,
    provenance: {
      sourceId: 'sbv',
      source: SBV_SOURCE_NAME,
      indexUrl: SBV_RELEASE_INDEX_URL,
      releaseUrl: null,
      pdfUrl: null
    }
  };
}

function normalizedVietnamese(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function isWeeklyReleaseLink({ url, label }) {
  if (!isOfficialUrl(url, SBV_HOST)) return false;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep encoded URL */ }
  const normalized = normalizedVietnamese(`${decoded} ${label}`);
  return normalized.includes('dien bien') && normalized.includes('lien ngan hang');
}

function isOfficialPdfLink({ url }) {
  return isOfficialUrl(url, SBV_HOST) && new URL(url).pathname.toLowerCase().includes('.pdf');
}

export async function extractPdfText(arrayBuffer) {
  // Import the library implementation directly; the package root executes its
  // bundled demo when loaded as an ES module under Node.
  const imported = await import('pdf-parse/lib/pdf-parse.js');
  const parsePdf = imported.default || imported;
  const parsed = await parsePdf(Buffer.from(arrayBuffer));
  return typeof parsed?.text === 'string' ? parsed.text : '';
}

function hasPdfSignature(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export async function fetchSbvMoneyMarket({
  fetchFn = fetch,
  indexUrl = SBV_RELEASE_INDEX_URL,
  timeoutMs = 8000,
  maxReleases = 12,
  extractPdfTextFn = extractPdfText
} = {}) {
  try {
    if (!isOfficialUrl(indexUrl, SBV_HOST)) return unavailableMoneyMarket('INVALID_OFFICIAL_SOURCE_URL');
    const indexHtml = await fetchOfficialResource(indexUrl, { fetchFn, timeoutMs });
    const releaseLinks = extractLinks(indexHtml, indexUrl, isWeeklyReleaseLink).slice(0, maxReleases);
    if (releaseLinks.length === 0) return unavailableMoneyMarket('MALFORMED_OFFICIAL_SOURCE');

    const settled = await Promise.allSettled(releaseLinks.map(async (releaseUrl) => {
      const releaseHtml = await fetchOfficialResource(releaseUrl, { fetchFn, timeoutMs });
      const direct = parseSbvWeeklyRelease(releaseHtml, releaseUrl);
      if (direct) return direct;

      const pdfUrl = extractLinks(releaseHtml, releaseUrl, isOfficialPdfLink)[0];
      if (!pdfUrl) return null;
      const pdf = await fetchOfficialResource(pdfUrl, {
        fetchFn,
        timeoutMs,
        accept: 'application/pdf,*/*;q=0.5',
        responseType: 'arrayBuffer'
      });
      if (!hasPdfSignature(pdf)) return null;
      const pdfText = await extractPdfTextFn(pdf);
      return parseSbvWeeklyRelease(pdfText, releaseUrl, pdfUrl);
    }));

    const observations = settled
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    return buildMoneyMarketDomain(observations);
  } catch {
    return unavailableMoneyMarket();
  }
}
