import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNsoHeadlineCpi,
  parseNsoCoreCpi,
  parseNsoQuarterlyGdp,
  parseNsoMonthlyIip,
  parseNsoMonthlyRetail,
  parseNsoDisbursedFdi,
  parseNsoSocioeconomicRelease,
  normalizeNsoMacroFacts
} from '../src/context/providers/nsoMacro.js';
import {
  parseSbvCentralFx,
  parseSbvDailyInterbankOvernight,
  parseSbvCreditGrowth,
  parseSbvM2Level,
  normalizeSbvMonetaryFacts
} from '../src/context/providers/sbvMonetary.js';
import {
  createMarketObservation,
  buildObservationId,
  PILLARS,
  UNIT_TYPES,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  normalizeReferencePeriodKey,
  compareObservationVintages
} from '../src/context/factModel.js';
import {
  evaluateObservationFreshness,
  CADENCE_POLICIES,
  FACT_POLICY_MAP
} from '../src/context/freshnessPolicy.js';
import {
  isSourceDue,
  recordCheckpoint,
  calculateNextDueAt,
  clearCheckpoints,
  SOURCE_KEYS
} from '../src/context/collectorCheckpoints.js';
import {
  normalizeMacroObservations,
  normalizeMonetaryObservations,
  mergeWithLastKnownGood,
  runMarketContextCollector
} from '../src/context/collector.js';
import {
  persistMarketObservations,
  fetchLatestPersistedObservations,
  fetchObservationByVintageId,
  clearPersistenceStore
} from '../src/context/repository.js';
import { deriveMarketSignals } from '../src/ai/derivedSignals.js';
import { buildMarketStrategistFactPacket } from '../src/ai/marketStrategistEngine.js';

describe('V1.3 Improvement 01A — Official Vietnam Macro & Monetary Core', () => {

  beforeEach(() => {
    clearPersistenceStore();
    clearCheckpoints();
  });

  // 1. CPI monthly YoY parsed correctly
  test('1. CPI monthly YoY parsed correctly from official release', () => {
    const text = 'Chỉ số giá tiêu dùng (CPI) tháng 08/2026 tăng 3.45% so với cùng kỳ năm trước do nhóm giáo dục và lương thực điều chỉnh.';
    const result = parseNsoHeadlineCpi(text);
    assert.notEqual(result, null);
    assert.equal(result.value, 3.45);
    assert.equal(result.referenceTime, '2026-08');
  });

  // 2. Cumulative CPI cannot substitute monthly YoY
  test('2. Cumulative CPI cannot substitute monthly YoY', () => {
    // Only cumulative YTD text available, monthly YoY omitted
    const cumulativeOnlyText = 'Bình quân 8 tháng năm 2026, CPI tăng 4.04% so với cùng kỳ năm trước. Chỉ số giá vàng tăng mạnh.';
    const result = parseNsoHeadlineCpi(cumulativeOnlyText);
    assert.equal(result, null, 'Cumulative CPI must NOT substitute monthly YoY');
  });

  // 3. Core CPI cumulative value cannot masquerade as monthly YoY
  test('3. Core CPI cumulative value cannot masquerade as monthly YoY', () => {
    const cumulativeCoreText = 'Bình quân 8 tháng năm 2026, lạm phát cơ bản tăng 2.71% so với cùng kỳ năm trước.';
    const result = parseNsoCoreCpi(cumulativeCoreText);
    assert.equal(result, null, 'Cumulative/YTD average core inflation must be rejected');

    const monthlyCoreText = 'Lạm phát cơ bản tháng 08/2026 tăng 3.12% so với cùng kỳ năm trước.';
    const validMonthly = parseNsoCoreCpi(monthlyCoreText);
    assert.notEqual(validMonthly, null);
    assert.equal(validMonthly.value, 3.12);
    assert.equal(validMonthly.referenceTime, '2026-08');
  });

  // 4. Quarterly GDP vs cumulative H1/9M kept distinct
  test('4. Quarterly GDP vs cumulative H1/9M kept distinct', () => {
    const cumulativeH1Text = 'Tổng sản phẩm trong nước (GDP) 6 tháng đầu năm 2026 tăng 6.42% so với cùng kỳ.';
    const h1Result = parseNsoQuarterlyGdp(cumulativeH1Text);
    assert.equal(h1Result, null, 'Cumulative H1 GDP must NOT substitute individual quarterly GDP');

    const quarterlyText = 'Tổng sản phẩm trong nước (GDP) quý II/2026 ước tính tăng 6.93% so với cùng kỳ năm trước.';
    const qResult = parseNsoQuarterlyGdp(quarterlyText);
    assert.notEqual(qResult, null);
    assert.equal(qResult.value, 6.93);
    assert.equal(qResult.referenceTime, '2026-Q2');
  });

  // 5. IIP monthly vs YTD kept distinct
  test('5. IIP monthly vs YTD kept distinct', () => {
    const ytdIipText = 'Tính chung 8 tháng năm 2026, chỉ số sản xuất toàn ngành công nghiệp (IIP) ước tính tăng 8.5% so với cùng kỳ.';
    const ytdResult = parseNsoMonthlyIip(ytdIipText);
    assert.equal(ytdResult, null, 'YTD cumulative IIP must NOT substitute monthly IIP');

    const monthlyIipText = 'Chỉ số sản xuất toàn ngành công nghiệp (IIP) tháng 08/2026 ước tính tăng 9.5% so với cùng kỳ năm trước.';
    const monthResult = parseNsoMonthlyIip(monthlyIipText);
    assert.notEqual(monthResult, null);
    assert.equal(monthResult.value, 9.5);
    assert.equal(monthResult.referenceTime, '2026-08');
  });

  // 6. Nominal retail vs real/price-adjusted metric kept distinct
  test('6. Nominal retail vs real/price-adjusted metric kept distinct', () => {
    // If the text only has price-adjusted growth, reject
    const priceAdjustedOnlyText = 'Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng 08/2026 loại trừ yếu tố giá tăng 5.8% so với cùng kỳ.';
    const realResult = parseNsoMonthlyRetail(priceAdjustedOnlyText);
    assert.equal(realResult, null, 'Price-adjusted/real retail must NOT substitute nominal retail');

    const nominalRetailText = 'Tổng mức bán lẻ hàng hóa và doanh thu dịch vụ tiêu dùng tháng 08/2026 ước tính tăng 8.8% so với cùng kỳ năm trước.';
    const nominalResult = parseNsoMonthlyRetail(nominalRetailText);
    assert.notEqual(nominalResult, null);
    assert.equal(nominalResult.value, 8.8);
    assert.equal(nominalResult.referenceTime, '2026-08');
  });

  // 7. FDI disbursed vs registered capital kept distinct
  test('7. FDI disbursed vs registered capital kept distinct', () => {
    const registeredOnlyText = 'Tổng vốn đăng ký cấp mới, vốn đăng ký điều chỉnh và giá trị góp vốn mua cổ phần của nhà đầu tư nước ngoài đạt 20.5 tỷ USD.';
    const regResult = parseNsoDisbursedFdi(registeredOnlyText);
    assert.equal(regResult, null, 'Registered FDI capital must NOT substitute disbursed FDI');

    const disbursedText = 'Vốn đầu tư trực tiếp nước ngoài thực hiện tại Việt Nam 8 tháng năm 2026 ước đạt 14.15 tỷ USD, tăng 8.0% so với cùng kỳ năm trước.';
    const disResult = parseNsoDisbursedFdi(disbursedText, '2026-08');
    assert.notEqual(disResult, null);
    assert.equal(disResult.value, 14.15);
    assert.equal(disResult.unit, 'tỷ USD');
    assert.equal(disResult.unitType, UNIT_TYPES.CURRENCY_AMOUNT);
  });

  // 8. SBV central FX distinct from buy/sell/commercial FX
  test('8. SBV central FX distinct from buy/sell/commercial FX', () => {
    const rawSbvText = `
      Ngân hàng Nhà nước Việt Nam thông báo:
      Tỷ giá trung tâm của Đồng Việt Nam với Đô la Mỹ áp dụng cho ngày 05/09/2026 là: 24.250 VND/USD.
      Tỷ giá mua giao ngay tại Sở Giao dịch: 23.400 VND/USD.
      Tỷ giá bán can thiệp: 25.412 VND/USD.
      Tỷ giá thương mại tham khảo tại Vietcombank: 24.800 VND/USD.
    `;
    const result = parseSbvCentralFx(rawSbvText, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/ttnn/tgtw');
    assert.equal(result.status, 'available');
    assert.equal(result.value, 24250, 'Must extract central rate 24250, not buy (23400) or sell (25412)');
    assert.equal(result.unit, 'VND/USD');
  });

  // 9. Effective date preserved
  test('9. Effective date preserved and separated from publication/fetch timestamp', () => {
    const rawSbvText = 'Tỷ giá trung tâm của Đồng Việt Nam với Đô la Mỹ áp dụng cho ngày 05/09/2026 là 24.250 VND/USD.';
    const result = parseSbvCentralFx(rawSbvText, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/ttnn/tgtw');
    assert.equal(result.effectiveDate, '2026-09-05');

    const obs = normalizeSbvMonetaryFacts({ centralFx: result, now: new Date('2026-09-05T12:00:00.000Z') })
      .find((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');

    assert.equal(obs.referenceTime, '2026-09-05', 'Effective date must be preserved in referenceTime');
    assert.equal(obs.unitType, UNIT_TYPES.CURRENCY_RATIO);
    assert.equal(obs.quoteDirection, 'VND_PER_USD');
    assert.equal(obs.publishedAt, null, 'Fetch time must never substitute for publishedAt');
  });

  // 10. Daily overnight fact distinct from weekly overnight fact
  test('10. Daily overnight fact distinct from weekly overnight fact', () => {
    const dailyRaw = 'Lãi suất bình quân liên ngân hàng ngày 04/09/2026. Kỳ hạn Qua đêm là 4.35%.';
    const dailyParsed = parseSbvDailyInterbankOvernight(dailyRaw, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/ttnn/lslnh');
    assert.equal(dailyParsed.value, 4.35);
    assert.equal(dailyParsed.sessionDate, '2026-09-04');

    const weeklyMock = {
      status: 'available',
      vndOvernightRatePct: 4.10,
      trendPp: 0.15,
      referenceWeekStart: '2026-08-24'
    };

    const observations = normalizeMonetaryObservations(weeklyMock, null, new Date(), { dailyOvernight: dailyParsed });
    const weeklyObs = observations.find((o) => o.factId === 'vn.monetary.rate.vnd_overnight');
    const dailyObs = observations.find((o) => o.factId === 'vn.monetary.interbank.vnd.overnight.daily_avg_rate');

    assert.notEqual(weeklyObs, undefined);
    assert.notEqual(dailyObs, undefined);
    assert.notEqual(weeklyObs.factId, dailyObs.factId, 'Daily and weekly facts must have distinct fact IDs');
    assert.equal(weeklyObs.value, 4.10);
    assert.equal(dailyObs.value, 4.35);
    assert.equal(dailyObs.referenceTime, '2026-09-04');
  });

  // 11. Credit selects explicitly labelled reference period
  test('11. Credit selects explicitly labelled reference period (rejects arbitrary first row)', () => {
    const multiPeriodText = `
      Báo cáo hoạt động ngân hàng:
      - Tăng trưởng tín dụng toàn hệ thống đến tháng 06/2026 đạt 4.45% so với cuối năm trước.
      - Tăng trưởng tín dụng toàn hệ thống đến tháng 07/2026 đạt 5.66% so với cuối năm trước.
    `;
    // Querying for target period '2026-07'
    const targetedResult = parseSbvCreditGrowth(multiPeriodText, '2026-07', 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente');
    assert.equal(targetedResult.value, 5.66);
    assert.equal(targetedResult.referencePeriod, '2026-07');

    // Auto-selecting latest dated candidate
    const latestResult = parseSbvCreditGrowth(multiPeriodText, null, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente');
    assert.equal(latestResult.value, 5.66);
    assert.equal(latestResult.referencePeriod, '2026-07');
  });

  // 12. M2 unit scale preserved
  test('12. M2 unit scale preserved as billion VND (currency_amount)', () => {
    const m2Text = 'Tổng phương tiện thanh toán (M2) đến tháng 07/2026 đạt 16.845.210 tỷ đồng.';
    const result = parseSbvM2Level(m2Text, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente');
    assert.equal(result.status, 'available');
    assert.equal(result.value, 16845210);
    assert.equal(result.unit, 'tỷ VND');

    const obs = normalizeSbvMonetaryFacts({ m2Level: result, now: new Date() })
      .find((o) => o.factId === 'vn.monetary.money_supply.m2.level');
    assert.equal(obs.value, 16845210);
    assert.equal(obs.unit, 'tỷ VND');
    assert.equal(obs.unitType, UNIT_TYPES.CURRENCY_AMOUNT);
  });

  // 13. Pre/post October 2025 M2 methodology distinction
  test('13. Pre/post October 2025 M2 methodology distinction maintained', () => {
    const preOctText = 'Tổng phương tiện thanh toán (M2) đến tháng 08/2025 đạt 15.500.000 tỷ đồng.';
    const preResult = parseSbvM2Level(preOctText, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente');
    assert.equal(preResult.methodologyVersion, 'sbv_m2_pre_202510');

    const postOctText = 'Tổng phương tiện thanh toán (M2) đến tháng 11/2025 đạt 16.100.000 tỷ đồng.';
    const postResult = parseSbvM2Level(postOctText, 'https://www.sbv.gov.vn/webcenter/portal/vi/menu/trangchu/tk/tiente');
    assert.equal(postResult.methodologyVersion, 'sbv_m2_post_202510');
  });

  // 14. Missing/ambiguous cell produces unavailable, not zero
  test('14. Missing/ambiguous cell produces unavailable, not zero', () => {
    const corruptedText = 'Chỉ số CPI tháng 08/2026 đạt mức [không xác định] so với cùng kỳ.';
    const cpiResult = parseNsoHeadlineCpi(corruptedText);
    assert.equal(cpiResult, null);

    const observations = normalizeNsoMacroFacts({ parsed: {} });
    for (const obs of observations) {
      assert.equal(obs.value, null, 'Missing numerical value must be null, NEVER 0');
      assert.notEqual(obs.value, 0, 'Zero must not be fabricated for missing data');
      assert.equal(obs.status, OBSERVATION_STATUS.UNAVAILABLE);
    }
  });

  // 15. Source layout mismatch quarantines parser output
  test('15. Source layout mismatch quarantines parser output safely', () => {
    const brokenHtml = '<html><body><div>Trang web đang bảo trì hệ thống</div></body></html>';
    const parsed = parseNsoSocioeconomicRelease(brokenHtml, 'https://www.nso.gov.vn/tinh-hinh-kinh-te-xa-hoi/bao-tri');
    assert.equal(parsed.status, 'quarantined');

    const fxQuarantine = parseSbvCentralFx('Lỗi cơ sở dữ liệu NHNN', 'https://www.sbv.gov.vn/tgtw');
    assert.equal(fxQuarantine.status, 'quarantined');
  });

  // 16. Correction creates new observation vintage
  test('16. Correction creates new observation vintage', async () => {
    const preliminaryObs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'Lạm phát CPI',
      value: 3.45,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: '2026-08',
      publishedAt: '2026-09-01T02:00:00.000Z',
      revisionMarker: 'PRELIMINARY'
    });

    const revisedObs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'Lạm phát CPI',
      value: 3.52, // Corrected value
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      referenceTime: '2026-08',
      publishedAt: '2026-09-03T02:00:00.000Z',
      revisionMarker: 'FINAL'
    });

    assert.notEqual(preliminaryObs.observationId, revisedObs.observationId, 'Corrected observation must generate NEW vintage ID');

    await persistMarketObservations([preliminaryObs], null);
    await persistMarketObservations([revisedObs], null);

    const oldVintage = await fetchObservationByVintageId(preliminaryObs.observationId, null);
    assert.notEqual(oldVintage, null, 'Old vintage must remain queryable');
    assert.equal(oldVintage.value, 3.45);

    const latest = (await fetchLatestPersistedObservations(null)).find((o) => o.factId === 'vn.macro.cpi.yoy');
    assert.equal(latest.value, 3.52, 'Latest query must select the revised observation');
  });

  // 17. Identical release remains idempotent
  test('17. Identical release remains idempotent', async () => {
    const obs = createMarketObservation({
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm',
      value: 24250,
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      referenceTime: '2026-09-05'
    });

    const res1 = await persistMarketObservations([obs], null);
    const res2 = await persistMarketObservations([obs], null);

    assert.equal(res1.persisted.length, 1);
    assert.equal(res2.persisted.length, 1);

    const all = await fetchLatestPersistedObservations(null);
    const centralFacts = all.filter((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');
    assert.equal(centralFacts.length, 1, 'Idempotent persistence must not produce duplicate records');
  });

  // 18. Monthly/quarterly facts use correct freshness policy
  test('18. Monthly/quarterly facts use correct freshness policy', () => {
    assert.equal(FACT_POLICY_MAP['vn.macro.cpi.yoy'], CADENCE_POLICIES.NSO_MONTHLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.macro.core_cpi.yoy'], CADENCE_POLICIES.NSO_MONTHLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.macro.gdp.real.quarter_yoy'], CADENCE_POLICIES.NSO_QUARTERLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.macro.iip.month_yoy'], CADENCE_POLICIES.NSO_MONTHLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.macro.retail.nominal.month_yoy'], CADENCE_POLICIES.NSO_MONTHLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.macro.fdi.disbursed.ytd_usd'], CADENCE_POLICIES.NSO_MONTHLY_RELEASE);
    assert.equal(FACT_POLICY_MAP['vn.monetary.fx.sbv_central.usd_vnd'], CADENCE_POLICIES.SBV_EFFECTIVE_FX);
    assert.equal(FACT_POLICY_MAP['vn.monetary.interbank.vnd.overnight.daily_avg_rate'], CADENCE_POLICIES.SBV_INTERBANK_LAGGED);
    assert.equal(FACT_POLICY_MAP['vn.monetary.credit.outstanding.ytd_growth'], CADENCE_POLICIES.SBV_MONTHLY_LAGGED);
    assert.equal(FACT_POLICY_MAP['vn.monetary.money_supply.m2.level'], CADENCE_POLICIES.SBV_MONTHLY_LAGGED);

    // Test runtime freshness: 30 days old monthly CPI is FRESH (cadence is 45 days)
    const monthlyObs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'CPI',
      value: 3.5,
      unit: '%',
      referenceTime: '2026-08' // Reference month ends 2026-08-31
    });
    const freshEval = evaluateObservationFreshness(monthlyObs, new Date('2026-09-15T00:00:00.000Z'));
    assert.equal(freshEval.freshness, OBSERVATION_FRESHNESS.FRESH);

    // 60 days after month end is STALE (> 45 days)
    const staleEval = evaluateObservationFreshness(monthlyObs, new Date('2026-11-01T00:00:00.000Z'));
    assert.equal(staleEval.freshness, OBSERVATION_FRESHNESS.STALE);
  });

  // 19. Scheduler skips source before nextDueAt
  test('19. Scheduler skips source before nextDueAt', async () => {
    const now = new Date('2026-09-05T10:00:00.000Z');
    const futureDue = new Date('2026-09-06T10:00:00.000Z').toISOString();

    // Record checkpoint with future nextDueAt
    await recordCheckpoint(SOURCE_KEYS.NSO_MONTHLY, {
      status: 'success',
      nextDueAt: futureDue,
      client: null,
      now
    });

    const isDue = await isSourceDue(SOURCE_KEYS.NSO_MONTHLY, { now, client: null });
    assert.equal(isDue, false, 'Source must NOT be due before nextDueAt');
  });

  // 20. Scheduler runs source once it becomes due
  test('20. Scheduler runs source once it becomes due', async () => {
    const pastDue = new Date('2026-09-05T08:00:00.000Z').toISOString();
    const now = new Date('2026-09-05T10:00:00.000Z');

    await recordCheckpoint(SOURCE_KEYS.NSO_MONTHLY, {
      status: 'success',
      nextDueAt: pastDue,
      client: null,
      now: new Date('2026-09-05T07:00:00.000Z')
    });

    const isDue = await isSourceDue(SOURCE_KEYS.NSO_MONTHLY, { now, client: null });
    assert.equal(isDue, true, 'Source must be due once nextDueAt has passed');
  });

  // 21. One source failure does not block other official sources
  test('21. One source failure does not block other official sources (LKG isolation)', async () => {
    // 1. Initial successful run: persist CPI and SBV FX
    const initialCpi = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'CPI',
      value: 3.45,
      unit: '%',
      referenceTime: '2026-08'
    });
    const initialFx = createMarketObservation({
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm',
      value: 24250,
      unit: 'VND/USD',
      referenceTime: '2026-09-04'
    });
    await persistMarketObservations([initialCpi, initialFx], null);

    // 2. Subsequent collector run: macro provider fails completely, monetary succeeds with new FX
    const newFx = createMarketObservation({
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm',
      value: 24265,
      unit: 'VND/USD',
      referenceTime: '2026-09-05'
    });

    const summary = await runMarketContextCollector({
      now: new Date('2026-09-05T10:00:00.000Z'),
      client: null,
      fetchNsoInflationFn: async () => { throw new Error('NSO_DOWN'); },
      fetchSbvOfficialFn: async () => [newFx],
      forceRefresh: true
    });

    assert.equal(summary.validated >= 1, true);

    const allPersisted = await fetchLatestPersistedObservations(null);
    const cpiAfter = allPersisted.find((o) => o.factId === 'vn.macro.cpi.yoy');
    const fxAfter = allPersisted.find((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');

    assert.notEqual(cpiAfter, undefined, 'LKG must preserve CPI despite NSO failure');
    assert.equal(cpiAfter.value, 3.45);
    assert.notEqual(fxAfter, undefined);
    assert.equal(fxAfter.value, 24265, 'SBV FX updated successfully despite NSO failure');
  });

  // 22. No full official document/raw HTML sent to Gemini
  test('22. No full official document/raw HTML sent to Gemini', () => {
    const rawHtmlSnippet = '<div class="nso-report"><h1>Tình hình kinh tế</h1><p>Văn bản chính thức rất dài...</p></div>';
    const obs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'CPI',
      value: 3.45,
      unit: '%',
      referenceTime: '2026-08',
      provenance: { rawHtmlSnippet }
    });

    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: [obs],
      newsArticles: [],
      portfolio: null,
      now: new Date()
    });

    const serialized = JSON.stringify(factPacket.evidence);
    assert.equal(serialized.includes('<div class='), false, 'Raw HTML must NOT be forwarded to strategist evidence');
    assert.equal(serialized.includes('Văn bản chính thức rất dài'), false);
  });

  // 23. No private profile/portfolio data enters official evidence pipeline
  test('23. No private profile/portfolio data enters official evidence pipeline', () => {
    const privatePortfolio = {
      userId: 'user-secret-1234',
      totalEquityVnd: 500000000,
      holdings: [{ symbol: 'FPT', shares: 1000 }]
    };

    const obs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'CPI',
      value: 3.45,
      unit: '%',
      referenceTime: '2026-08'
    });

    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: [obs],
      newsArticles: [],
      portfolio: privatePortfolio,
      now: new Date()
    });

    const serializedEvidence = JSON.stringify(factPacket);
    assert.equal(serializedEvidence.includes('user-secret-1234'), false, 'Private userId must NOT enter evidence');
    assert.equal(serializedEvidence.includes('500000000'), false, 'Private portfolio equity must NOT enter evidence');
  });

});