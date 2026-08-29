import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAFEF_FEEDS,
  parseCafeFRss,
  parseCoinDeskRss,
  parseAlphaVantageNews,
  normalizeUrl,
  cleanPlainText,
  normalizePublishedAt,
  deduplicateArticles,
  matchArticleAssets,
  attachRelatedAssets,
  NewsCache,
  NewsService
} from '../src/news.js';

describe('Feature 23 — Multi-Asset News Foundation', () => {
  const sampleCanonicalAssets = [
    {
      id: 'uuid-fpt',
      symbol: 'FPT',
      name: 'FPT Corporation',
      asset_type: 'stock',
      market_policy: 'VN_EXCHANGE'
    },
    {
      id: 'uuid-vcb',
      symbol: 'VCB',
      name: 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)',
      asset_type: 'stock',
      market_policy: 'VN_EXCHANGE'
    },
    {
      id: 'uuid-btc',
      symbol: 'BTC',
      name: 'Bitcoin',
      asset_type: 'crypto',
      market_policy: 'CONTINUOUS_24_7'
    },
    {
      id: 'uuid-eth',
      symbol: 'ETH',
      name: 'Ethereum',
      asset_type: 'crypto',
      market_policy: 'CONTINUOUS_24_7'
    },
    {
      id: 'uuid-sol',
      symbol: 'SOL',
      name: 'Solana',
      asset_type: 'crypto',
      market_policy: 'CONTINUOUS_24_7'
    },
    {
      id: 'uuid-rain',
      symbol: 'RAIN',
      name: 'Rain',
      asset_type: 'crypto',
      market_policy: 'CONTINUOUS_24_7'
    },
    {
      id: 'uuid-xau',
      symbol: 'XAU/USD',
      name: 'Gold Spot / US Dollar',
      asset_type: 'gold',
      market_policy: 'GLOBAL_24_5'
    },
    {
      id: 'uuid-usdvnd',
      symbol: 'USD/VND',
      name: 'US Dollar / Vietnamese Dong',
      asset_type: 'fx',
      market_policy: 'GLOBAL_24_5'
    }
  ];

  describe('1. Normalization & Security (URL, Text, Time)', () => {
    test('CafeF exact 4 approved feeds configuration', () => {
      assert.equal(CAFEF_FEEDS.length, 4);
      assert.deepEqual(CAFEF_FEEDS, [
        { category: 'market', url: 'https://cafef.vn/thi-truong-chung-khoan.rss' },
        { category: 'company', url: 'https://cafef.vn/doanh-nghiep.rss' },
        { category: 'macro', url: 'https://cafef.vn/vi-mo-dau-tu.rss' },
        { category: 'global', url: 'https://cafef.vn/tai-chinh-quoc-te.rss' }
      ]);
    });

    test('A. CafeF article normalization', () => {
      const xml = `
        <rss><channel>
          <item>
            <title><![CDATA[FPT c&ocirc;ng b&#7889; k&#7871;t qu&#7843; kinh doanh]]></title>
            <link>https://cafef.vn/fpt-kqkd.chn?utm_source=rss&amp;tab=1</link>
            <description><![CDATA[Doanh thu t&#259;ng tr&#430;&#7903;ng 20%. &copy; 2026]]></description>
            <pubDate>Sat, 29 Aug 2026 08:25:00 +0700</pubDate>
            <guid>https://cafef.vn/fpt-kqkd.chn</guid>
          </item>
        </channel></rss>
      `;
      const { items, skippedCount } = parseCafeFRss(xml, 'market');
      assert.equal(skippedCount, 0);
      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'CafeF');
      assert.equal(items[0].sourceId, 'cafef');
      assert.equal(items[0].language, 'vi');
      assert.equal(items[0].category, 'market');
      assert.equal(items[0].url, 'https://cafef.vn/fpt-kqkd.chn?tab=1');
      assert.equal(items[0].title.includes('FPT'), true);
      assert.equal(items[0].publishedAt, '2026-08-29T01:25:00.000Z');
    });

    test('B. CoinDesk article normalization', () => {
      const xml = `
        <rss><channel>
          <item>
            <title>Bitcoin Breaches New Highs as Ethereum Follows</title>
            <link>https://www.coindesk.com/markets/2026/08/29/btc-eth-highs/?utm_medium=feed</link>
            <description>Crypto rally continues with strong institutional volume.</description>
            <pubDate>Sat, 29 Aug 2026 02:30:00 GMT</pubDate>
            <guid>coindesk-12345</guid>
          </item>
        </channel></rss>
      `;
      const { items, skippedCount } = parseCoinDeskRss(xml);
      assert.equal(skippedCount, 0);
      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'CoinDesk');
      assert.equal(items[0].sourceId, 'coindesk');
      assert.equal(items[0].category, 'crypto');
      assert.equal(items[0].language, 'en');
      assert.equal(items[0].url, 'https://www.coindesk.com/markets/2026/08/29/btc-eth-highs/');
      assert.equal(items[0].publishedAt, '2026-08-29T02:30:00.000Z');
    });

    test('C. Alpha Vantage article normalization', () => {
      const payload = {
        feed: [
          {
            title: 'Gold prices surge as central banks add to reserves',
            url: 'https://www.reuters.com/markets/commodities/gold-rally/?utm_campaign=daily&page=2',
            time_published: '20260828T191032',
            summary: 'Spot gold bullion reached new levels on safe-haven buying.',
            source: 'Reuters',
            topics: [{ topic: 'Economy - Monetary', relevance_score: '0.9' }],
            overall_sentiment_score: 0.75,
            overall_sentiment_label: 'Bullish',
            ticker_sentiment: [{ ticker: 'XAU', relevance_score: '0.8', ticker_sentiment_score: '0.6' }]
          }
        ]
      };
      const { items, skippedCount, error } = parseAlphaVantageNews(payload);
      assert.equal(error, null);
      assert.equal(skippedCount, 0);
      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'Reuters');
      assert.equal(items[0].sourceId, 'alphavantage-news');
      assert.equal(items[0].category, 'gold');
      assert.equal(items[0].url, 'https://www.reuters.com/markets/commodities/gold-rally/?page=2');
      assert.equal(items[0].publishedAt, '2026-08-28T19:10:32.000Z');
    });

    test('D & E. Alpha Vantage sentiment and relevance scores are completely discarded', () => {
      const payload = {
        feed: [
          {
            title: 'Global FX rates shift on US economic data',
            url: 'https://www.bloomberg.com/news/articles/2026-08-28/fx-dollar-moves',
            time_published: '20260828T200000',
            summary: 'Foreign exchange markets react to latest figures.',
            source: 'Bloomberg',
            topics: [{ topic: 'Forex', relevance_score: '0.95' }],
            overall_sentiment_score: 0.123,
            overall_sentiment_label: 'Somewhat-Bullish',
            relevance_score: 0.99,
            ticker_sentiment: [{ ticker: 'FOREX:USD', relevance_score: '0.8', ticker_sentiment_score: '0.2' }]
          }
        ]
      };
      const { items } = parseAlphaVantageNews(payload);
      assert.equal(items.length, 1);
      const item = items[0];
      assert.equal('overall_sentiment_score' in item, false);
      assert.equal('overall_sentiment_label' in item, false);
      assert.equal('relevance_score' in item, false);
      assert.equal('ticker_sentiment' in item, false);
    });

    test('F. valid publication timestamp UTC normalization', () => {
      assert.equal(normalizePublishedAt('2026-08-29T10:00:00Z'), '2026-08-29T10:00:00.000Z');
      assert.equal(normalizePublishedAt('2026-08-29T17:00:00+07:00'), '2026-08-29T10:00:00.000Z');
      assert.equal(normalizePublishedAt('Sat, 29 Aug 2026 10:00:00 GMT'), '2026-08-29T10:00:00.000Z');
      assert.equal(normalizePublishedAt('20260829T100000'), '2026-08-29T10:00:00.000Z');
    });

    test('G. timezone-ambiguous timestamp rejected', () => {
      assert.equal(normalizePublishedAt('2026-08-29'), null, 'Date-only must be rejected');
      assert.equal(normalizePublishedAt('2026-08-29T10:00:00'), null, 'ISO without timezone offset must be rejected');
      assert.equal(normalizePublishedAt('2026-08-29 10:00:00'), null, 'Prose without timezone offset must be rejected');
      assert.equal(normalizePublishedAt('invalid-date'), null);
      assert.equal(normalizePublishedAt(null), null);
    });

    test('H. malformed individual article skipped', () => {
      const xml = `
        <rss><channel>
          <item>
            <!-- Missing title and link -->
            <description>Missing fields</description>
            <pubDate>Sat, 29 Aug 2026 08:25:00 +0700</pubDate>
          </item>
          <item>
            <title>Valid Headline</title>
            <link>https://cafef.vn/valid.chn</link>
            <pubDate>Sat, 29 Aug 2026 08:25:00 +0700</pubDate>
          </item>
        </channel></rss>
      `;
      const { items, skippedCount } = parseCafeFRss(xml, 'market');
      assert.equal(skippedCount, 1);
      assert.equal(items.length, 1);
      assert.equal(items[0].title, 'Valid Headline');
    });

    test('I. malformed full source payload handled gracefully', () => {
      const { items, error } = parseAlphaVantageNews('not json');
      assert.equal(error, 'SOURCE_MALFORMED');
      assert.equal(items.length, 0);
    });

    test('J. non-http(s) URL rejected', () => {
      assert.equal(normalizeUrl('javascript:alert(1)'), null);
      assert.equal(normalizeUrl('data:text/html,<h1>Test</h1>'), null);
      assert.equal(normalizeUrl('file:///etc/passwd'), null);
      assert.equal(normalizeUrl('ftp://ftp.example.com'), null);
    });

    test('K. credential-bearing URL rejected', () => {
      assert.equal(normalizeUrl('https://user:password@example.com/news'), null);
      assert.equal(normalizeUrl('http://admin:secret@malicious.com/feed'), null);
    });

    test('L & M. known tracking params removed while semantic query params retained and sorted', () => {
      const raw = 'https://Example.com:443/article?b=2&utm_source=twitter&a=1&fbclid=xyz&utm_campaign=promo#section';
      const normalized = normalizeUrl(raw);
      assert.equal(normalized, 'https://example.com/article?a=1&b=2');
    });
  });

  describe('2. Deduplication & Sorting', () => {
    test('N. exact normalized URL dedupe', () => {
      const articles = [
        { id: '1', title: 'Story A', url: 'https://example.com/story?a=1', sourceId: 'coindesk', publishedAt: '2026-08-29T10:00:00Z' },
        { id: '2', title: 'Story A (duplicate)', url: 'https://example.com/story?a=1', sourceId: 'alphavantage-news', publishedAt: '2026-08-29T10:00:00Z' }
      ];
      const result = deduplicateArticles(articles);
      assert.equal(result.length, 1);
      assert.equal(result[0].sourceId, 'coindesk', 'Higher priority source wins');
    });

    test('O. source GUID dedupe', () => {
      const articles = [
        { id: 'guid-100', title: 'Story Version 1', url: 'https://example.com/v1', sourceId: 'cafef', publishedAt: '2026-08-29T10:00:00Z', summary: null },
        { id: 'guid-100', title: 'Story Version 2', url: 'https://example.com/v2', sourceId: 'cafef', publishedAt: '2026-08-29T10:00:00Z', summary: 'Has summary' }
      ];
      const result = deduplicateArticles(articles);
      assert.equal(result.length, 1);
      assert.equal(result[0].summary, 'Has summary', 'Article with non-null summary is preferred');
    });

    test('P. conservative fallback dedupe (sourceId + title + publishedAt)', () => {
      const articles = [
        { id: 'id-a', title: 'Same Headline', url: 'https://example.com/diff-url-1', sourceId: 'cafef', publishedAt: '2026-08-29T10:00:00Z' },
        { id: 'id-b', title: 'Same Headline', url: 'https://example.com/diff-url-2', sourceId: 'cafef', publishedAt: '2026-08-29T10:00:00Z' }
      ];
      const result = deduplicateArticles(articles);
      assert.equal(result.length, 1);
    });

    test('Q. deterministic tie ordering', () => {
      const articles = [
        { id: 'id-z', title: 'Article Z', publishedAt: '2026-08-29T10:00:00Z', sourceId: 'coindesk' },
        { id: 'id-a', title: 'Article A', publishedAt: '2026-08-29T10:00:00Z', sourceId: 'cafef' },
        { id: 'id-m', title: 'Article M', publishedAt: '2026-08-29T11:00:00Z', sourceId: 'coindesk' }
      ];
      const service = new NewsService();
      const sorted = service.processArticles(articles, sampleCanonicalAssets);
      assert.equal(sorted[0].id, 'id-m', 'Newest timestamp first');
      assert.equal(sorted[1].sourceId, 'cafef', 'Cafef before coindesk tie-breaker');
      assert.equal(sorted[2].sourceId, 'coindesk');
    });
  });

  describe('3. Asset Relevance & Disambiguation', () => {
    test('R & S. exact symbol and canonical name matching', () => {
      const article = {
        title: 'FPT ký kết hợp tác công nghệ quy mô lớn',
        summary: 'Tập đoàn FPT đẩy mạnh mở rộng thị trường.'
      };
      const matches = matchArticleAssets(article, sampleCanonicalAssets);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].symbol, 'FPT');
      assert.equal(matches[0].assetId, 'uuid-fpt');
      assert.equal(matches[0].relevanceReason, 'SYMBOL_EXACT');
    });

    test('T & Y. verified alias and Gold (XAU/USD / vàng) relationship', () => {
      const article = {
        title: 'Giá vàng miếng và vàng spot quốc tế tiếp tục tăng mạnh',
        summary: 'Nhu cầu vàng sjc tăng cao trước kỳ họp của Fed.'
      };
      const matches = matchArticleAssets(article, sampleCanonicalAssets);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].symbol, 'XAU/USD');
      assert.equal(matches[0].assetId, 'uuid-xau');
      assert.equal(matches[0].relevanceReason, 'VERIFIED_ALIAS');
    });

    test('U & V. ambiguous crypto symbol rejection outside crypto context vs acceptance in CoinDesk crypto context', () => {
      const nonCryptoArticle = {
        title: 'The sol system exploration and space observation report',
        summary: 'Scientists study solar flares in the outer rim.',
        sourceId: 'alphavantage-news'
      };
      const nonCryptoMatches = matchArticleAssets(nonCryptoArticle, sampleCanonicalAssets);
      assert.equal(nonCryptoMatches.length, 0, 'Must NOT match SOL from solar/sol in non-crypto article');

      const cryptoArticle = {
        title: 'SOL breaks key resistance as ecosystem volume surges',
        summary: 'DeFi protocol activity on the network reaches new milestone.',
        sourceId: 'coindesk'
      };
      const cryptoMatches = matchArticleAssets(cryptoArticle, sampleCanonicalAssets);
      assert.equal(cryptoMatches.length, 1);
      assert.equal(cryptoMatches[0].symbol, 'SOL');
      assert.equal(cryptoMatches[0].assetId, 'uuid-sol');
    });

    test('RAIN symbol ultra-ambiguity guard: common word "rain" never matches', () => {
      const weatherArticle = {
        title: 'Heavy rain causes flooding in major cities',
        summary: 'Rain continues for three consecutive days.',
        sourceId: 'coindesk'
      };
      const matches = matchArticleAssets(weatherArticle, sampleCanonicalAssets);
      assert.equal(matches.length, 0, 'Word "rain" must not match RAIN token');

      const tokenArticle = {
        title: 'Rain token trading volume spikes on decentralized exchanges',
        summary: 'Liquidity pools for Rain crypto see inflow.',
        sourceId: 'coindesk'
      };
      const tokenMatches = matchArticleAssets(tokenArticle, sampleCanonicalAssets);
      assert.equal(tokenMatches.length, 1);
      assert.equal(tokenMatches[0].symbol, 'RAIN');
    });

    test('W. USD alone does not match USD/VND', () => {
      const article = {
        title: 'US Fed holds interest rates steady as USD index strengthens',
        summary: 'The US dollar gained against global currencies.'
      };
      const matches = matchArticleAssets(article, sampleCanonicalAssets);
      assert.equal(matches.length, 0, 'Standalone USD must not match USD/VND');
    });

    test('X. explicit USD/VND evidence matches USD/VND', () => {
      const article = {
        title: 'Tỷ giá USD/VND hạ nhiệt sau động thái can thiệp của NHNN',
        summary: 'Tỷ giá trung tâm được điều chỉnh giảm nhẹ trong phiên hôm nay.'
      };
      const matches = matchArticleAssets(article, sampleCanonicalAssets);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].symbol, 'USD/VND');
      assert.equal(matches[0].assetId, 'uuid-usdvnd');
    });

    test('Z & AA. multi-asset single article emitted once with canonical UUIDs in relatedAssets', () => {
      const article = {
        id: 'btc-eth-1',
        title: 'Bitcoin and Ethereum lead broad cryptocurrency market rebound',
        summary: 'BTC and ETH both advance over 5% in 24 hours.',
        sourceId: 'coindesk',
        publishedAt: '2026-08-29T10:00:00Z',
        url: 'https://coindesk.com/btc-eth'
      };
      const processed = attachRelatedAssets([article], sampleCanonicalAssets);
      assert.equal(processed.length, 1);
      assert.equal(processed[0].relatedAssets.length, 2);
      assert.deepEqual(
        processed[0].relatedAssets.map((r) => r.symbol).sort(),
        ['BTC', 'ETH']
      );
      assert.deepEqual(
        processed[0].relatedAssets.map((r) => r.assetId).sort(),
        ['uuid-btc', 'uuid-eth']
      );
    });

    test('AD. general unlinked article gets relatedAssets: []', () => {
      const article = {
        id: 'macro-1',
        title: 'Global economic growth projections revised for upcoming year',
        summary: 'International monetary authorities issue annual report.',
        sourceId: 'alphavantage-news',
        publishedAt: '2026-08-29T10:00:00Z',
        url: 'https://example.com/macro'
      };
      const processed = attachRelatedAssets([article], sampleCanonicalAssets);
      assert.equal(processed.length, 1);
      assert.deepEqual(processed[0].relatedAssets, []);
    });
  });

  describe('4. Personalized News & Filtering', () => {
    test('AB & AC & AE. personalized UUID intersection, deduping, and general article exclusion', async () => {
      const holdings = [
        { id: 'h1', asset_id: 'uuid-fpt', asset: { id: 'uuid-fpt', symbol: 'FPT', name: 'FPT Corporation' } }
      ];
      const watchlist = [
        { id: 'w1', asset_id: 'uuid-fpt', asset: { id: 'uuid-fpt', symbol: 'FPT', name: 'FPT Corporation' } },
        { id: 'w2', asset_id: 'uuid-btc', asset: { id: 'uuid-btc', symbol: 'BTC', name: 'Bitcoin' } }
      ];

      const mockCafeF = async () => ({
        sourceId: 'cafef',
        name: 'CafeF',
        status: 'ok',
        fetchedAt: '2026-08-29T10:00:00Z',
        items: [
          {
            id: 'fpt-news',
            title: 'FPT mở rộng trung tâm phần mềm mới',
            summary: 'Dự án tạo thêm hàng nghìn việc làm.',
            url: 'https://cafef.vn/fpt-new',
            source: 'CafeF',
            sourceId: 'cafef',
            publishedAt: '2026-08-29T10:00:00Z',
            category: 'company'
          },
          {
            id: 'vcb-news',
            title: 'Vietcombank công bố báo cáo tài chính',
            summary: 'Lợi nhuận ngân hàng duy trì vị thế dẫn đầu.',
            url: 'https://cafef.vn/vcb-new',
            source: 'CafeF',
            sourceId: 'cafef',
            publishedAt: '2026-08-29T09:00:00Z',
            category: 'company'
          }
        ]
      });

      const mockCoinDesk = async () => ({
        sourceId: 'coindesk',
        name: 'CoinDesk',
        status: 'ok',
        fetchedAt: '2026-08-29T10:00:00Z',
        items: [
          {
            id: 'btc-news',
            title: 'Bitcoin institutional inflows hit record levels',
            summary: 'BTC funds record highest net inflow this quarter.',
            url: 'https://coindesk.com/btc-flow',
            source: 'CoinDesk',
            sourceId: 'coindesk',
            publishedAt: '2026-08-29T09:30:00Z',
            category: 'crypto'
          },
          {
            id: 'general-crypto',
            title: 'Global crypto regulatory landscape overview',
            summary: 'Policy makers discuss cross-border standards.',
            url: 'https://coindesk.com/policy',
            source: 'CoinDesk',
            sourceId: 'coindesk',
            publishedAt: '2026-08-29T08:00:00Z',
            category: 'crypto'
          }
        ]
      });

      const mockAlphaVantage = async () => ({
        sourceId: 'alphavantage-news',
        name: 'Alpha Vantage News',
        status: 'ok',
        fetchedAt: '2026-08-29T10:00:00Z',
        items: []
      });

      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: mockCafeF,
        fetchCoinDeskFn: mockCoinDesk,
        fetchAlphaVantageFn: mockAlphaVantage
      });

      const result = await service.getPersonalizedNewsFeed({
        getHoldingsFn: async () => holdings,
        getWatchlistFn: async () => watchlist
      });

      assert.equal(result.status, 'ok');
      assert.equal(result.userAssetCount, 2, 'FPT and BTC deduplicated across holdings & watchlist');
      assert.equal(result.count, 2, 'Only FPT and BTC articles matched; unlinked and VCB excluded');

      const matchedSymbols = result.data.map((item) => item.matchedAssets[0].symbol).sort();
      assert.deepEqual(matchedSymbols, ['BTC', 'FPT']);
    });

    test('AF. known asset + no matching news => 200 empty', async () => {
      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: async () => ({ sourceId: 'cafef', name: 'CafeF', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] }),
        fetchCoinDeskFn: async () => ({ sourceId: 'coindesk', name: 'CoinDesk', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] }),
        fetchAlphaVantageFn: async () => ({ sourceId: 'alphavantage-news', name: 'Alpha Vantage News', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] })
      });

      const res = await service.getNewsFeed({ assetId: 'uuid-fpt' });
      assert.equal(res.status, 'ok');
      assert.equal(res.count, 0);
      assert.deepEqual(res.data, []);
    });

    test('AG. unknown assetId => 404', async () => {
      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        getAssetByIdFn: async () => null,
        fetchCafeFFn: async () => ({ sourceId: 'cafef', name: 'CafeF', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] }),
        fetchCoinDeskFn: async () => ({ sourceId: 'coindesk', name: 'CoinDesk', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] }),
        fetchAlphaVantageFn: async () => ({ sourceId: 'alphavantage-news', name: 'Alpha Vantage News', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] })
      });

      await assert.rejects(
        async () => {
          await service.getNewsFeed({ assetId: 'non-existent-uuid' });
        },
        (err) => err.statusCode === 404 && err.code === 'ASSET_NOT_FOUND'
      );
    });
  });

  describe('5. Source Failure, Partial Semantics & Caching', () => {
    test('AH. one source failure => HTTP 200 partial: true', async () => {
      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: async () => ({
          sourceId: 'cafef',
          name: 'CafeF',
          status: 'ok',
          fetchedAt: '2026-08-29T10:00:00Z',
          items: [{ id: '1', title: 'CafeF Story', url: 'https://cafef.vn/1', publishedAt: '2026-08-29T10:00:00Z', source: 'CafeF', sourceId: 'cafef' }]
        }),
        fetchCoinDeskFn: async () => ({
          sourceId: 'coindesk',
          name: 'CoinDesk',
          status: 'error',
          fetchedAt: '2026-08-29T10:00:00Z',
          items: [],
          errorCode: 'SOURCE_FETCH_FAILED'
        }),
        fetchAlphaVantageFn: async () => ({
          sourceId: 'alphavantage-news',
          name: 'Alpha Vantage News',
          status: 'ok',
          fetchedAt: '2026-08-29T10:00:00Z',
          items: []
        })
      });

      const res = await service.getNewsFeed();
      assert.equal(res.status, 'ok');
      assert.equal(res.partial, true);
      assert.equal(res.data.length, 1);
      assert.equal(res.sources.find((s) => s.sourceId === 'coindesk').status, 'error');
    });

    test('AI. all live fail + stale cache => HTTP 200 with stale source status', async () => {
      const cache = new NewsCache({
        'cafef': { freshTtlMs: 10, staleTtlMs: 5000 },
        'coindesk': { freshTtlMs: 10, staleTtlMs: 5000 },
        'alphavantage-news': { freshTtlMs: 10, staleTtlMs: 5000 }
      });

      // Populate good cache
      cache.set('cafef', {
        sourceId: 'cafef',
        name: 'CafeF',
        status: 'ok',
        fetchedAt: '2026-08-29T10:00:00Z',
        items: [{ id: 'c1', title: 'Cached CafeF Article', url: 'https://cafef.vn/c1', publishedAt: '2026-08-29T10:00:00Z', source: 'CafeF', sourceId: 'cafef' }]
      });

      // Sleep 20ms so fresh TTL expires but within stale window
      await new Promise((r) => setTimeout(r, 25));

      // Live fetch fails
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: async () => ({ sourceId: 'cafef', name: 'CafeF', status: 'error', errorCode: 'LIVE_FAIL', items: [] }),
        fetchCoinDeskFn: async () => ({ sourceId: 'coindesk', name: 'CoinDesk', status: 'error', errorCode: 'LIVE_FAIL', items: [] }),
        fetchAlphaVantageFn: async () => ({ sourceId: 'alphavantage-news', name: 'Alpha Vantage News', status: 'error', errorCode: 'LIVE_FAIL', items: [] })
      });

      const res = await service.getNewsFeed();
      assert.equal(res.status, 'ok');
      assert.equal(res.partial, true);
      assert.equal(res.data.length, 1);
      assert.equal(res.sources.find((s) => s.sourceId === 'cafef').status, 'stale');
    });

    test('AJ. all sources fail and no cache => HTTP 503 NEWS_SOURCES_UNAVAILABLE', async () => {
      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: async () => ({ sourceId: 'cafef', name: 'CafeF', status: 'error', errorCode: 'FAIL', items: [] }),
        fetchCoinDeskFn: async () => ({ sourceId: 'coindesk', name: 'CoinDesk', status: 'error', errorCode: 'FAIL', items: [] }),
        fetchAlphaVantageFn: async () => ({ sourceId: 'alphavantage-news', name: 'Alpha Vantage News', status: 'error', errorCode: 'FAIL', items: [] })
      });

      await assert.rejects(
        async () => {
          await service.getNewsFeed();
        },
        (err) => err.statusCode === 503 && err.code === 'NEWS_SOURCES_UNAVAILABLE'
      );
    });

    test('AK & AL. successful empty source is cached and causes no external fetch', async () => {
      const cache = new NewsCache();
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return { sourceId: 'coindesk', name: 'CoinDesk', status: 'empty', fetchedAt: '2026-08-29T10:00:00Z', items: [] };
      };

      const res1 = await cache.fetchWithCache('coindesk', mockFetch);
      assert.equal(res1.status, 'empty');
      assert.equal(callCount, 1);

      const res2 = await cache.fetchWithCache('coindesk', mockFetch);
      assert.equal(res2.status, 'empty');
      assert.equal(callCount, 1, 'Cache hit: no second fetch');
    });

    test('AM. Alpha Vantage 4-hour fresh TTL configuration', () => {
      const cache = new NewsCache();
      const avConfig = cache.configs['alphavantage-news'];
      assert.equal(avConfig.freshTtlMs, 4 * 3600 * 1000, 'Fresh TTL must be 4 hours');
      assert.equal(avConfig.staleTtlMs, 24 * 3600 * 1000, 'Stale TTL must be 24 hours');
    });

    test('AN. concurrent identical refreshes coalesced into single in-flight call', async () => {
      const cache = new NewsCache();
      let callCount = 0;
      const slowFetch = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { sourceId: 'cafef', name: 'CafeF', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] };
      };

      const [res1, res2, res3] = await Promise.all([
        cache.fetchWithCache('cafef', slowFetch),
        cache.fetchWithCache('cafef', slowFetch),
        cache.fetchWithCache('cafef', slowFetch)
      ]);

      assert.equal(callCount, 1, 'Coalesced concurrent requests into 1 execution');
      assert.equal(res1.status, 'ok');
      assert.equal(res2.status, 'ok');
      assert.equal(res3.status, 'ok');
    });
  });

  describe('6. Legacy Compatibility & Security Invariants', () => {
    test('AP & AQ & AR. legacy top-level and article fields preserved', async () => {
      const cache = new NewsCache();
      const service = new NewsService({
        cache,
        getAssetsFn: async () => sampleCanonicalAssets,
        fetchCafeFFn: async () => ({
          sourceId: 'cafef',
          name: 'CafeF',
          status: 'ok',
          fetchedAt: '2026-08-29T10:00:00Z',
          items: [
            {
              id: 'art-1',
              title: 'Tập đoàn FPT công bố doanh thu quý',
              summary: 'Khối công nghệ tiếp tục dẫn đầu.',
              url: 'https://cafef.vn/art-1',
              source: 'CafeF',
              sourceId: 'cafef',
              language: 'vi',
              category: 'company',
              publishedAt: '2026-08-29T10:00:00Z'
            }
          ]
        }),
        fetchCoinDeskFn: async () => ({ sourceId: 'coindesk', name: 'CoinDesk', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] }),
        fetchAlphaVantageFn: async () => ({ sourceId: 'alphavantage-news', name: 'Alpha Vantage News', status: 'ok', fetchedAt: '2026-08-29T10:00:00Z', items: [] })
      });

      const res = await service.getNewsFeed();
      assert.equal(res.status, 'ok');
      assert.equal(typeof res.count, 'number');
      assert.equal(Array.isArray(res.data), true);

      const article = res.data[0];
      assert.equal(typeof article.id, 'string');
      assert.equal(typeof article.title, 'string');
      assert.equal(typeof article.summary, 'string');
      assert.equal(typeof article.source, 'string', 'Legacy source is display string');
      assert.equal(typeof article.category, 'string');
      assert.equal(typeof article.publishedAt, 'string');
      assert.equal(typeof article.url, 'string');
      assert.equal(Array.isArray(article.relatedAssets), true);
    });

    test('AT, AU, AV, AW. zero sentiment, relevance scores, recommendations, or full bodies', async () => {
      const payload = {
        feed: [
          {
            title: 'Sample market headline',
            url: 'https://example.com/test',
            time_published: '20260828T120000',
            summary: 'Short excerpt.',
            source: 'Reuters',
            topics: [{ topic: 'Finance', relevance_score: '0.9' }],
            overall_sentiment_score: 0.99,
            overall_sentiment_label: 'Bullish',
            relevance_score: 0.95
          }
        ]
      };
      const { items } = parseAlphaVantageNews(payload);
      const item = items[0];

      // Assert forbidden fields are absent
      const forbidden = [
        'sentiment', 'overall_sentiment_score', 'overall_sentiment_label',
        'relevance_score', 'ticker_sentiment', 'score', 'confidence',
        'recommendation', 'signal', 'body', 'content', 'article_body'
      ];
      for (const prop of forbidden) {
        assert.equal(prop in item, false, `Field '${prop}' must NOT exist`);
      }
    });
  });
});

