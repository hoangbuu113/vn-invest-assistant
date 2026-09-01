import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NSO_CPI_CHART_URL,
  NSO_CPI_INDEX_URL,
  buildInflationDomain,
  fetchNsoInflation,
  parseNsoCpiChart,
  parseNsoCpiIndex,
  parseNsoCpiRelease
} from '../src/regime/providers/nso.js';

const JULY_URL = 'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/08/chi-so-gia-tieu-dung-thang-bay/';
const APRIL_URL = 'https://www.nso.gov.vn/du-lieu-va-so-lieu-thong-ke/2026/05/chi-so-gia-tieu-dung-thang-tu/';

function archiveEntry({
  url,
  title,
  referencePeriod,
  publishedAt,
  nextReleaseAt = null,
  wrapperClass = 'item'
}) {
  return `
    <p><a data-cosmetic="ignored" href="${url}"></p>
      <section class="${wrapperClass}">
        <h3>${title}</h3>
        <div><span>Ngày đăng: ${publishedAt}</span></div>
        <span>Kỳ tham chiếu: ${referencePeriod}</span>
        ${nextReleaseAt ? `<small>Lần công bố sắp tới: ${nextReleaseAt}</small>` : ''}
      </section>
    <p></a></p>
  `;
}

function chartFixture(points) {
  return `
    <html><script>
      var m_chart = {
        chart_args: ${JSON.stringify({ series: [{ type: 'line', data: points }] })},
        post_id: 24238,
        instance: 1
      };
    </script></html>
  `;
}

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => body
  };
}

function officialIndex({ duplicateJuly = false } = {}) {
  return [
    archiveEntry({
      url: JULY_URL,
      title: 'Chỉ số giá tiêu dùng tháng Bảy và 7 tháng năm 2026',
      referencePeriod: '7/2026',
      publishedAt: '03/08/2026'
    }),
    duplicateJuly
      ? archiveEntry({
        url: `${JULY_URL}ban-khac/`,
        title: 'Chỉ số giá tiêu dùng tháng Bảy - bản khác',
        referencePeriod: '7/2026',
        publishedAt: '03/08/2026'
      })
      : '',
    archiveEntry({
      url: APRIL_URL,
      title: 'Chỉ số giá tiêu dùng tháng Tư và 4 tháng năm 2026',
      referencePeriod: 'Tháng 4/2026',
      publishedAt: '03/05/2026',
      nextReleaseAt: '03/06/2026',
      wrapperClass: 'item cosmetic-layout-change'
    })
  ].join('');
}

describe('Feature 27 CPI reliability', () => {
  test('parses official archive metadata despite cosmetic wrappers and parses the structured YoY series', () => {
    const entries = parseNsoCpiIndex(officialIndex());
    assert.deepEqual(entries, [
      {
        referencePeriod: '2026-07',
        publishedAt: '2026-08-03',
        nextReleaseAt: null,
        releaseUrl: JULY_URL
      },
      {
        referencePeriod: '2026-04',
        publishedAt: '2026-05-03',
        nextReleaseAt: '2026-06-03',
        releaseUrl: APRIL_URL
      }
    ]);

    assert.deepEqual(parseNsoCpiChart(chartFixture([
      ['04/2026', 5.46],
      ['7/2026', 4.45]
    ])), [
      { referencePeriod: '2026-04', headlineCpiYoYPct: 5.46 },
      { referencePeriod: '2026-07', headlineCpiYoYPct: 4.45 }
    ]);
  });

  test('rejects a missing CPI series, malformed numeric strings, and duplicate chart periods', () => {
    assert.equal(parseNsoCpiChart('<script>var x = { chart_args: {"series":[]}, post_id: 1 };</script>'), null);
    assert.equal(parseNsoCpiChart(chartFixture([['7/2026', '4,45']])), null);
    assert.equal(parseNsoCpiChart(chartFixture([
      ['7/2026', 4.45],
      ['07/2026', 4.45]
    ])), null);
  });

  test('accepts official comma and dot decimal notation but rejects malformed release numbers', () => {
    const releaseUrl = JULY_URL;
    const comma = parseNsoCpiRelease(`
      <p>Chỉ số giá tiêu dùng (CPI) tháng Bảy tăng 4,45% so với cùng kỳ năm trước.</p>
      <p>Kỳ tham chiếu: 7/2026</p><p>Ngày đăng: 03/08/2026</p>
    `, releaseUrl);
    const dot = parseNsoCpiRelease(`
      <p>Chỉ số giá tiêu dùng (CPI) tháng Bảy tăng 4.45% so với cùng kỳ năm trước.</p>
      <p>Kỳ tham chiếu: 7/2026</p><p>Ngày đăng: 03/08/2026</p>
    `, releaseUrl);
    const malformed = parseNsoCpiRelease(`
      <p>Chỉ số giá tiêu dùng (CPI) tháng Bảy tăng 4,4,5% so với cùng kỳ năm trước.</p>
      <p>Kỳ tham chiếu: 7/2026</p><p>Ngày đăng: 03/08/2026</p>
    `, releaseUrl);
    assert.equal(comma.headlineCpiYoYPct, 4.45);
    assert.equal(dot.headlineCpiYoYPct, 4.45);
    assert.equal(malformed, null);
  });

  test('returns unavailable for duplicate official archive matches instead of choosing silently', async () => {
    const pages = new Map([
      [NSO_CPI_INDEX_URL, officialIndex({ duplicateJuly: true })],
      [NSO_CPI_CHART_URL, chartFixture([['4/2026', 5.46], ['7/2026', 4.45]])]
    ]);
    const domain = await fetchNsoInflation({
      now: new Date('2026-09-01T00:00:00Z'),
      fetchFn: async (url) => response(pages.get(url) || '', {
        ok: pages.has(url),
        status: pages.has(url) ? 200 : 404
      })
    });
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.reason, 'AMBIGUOUS_OFFICIAL_RELEASE');
    assert.equal(domain.headlineCpiYoYPct, null);
  });

  test('returns unavailable when archive and chart current periods disagree', async () => {
    const pages = new Map([
      [NSO_CPI_INDEX_URL, officialIndex()],
      [NSO_CPI_CHART_URL, chartFixture([['4/2026', 5.46], ['6/2026', 4.69]])]
    ]);
    const domain = await fetchNsoInflation({
      now: new Date('2026-09-01T00:00:00Z'),
      fetchFn: async (url) => response(pages.get(url))
    });
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.reason, 'OFFICIAL_SOURCE_PERIOD_MISMATCH');
  });

  test('marks an overdue official release stale while preserving exact M minus M-3 evidence', () => {
    const latest = {
      referencePeriod: '2026-07',
      publishedAt: '2026-08-03',
      nextReleaseAt: '2026-09-03',
      headlineCpiYoYPct: 4.45,
      releaseUrl: JULY_URL
    };
    const comparison = {
      referencePeriod: '2026-04',
      publishedAt: '2026-05-03',
      headlineCpiYoYPct: 5.46,
      releaseUrl: APRIL_URL
    };
    const domain = buildInflationDomain([comparison, latest], {
      now: new Date('2026-09-07T00:00:00Z')
    });
    assert.equal(domain.status, 'stale');
    assert.equal(domain.underlyingStatus, 'available');
    assert.equal(domain.reason, 'OFFICIAL_RELEASE_OVERDUE');
    assert.equal(domain.headlineCpiYoYPct, 4.45);
    assert.equal(domain.threeMonthDeltaPp, 4.45 - 5.46);
  });

  test('maps official source failure to unavailable without fabricating zero', async () => {
    const domain = await fetchNsoInflation({
      now: new Date('2026-09-01T00:00:00Z'),
      fetchFn: async () => response('', { ok: false, status: 503 })
    });
    assert.equal(domain.status, 'unavailable');
    assert.equal(domain.reason, 'OFFICIAL_DATA_UNAVAILABLE');
    assert.equal(domain.headlineCpiYoYPct, null);
    assert.equal(domain.threeMonthDeltaPp, null);
  });
});
