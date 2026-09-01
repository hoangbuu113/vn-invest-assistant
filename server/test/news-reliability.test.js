import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NewsCache,
  NewsService,
  cleanPlainText,
  parseCoinDeskRss
} from '../src/news.js';
import {
  fetchCafeFNews,
  MAX_CAFEF_ARTICLES
} from '../src/news/adapters/cafef.js';
import {
  fetchCoinDeskNews,
  MAX_COINDESK_ARTICLES
} from '../src/news/adapters/coindesk.js';
import {
  fetchAlphaVantageNews,
  parseAlphaVantageNews
} from '../src/news/adapters/alphavantage.js';

const FETCHED_AT = '2026-09-01T10:00:00.000Z';
const PUBLISHED_AT = 'Mon, 31 Aug 2026 10:00:00 GMT';

const assets = [{
  id: 'asset-fpt',
  symbol: 'FPT',
  name: 'FPT Corporation',
  asset_type: 'stock',
  market_policy: 'VN_EXCHANGE'
}];

function article({ id = 'article-1', title = 'FPT reports business growth', sourceId = 'cafef' } = {}) {
  return {
    id,
    title,
    summary: 'FPT business update.',
    url: `https://example.com/${id}`,
    source: sourceId === 'cafef' ? 'CafeF' : sourceId,
    sourceId,
    language: sourceId === 'cafef' ? 'vi' : 'en',
    category: 'company',
    publishedAt: FETCHED_AT
  };
}

function sourceResult(sourceId, { status = 'ok', items = [], errorCode = null } = {}) {
  return {
    sourceId,
    name: sourceId,
    language: sourceId === 'cafef' ? 'vi' : 'en',
    status,
    fetchedAt: FETCHED_AT,
    items,
    articleCount: items.length,
    skippedCount: 0,
    errorCode
  };
}

function response(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => text
  };
}

describe('V1.1 Improvement 05 - multi-source news reliability', () => {
  test('all providers succeed and generic plus personalized consumers share one acquisition', async () => {
    const cache = new NewsCache();
    const calls = { cafef: 0, coindesk: 0, alpha: 0 };
    const delayed = (key, result) => async () => {
      calls[key]++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return result;
    };
    const service = new NewsService({
      cache,
      getAssetsFn: async () => assets,
      fetchCafeFFn: delayed('cafef', sourceResult('cafef', { items: [article()] })),
      fetchCoinDeskFn: delayed('coindesk', sourceResult('coindesk')),
      fetchAlphaVantageFn: delayed('alpha', sourceResult('alphavantage-news'))
    });

    const [generic, personalized] = await Promise.all([
      service.getNewsFeed(),
      service.getPersonalizedNewsFeed({
        getHoldingsFn: async () => [{ asset_id: 'asset-fpt', asset: assets[0] }],
        getWatchlistFn: async () => []
      })
    ]);

    assert.equal(generic.partial, false);
    assert.equal(personalized.partial, false);
    assert.equal(personalized.count, 1);
    assert.deepEqual(calls, { cafef: 1, coindesk: 1, alpha: 1 });

    await service.getPersonalizedNewsFeed({
      getHoldingsFn: async () => [{ asset_id: 'asset-fpt', asset: assets[0] }],
      getWatchlistFn: async () => []
    });
    assert.deepEqual(calls, { cafef: 1, coindesk: 1, alpha: 1 });
  });

  test('multiple provider failures preserve valid news and expose partial source reasons', async () => {
    const service = new NewsService({
      cache: new NewsCache(),
      getAssetsFn: async () => assets,
      fetchCafeFFn: async () => sourceResult('cafef', { items: [article()] }),
      fetchCoinDeskFn: async () => sourceResult('coindesk', {
        status: 'error',
        errorCode: 'SOURCE_TIMEOUT'
      }),
      fetchAlphaVantageFn: async () => sourceResult('alphavantage-news', {
        status: 'error',
        errorCode: 'PROVIDER_RATE_LIMITED'
      })
    });

    const result = await service.getNewsFeed();
    assert.equal(result.status, 'ok');
    assert.equal(result.partial, true);
    assert.equal(result.count, 1);
    assert.equal(result.sources.find((item) => item.sourceId === 'coindesk').errorCode, 'SOURCE_TIMEOUT');
    assert.equal(result.sources.find((item) => item.sourceId === 'alphavantage-news').errorCode, 'PROVIDER_RATE_LIMITED');
  });

  test('CafeF isolates malformed and timed-out feeds while retaining valid bounded articles', async () => {
    const validXml = `<rss><channel>
      <item><title>FPT business update</title><link>https://cafef.vn/fpt.chn</link><description>Market news</description><pubDate>${PUBLISHED_AT}</pubDate></item>
      <item><title>FPT duplicate</title><link>https://cafef.vn/fpt.chn?utm_source=rss</link><description>Duplicate</description><pubDate>${PUBLISHED_AT}</pubDate></item>
    </channel></rss>`;
    const feeds = [
      { category: 'market', url: 'https://source.test/valid' },
      { category: 'macro', url: 'https://source.test/malformed' },
      { category: 'global', url: 'https://source.test/timeout' }
    ];

    const result = await fetchCafeFNews({
      feeds,
      fetchFn: async (url) => {
        if (url.endsWith('/valid')) return response(validXml);
        if (url.endsWith('/malformed')) return response('<html><body>not an RSS feed</body></html>');
        const error = new Error('abort');
        error.name = 'AbortError';
        throw error;
      }
    });

    assert.equal(result.status, 'degraded');
    assert.equal(result.errorCode, 'PARTIAL_FEED_FAILURE');
    assert.equal(result.items.length, 1, 'duplicate normalized URL is cached once');
    assert.ok(result.items.length <= MAX_CAFEF_ARTICLES);
    assert.equal(result.feeds.find((feed) => feed.category === 'macro').errorCode, 'SOURCE_MALFORMED');
    assert.equal(result.feeds.find((feed) => feed.category === 'global').errorCode, 'SOURCE_TIMEOUT');
  });

  test('CoinDesk rejects structurally malformed payloads instead of caching a false empty success', async () => {
    const result = await fetchCoinDeskNews({
      fetchFn: async () => response('<html><body>upstream error page</body></html>')
    });
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'SOURCE_MALFORMED');
    assert.deepEqual(result.items, []);
  });

  test('a structurally valid empty RSS document remains a truthful empty source', async () => {
    const result = await fetchCoinDeskNews({
      fetchFn: async () => response('<rss><channel></channel></rss>')
    });
    assert.equal(result.status, 'empty');
    assert.equal(result.errorCode, null);
    assert.deepEqual(result.items, []);
  });

  test('RSS normalization bounds items, removes duplicates, invalid dates, HTML and scripts', () => {
    const rawItems = Array.from({ length: MAX_COINDESK_ARTICLES - 2 }, (_, index) => `
      <item>
        <title>Bitcoin item ${index}</title>
        <link>https://www.coindesk.com/item-${index}</link>
        <description><![CDATA[<script>steal()</script><b>Safe ${index}</b>]]></description>
        <pubDate>${PUBLISHED_AT}</pubDate>
        <guid>item-${index}</guid>
      </item>`).join('');
    const duplicate = `<item><title>Duplicate</title><link>https://www.coindesk.com/item-0?utm_source=rss</link><pubDate>${PUBLISHED_AT}</pubDate><guid>duplicate</guid></item>`;
    const invalidDate = '<item><title>Invalid date</title><link>https://www.coindesk.com/invalid</link><pubDate>2026-09-01</pubDate></item>';
    const overflow = Array.from({ length: 5 }, (_, index) => `<item><title>Overflow ${index}</title><link>https://www.coindesk.com/overflow-${index}</link><pubDate>${PUBLISHED_AT}</pubDate></item>`).join('');
    const parsed = parseCoinDeskRss(`<rss><channel>${rawItems}${duplicate}${invalidDate}${overflow}</channel></rss>`);

    assert.equal(parsed.error, null);
    assert.ok(parsed.items.length <= MAX_COINDESK_ARTICLES);
    assert.equal(parsed.items[0].summary.includes('<'), false);
    assert.equal(parsed.items[0].summary.includes('steal'), false);
    assert.ok(parsed.skippedCount >= 7);
    assert.equal(cleanPlainText('&lt;script&gt;unsafe&lt;/script&gt;<b>safe</b>'), 'safe');
  });

  test('deterministic cache hit, expiry and concurrent request coalescing', async () => {
    let nowMs = 1_000;
    const cache = new NewsCache({
      coindesk: { freshTtlMs: 10, staleTtlMs: 30 }
    }, { nowFn: () => nowMs });
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return sourceResult('coindesk');
    };

    await Promise.all([
      cache.fetchWithCache('coindesk', load),
      cache.fetchWithCache('coindesk', load)
    ]);
    assert.equal(calls, 1);
    nowMs = 1_010;
    await cache.fetchWithCache('coindesk', load);
    assert.equal(calls, 1, 'fresh boundary is still a cache hit');
    nowMs = 1_011;
    await cache.fetchWithCache('coindesk', load);
    assert.equal(calls, 2, 'expired fresh entry performs one refresh');
  });

  test('stale last-good metadata preserves age and refresh failure without presenting data as fresh', async () => {
    let nowMs = 1_000;
    const cache = new NewsCache({
      cafef: { freshTtlMs: 10, staleTtlMs: 30 }
    }, { nowFn: () => nowMs });
    await cache.fetchWithCache('cafef', async () => sourceResult('cafef', { items: [article()] }));

    nowMs = 1_011;
    const stale = await cache.fetchWithCache('cafef', async () => sourceResult('cafef', {
      status: 'error',
      errorCode: 'SOURCE_TIMEOUT'
    }));

    assert.equal(stale.status, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.cacheAgeMs, 11);
    assert.equal(stale.staleReason, 'SOURCE_TIMEOUT');
    assert.equal(stale.cachedStatus, 'ok');
    assert.equal(stale.fetchedAt, FETCHED_AT);
  });

  test('bounded negative caching suppresses repeated optional Alpha upstream attempts', async () => {
    let nowMs = 1_000;
    const cache = new NewsCache({
      'alphavantage-news': {
        freshTtlMs: 10,
        staleTtlMs: 30,
        errorTtlMs: 100
      }
    }, { nowFn: () => nowMs });
    let calls = 0;
    const limited = async () => {
      calls++;
      return sourceResult('alphavantage-news', {
        status: 'error',
        errorCode: 'PROVIDER_RATE_LIMITED'
      });
    };

    const first = await cache.fetchWithCache('alphavantage-news', limited);
    const second = await cache.fetchWithCache('alphavantage-news', limited);
    assert.equal(first.cacheStatus, 'negative');
    assert.equal(second.cacheStatus, 'negative');
    assert.equal(calls, 1);

    nowMs = 1_101;
    await cache.fetchWithCache('alphavantage-news', limited);
    assert.equal(calls, 2);
  });

  test('Alpha Vantage quota cooldown prevents an optional news request and exposes a safe status', async () => {
    let calls = 0;
    const result = await fetchAlphaVantageNews({
      apiKey: 'test-key',
      getQuotaCooldownMsFn: () => 60_000,
      fetchFn: async () => {
        calls++;
        throw new Error('must not execute');
      },
      nowFn: () => Date.parse(FETCHED_AT)
    });

    assert.equal(calls, 0);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'PROVIDER_RATE_LIMITED');
    assert.equal(JSON.stringify(result).includes('test-key'), false);
  });

  test('Alpha Vantage missing feed is malformed and HTTP 429 is safely classified', async () => {
    assert.equal(parseAlphaVantageNews({}).error, 'SOURCE_MALFORMED');
    const result = await fetchAlphaVantageNews({
      apiKey: 'test-key',
      fetchFn: async () => response('', { ok: false, status: 429 }),
      getQuotaCooldownMsFn: () => 0,
      nowFn: () => Date.parse(FETCHED_AT)
    });
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'PROVIDER_RATE_LIMITED');
  });

  test('personalized output is bounded and an empty user state performs zero provider calls', async () => {
    let calls = 0;
    const manyArticles = Array.from({ length: 45 }, (_, index) => article({
      id: `fpt-${index}`,
      title: `FPT business update ${index}`
    }));
    const service = new NewsService({
      cache: new NewsCache(),
      getAssetsFn: async () => assets,
      fetchCafeFFn: async () => {
        calls++;
        return sourceResult('cafef', { items: manyArticles });
      },
      fetchCoinDeskFn: async () => {
        calls++;
        return sourceResult('coindesk');
      },
      fetchAlphaVantageFn: async () => {
        calls++;
        return sourceResult('alphavantage-news');
      }
    });

    const empty = await service.getPersonalizedNewsFeed({
      getHoldingsFn: async () => [],
      getWatchlistFn: async () => []
    });
    assert.equal(empty.count, 0);
    assert.equal(empty.dataAsOf, null);
    assert.equal(calls, 0);

    const populated = await service.getPersonalizedNewsFeed({
      getHoldingsFn: async () => [{ asset_id: 'asset-fpt', asset: assets[0] }],
      getWatchlistFn: async () => []
    });
    assert.equal(populated.count, 30);
    assert.equal(populated.data.length, 30);
    assert.equal(calls, 3);
  });
});
