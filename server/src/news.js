import { XMLParser } from 'fast-xml-parser';

const CAFEF_FEEDS = [
  {
    category: 'market',
    url: 'https://cafef.vn/thi-truong-chung-khoan.rss'
  },
  {
    category: 'company',
    url: 'https://cafef.vn/doanh-nghiep.rss'
  },
  {
    category: 'macro',
    url: 'https://cafef.vn/vi-mo-dau-tu.rss'
  },
  {
    category: 'global',
    url: 'https://cafef.vn/tai-chinh-quoc-te.rss'
  }
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
});

/**
 * Strips HTML tags and decodes common HTML entities.
 * @param {string} text
 * @returns {string}
 */
function cleanHtmlText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Parses an individual CafeF RSS feed URL.
 * Returns an array of normalized news items or an empty array on error.
 * @param {{ category: string, url: string }} feedConfig
 * @returns {Promise<Array<object>>}
 */
async function fetchSingleFeed(feedConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(feedConfig.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[News] Failed to fetch feed ${feedConfig.category} (${feedConfig.url}): HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parsed = xmlParser.parse(xml);
    let items = parsed?.rss?.channel?.item || [];

    if (!Array.isArray(items)) {
      items = items ? [items] : [];
    }

    return items.map((item) => {
      const guidValue = typeof item.guid === 'object'
        ? (item.guid['#text'] || item.guid['__text'] || item.link)
        : (item.guid || item.link);

      const link = typeof item.link === 'string' ? item.link.trim() : String(guidValue || '').trim();
      const id = String(guidValue || link).trim();

      const rawTitle = typeof item.title === 'string'
        ? item.title
        : (item.title?.['#text'] || '');
      const title = cleanHtmlText(rawTitle);

      const rawDescription = typeof item.description === 'string'
        ? item.description
        : (item.description?.['#text'] || '');
      const summary = cleanHtmlText(rawDescription);

      let publishedAt = null;
      if (item.pubDate) {
        const parsedDate = new Date(item.pubDate);
        if (!isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate.toISOString();
        }
      }

      return {
        id,
        title,
        summary,
        source: 'CafeF',
        category: feedConfig.category,
        publishedAt,
        url: link
      };
    });
  } catch (error) {
    clearTimeout(timeout);
    console.warn(`[News] Error fetching feed ${feedConfig.category} (${feedConfig.url}):`, error.message);
    return [];
  }
}

/**
 * Fetches, deduplicates, sorts, and limits CafeF news from all 4 categories.
 * @param {Array<{ category: string, url: string }>} [feeds=CAFEF_FEEDS]
 * @param {number} [limit=30]
 * @returns {Promise<Array<object>>}
 */
export async function getNewsFeed(feeds = CAFEF_FEEDS, limit = 30) {
  const results = await Promise.allSettled(feeds.map((feed) => fetchSingleFeed(feed)));

  const allItems = [];
  const seenKeys = new Set();

  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      for (const item of result.value) {
        const uniqueKey = item.id || item.url;
        if (uniqueKey && !seenKeys.has(uniqueKey)) {
          seenKeys.add(uniqueKey);
          allItems.push(item);
        }
      }
    }
  }

  // Sort newest first
  allItems.sort((a, b) => {
    const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return timeB - timeA;
  });

  return allItems.slice(0, limit);
}
