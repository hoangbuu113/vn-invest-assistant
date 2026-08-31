import { cleanPlainText } from '../../news/text.js';

export const OFFICIAL_SOURCE_USER_AGENT = 'VN-Invest-Assistant/1.0 (+official public data reader)';

export function parseDecimal(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const normalized = String(raw).trim().replace(',', '.');
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function textFromHtml(html) {
  if (typeof html !== 'string') return '';
  return cleanPlainText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  );
}

export function isOfficialUrl(rawUrl, officialHost) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (url.hostname === officialHost || url.hostname.endsWith(`.${officialHost}`));
  } catch {
    return false;
  }
}

export function extractLinks(html, baseUrl, predicate) {
  if (typeof html !== 'string') return [];
  const links = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    try {
      const url = new URL(match[2], baseUrl).toString();
      const label = textFromHtml(match[3]);
      if (!seen.has(url) && predicate({ url, label })) {
        seen.add(url);
        links.push(url);
      }
    } catch {
      // Ignore malformed links from upstream pages.
    }
  }
  return links;
}

export async function fetchOfficialResource(url, {
  fetchFn = fetch,
  timeoutMs = 8000,
  accept = 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
  responseType = 'text'
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        'User-Agent': OFFICIAL_SOURCE_USER_AGENT
      }
    });
    if (!response?.ok) {
      const error = new Error('OFFICIAL_SOURCE_UNAVAILABLE');
      error.code = response?.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw error;
    }
    return responseType === 'arrayBuffer' ? response.arrayBuffer() : response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('OFFICIAL_SOURCE_TIMEOUT');
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function subtractMonths(referencePeriod, months) {
  const match = /^(\d{4})-(\d{2})$/.exec(referencePeriod || '');
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 - months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
