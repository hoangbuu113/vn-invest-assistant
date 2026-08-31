import {
  extractLinks,
  fetchOfficialResource,
  isOfficialUrl,
  parseDecimal,
  subtractMonths,
  textFromHtml
} from './common.js';

export const NSO_CPI_INDEX_URL = 'https://www.nso.gov.vn/cpi-vi/';
const NSO_HOST = 'nso.gov.vn';
const NSO_SOURCE_NAME = 'Cơ quan Thống kê Quốc gia';

function publicationDateToIso(day, month, year) {
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

function signedVietnamesePercent(direction, rawValue) {
  const value = parseDecimal(rawValue);
  if (value === null || value < 0) return null;
  return direction.toLocaleLowerCase('vi-VN') === 'giảm' ? -value : value;
}

export function parseNsoCpiRelease(html, releaseUrl) {
  if (!isOfficialUrl(releaseUrl, NSO_HOST)) return null;
  const text = textFromHtml(html);
  if (!text) return null;

  const periodMatch = /Kỳ tham chiếu\s*:\s*(?:Tháng\s*)?(\d{1,2})\s*\/\s*(\d{4})/iu.exec(text);
  const publicationMatch = /Ngày đăng\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/iu.exec(text);
  if (!periodMatch || !publicationMatch) return null;

  const month = Number(periodMatch[1]);
  const year = Number(periodMatch[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || year < 2000) return null;

  const cpiStart = text.search(/Chỉ số giá tiêu dùng\s*\(CPI\)\s*tháng/iu);
  if (cpiStart < 0) return null;
  const headline = text.slice(cpiStart, cpiStart + 900);
  const yoyMatch = /(tăng|giảm)\s+(\d+(?:[,.]\d+)?)\s*%\s+so với cùng kỳ năm trước/iu.exec(headline);
  if (!yoyMatch) return null;

  const headlineCpiYoYPct = signedVietnamesePercent(yoyMatch[1], yoyMatch[2]);
  const publishedAt = publicationDateToIso(publicationMatch[1], publicationMatch[2], publicationMatch[3]);
  if (headlineCpiYoYPct === null || !publishedAt) return null;

  return {
    referencePeriod: `${year}-${String(month).padStart(2, '0')}`,
    publishedAt,
    headlineCpiYoYPct,
    releaseUrl
  };
}

export function buildInflationDomain(releases = []) {
  const byPeriod = new Map();
  for (const release of releases) {
    if (
      release &&
      /^\d{4}-\d{2}$/.test(release.referencePeriod || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(release.publishedAt || '') &&
      Number.isFinite(release.headlineCpiYoYPct) &&
      isOfficialUrl(release.releaseUrl, NSO_HOST)
    ) {
      const existing = byPeriod.get(release.referencePeriod);
      if (!existing || release.publishedAt > existing.publishedAt) {
        byPeriod.set(release.referencePeriod, release);
      }
    }
  }

  const ordered = [...byPeriod.values()].sort((a, b) => a.referencePeriod.localeCompare(b.referencePeriod));
  const latest = ordered.at(-1);
  if (!latest) return unavailableInflation();

  const comparisonPeriod = subtractMonths(latest.referencePeriod, 3);
  const comparison = byPeriod.get(comparisonPeriod);

  return {
    referencePeriod: latest.referencePeriod,
    publishedAt: latest.publishedAt,
    headlineCpiYoYPct: latest.headlineCpiYoYPct,
    threeMonthDeltaPp: comparison
      ? latest.headlineCpiYoYPct - comparison.headlineCpiYoYPct
      : null,
    status: comparison ? 'available' : 'insufficient_history',
    provenance: {
      sourceId: 'nso',
      source: NSO_SOURCE_NAME,
      indexUrl: NSO_CPI_INDEX_URL,
      releaseUrl: latest.releaseUrl,
      comparisonReleaseUrl: comparison?.releaseUrl || null,
      comparisonReferencePeriod: comparisonPeriod
    }
  };
}

export function unavailableInflation(reason = 'OFFICIAL_DATA_UNAVAILABLE') {
  return {
    referencePeriod: null,
    publishedAt: null,
    headlineCpiYoYPct: null,
    threeMonthDeltaPp: null,
    status: 'unavailable',
    reason,
    provenance: {
      sourceId: 'nso',
      source: NSO_SOURCE_NAME,
      indexUrl: NSO_CPI_INDEX_URL,
      releaseUrl: null,
      comparisonReleaseUrl: null,
      comparisonReferencePeriod: null
    }
  };
}

function isCpiReleaseLink({ url, label }) {
  if (!isOfficialUrl(url, NSO_HOST)) return false;
  const normalized = `${decodeURIComponent(url)} ${label}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalized.includes('chi-so-gia-tieu-dung') && normalized.includes('chi so gia tieu dung');
}

export async function fetchNsoInflation({
  fetchFn = fetch,
  indexUrl = NSO_CPI_INDEX_URL,
  timeoutMs = 8000,
  maxReleases = 10
} = {}) {
  try {
    if (!isOfficialUrl(indexUrl, NSO_HOST)) return unavailableInflation('INVALID_OFFICIAL_SOURCE_URL');
    const indexHtml = await fetchOfficialResource(indexUrl, { fetchFn, timeoutMs });
    const links = extractLinks(indexHtml, indexUrl, isCpiReleaseLink).slice(0, maxReleases);
    if (links.length === 0) return unavailableInflation('MALFORMED_OFFICIAL_SOURCE');

    const settled = await Promise.allSettled(
      links.map(async (url) => {
        const html = await fetchOfficialResource(url, { fetchFn, timeoutMs });
        return parseNsoCpiRelease(html, url);
      })
    );
    const releases = settled
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    return buildInflationDomain(releases);
  } catch {
    return unavailableInflation();
  }
}
