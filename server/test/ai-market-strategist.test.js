import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  generateDeterministicMarketStrategist,
  generateMarketStrategist,
  MarketStrategistRuntime
} from '../src/ai/marketStrategistEngine.js';
import {
  MARKET_STRATEGIST_SCHEMA,
  STRATEGIST_METHODOLOGY_VERSION
} from '../src/ai/marketStrategistPrompt.js';
import { validateMarketStrategistOutput } from '../src/ai/marketStrategistValidation.js';
import { getMarketStrategist } from '../src/marketStrategist.js';
import {
  buildMarketStrategistViewModel,
  formatStrategistStance,
  formatEvidenceValue
} from '../../client/src/utils/marketStrategistDisplay.js';
import { buildInvestmentBriefViewModel } from '../../client/src/utils/investmentBriefDisplay.js';

const MOCK_OBSERVATIONS = [
  {
    id: 'vn.market.vnindex.close:2026-09-04:pub_1',
    observationId: 'vn.market.vnindex.close:2026-09-04:pub_1',
    factId: 'vn.market.vnindex.close',
    pillar: 'market',
    metric: 'Chỉ số VN-Index (đóng cửa phiên)',
    label: 'VN-Index',
    value: 1853.08,
    unit: 'điểm',
    change: 25.36,
    changeUnit: 'điểm',
    changePercent: 1.39,
    status: 'available',
    freshness: 'fresh',
    source: 'VNDIRECT'
  },
  {
    id: 'vn.macro.cpi.yoy:2026-08:pub_1',
    observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
    label: 'Lạm phát CPI (YoY)',
    value: 4.89,
    unit: '%',
    change: -0.71,
    changeUnit: 'điểm %',
    status: 'available',
    freshness: 'fresh',
    source: 'Cơ quan Thống kê Quốc gia'
  },
  {
    id: 'vn.monetary.fx.usd_vnd:2026-09-04:pub_1',
    observationId: 'vn.monetary.fx.usd_vnd:2026-09-04:pub_1',
    factId: 'vn.monetary.fx.usd_vnd',
    pillar: 'monetary',
    metric: 'Tỷ giá USD/VND',
    label: 'Tỷ giá USD/VND',
    value: 26054,
    unit: 'VND',
    change: -16,
    changeUnit: 'VND',
    status: 'available',
    freshness: 'fresh',
    source: 'Yahoo Finance'
  },
  {
    id: 'global.intermarket.dxy.quote:2026-09-04:pub_1',
    observationId: 'global.intermarket.dxy.quote:2026-09-04:pub_1',
    factId: 'global.intermarket.dxy.quote',
    pillar: 'intermarket',
    metric: 'Chỉ số USD (DXY)',
    label: 'Chỉ số USD (DXY)',
    value: 99.22,
    unit: 'điểm',
    change: -0.22,
    status: 'available',
    freshness: 'fresh',
    source: 'Yahoo Finance'
  }
];

const MOCK_NEWS = [
  {
    articleId: 'news_cafef_123',
    id: 'news_cafef_123',
    title: 'Viconship lên kế hoạch tăng vốn điều lệ',
    excerpt: 'Kế hoạch phát hành thêm cổ phiếu để nâng cao năng lực tài chính.',
    sourceName: 'CafeF',
    publishedAt: '2026-09-04T12:53:00.000Z',
    geography: 'vietnam',
    relatedAssets: [{ symbol: 'VSC', name: 'Viconship' }]
  },
  {
    articleId: 'news_coindesk_456',
    id: 'news_coindesk_456',
    title: 'US added 162k jobs in August',
    excerpt: 'Labor market bounced back according to official reports.',
    sourceName: 'CoinDesk',
    publishedAt: '2026-09-04T12:31:00.000Z',
    geography: 'global',
    relatedAssets: []
  }
];

test('V1.2 Improvement 04 — AI Market Strategist', async (t) => {
  const NOW = new Date('2026-09-04T13:30:00.000Z');

  await t.test('1. AI only receives allowed public facts/news in fact packet', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    assert.equal(packet.evidence.length, 4);
    assert.equal(packet.untrustedNews.length, 2);
    assert.ok(packet.validFactIds.has('vn.market.vnindex.close:2026-09-04:pub_1'));
    assert.ok(packet.validArticleIds.has('news_cafef_123'));

    // Check structure of public facts
    const vnIndexEv = packet.evidence.find((e) => e.factId === 'vn.market.vnindex.close');
    assert.equal(vnIndexEv.value, 1853.08);
    assert.equal(vnIndexEv.unit, 'điểm');
  });

  await t.test('2. Guard strictly blocks private portfolio/user data from entering input', () => {
    // Attempting to pass user ID / portfolio holdings throws immediately
    assert.throws(() => {
      buildMarketStrategistFactPacket({
        marketObservations: [
          ...MOCK_OBSERVATIONS,
          { portfolio: { holdings: ['FPT'] } }
        ],
        newsArticles: MOCK_NEWS,
        now: NOW
      });
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      buildMarketStrategistFactPacket({
        marketObservations: MOCK_OBSERVATIONS,
        newsArticles: [
          ...MOCK_NEWS,
          { userId: 'user_12345', email: 'investor@test.com' }
        ],
        now: NOW
      });
    }, /FORBIDDEN_USER_DATA/);

    assert.throws(() => {
      buildMarketStrategistFactPacket({
        marketObservations: [
          ...MOCK_OBSERVATIONS,
          { cash: 100_000_000, transactions: [] }
        ],
        newsArticles: MOCK_NEWS,
        now: NOW
      });
    }, /FORBIDDEN_USER_DATA/);
  });

  await t.test('3. Strict structured output validation against schema', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const validDeterministic = generateDeterministicMarketStrategist({ factPacket: packet, now: NOW });
    const validation = validateMarketStrategistOutput(validDeterministic, {
      validFactIds: packet.validFactIds,
      validArticleIds: packet.validArticleIds
    });

    assert.equal(validation.valid, true, `Expected valid output, got errors: ${validation.errors.join(', ')}`);
    assert.ok(validDeterministic.marketOverview.vietnam.length >= 10);
    assert.ok(validDeterministic.marketOverview.global.length >= 10);
    assert.ok(validDeterministic.keyDrivers.length >= 1);
    assert.ok(['defensive', 'neutral', 'selective_risk_on', 'risk_on'].includes(validDeterministic.investmentOrientation.stance));
    assert.equal(validDeterministic.methodologyVersion, STRATEGIST_METHODOLOGY_VERSION);
  });

  await t.test('4. Unknown citation is rejected by validator', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const candidate = generateDeterministicMarketStrategist({ factPacket: packet, now: NOW });
    // Inject fabricated fact observation ID
    candidate.citations.factObservationIds.push('vn.fake.fabricated_fact:2026:obs_fake');

    const validation = validateMarketStrategistOutput(candidate, {
      validFactIds: packet.validFactIds,
      validArticleIds: packet.validArticleIds
    });

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes('UNKNOWN_FACT_CITATION_vn.fake.fabricated_fact')));
  });

  await t.test('5. Hallucinated recommendation / forbidden keyword is rejected', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const candidate = generateDeterministicMarketStrategist({ factPacket: packet, now: NOW });
    // Inject forbidden recommendation
    candidate.investmentOrientation.rationale = 'Khuyến nghị mua ngay cổ phiếu để đạt lợi nhuận cam kết cao.';

    const validation = validateMarketStrategistOutput(candidate, {
      validFactIds: packet.validFactIds,
      validArticleIds: packet.validArticleIds
    });

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.includes('FORBIDDEN_RECOMMENDATION_KEYWORDS_DETECTED'));
  });

  await t.test('6. Malformed AI response falls back to deterministic brief', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    // Mock LLM returning malformed/empty object
    const result = await generateMarketStrategist({
      factPacket: packet,
      now: NOW,
      apiKey: 'test-key',
      runtime: new MarketStrategistRuntime(),
      generateLlmFn: async () => ({ malformed: true, missingAll: true })
    });

    assert.equal(result.generationMode, 'deterministic_fallback');
    assert.ok(result.marketOverview.vietnam);
    assert.ok(result.investmentOrientation.stance);
  });

  await t.test('7. Provider failure / timeout falls back to deterministic brief', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const result = await generateMarketStrategist({
      factPacket: packet,
      now: NOW,
      apiKey: 'test-key',
      runtime: new MarketStrategistRuntime(),
      generateLlmFn: async () => {
        throw new Error('AI provider connection timeout');
      }
    });

    assert.equal(result.generationMode, 'deterministic_fallback');
    assert.ok(result.keyDrivers.length > 0);
  });

  await t.test('8. Cache fingerprint stability and hit', async () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const fp1 = computeStrategistFingerprint({
      validFactIds: packet.validFactIds,
      validArticleIds: packet.validArticleIds
    });
    const fp2 = computeStrategistFingerprint({
      validFactIds: packet.validFactIds,
      validArticleIds: packet.validArticleIds
    });

    assert.equal(fp1, fp2);

    const runtime = new MarketStrategistRuntime();
    const first = await generateMarketStrategist({
      factPacket: packet,
      now: NOW,
      apiKey: 'test-key',
      runtime,
      generateLlmFn: async () => {
        const d = generateDeterministicMarketStrategist({ factPacket: packet, now: NOW });
        return { ...d, generationMode: 'llm' };
      }
    });

    assert.equal(first.generationMode, 'llm');

    // Second call with same inputs should hit cache
    const second = await generateMarketStrategist({
      factPacket: packet,
      now: NOW,
      apiKey: 'test-key',
      runtime
    });

    assert.equal(second.generationMode, 'cache');
    assert.equal(second.marketOverview.vietnam, first.marketOverview.vietnam);
  });

  await t.test('9. Fact or news change invalidates cache fingerprint', () => {
    const packet1 = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const newObservations = [
      ...MOCK_OBSERVATIONS,
      {
        id: 'global.intermarket.brent.futures:2026-09-04:pub_2',
        observationId: 'global.intermarket.brent.futures:2026-09-04:pub_2',
        factId: 'global.intermarket.brent.futures',
        value: 95.5,
        unit: 'USD/thùng'
      }
    ];

    const packet2 = buildMarketStrategistFactPacket({
      marketObservations: newObservations,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const fp1 = computeStrategistFingerprint({
      validFactIds: packet1.validFactIds,
      validArticleIds: packet1.validArticleIds
    });
    const fp2 = computeStrategistFingerprint({
      validFactIds: packet2.validFactIds,
      validArticleIds: packet2.validArticleIds
    });

    assert.notEqual(fp1, fp2);
  });

  await t.test('10. UI view model maps AI and fallback states truthfully', () => {
    const packet = buildMarketStrategistFactPacket({
      marketObservations: MOCK_OBSERVATIONS,
      newsArticles: MOCK_NEWS,
      now: NOW
    });

    const fallbackData = generateDeterministicMarketStrategist({ factPacket: packet, now: NOW });
    const vmFallback = buildMarketStrategistViewModel(fallbackData);

    assert.equal(vmFallback.badgeLabel, 'Tóm tắt dữ liệu');
    assert.equal(vmFallback.fallbackNotice, 'Bản tóm tắt hiện được tạo từ dữ liệu đã xác minh.');
    assert.equal(vmFallback.investmentOrientation.stanceLabel, formatStrategistStance(fallbackData.investmentOrientation.stance));
    assert.equal(vmFallback.marketOverview.vietnam, fallbackData.marketOverview.vietnam);

    // LLM state view model
    const llmData = { ...fallbackData, generationMode: 'llm' };
    const vmLlm = buildMarketStrategistViewModel(llmData);
    assert.equal(vmLlm.badgeLabel, 'AI Tổng hợp');
    assert.equal(vmLlm.fallbackNotice, null);

    // Bridge in investmentBriefDisplay
    const bridged = buildInvestmentBriefViewModel(fallbackData);
    assert.equal(bridged.isStrategist, true);
    assert.equal(bridged.curatedSections.length, 4);
    assert.equal(bridged.badgeLabel, 'Tóm tắt dữ liệu');
  });

  await t.test('11. getMarketStrategist top-level facade runs end-to-end with mock fabric and news', async () => {
    const res = await getMarketStrategist({
      now: NOW,
      getMarketContextFabricFn: async () => ({ facts: MOCK_OBSERVATIONS }),
      getNewsFeedFn: async () => ({ data: MOCK_NEWS }),
      runtime: new MarketStrategistRuntime(),
      aiEnabled: false
    });

    assert.ok(res.marketOverview);
    assert.ok(res.keyDrivers.length > 0);
    assert.ok(res.investmentOrientation);
    assert.equal(res.generationMode, 'deterministic_fallback');
    assert.equal(res.citations.factObservationIds.length > 0, true);
    assert.equal(res.citations.articleIds.length > 0, true);
    assert.equal(res.evidence.length, 4);
  });

  await t.test('12. allowLlm=false skips LLM invocation and returns deterministic synthesis or cache', async () => {
    let llmCalled = false;
    const res = await getMarketStrategist({
      now: NOW,
      getMarketContextFabricFn: async () => ({ facts: MOCK_OBSERVATIONS }),
      getNewsFeedFn: async () => ({ data: MOCK_NEWS }),
      runtime: new MarketStrategistRuntime(),
      apiKey: 'sk-mock-key',
      aiEnabled: true,
      allowLlm: false,
      generateLlmFn: async () => {
        llmCalled = true;
        return {};
      }
    });

    assert.equal(llmCalled, false);
    assert.equal(res.generationMode, 'deterministic_fallback');
  });

  await t.test('13. POST and GET endpoints in createApp operate without profile dependency', async () => {
    const { createApp } = await import('../index.js');
    const app = createApp({
      getMarketStrategistFn: async ({ allowLlm }) => ({
        generationMode: allowLlm ? 'deterministic_fallback' : 'deterministic_fallback',
        marketOverview: { vietnam: 'VN test', global: 'Global test' }
      })
    });

    const server = app.listen(0);
    const { port } = server.address();
    try {
      // Public GET request without auth or profile succeeds (200)
      const getRes = await fetch(`http://127.0.0.1:${port}/api/market-strategist`);
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json();
      assert.equal(getBody.status, 'ok');
      assert.equal(getBody.data.marketOverview.vietnam, 'VN test');

      // Unauthenticated POST request is rejected (401 AUTH_REQUIRED)
      const unauthPostRes = await fetch(`http://127.0.0.1:${port}/api/market-strategist`, {
        method: 'POST'
      });
      assert.equal(unauthPostRes.status, 401);

      // Authenticated POST request without profileId succeeds (200 OK, no profile dependency)
      const testPayload = Buffer.from(JSON.stringify({ sub: 'user-123' })).toString('base64url');
      const testToken = `header.${testPayload}.signature`;
      const authPostRes = await fetch(`http://127.0.0.1:${port}/api/market-strategist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testToken}`
        }
      });
      assert.equal(authPostRes.status, 200);
      const postBody = await authPostRes.json();
      assert.equal(postBody.status, 'ok');
    } finally {
      server.close();
    }
  });
});
