import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../index.js';
import {
  buildArticleId,
  clearNewsPersistenceStore,
  deduplicateCanonicalArticles,
  fetchPersistedNewsArticles,
  NewsReadCache,
  NewsReadService,
  normalizeCanonicalArticle,
  persistNewsArticles,
  runNewsCollector
} from '../src/news.js';

const NOW = new Date('2026-09-04T09:00:00.000Z');
const SCHEDULER_TOKEN = 'news-scheduler-token-with-at-least-thirty-two-characters';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(testDir, '..', '..', 'supabase', 'migrations', '20260904040000_create_market_news_articles.sql');
const schemaPath = path.resolve(testDir, '..', 'db', 'schema.sql');
const runningServers = [];

function rawArticle(overrides = {}) {
  return {
    id: 'provider-article-1',
    sourceId: 'cafef',
    source: 'CafeF',
    title: 'FPT công bố kế hoạch đầu tư mới',
    summary: 'Thông tin do CafeF công bố.',
    url: 'https://cafef.vn/fpt-ke-hoach-moi.htm?utm_source=test',
    publishedAt: '2026-09-04T07:00:00.000Z',
    language: 'vi',
    category: 'company',
    relatedAssets: [{
      assetId: 'asset-fpt',
      symbol: 'fpt',
      name: 'FPT Corporation',
      relevanceReason: 'TITLE_SYMBOL_MATCH'
    }],
    ...overrides
  };
}

function canonicalArticle(overrides = {}) {
  return normalizeCanonicalArticle(rawArticle(overrides), { fetchedAt: NOW.toISOString() });
}

function rowFromArticle(article) {
  return {
    article_id: article.articleId,
    source_id: article.sourceId,
    source_name: article.sourceName,
    title: article.title,
    excerpt: article.excerpt,
    canonical_url: article.url,
    published_at: article.publishedAt,
    fetched_at: article.fetchedAt,
    language: article.language,
    category: article.category,
    topic: article.topic,
    related_assets: article.relatedAssets,
    geography: article.geography,
    source_authority: article.sourceAuthority,
    quality: article.quality,
    provenance: article.provenance,
    status: article.status,
    freshness: article.freshness,
    last_seen_at: article.fetchedAt
  };
}

function createNewsDb(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [row.article_id, structuredClone(row)]));
  let selectCount = 0;
  let upsertCount = 0;
  return {
    get selectCount() { return selectCount; },
    get upsertCount() { return upsertCount; },
    from(table) {
      assert.equal(table, 'market_news_articles');
      return {
        async upsert(values, options) {
          upsertCount++;
          assert.equal(options.onConflict, 'article_id');
          for (const value of values) rows.set(value.article_id, structuredClone(value));
          return { error: null };
        },
        select() {
          return {
            order(_column, _options) {
              return {
                async limit(limit) {
                  selectCount++;
                  return { data: Array.from(rows.values()).slice(0, limit), error: null };
                }
              };
            }
          };
        }
      };
    }
  };
}

async function listen(app) {
  const server = http.createServer(app);
  runningServers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  await Promise.all(runningServers.map((server) => new Promise((resolve) => server.close(resolve))));
});

beforeEach(() => {
  clearNewsPersistenceStore();
});

describe('V1.2 Improvement 03 - reliable normalized news pipeline', () => {
  test('article identity is deterministic across tracking URLs and deduplication preserves a richer copy', () => {
    const first = canonicalArticle();
    const repeat = canonicalArticle({
      id: 'provider-article-repeat',
      summary: 'Thông tin đầy đủ hơn từ cùng bài viết.',
      url: 'https://cafef.vn/fpt-ke-hoach-moi.htm?utm_campaign=repeat'
    });
    const distinct = canonicalArticle({
      id: 'provider-article-2',
      title: 'FPT công bố kết quả quý',
      url: 'https://cafef.vn/fpt-ket-qua-quy.htm'
    });

    assert.equal(first.articleId, repeat.articleId);
    assert.equal(buildArticleId(rawArticle()), first.articleId);
    assert.equal(deduplicateCanonicalArticles([first, repeat, distinct]).length, 2);
    assert.notEqual(first.articleId, distinct.articleId);
  });

  test('canonical contract validates attribution, timestamps, required fields and related assets', () => {
    const article = canonicalArticle({
      relatedAssets: [
        { assetId: 'asset-fpt', symbol: 'fpt', name: 'FPT', relevanceReason: 'TITLE_SYMBOL_MATCH' },
        { assetId: 'asset-fpt', symbol: 'VCB', name: 'duplicate' },
        { symbol: 'VCB' }
      ]
    });

    assert.equal(article.sourceId, 'cafef');
    assert.equal(article.sourceName, 'CafeF');
    assert.equal(article.sourceAuthority, 'FINANCIAL_MEDIA');
    assert.equal(article.provenance.provider, 'cafef');
    assert.deepEqual(article.relatedAssets, [{
      assetId: 'asset-fpt',
      symbol: 'FPT',
      name: 'FPT',
      relevanceReason: 'TITLE_SYMBOL_MATCH'
    }]);
    assert.equal(normalizeCanonicalArticle(rawArticle({ publishedAt: 'not-a-date' }), { fetchedAt: NOW.toISOString() }), null);
    assert.equal(normalizeCanonicalArticle(rawArticle({ title: '   ' }), { fetchedAt: NOW.toISOString() }), null);
    assert.equal(normalizeCanonicalArticle(rawArticle({ url: 'javascript:alert(1)' }), { fetchedAt: NOW.toISOString() }), null);
    assert.equal(normalizeCanonicalArticle(rawArticle(), { fetchedAt: 'malformed' }), null);
  });

  test('cold-start public reader loads persisted rows without any provider acquisition', async () => {
    const article = canonicalArticle();
    const db = createNewsDb([rowFromArticle(article)]);
    let upstreamCalls = 0;
    const reader = new NewsReadService({
      client: db,
      cache: new NewsReadCache(),
      fetchPersistedFn: async (options) => {
        const rows = await fetchPersistedNewsArticles(options);
        return rows;
      },
      getAssetByIdFn: async () => ({ id: 'asset-fpt' })
    });
    const app = createApp({
      getNewsFeedFn: (options) => reader.getNewsFeed(options),
      runNewsCollectorFn: async () => {
        upstreamCalls++;
        return { success: true };
      }
    });
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/api/news?geography=vietnam&topic=company`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.data[0].articleId, article.articleId);
    assert.equal(db.selectCount, 1);
    assert.equal(upstreamCalls, 0);
  });

  test('reader cache prevents repeated persisted reads and exposes explicit stale metadata', async () => {
    const oldArticle = normalizeCanonicalArticle(rawArticle(), {
      fetchedAt: '2026-09-04T06:00:00.000Z'
    });
    const db = createNewsDb([rowFromArticle(oldArticle)]);
    const reader = new NewsReadService({ client: db, cache: new NewsReadCache() });

    const first = await reader.getNewsFeed({ now: NOW });
    const second = await reader.getNewsFeed({ now: new Date('2026-09-04T09:01:00.000Z') });
    assert.equal(db.selectCount, 1);
    assert.equal(first.data[0].freshness, 'stale');
    assert.equal(first.partial, true);
    assert.equal(second.source, 'memory_cache');
  });

  test('provider failure retains last-known-good articles and never fabricates a replacement', async () => {
    const existing = canonicalArticle();
    const db = createNewsDb([rowFromArticle(existing)]);
    const failingService = {
      async fetchAllSources() {
        return {
          sourceResults: [
            { sourceId: 'cafef', status: 'error', articleCount: 0, errorCode: 'SOURCE_TIMEOUT' },
            { sourceId: 'coindesk', status: 'error', articleCount: 0, errorCode: 'HTTP_429' },
            { sourceId: 'alphavantage-news', status: 'error', articleCount: 0, errorCode: 'PROVIDER_RATE_LIMITED' }
          ],
          allArticles: [],
          partial: false,
          allFailed: true
        };
      },
      processArticles() { return []; }
    };

    const result = await runNewsCollector({
      now: NOW,
      client: db,
      service: failingService,
      getAssetsFn: async () => [],
      readCache: new NewsReadCache()
    });
    const retained = await fetchPersistedNewsArticles({ client: db, now: NOW });
    assert.equal(result.success, true);
    assert.equal(result.allProvidersFailed, true);
    assert.equal(result.validatedArticleCount, 0);
    assert.equal(result.retainedArticleCount, 1);
    assert.equal(retained[0].articleId, existing.articleId);
  });

  test('collector persists normalized articles once and records source provenance', async () => {
    const db = createNewsDb();
    const service = {
      async fetchAllSources() {
        return {
          sourceResults: [{ sourceId: 'cafef', status: 'ok', articleCount: 2, fetchedAt: NOW.toISOString() }],
          allArticles: [rawArticle(), rawArticle({ id: 'repeat', url: 'https://cafef.vn/fpt-ke-hoach-moi.htm?utm_medium=rss' })],
          partial: false,
          allFailed: false
        };
      },
      processArticles(articles) { return articles; }
    };
    const result = await runNewsCollector({
      now: NOW,
      client: db,
      service,
      getAssetsFn: async () => [],
      readCache: new NewsReadCache()
    });

    assert.equal(result.success, true);
    assert.equal(result.validatedArticleCount, 1);
    assert.equal(result.durablyPersisted, 1);
    assert.equal(db.upsertCount, 1);
    const rows = await fetchPersistedNewsArticles({ client: db, now: NOW });
    assert.equal(rows[0].provenance.provider, 'cafef');
  });

  test('persistence errors are sanitized and retain the process last-known-good copy', async () => {
    const article = canonicalArticle();
    const failingDb = {
      from() {
        return { async upsert() { throw new Error('secret provider detail'); } };
      }
    };
    const result = await persistNewsArticles([article], failingDb);
    const retained = await fetchPersistedNewsArticles({ client: null, now: NOW });
    assert.equal(result.isDurable, false);
    assert.equal(result.failedPersistence, 1);
    assert.deepEqual(result.error, { code: null, message: 'NEWS_PERSISTENCE_FAILED' });
    assert.equal(retained[0].articleId, article.articleId);
  });

  test('internal collector route is scheduler-authenticated and reports durable collection only', async () => {
    let collectorCalls = 0;
    const app = createApp({
      alertSchedulerToken: SCHEDULER_TOKEN,
      runNewsCollectorFn: async () => {
        collectorCalls++;
        return { success: true, isDurable: true, durablyPersisted: 3, failedPersistence: 0 };
      }
    });
    const baseUrl = await listen(app);

    const denied = await fetch(`${baseUrl}/api/internal/news/refresh`, { method: 'POST' });
    assert.equal(denied.status, 401);
    const accepted = await fetch(`${baseUrl}/api/internal/news/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
    });
    const body = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(body.data.durablyPersisted, 3);
    assert.equal(collectorCalls, 1);
  });

  test('migration creates a public-read, backend-write global news table without user ownership', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.market_news_articles/i);
    assert.match(sql, /article_id TEXT PRIMARY KEY/i);
    assert.match(sql, /GRANT SELECT ON public\.market_news_articles TO anon, authenticated/i);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.market_news_articles FROM anon, authenticated/i);
    assert.match(sql, /GRANT ALL ON public\.market_news_articles TO service_role/i);
    assert.doesNotMatch(sql, /user_id|profile_id/i);
    assert.match(schema, /Schema Migration: 20260904040000_create_market_news_articles\.sql/i);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.market_news_articles/i);
  });
});
