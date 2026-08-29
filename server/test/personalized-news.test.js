import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  getUserAssetUniverse,
  buildAssetMatchers,
  filterPersonalizedNews,
  getPersonalizedNewsFeed
} from '../src/news.js';
import { createApp } from '../index.js';

describe('Feature 13 — Personalized Relevant News / Tin của tôi', () => {
  const sampleUserAssets = [
    {
      id: 'asset-1',
      symbol: 'FPT',
      name: 'FPT Corporation'
    },
    {
      id: 'asset-2',
      symbol: 'VCB',
      name: 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)'
    },
    {
      id: 'asset-3',
      symbol: 'HPG',
      name: 'Hoa Phat Group Joint Stock Company'
    }
  ];

  describe('1. Pure Deterministic Matching Engine Logic', () => {
    test('A. exact symbol token match: "FPT công bố kết quả..." -> matches FPT', () => {
      const news = [
        {
          id: 'news-1',
          title: 'FPT công bố kết quả kinh doanh quý 3 tăng trưởng mạnh',
          summary: 'Doanh thu khối công nghệ tiếp tục dẫn đầu tăng trưởng.',
          publishedAt: '2026-08-28T10:00:00Z',
          url: 'https://cafef.vn/fpt-1.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 1);
      assert.equal(result[0].matchedAssets.length, 1);
      assert.equal(result[0].matchedAssets[0].symbol, 'FPT');
      assert.equal(result[0].matchedAssets[0].name, 'FPT Corporation');
    });

    test('B. lowercase/case-insensitive match: "fpt ..." -> matches FPT', () => {
      const news = [
        {
          id: 'news-2',
          title: 'Cổ phiếu fpt tiếp tục lập đỉnh mới trong phiên sáng',
          summary: 'Khối ngoại mua ròng mạnh mã fpt.',
          publishedAt: '2026-08-28T10:05:00Z',
          url: 'https://cafef.vn/fpt-2.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 1);
      assert.equal(result[0].matchedAssets.length, 1);
      assert.equal(result[0].matchedAssets[0].symbol, 'FPT');
    });

    test('C. punctuation boundary: "(FPT): ..." and "[FPT] ..." -> matches FPT', () => {
      const news = [
        {
          id: 'news-3a',
          title: 'Điểm tin doanh nghiệp (FPT): Dự kiến chi trả cổ tức đợt 1',
          summary: 'Thông tin công bố ngày hôm nay.',
          publishedAt: '2026-08-28T10:10:00Z',
          url: 'https://cafef.vn/fpt-3a.chn'
        },
        {
          id: 'news-3b',
          title: '[FPT] Khởi công trung tâm dữ liệu mới',
          summary: 'Dự án quy mô hàng trăm triệu USD.',
          publishedAt: '2026-08-28T10:15:00Z',
          url: 'https://cafef.vn/fpt-3b.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 2);
      assert.equal(result[0].matchedAssets[0].symbol, 'FPT');
      assert.equal(result[1].matchedAssets[0].symbol, 'FPT');
    });

    test('D. substring false positive prevention: symbol does NOT match arbitrary longer words', () => {
      const news = [
        {
          id: 'news-4a',
          title: 'Dự án AFPT tại thị trường quốc tế',
          summary: 'Không liên quan đến mã chứng khoán.',
          publishedAt: '2026-08-28T10:20:00Z',
          url: 'https://cafef.vn/afpt.chn'
        },
        {
          id: 'news-4b',
          title: 'Công nghệ FPTXYZ mới được giới thiệu',
          summary: 'Thử nghiệm hệ thống xử lý dữ liệu.',
          publishedAt: '2026-08-28T10:25:00Z',
          url: 'https://cafef.vn/fptxyz.chn'
        },
        {
          id: 'news-4c',
          title: 'Dòng tiềnFPT chảy mạnh vào thị trường',
          summary: 'Lỗi dính chữ trong văn bản.',
          publishedAt: '2026-08-28T10:30:00Z',
          url: 'https://cafef.vn/tienfpt.chn'
        }
      ];

      const result = filterPersonalizedNews(news, [{ symbol: 'FPT', name: 'FPT Corporation' }]);
      assert.equal(result.length, 0, 'Should not match any substrings without word/token boundary');
    });

    test('E. asset name match using actual provided metadata fixture -> correct asset match', () => {
      const news = [
        {
          id: 'news-5a',
          title: 'Vietcombank giảm mạnh lãi suất cho vay hỗ trợ doanh nghiệp',
          summary: 'Ngân hàng triển khai gói tín dụng 50.000 tỷ đồng.',
          publishedAt: '2026-08-28T10:35:00Z',
          url: 'https://cafef.vn/vcb-name.chn'
        },
        {
          id: 'news-5b',
          title: 'Hoa Phat Group Joint Stock Company announces record output',
          summary: 'Steel production increases across all plants.',
          publishedAt: '2026-08-28T10:40:00Z',
          url: 'https://cafef.vn/hpg-name.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 2);
      assert.equal(result[0].matchedAssets[0].symbol, 'VCB');
      assert.equal(result[1].matchedAssets[0].symbol, 'HPG');
    });

    test('F. duplicate asset across holdings + watchlist -> one asset context only', () => {
      const holdings = [
        {
          id: 'h1',
          asset_id: 'asset-1',
          asset: { id: 'asset-1', symbol: 'FPT', name: 'FPT Corporation' }
        }
      ];
      const watchlist = [
        {
          id: 'w1',
          asset_id: 'asset-1',
          asset: { id: 'asset-1', symbol: 'FPT', name: 'FPT Corporation' }
        }
      ];

      const universe = getUserAssetUniverse(holdings, watchlist);
      assert.equal(universe.length, 1);
      assert.equal(universe[0].symbol, 'FPT');

      const news = [
        {
          id: 'news-6',
          title: 'FPT và FPT Corporation ký thỏa thuận mới',
          summary: 'FPT tiếp tục mở rộng.',
          publishedAt: '2026-08-28T10:45:00Z',
          url: 'https://cafef.vn/fpt-dedupe.chn'
        }
      ];

      const filtered = filterPersonalizedNews(news, universe);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].matchedAssets.length, 1, 'Duplicate matches for same asset should be deduplicated');
      assert.equal(filtered[0].matchedAssets[0].symbol, 'FPT');
    });

    test('G. one article matching multiple user assets -> matchedAssets contains both deterministically', () => {
      const news = [
        {
          id: 'news-7',
          title: 'FPT và Vietcombank ký kết hợp tác chuyển đổi số toàn diện',
          summary: 'Hai doanh nghiệp hàng đầu bắt tay triển khai hạ tầng số.',
          publishedAt: '2026-08-28T10:50:00Z',
          url: 'https://cafef.vn/fpt-vcb.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 1);
      assert.equal(result[0].matchedAssets.length, 2);
      const symbols = result[0].matchedAssets.map((a) => a.symbol);
      assert.ok(symbols.includes('FPT'));
      assert.ok(symbols.includes('VCB'));
    });

    test('H. user has assets but no matching news -> valid empty personalized result', () => {
      const news = [
        {
          id: 'news-8',
          title: 'Giá vàng trong nước biến động mạnh theo xu hướng thế giới',
          summary: 'Giá dầu thế giới cũng quay đầu giảm nhẹ.',
          publishedAt: '2026-08-28T10:55:00Z',
          url: 'https://cafef.vn/gold.chn'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 0);
    });

    test('I. no holdings/watchlist -> valid empty-user-assets semantics', async () => {
      const universe = getUserAssetUniverse([], []);
      assert.deepEqual(universe, []);

      const result = await getPersonalizedNewsFeed({
        getNewsFeedFn: async () => [
          { id: '1', title: 'FPT tăng mạnh', publishedAt: '2026-08-28T10:00:00Z' }
        ],
        getHoldingsFn: async () => [],
        getWatchlistFn: async () => []
      });

      assert.equal(result.userAssetCount, 0);
      assert.deepEqual(result.news, []);
      assert.deepEqual(result.userAssets, []);
    });

    test('Chronology: preserves newest-first ordering of matching articles', () => {
      const news = [
        {
          id: 'news-older',
          title: 'FPT công bố báo cáo sáng nay',
          publishedAt: '2026-08-28T08:00:00Z'
        },
        {
          id: 'news-newer',
          title: 'VCB triển khai gói dịch vụ chiều nay',
          publishedAt: '2026-08-28T14:00:00Z'
        }
      ];

      // Assuming raw news is already newest first:
      news.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 2);
      assert.equal(result[0].id, 'news-newer');
      assert.equal(result[1].id, 'news-older');
    });

    test('No forbidden AI / scoring fields in personalized news output', () => {
      const news = [
        {
          id: 'news-check',
          title: 'FPT đầu tư AI center',
          summary: 'Đầu tư phát triển công nghệ.',
          publishedAt: '2026-08-28T10:00:00Z'
        }
      ];

      const result = filterPersonalizedNews(news, sampleUserAssets);
      assert.equal(result.length, 1);
      const article = result[0];

      const forbiddenKeys = [
        'sentiment',
        'sentimentScore',
        'relevanceScore',
        'importanceScore',
        'opportunityScore',
        'recommendation',
        'rating',
        'action'
      ];

      for (const key of forbiddenKeys) {
        assert.equal(article[key], undefined, `Article should not contain forbidden property '${key}'`);
      }
    });
  });

  describe('2. Production Express Route Layer Integration (GET /api/news/personalized)', () => {
    let serverInstance;
    let baseUrl;
    let mockHoldings = [];
    let mockWatchlist = [];
    let mockNews = [];
    let simulateDbError = false;

    before(async () => {
      const appInstance = createApp({
        getHoldingsFn: async () => {
          if (simulateDbError) throw new Error('Database connection timeout');
          return mockHoldings;
        },
        getWatchlistFn: async () => {
          if (simulateDbError) throw new Error('Database connection timeout');
          return mockWatchlist;
        },
        getNewsFeedFn: async () => mockNews
      });

      serverInstance = http.createServer(appInstance);
      await new Promise((resolve) => serverInstance.listen(0, resolve));
      const port = serverInstance.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    after(async () => {
      if (serverInstance) {
        await new Promise((resolve) => serverInstance.close(resolve));
      }
    });

    test('J. route/integration uses production matching path with populated user assets', async () => {
      simulateDbError = false;
      mockHoldings = [
        {
          id: 'h-1',
          asset_id: 'a-1',
          quantity: 100,
          average_cost: 120000,
          asset: { id: 'a-1', symbol: 'FPT', name: 'FPT Corporation' }
        }
      ];

      mockWatchlist = [
        {
          id: 'w-1',
          asset_id: 'a-2',
          asset: { id: 'a-2', symbol: 'VCB', name: 'Vietcombank' }
        }
      ];

      mockNews = [
        {
          id: 'n-1',
          title: 'FPT đẩy mạnh đầu tư ra thị trường quốc tế',
          summary: 'Mở rộng hiện diện tại châu Âu.',
          source: 'CafeF',
          category: 'company',
          publishedAt: '2026-08-28T12:00:00Z',
          url: 'https://cafef.vn/fpt-global.chn',
          relatedAssets: [
            { assetId: 'a-1', symbol: 'FPT', name: 'FPT Corporation', matchReasons: ['SYMBOL_EXACT'] }
          ]
        },
        {
          id: 'n-2',
          title: 'Giá vàng SJC duy trì mức cao',
          summary: 'Giao dịch trầm lắng trong phiên.',
          source: 'CafeF',
          category: 'market',
          publishedAt: '2026-08-28T11:00:00Z',
          url: 'https://cafef.vn/gold-today.chn',
          relatedAssets: []
        }
      ];

      const res = await fetch(`${baseUrl}/api/news/personalized`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.userAssetCount, 2);
      assert.equal(body.count, 1);
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].id, 'n-1');
      assert.equal(body.data[0].matchedAssets[0].symbol, 'FPT');
      assert.equal(body.data[0].source, 'CafeF');
    });

    test('J1. production route rejects ordinary-word RAIN false positives when canonical relationships are empty', async () => {
      simulateDbError = false;
      mockHoldings = [
        {
          id: 'h-rain',
          asset_id: 'asset-rain',
          asset: { id: 'asset-rain', symbol: 'RAIN', name: 'Rain' }
        }
      ];
      mockWatchlist = [];
      mockNews = [
        {
          id: 'weather-news',
          title: 'Heavy rain expected across the region tomorrow',
          summary: 'Weather conditions may affect travel.',
          relatedAssets: []
        }
      ];

      const res = await fetch(`${baseUrl}/api/news/personalized`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.userAssetCount, 1);
      assert.equal(body.count, 0);
      assert.deepEqual(body.data, []);
    });

    test('J1b. one canonical article related to multiple user UUIDs appears once and preserves all relationships', async () => {
      simulateDbError = false;
      mockHoldings = [
        {
          id: 'h-fpt',
          asset_id: 'asset-fpt',
          asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corporation' }
        }
      ];
      mockWatchlist = [
        {
          id: 'w-vcb',
          asset_id: 'asset-vcb',
          asset: { id: 'asset-vcb', symbol: 'VCB', name: 'Vietcombank' }
        }
      ];
      mockNews = [
        {
          id: 'fpt-vcb-partnership',
          title: 'Canonical multi-asset article',
          relatedAssets: [
            { assetId: 'asset-fpt', symbol: 'FPT', name: 'FPT Corporation', matchReasons: ['SYMBOL_EXACT'] },
            { assetId: 'asset-vcb', symbol: 'VCB', name: 'Vietcombank', matchReasons: ['SYMBOL_EXACT'] }
          ]
        }
      ];

      const res = await fetch(`${baseUrl}/api/news/personalized`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.count, 1);
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].relatedAssets.length, 2);
      assert.deepEqual(body.data[0].matchedAssets.map((asset) => asset.symbol), ['FPT', 'VCB']);
    });

    test('J2. route returns 200 with empty data when user has 0 assets', async () => {
      simulateDbError = false;
      mockHoldings = [];
      mockWatchlist = [];
      mockNews = [{ id: '1', title: 'FPT tin' }];

      const res = await fetch(`${baseUrl}/api/news/personalized`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.userAssetCount, 0);
      assert.equal(body.count, 0);
      assert.deepEqual(body.data, []);
    });

    test('J3. route returns 500 when holdings query fails', async () => {
      simulateDbError = true;

      const res = await fetch(`${baseUrl}/api/news/personalized`);
      const body = await res.json();

      assert.equal(res.status, 500);
      assert.equal(body.status, 'error');
      assert.ok(body.message.includes('Failed to fetch personalized news feed'));
      assert.ok(body.details.includes('Database connection timeout'));
    });
  });
});
