import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../index.js';
import { RegimeCache } from '../src/regime/cache.js';
import {
  NSO_CPI_CHART_URL,
  buildInflationDomain,
  fetchNsoInflation,
  parseNsoCpiRelease,
  unavailableInflation
} from '../src/regime/providers/nso.js';
import {
  SBV_RELEASE_INDEX_URL,
  buildMoneyMarketDomain,
  fetchSbvMoneyMarket,
  parseSbvWeeklyRelease,
  unavailableMoneyMarket
} from '../src/regime/providers/sbv.js';
import { buildVietnamRegime, getVietnamRegime } from '../src/regime.js';
import { buildVietnamRegimeViewModel } from '../../client/src/utils/regimeDisplay.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const panelPath = path.resolve(testDir, '..', '..', 'client', 'src', 'components', 'VietnamRegimePanel.jsx');

function cpiRelease(referencePeriod, publishedAt, headlineCpiYoYPct) {
  return {
    referencePeriod,
    publishedAt,
    headlineCpiYoYPct,
    releaseUrl: `https://www.nso.gov.vn/tin-tuc-thong-ke/${referencePeriod}/chi-so-gia-tieu-dung/`
  };
}

function weeklyObservation(index, rate, { skipWeeks = 0 } = {}) {
  const start = new Date(Date.UTC(2026, 5, 1 + (index + skipWeeks) * 7));
  const end = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
  return {
    referenceWeekStart: start.toISOString().slice(0, 10),
    referenceWeekEnd: end.toISOString().slice(0, 10),
    vndOvernightRatePct: rate,
    releaseUrl: `https://www.sbv.gov.vn/vi/w/weekly-${index}`,
    pdfUrl: `https://www.sbv.gov.vn/documents/20117/weekly-${index}.pdf`
  };
}

function response(body, { ok = true, status = 200, arrayBuffer = null } = {}) {
  return {
    ok,
    status,
    text: async () => body,
    arrayBuffer: async () => arrayBuffer || new TextEncoder().encode(body).buffer
  };
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Feature 27B — Vietnam market regime foundation', () => {
  test('parses an official NSO CPI release and calculates the exact M minus M-3 YoY delta', () => {
    const html = `
      <main>
        <p>Chỉ số giá tiêu dùng (CPI) tháng Bảy giảm 0,12% so với tháng trước;
        tăng 3,08% so với tháng 12/2025 và tăng 4,45% so với cùng kỳ năm trước.</p>
        <p>Kỳ tham chiếu: 7/2026</p><p>Ngày đăng: 03/08/2026</p>
      </main>`;
    const parsed = parseNsoCpiRelease(
      html,
      'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/08/chi-so-gia-tieu-dung-thang-bay/'
    );
    assert.deepEqual(parsed, {
      referencePeriod: '2026-07',
      publishedAt: '2026-08-03',
      headlineCpiYoYPct: 4.45,
      releaseUrl: 'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/08/chi-so-gia-tieu-dung-thang-bay/'
    });

    const domain = buildInflationDomain([
      cpiRelease('2026-04', '2026-05-03', 5.46),
      parsed
    ]);
    assert.equal(domain.status, 'available');
    assert.equal(domain.headlineCpiYoYPct, 4.45);
    assert.equal(domain.threeMonthDeltaPp, 4.45 - 5.46);
  });

  test('preserves the latest official CPI and returns null when M-3 is missing', () => {
    const domain = buildInflationDomain([cpiRelease('2026-07', '2026-08-03', 4.45)]);
    assert.equal(domain.status, 'insufficient_history');
    assert.equal(domain.headlineCpiYoYPct, 4.45);
    assert.equal(domain.threeMonthDeltaPp, null);
  });

  test('fetches only the official NSO archive and structured chart without deriving YoY from MoM', async () => {
    const indexUrl = 'https://www.nso.gov.vn/cpi-vi/';
    const julyUrl = 'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/08/chi-so-gia-tieu-dung-thang-bay/';
    const aprilUrl = 'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/05/chi-so-gia-tieu-dung-thang-tu/';
    const pages = new Map([
      [indexUrl, `
        <a href="${julyUrl}"><section class="item"><h3>Chỉ số giá tiêu dùng tháng Bảy</h3>
          <span>Ngày đăng: 03/08/2026</span><span>Kỳ tham chiếu: 7/2026</span>
        </section></a>
        <a href="${aprilUrl}"><section class="item"><h3>Chỉ số giá tiêu dùng tháng Tư</h3>
          <span>Ngày đăng: 03/05/2026</span><span>Kỳ tham chiếu: Tháng 4/2026</span>
        </section></a>
      `],
      [NSO_CPI_CHART_URL, `
        <script>var official = {
          chart_args: {"series":[{"data":[["4/2026",5.46],["7/2026",4.45]]}]},
          post_id: 24238
        };</script>
      `]
    ]);
    const requestedUrls = [];
    const domain = await fetchNsoInflation({
      now: new Date('2026-09-01T00:00:00Z'),
      fetchFn: async (url) => {
        requestedUrls.push(url);
        return response(pages.get(url) || '', { ok: pages.has(url), status: pages.has(url) ? 200 : 404 });
      }
    });
    assert.deepEqual(requestedUrls.sort(), [NSO_CPI_CHART_URL, indexUrl].sort());
    assert.equal(domain.status, 'available');
    assert.equal(domain.headlineCpiYoYPct, 4.45);
    assert.equal(domain.threeMonthDeltaPp, 4.45 - 5.46);
    assert.equal(domain.provenance.chartUrl, NSO_CPI_CHART_URL);
  });

  test('parses verified SBV weekly overnight-rate observations across diverse official date formats', () => {
    // Pattern 1: Two months date format (e.g. 29/6 - 03/7/2026)
    const obs1 = parseSbvWeeklyRelease(
      'Diễn biến thị trường tuần từ 29/6 - 03/7/2026. Lãi suất giao dịch bình quân kỳ hạn qua đêm là 7,23%/năm.',
      'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-lien-ngan-hang',
      'https://www.sbv.gov.vn/documents/20117/29.6-03.7.2026.pdf'
    );
    assert.deepEqual(obs1, {
      referenceWeekStart: '2026-06-29',
      referenceWeekEnd: '2026-07-03',
      vndOvernightRatePct: 7.23,
      releaseUrl: 'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-lien-ngan-hang',
      pdfUrl: 'https://www.sbv.gov.vn/documents/20117/29.6-03.7.2026.pdf'
    });

    // Pattern 2: Single-month hyphen date format (e.g. tuần từ 06-10.7.2026)
    const obs2 = parseSbvWeeklyRelease(
      'Diễn biến thị trường ngoại tệ và thị trường liên ngân hàng tuần từ 06-10.7.2026. Lãi suất bình quân qua đêm: 4,50%',
      'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-06-10'
    );
    assert.deepEqual(obs2, {
      referenceWeekStart: '2026-07-06',
      referenceWeekEnd: '2026-07-10',
      vndOvernightRatePct: 4.5,
      releaseUrl: 'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-06-10',
      pdfUrl: null
    });

    // Pattern 3: Single-month slash date format (e.g. tuần từ 04-08/5/2026)
    const obs3 = parseSbvWeeklyRelease(
      'Diễn biến thị trường ngoại tệ và thị trường liên ngân hàng tuần từ 04-08/5/2026. Lãi suất kỳ hạn qua đêm là 3,85%/năm.',
      'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-04-08'
    );
    assert.deepEqual(obs3, {
      referenceWeekStart: '2026-05-04',
      referenceWeekEnd: '2026-05-08',
      vndOvernightRatePct: 3.85,
      releaseUrl: 'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-04-08',
      pdfUrl: null
    });
  });

  test('fetchSbvMoneyMarket fails closed with an explicit source-access blocker on WAF rejection', async () => {
    const domain = await fetchSbvMoneyMarket({
      fetchFn: async () => response('<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>', { status: 200 })
    });
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.reason, 'BLOCKED_BY_SOURCE_ACCESS');
    assert.equal(domain.provenance.indexUrl, SBV_RELEASE_INDEX_URL);
    assert.equal(domain.vndOvernightRatePct, null);
  });

  test('fetchSbvMoneyMarket gracefully returns unavailable on timeout', async () => {
    const domain = await fetchSbvMoneyMarket({
      fetchFn: async () => {
        const error = new Error('AbortError');
        error.name = 'AbortError';
        throw error;
      }
    });
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.reason, 'OFFICIAL_SOURCE_TIMEOUT');
  });

  test('preserves the latest SBV rate but withholds derived fields below eight observations', () => {
    const domain = buildMoneyMarketDomain(Array.from({ length: 7 }, (_, index) => weeklyObservation(index, index + 1)));
    assert.equal(domain.status, 'insufficient_history');
    assert.equal(domain.vndOvernightRatePct, 7);
    assert.equal(domain.latest4WeekMeanPct, null);
    assert.equal(domain.previous4WeekMeanPct, null);
    assert.equal(domain.trendPp, null);
  });

  test('uses exactly eight consecutive official observations for full-precision four-week means', () => {
    const domain = buildMoneyMarketDomain(Array.from({ length: 8 }, (_, index) => weeklyObservation(index, index + 1)));
    assert.equal(domain.status, 'available');
    assert.equal(domain.previous4WeekMeanPct, 2.5);
    assert.equal(domain.latest4WeekMeanPct, 6.5);
    assert.equal(domain.trendPp, 4);
  });

  test('does not fill a missing official week even when eight distinct observations exist', () => {
    const observations = [0, 1, 2, 3, 5, 6, 7, 8].map((week, index) => weeklyObservation(week, index + 1));
    const domain = buildMoneyMarketDomain(observations);
    assert.equal(domain.observationCount, 8);
    assert.equal(domain.status, 'insufficient_history');
    assert.equal(domain.trendPp, null);
  });

  test('uses an official PDF extraction path and rejects malformed SBV source data', async () => {
    const indexUrl = SBV_RELEASE_INDEX_URL;
    const releaseUrl = 'https://www.sbv.gov.vn/vi/w/dien-bien-thi-truong-lien-ngan-hang-1';
    const pdfUrl = 'https://www.sbv.gov.vn/documents/20117/week-1.pdf/official';
    const pages = new Map([
      [indexUrl, `<a href="${releaseUrl}">Diễn biến thị trường ngoại tệ và thị trường liên ngân hàng</a>`],
      [releaseUrl, `<a href="${pdfUrl}">PDF</a>`]
    ]);
    let pdfExtractions = 0;
    const domain = await fetchSbvMoneyMarket({
      fetchFn: async (url) => {
        if (url === pdfUrl) return response('pdf-bytes', { arrayBuffer: new TextEncoder().encode('%PDF-fake').buffer });
        return response(pages.get(url) || '', { ok: pages.has(url), status: pages.has(url) ? 200 : 404 });
      },
      extractPdfTextFn: async () => {
        pdfExtractions += 1;
        return 'Tuần từ 01/6 - 05/6/2026. Kỳ hạn qua đêm: không công bố.';
      }
    });
    assert.equal(pdfExtractions, 1);
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.vndOvernightRatePct, null);
    assert.equal(domain.trendPp, null);
  });

  test('coalesces requests and serves a bounded stale official observation after live failure', async () => {
    const cache = new RegimeCache({
      inflation: { freshTtlMs: 10, staleTtlMs: 1000 }
    });
    const firstNow = new Date('2026-08-31T00:00:00Z');
    let calls = 0;
    const fetchGood = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return buildInflationDomain([
        cpiRelease('2026-04', '2026-05-03', 5.46),
        cpiRelease('2026-07', '2026-08-03', 4.45)
      ]);
    };
    const [a, b] = await Promise.all([
      cache.fetchWithCache('inflation', fetchGood, { now: firstNow }),
      cache.fetchWithCache('inflation', fetchGood, { now: firstNow })
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);

    const stale = await cache.fetchWithCache('inflation', async () => unavailableInflation(), {
      now: new Date(firstNow.getTime() + 20)
    });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.underlyingStatus, 'available');
    assert.equal(stale.headlineCpiYoYPct, 4.45);
  });

  test('builds a truthful partial response and never fabricates zeros', async () => {
    const now = new Date('2026-08-31T05:00:00Z');
    const inflation = buildInflationDomain([
      cpiRelease('2026-04', '2026-05-03', 5.46),
      cpiRelease('2026-07', '2026-08-03', 4.45)
    ]);
    const result = buildVietnamRegime({
      now,
      inflation,
      moneyMarket: unavailableMoneyMarket('MALFORMED_OFFICIAL_SOURCE')
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.partial, true);
    assert.equal(result.moneyMarket.vndOvernightRatePct, null);
    assert.equal(result.moneyMarket.trendPp, null);
    assert.deepEqual(result.marketBreadth, {
      status: 'unavailable',
      reason: 'SOURCE_NOT_PROVISIONED',
      provenance: null
    });

    const malformedCpi = buildInflationDomain([
      { ...cpiRelease('2026-07', '2026-08-03', 4.45), headlineCpiYoYPct: '4.45' }
    ]);
    assert.equal(malformedCpi.headlineCpiYoYPct, null);
  });

  test('returns HTTP 200 for one usable domain and HTTP 503 when all live/stale domains are unusable', async () => {
    const available = buildInflationDomain([
      cpiRelease('2026-04', '2026-05-03', 5.46),
      cpiRelease('2026-07', '2026-08-03', 4.45)
    ]);
    const partialApp = createApp({
      getVietnamRegimeFn: async ({ now }) => buildVietnamRegime({
        now,
        inflation: available,
        moneyMarket: unavailableMoneyMarket()
      })
    });
    await withServer(partialApp, async (baseUrl) => {
      const responseValue = await fetch(`${baseUrl}/api/regime/vietnam`);
      const body = await responseValue.json();
      assert.equal(responseValue.status, 200);
      assert.equal(body.partial, true);
      assert.equal(body.inflation.status, 'available');
      assert.equal(body.marketBreadth.reason, 'SOURCE_NOT_PROVISIONED');
    });

    const unavailableApp = createApp({
      getVietnamRegimeFn: async ({ now }) => buildVietnamRegime({
        now,
        inflation: unavailableInflation(),
        moneyMarket: unavailableMoneyMarket()
      })
    });
    await withServer(unavailableApp, async (baseUrl) => {
      const responseValue = await fetch(`${baseUrl}/api/regime/vietnam`);
      const body = await responseValue.json();
      assert.equal(responseValue.status, 503);
      assert.equal(body.code, 'REGIME_SOURCES_UNAVAILABLE');
    });
  });

  test('isolates source failures in the production regime service', async () => {
    const result = await getVietnamRegime({
      now: new Date('2026-08-31T05:00:00Z'),
      getFabricFn: async () => ({
        facts: [
          {
            factId: 'vn.macro.cpi.yoy',
            value: 4.45,
            change: -1.01,
            referenceTime: '2026-07',
            publishedAt: '2026-08-03',
            status: 'available',
            provenance: { source: 'NSO' }
          }
        ],
        pillars: { macro: [], monetary: [], market: [], intermarket: [] },
        pulseMetrics: []
      })
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.moneyMarket.status, 'unavailable');
    assert.equal(result.inflation.status, 'available');

    const errorResult = await getVietnamRegime({
      now: new Date('2026-08-31T05:00:00Z'),
      getFabricFn: async () => { throw new Error('private upstream detail'); }
    });
    assert.equal(errorResult.status, 'unavailable');
    assert.equal(errorResult.moneyMarket.status, 'unavailable');
    assert.equal(JSON.stringify(errorResult).includes('private upstream detail'), false);
  });

  test('frontend view model proves available, insufficient, stale, and unavailable capability states', () => {
    const model = buildVietnamRegimeViewModel({
      partial: true,
      inflation: {
        status: 'insufficient_history',
        headlineCpiYoYPct: 0,
        threeMonthDeltaPp: null,
        referencePeriod: '2026-07'
      },
      moneyMarket: {
        status: 'stale',
        underlyingStatus: 'available',
        vndOvernightRatePct: 0,
        latest4WeekMeanPct: 1,
        previous4WeekMeanPct: 2,
        trendPp: -1
      },
      marketBreadth: { status: 'unavailable', reason: 'SOURCE_NOT_PROVISIONED' }
    });
    assert.equal(model.inflation.usable, true);
    assert.equal(model.inflation.headlineCpiYoYPct, 0);
    assert.equal(model.inflation.threeMonthDeltaPp, null);
    assert.equal(model.moneyMarket.usable, true);
    assert.equal(model.moneyMarket.trendPp, -1);
    assert.equal(model.marketBreadth.reason, 'SOURCE_NOT_PROVISIONED');

    const panel = fs.readFileSync(panelPath, 'utf8');
    assert.match(panel, /Chưa có nguồn dữ liệu đủ tin cậy/);
    assert.match(panel, /Chưa đủ 8 tuần chính thức liên tục/);
    assert.doesNotMatch(panel, /bullish|bearish|confidence|overallScore|regimeLabel/i);
  });
});
