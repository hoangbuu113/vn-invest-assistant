import {
  fetchOfficialResource,
  isOfficialUrl,
  parseDecimal,
  subtractMonths,
  textFromHtml
} from './common.js';

export const NSO_CPI_INDEX_URL = 'https://www.nso.gov.vn/cpi-vi/';
export const NSO_CPI_CHART_URL = 'https://www.nso.gov.vn/chart/cpi/embed/?show=chart&width=responsive&share';
const NSO_HOST = 'nso.gov.vn';
const NSO_SOURCE_NAME = 'Cơ quan Thống kê Quốc gia';
const NEXT_RELEASE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const FALLBACK_RELEASE_GRACE_MS = 45 * 24 * 60 * 60 * 1000;

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

function referencePeriodToIso(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function signedVietnamesePercent(direction, rawValue) {
  const value = parseDecimal(rawValue);
  if (value === null || value < 0) return null;
  return direction.toLocaleLowerCase('vi-VN') === 'giảm' ? -value : value;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function isCpiReleaseLink(url, label) {
  if (!isOfficialUrl(url, NSO_HOST)) return false;
  try {
    const pathname = normalizeSearchText(decodeURIComponent(new URL(url).pathname));
    const normalizedLabel = normalizeSearchText(label);
    return pathname.includes('/chi-so-gia-tieu-dung') && normalizedLabel.includes('chi so gia tieu dung');
  } catch {
    return false;
  }
}

function uniqueRegexMatch(text, pattern) {
  const matches = [...text.matchAll(pattern)];
  return matches.length === 1 ? matches[0] : null;
}

function parseIndexEntry(label, releaseUrl) {
  if (!isCpiReleaseLink(releaseUrl, label)) return null;
  const periodMatch = uniqueRegexMatch(
    label,
    /Kỳ tham chiếu\s*:\s*(?:Tháng\s*)?(\d{1,2})\s*\/\s*(\d{4})/giu
  );
  const publicationMatch = uniqueRegexMatch(
    label,
    /Ngày đăng\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/giu
  );
  if (!periodMatch || !publicationMatch) return null;

  const referencePeriod = referencePeriodToIso(periodMatch[1], periodMatch[2]);
  const publishedAt = publicationDateToIso(
    publicationMatch[1],
    publicationMatch[2],
    publicationMatch[3]
  );
  if (!referencePeriod || !publishedAt) return null;

  const nextReleaseMatch = uniqueRegexMatch(
    label,
    /Lần công bố sắp tới\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/giu
  );
  const nextReleaseAt = nextReleaseMatch
    ? publicationDateToIso(nextReleaseMatch[1], nextReleaseMatch[2], nextReleaseMatch[3])
    : null;

  return {
    referencePeriod,
    publishedAt,
    nextReleaseAt,
    releaseUrl
  };
}

export function parseNsoCpiIndex(html, indexUrl = NSO_CPI_INDEX_URL, { maxReleases = 12 } = {}) {
  if (!isOfficialUrl(indexUrl, NSO_HOST) || typeof html !== 'string') return [];
  const entries = [];
  const seenUrls = new Set();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null && entries.length < maxReleases) {
    try {
      const releaseUrl = new URL(match[2], indexUrl).toString();
      if (seenUrls.has(releaseUrl)) continue;
      const entry = parseIndexEntry(textFromHtml(match[3]), releaseUrl);
      if (!entry) continue;
      seenUrls.add(releaseUrl);
      entries.push(entry);
    } catch {
      // Ignore malformed upstream anchors.
    }
  }

  return entries;
}

function normalizeChartPeriod(rawPeriod) {
  const match = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(String(rawPeriod || '').trim());
  return match ? referencePeriodToIso(match[1], match[2]) : null;
}

export function parseNsoCpiChart(html, chartUrl = NSO_CPI_CHART_URL) {
  if (!isOfficialUrl(chartUrl, NSO_HOST) || typeof html !== 'string') return null;
  const chartMatch = /\bchart_args\s*:\s*(\{[\s\S]*?\})\s*,\s*post_id\s*:/i.exec(html);
  if (!chartMatch) return null;

  let chartArgs;
  try {
    chartArgs = JSON.parse(chartMatch[1]);
  } catch {
    return null;
  }

  if (!Array.isArray(chartArgs.series) || chartArgs.series.length !== 1) return null;
  const rawData = chartArgs.series[0]?.data;
  if (!Array.isArray(rawData) || rawData.length === 0) return null;

  const byPeriod = new Map();
  for (const point of rawData) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const referencePeriod = normalizeChartPeriod(point[0]);
    const headlineCpiYoYPct = typeof point[1] === 'number' && Number.isFinite(point[1])
      ? point[1]
      : null;
    if (!referencePeriod || headlineCpiYoYPct === null || byPeriod.has(referencePeriod)) return null;
    byPeriod.set(referencePeriod, { referencePeriod, headlineCpiYoYPct });
  }

  return [...byPeriod.values()].sort((a, b) => a.referencePeriod.localeCompare(b.referencePeriod));
}

// Retained as a strict unit-level parser for a single official release. The
// production acquisition path uses the official structured chart plus archive
// metadata and does not fan out across individual release pages.
export function parseNsoCpiRelease(html, releaseUrl) {
  if (!isOfficialUrl(releaseUrl, NSO_HOST)) return null;
  const text = textFromHtml(html);
  if (!text) return null;

  const periodMatch = uniqueRegexMatch(
    text,
    /Kỳ tham chiếu\s*:\s*(?:Tháng\s*)?(\d{1,2})\s*\/\s*(\d{4})/giu
  );
  const publicationMatch = uniqueRegexMatch(
    text,
    /Ngày đăng\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/giu
  );
  if (!periodMatch || !publicationMatch) return null;

  const referencePeriod = referencePeriodToIso(periodMatch[1], periodMatch[2]);
  const publishedAt = publicationDateToIso(
    publicationMatch[1],
    publicationMatch[2],
    publicationMatch[3]
  );
  if (!referencePeriod || !publishedAt) return null;

  const cpiStart = text.search(/Chỉ số giá tiêu dùng\s*\(CPI\)\s*tháng/iu);
  if (cpiStart < 0) return null;
  const headline = text.slice(cpiStart, cpiStart + 900);
  const yoyMatch = /(tăng|giảm)\s+(\d+(?:[,.]\d+)?)\s*%\s+so với cùng kỳ năm trước/iu.exec(headline);
  if (!yoyMatch) return null;

  const headlineCpiYoYPct = signedVietnamesePercent(yoyMatch[1], yoyMatch[2]);
  if (headlineCpiYoYPct === null) return null;

  return {
    referencePeriod,
    publishedAt,
    headlineCpiYoYPct,
    releaseUrl
  };
}

function requireValidNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('NSO inflation acquisition requires a valid Date');
  }
  return now;
}

function isReleaseStale(release, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  const nextReleaseMs = release.nextReleaseAt
    ? Date.parse(`${release.nextReleaseAt}T00:00:00Z`)
    : NaN;
  const publishedMs = Date.parse(`${release.publishedAt}T00:00:00Z`);
  const staleAfterMs = Number.isFinite(nextReleaseMs)
    ? nextReleaseMs + NEXT_RELEASE_GRACE_MS
    : publishedMs + FALLBACK_RELEASE_GRACE_MS;
  return Number.isFinite(staleAfterMs) && now.getTime() > staleAfterMs;
}

export function buildInflationDomain(releases = [], { now } = {}) {
  if (now !== undefined) requireValidNow(now);
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
  const underlyingStatus = comparison ? 'available' : 'insufficient_history';
  const stale = isReleaseStale(latest, now);

  return {
    referencePeriod: latest.referencePeriod,
    publishedAt: latest.publishedAt,
    headlineCpiYoYPct: latest.headlineCpiYoYPct,
    threeMonthDeltaPp: comparison
      ? latest.headlineCpiYoYPct - comparison.headlineCpiYoYPct
      : null,
    status: stale ? 'stale' : underlyingStatus,
    ...(stale ? { underlyingStatus, reason: 'OFFICIAL_RELEASE_OVERDUE' } : {}),
    provenance: {
      sourceId: 'nso',
      source: NSO_SOURCE_NAME,
      indexUrl: NSO_CPI_INDEX_URL,
      chartUrl: NSO_CPI_CHART_URL,
      releaseUrl: latest.releaseUrl,
      comparisonReleaseUrl: comparison?.releaseUrl || null,
      comparisonReferencePeriod: comparisonPeriod,
      nextExpectedReleaseAt: latest.nextReleaseAt || null
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
      chartUrl: NSO_CPI_CHART_URL,
      releaseUrl: null,
      comparisonReleaseUrl: null,
      comparisonReferencePeriod: null,
      nextExpectedReleaseAt: null
    }
  };
}

function uniqueEntriesByPeriod(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const group = grouped.get(entry.referencePeriod) || [];
    group.push(entry);
    grouped.set(entry.referencePeriod, group);
  }

  const unique = new Map();
  for (const [period, group] of grouped) {
    if (group.length !== 1) return null;
    unique.set(period, group[0]);
  }
  return unique;
}

function sourceFailureReason(error) {
  if (error?.code === 'PROVIDER_TIMEOUT') return 'OFFICIAL_SOURCE_TIMEOUT';
  if (error?.code === 'PROVIDER_RATE_LIMITED') return 'OFFICIAL_SOURCE_RATE_LIMITED';
  return 'OFFICIAL_DATA_UNAVAILABLE';
}

export async function fetchNsoInflation({
  fetchFn = fetch,
  indexUrl = NSO_CPI_INDEX_URL,
  chartUrl = NSO_CPI_CHART_URL,
  timeoutMs = 8000,
  maxReleases = 12,
  now = new Date()
} = {}) {
  try {
    requireValidNow(now);
    if (!isOfficialUrl(indexUrl, NSO_HOST) || !isOfficialUrl(chartUrl, NSO_HOST)) {
      return unavailableInflation('INVALID_OFFICIAL_SOURCE_URL');
    }

    const [indexHtml, chartHtml] = await Promise.all([
      fetchOfficialResource(indexUrl, { fetchFn, timeoutMs }),
      fetchOfficialResource(chartUrl, { fetchFn, timeoutMs })
    ]);
    const entries = parseNsoCpiIndex(indexHtml, indexUrl, { maxReleases });
    if (entries.length === 0) return unavailableInflation('MALFORMED_OFFICIAL_INDEX');
    const entriesByPeriod = uniqueEntriesByPeriod(entries);
    if (!entriesByPeriod) return unavailableInflation('AMBIGUOUS_OFFICIAL_RELEASE');

    const chartPoints = parseNsoCpiChart(chartHtml, chartUrl);
    if (!chartPoints) return unavailableInflation('MALFORMED_OFFICIAL_CHART');
    const latestPoint = chartPoints.at(-1);
    const latestIndexPeriod = [...entriesByPeriod.keys()].sort().at(-1);
    if (!latestPoint || latestIndexPeriod !== latestPoint.referencePeriod) {
      return unavailableInflation('OFFICIAL_SOURCE_PERIOD_MISMATCH');
    }

    const comparisonPeriod = subtractMonths(latestPoint.referencePeriod, 3);
    const pointsByPeriod = new Map(chartPoints.map((point) => [point.referencePeriod, point]));
    const targetPeriods = [latestPoint.referencePeriod, comparisonPeriod];
    const releases = targetPeriods.flatMap((period) => {
      const entry = entriesByPeriod.get(period);
      const point = pointsByPeriod.get(period);
      if (!entry || !point) return [];
      return [{ ...entry, headlineCpiYoYPct: point.headlineCpiYoYPct }];
    });

    return buildInflationDomain(releases, { now });
  } catch (error) {
    return unavailableInflation(sourceFailureReason(error));
  }
}
