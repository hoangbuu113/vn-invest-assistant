import { XMLParser } from 'fast-xml-parser';
import { normalizeUrl } from '../url.js';
import { cleanPlainText } from '../text.js';
import { normalizePublishedAt } from '../time.js';

export const COINDESK_RSS_URL = 'https://www.coindesk.com/arc/outboundfeeds/rss/';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
});

/**
 * Parses raw XML text from CoinDesk RSS.
 * @param {string} xml
 * @returns {{ items: Array<object>, skippedCount: number }}
 */
export function parseCoinDeskRss(xml) {
  if (!xml || typeof xml !== 'string') {
    return { items: [], skippedCount: 0 };
  }

  const parsed = xmlParser.parse(xml);
  let rawItems = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  if (!Array.isArray(rawItems)) {
    rawItems = rawItems ? [rawItems] : [];
  }

  const items = [];
  let skippedCount = 0;

  for (const item of rawItems) {
    const guidVal = typeof item.guid === 'object'
      ? (item.guid['#text'] || item.guid['__text'] || item.link)
      : (item.guid || item.link || item.id);

    const rawLink = typeof item.link === 'string'
      ? item.link.trim()
      : (item.link?.['@_href'] || String(guidVal || '').trim());
    const normalizedLink = normalizeUrl(rawLink);

    const rawTitle = typeof item.title === 'string' ? item.title : (item.title?.['#text'] || '');
    const title = cleanPlainText(rawTitle);

    const rawDesc = typeof item.description === 'string'
      ? item.description
      : (item.description?.['#text'] || item.summary || item.summary?.['#text'] || '');
    const summary = cleanPlainText(rawDesc) || null;

    const rawPubDate = item.pubDate || item.published || item.updated;
    const publishedAt = normalizePublishedAt(rawPubDate);

    // Validation: title non-empty, valid URL, valid trustworthy timestamp
    if (!title || !normalizedLink || !publishedAt) {
      skippedCount++;
      continue;
    }

    const id = String(guidVal || normalizedLink).trim();

    items.push({
      id,
      title,
      summary,
      url: normalizedLink,
      source: 'CoinDesk',
      sourceId: 'coindesk',
      language: 'en',
      category: 'crypto',
      publishedAt
    });
  }

  return { items, skippedCount };
}

/**
 * Fetches and parses CoinDesk news feed.
 * @param {object} [options]
 * @param {string} [options.url=COINDESK_RSS_URL]
 * @param {number} [options.timeoutMs=8000]
 * @param {Function} [options.fetchFn=fetch]
 * @returns {Promise<object>}
 */
export async function fetchCoinDeskNews({
  url = COINDESK_RSS_URL,
  timeoutMs = 8000,
  fetchFn = fetch
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        sourceId: 'coindesk',
        name: 'CoinDesk',
        language: 'en',
        status: 'error',
        fetchedAt,
        items: [],
        articleCount: 0,
        skippedCount: 0,
        errorCode: `HTTP_${res.status}`
      };
    }

    const xml = await res.text();
    const { items, skippedCount } = parseCoinDeskRss(xml);

    return {
      sourceId: 'coindesk',
      name: 'CoinDesk',
      language: 'en',
      status: items.length > 0 ? 'ok' : 'empty',
      fetchedAt,
      items,
      articleCount: items.length,
      skippedCount,
      errorCode: null
    };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === 'AbortError';
    return {
      sourceId: 'coindesk',
      name: 'CoinDesk',
      language: 'en',
      status: 'error',
      fetchedAt,
      items: [],
      articleCount: 0,
      skippedCount: 0,
      errorCode: isTimeout ? 'SOURCE_TIMEOUT' : 'SOURCE_FETCH_FAILED'
    };
  }
}

