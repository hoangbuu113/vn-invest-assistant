import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNsoHeadlineCpi,
  parseNsoCoreCpi,
  parseNsoQuarterlyGdp,
  parseNsoMonthlyIip,
  parseNsoMonthlyRetail,
  parseNsoDisbursedFdi,
  parseNsoSocioeconomicRelease,
  normalizeNsoMacroFacts,
  referencePeriodToEndDate
} from '../src/context/providers/nsoMacro.js';
import {
  parseSbvCentralFx,
  parseSbvDailyInterbankOvernight,
  parseSbvCreditGrowth,
  parseSbvM2Level,
  normalizeSbvMonetaryFacts,
  isSbvWafBlocked,
  SBV_CANONICAL_URLS,
  SBV_LEGACY_FALLBACK_URLS,
  SBV_GUESSED_GENERIC_URLS,
  isCanonicalSbvUrl,
  isSbvGuessedGenericUrl
} from '../src/context/providers/sbvMonetary.js';
import {
  createMarketObservation,
  createUnavailableObservation,
  buildObservationId,
  PILLARS,
  UNIT_TYPES,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  FACT_LIFECYCLE_STATUS,
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
  SOURCE_KEYS,
  CHECKPOINT_STATUS,
  VALID_CHECKPOINT_STATUSES
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

  // 24. NSO scheduler does not assume day 25–31
  test('24. NSO scheduler does not assume day 25–31', () => {
    const day05 = new Date('2026-09-05T09:00:00.000Z');
    const day15 = new Date('2026-09-15T09:00:00.000Z');
    const day28 = new Date('2026-09-28T09:00:00.000Z');

    const due05 = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, day05);
    const due15 = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, day15);
    const due28 = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, day28);

    const diffHours05 = (Date.parse(due05) - day05.getTime()) / (3600 * 1000);
    const diffHours15 = (Date.parse(due15) - day15.getTime()) / (3600 * 1000);
    const diffHours28 = (Date.parse(due28) - day28.getTime()) / (3600 * 1000);

    assert.equal(diffHours05, 24, 'Day 5 uses 24h cadence');
    assert.equal(diffHours15, 24, 'Day 15 uses 24h cadence');
    assert.equal(diffHours28, 24, 'Day 28 uses 24h cadence (does not assume arbitrary 6h day 25-31 window)');
  });

  // 25. Release metadata updates nextDueAt
  test('25. Release metadata updates nextDueAt', async () => {
    const now = new Date('2026-09-03T09:00:00.000Z');
    const announcedNext = '2026-10-03T00:00:00.000Z';

    const calculated = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, now, { nextReleaseAt: announcedNext });
    assert.equal(calculated, announcedNext, 'calculateNextDueAt must honor authoritative nextReleaseAt');

    const { checkpoint } = await recordCheckpoint(SOURCE_KEYS.NSO_MONTHLY, {
      status: CHECKPOINT_STATUS.SUCCESS,
      metadata: { nextReleaseAt: announcedNext },
      client: null,
      now
    });
    assert.equal(checkpoint.next_due_at, announcedNext, 'Durable checkpoint must store nextReleaseAt in next_due_at');

    const isDue = await isSourceDue(SOURCE_KEYS.NSO_MONTHLY, {
      now: new Date('2026-09-20T00:00:00.000Z'),
      client: null
    });
    assert.equal(isDue, false, 'Source must not be due before nextReleaseAt date');
  });

  // 26. Inaccessible SBV source enters safe blocked/backoff state
  test('26. Inaccessible SBV source enters safe blocked/backoff state', async () => {
    const wafHtml = '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Your support ID is: 12345</body></html>';
    assert.equal(isSbvWafBlocked(wafHtml), true);

    const parsed = parseSbvCentralFx(wafHtml, 'https://sbv.gov.vn/vi/ty-gia-trung-tam');
    assert.equal(parsed.status, 'blocked');
    assert.equal(parsed.reason, 'PROVIDER_ACCESS_DENIED');

    const now = new Date('2026-09-05T10:00:00.000Z');
    await runMarketContextCollector({
      now,
      client: null,
      fetchSbvMoneyMarketFn: async () => ({
        status: 'unavailable',
        reason: 'PROVIDER_ACCESS_DENIED'
      }),
      forceRefresh: true
    });

    const isDueImmediately = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now, client: null });
    assert.equal(isDueImmediately, false, 'Blocked source must back off and not be due immediately');
  });

  // 27. Blocked source is not repeatedly polled every cron tick
  test('27. Blocked source is not repeatedly polled every cron tick', async () => {
    const t0 = new Date('2026-09-05T10:00:00.000Z');

    // Record blocked checkpoint
    await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, {
      status: CHECKPOINT_STATUS.BLOCKED_ACCESS_DENIED,
      metadata: { error: 'PROVIDER_ACCESS_DENIED' },
      client: null,
      now: t0
    });

    // Tick 1: 15 minutes later (typical Cloudflare cron tick)
    const tick15m = new Date('2026-09-05T10:15:00.000Z');
    const isDue15m = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tick15m, client: null });
    assert.equal(isDue15m, false, 'Blocked source must NOT wake at 15m cron tick');

    // Tick 2: 1 hour later
    const tick60m = new Date('2026-09-05T11:00:00.000Z');
    const isDue60m = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tick60m, client: null });
    assert.equal(isDue60m, false, 'Blocked source must NOT wake at 1h mark');

    // Tick 3: 12 hours later
    const tick12h = new Date('2026-09-05T22:00:00.000Z');
    const isDue12h = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tick12h, client: null });
    assert.equal(isDue12h, false, 'Blocked source must NOT wake at 12h mark');

    // Tick 4: 25 hours later (after backoff expires)
    const tick25h = new Date('2026-09-06T11:05:00.000Z');
    const isDue25h = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tick25h, client: null });
    assert.equal(isDue25h, true, 'Blocked source may only retry after 24h backoff window expires');
  });

  // 28. Parser-only fact cannot masquerade as live evidence
  test('28. Parser-only fact cannot masquerade as live evidence', () => {
    // August 2026 official report text only contained 8-month cumulative core CPI average
    const augustReleaseText = `
      Chỉ số giá tiêu dùng (CPI) tháng Tám tăng 0,47% so với tháng trước; tăng 3,57% so với tháng 12/2025 và tăng 4,89% so với cùng kỳ năm trước.
      Bình quân tám tháng năm 2026, CPI tăng 4,45% so với cùng kỳ năm trước; lạm phát cơ bản tăng 4,24%.
    `;

    const parsedCore = parseNsoCoreCpi(augustReleaseText);
    assert.equal(parsedCore, null, 'Cumulative 8M core inflation must not be extracted as monthly core CPI');

    const observations = normalizeNsoMacroFacts({ parsed: { coreCpi: parsedCore } });
    const coreObs = observations.find((o) => o.factId === 'vn.macro.core_cpi.yoy');

    assert.equal(coreObs.status, OBSERVATION_STATUS.UNAVAILABLE);
    assert.equal(coreObs.value, null);
    assert.equal(coreObs.statusReason, 'MONTHLY_CORE_CPI_UNAVAILABLE');

    // Must not be usable as active evidence in strategist fact packet
    const factPacket = buildMarketStrategistFactPacket({
      marketObservations: [coreObs],
      newsArticles: [],
      portfolio: null,
      now: new Date()
    });
    const serialized = JSON.stringify(factPacket.evidence);
    assert.equal(serialized.includes('4.24'), false, 'Cumulative core CPI must NOT appear in evidence packet');
    assert.equal(FACT_LIFECYCLE_STATUS.IMPLEMENTED_PARSER, 'IMPLEMENTED_PARSER');
  });

  // 29. Unavailable SBV facts do not create unsupported monetary stance
  test('29. Unavailable SBV facts do not create unsupported monetary stance', () => {
    const unavailableSbvFacts = [
      createUnavailableObservation('monetary.sbv_central_usd_vnd', PILLARS.MONETARY, 'Tỷ giá trung tâm SBV', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.fx.sbv_central.usd_vnd',
        value: null
      }),
      createUnavailableObservation('monetary.vnd_overnight_daily_avg_rate', PILLARS.MONETARY, 'Lãi suất VND qua đêm', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
        value: null
      }),
      createUnavailableObservation('monetary.credit_ytd_growth', PILLARS.MONETARY, 'Tăng trưởng tín dụng', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.credit.outstanding.ytd_growth',
        value: null
      }),
      createUnavailableObservation('monetary.m2_level', PILLARS.MONETARY, 'Cung tiền M2', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.money_supply.m2.level',
        value: null
      })
    ];

    const signals = deriveMarketSignals({
      marketObservations: unavailableSbvFacts,
      newsArticles: [],
      now: new Date('2026-09-05T10:00:00.000Z')
    });

    const stanceSignal = signals.find((s) => s.signalType === 'MONETARY_STANCE');
    assert.equal(stanceSignal, undefined, 'Monetary stance MUST abstain when SBV facts are unavailable');

    // When an observation exists but is stale, stance must remain strictly neutral (non-directional)
    const staleOvernightObs = createMarketObservation({
      factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
      pillar: PILLARS.MONETARY,
      label: 'Lãi suất qua đêm',
      value: 6.5, // tightening value if fresh
      referenceTime: '2026-07-01',
      status: 'stale',
      freshness: 'stale'
    });

    const staleSignals = deriveMarketSignals({
      marketObservations: [staleOvernightObs],
      newsArticles: [],
      now: new Date('2026-09-05T10:00:00.000Z')
    });

    const staleStance = staleSignals.find((s) => s.signalType === 'MONETARY_STANCE');
    assert.notEqual(staleStance, undefined);
    assert.equal(staleStance.state, 'neutral', 'Stale monetary fact must produce non-directional neutral stance, not tightening');
  });

  // 30. Live NSO facts retain exact official source URL
  test('30. Live NSO facts retain exact official source URL', () => {
    const officialUrl = 'https://www.nso.gov.vn/tin-tuc-thong-ke/2026/09/chi-so-gia-tieu-dung-cpi-chi-so-gia-vang-va-chi-so-gia-do-la-my-thang-tam-va-8-thang-nam-2026/';
    const sampleHtml = `
      <html>
        <head><title>Chỉ số giá tiêu dùng (CPI) tháng Tám và 8 tháng năm 2026</title></head>
        <body>
          <p>Chỉ số giá tiêu dùng (CPI) tháng Tám tăng 0,47% so với tháng trước; tăng 3,57% so với tháng 12/2025 và tăng 4,89% so với cùng kỳ năm trước. Bình quân tám tháng năm 2026, CPI tăng 4,45% so với cùng kỳ năm trước; lạm phát cơ bản tăng 4,24%.</p>
        </body>
      </html>
    `;

    const parsedRelease = parseNsoSocioeconomicRelease(sampleHtml, officialUrl);
    assert.equal(parsedRelease.status, 'available');
    assert.equal(parsedRelease.releaseUrl, officialUrl);
    assert.equal(parsedRelease.referenceMonth, '2026-08');
    assert.notEqual(parsedRelease.parsed.headlineCpi, null);
    assert.equal(parsedRelease.parsed.headlineCpi.value, 4.89);

    const observations = normalizeNsoMacroFacts(parsedRelease);
    const cpiObs = observations.find((o) => o.factId === 'vn.macro.cpi.yoy');

    assert.notEqual(cpiObs, undefined);
    assert.equal(cpiObs.value, 4.89);
    assert.equal(cpiObs.referenceTime, '2026-08');
    assert.equal(cpiObs.provenance.releaseUrl, officialUrl, 'Provenance must retain the exact live official release URL');
  });

  // 31. Source access failure preserves LKG without changing evidence timestamp
  test('31. Source access failure preserves LKG without changing evidence timestamp', async () => {
    const historicalObs = createMarketObservation({
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm',
      value: 24250,
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      referenceTime: '2026-09-04',
      publishedAt: '2026-09-04T02:00:00.000Z',
      observedAt: '2026-09-04T02:00:00.000Z',
      fetchedAt: '2026-09-04T03:00:00.000Z'
    });
    await persistMarketObservations([historicalObs], null);

    const failureTime = new Date('2026-09-05T12:00:00.000Z');
    await runMarketContextCollector({
      now: failureTime,
      client: null,
      fetchSbvMoneyMarketFn: async () => {
        const err = new Error('OFFICIAL_SOURCE_UNAVAILABLE');
        err.code = 'PROVIDER_ACCESS_DENIED';
        throw err;
      },
      forceRefresh: true
    });

    const persisted = await fetchLatestPersistedObservations(null);
    const lkgFx = persisted.find((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');

    assert.notEqual(lkgFx, undefined, 'LKG must be preserved');
    assert.equal(lkgFx.value, 24250);
    assert.equal(lkgFx.referenceTime, '2026-09-04', 'Reference time must remain unchanged');
    assert.equal(lkgFx.publishedAt, '2026-09-04T02:00:00.000Z', 'Published timestamp must remain unchanged');
    assert.equal(lkgFx.observedAt, '2026-09-04T02:00:00.000Z', 'Observed timestamp must remain unchanged');
    assert.notEqual(lkgFx.publishedAt, failureTime.toISOString(), 'Failure time must NEVER overwrite historical evidence timestamp');
  });

  // 32. Runtime checkpoint status enum matches DB schema constraint
  test('32. Runtime checkpoint status enum matches DB schema constraint', () => {
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../supabase/migrations/20260905010000_create_collector_checkpoints.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const checkMatch = /status\s+IN\s*\(([^)]+)\)/i.exec(sql);
    assert.notEqual(checkMatch, null, 'Migration must define status IN check constraint');
    const dbStatuses = checkMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));

    const runtimeStatuses = [...VALID_CHECKPOINT_STATUSES].sort();
    const sortedDbStatuses = [...dbStatuses].sort();

    assert.deepEqual(
      runtimeStatuses,
      sortedDbStatuses,
      'Runtime CHECKPOINT_STATUS enum values must strictly match the database CHECK constraint'
    );
    assert.equal(runtimeStatuses.includes('blocked/access_denied'), true);
  });

  // 33. blocked/access_denied checkpoint persists in DB-like store
  test('33. blocked/access_denied checkpoint persists in DB-like store', async () => {
    const dbTable = new Map();
    const mockDbClient = {
      from(table) {
        assert.equal(table, 'market_context_collector_checkpoints');
        return {
          upsert(checkpoint) {
            if (!VALID_CHECKPOINT_STATUSES.includes(checkpoint.status)) {
              return {
                select: async () => ({
                  data: null,
                  error: { code: '23514', message: `new row violates check constraint for column "status"` }
                })
              };
            }
            dbTable.set(checkpoint.source_key, { ...checkpoint });
            return {
              select: async () => ({
                data: [{ ...checkpoint }],
                error: null
              })
            };
          },
          select() {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    const row = dbTable.get(val);
                    return { data: row || null, error: null };
                  }
                };
              }
            };
          }
        };
      }
    };

    const now = new Date('2026-09-05T10:00:00.000Z');
    const res = await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, {
      status: CHECKPOINT_STATUS.BLOCKED_ACCESS_DENIED,
      client: mockDbClient,
      now,
      metadata: { reason: 'Government WAF challenge' }
    });

    assert.equal(res.isDurable, true);
    assert.equal(dbTable.has(SOURCE_KEYS.SBV_FX_CENTRAL), true);
    const persisted = dbTable.get(SOURCE_KEYS.SBV_FX_CENTRAL);
    assert.equal(persisted.status, 'blocked/access_denied');
    assert.equal(persisted.metadata?.reason, 'Government WAF challenge');

    // Negative test: invalid status violates DB check constraint
    const invalidRes = await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, {
      status: 'unsupported_custom_status',
      client: mockDbClient,
      now
    });
    assert.equal(invalidRes.isDurable, false, 'Invalid status must fail DB check constraint');
    assert.notEqual(invalidRes.error, null);
  });

  // 34. Blocked checkpoint survives reload and gates collector runs
  test('34. Blocked checkpoint survives reload and gates collector runs', async () => {
    const dbTable = new Map();
    const mockDbClient = {
      from(table) {
        return {
          upsert(checkpoint) {
            dbTable.set(checkpoint.source_key, { ...checkpoint });
            return {
              select: async () => ({ data: [{ ...checkpoint }], error: null })
            };
          },
          select() {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => ({ data: dbTable.get(val) || null, error: null })
                };
              }
            };
          }
        };
      }
    };

    const t0 = new Date('2026-09-05T08:00:00.000Z');
    await recordCheckpoint(SOURCE_KEYS.SBV_FX_CENTRAL, {
      status: CHECKPOINT_STATUS.BLOCKED_ACCESS_DENIED,
      client: mockDbClient,
      now: t0
    });

    // Simulate process cold restart: wipe in-memory checkpoint store
    clearCheckpoints();

    // 15-minute cron check reading from DB client: should NOT be due
    const tCron = new Date('2026-09-05T08:15:00.000Z');
    const isDueAt15m = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tCron, client: mockDbClient });
    assert.equal(isDueAt15m, false, 'Blocked checkpoint loaded from DB must gate collection');

    // 25 hours later: should become due after the 24h backoff
    const tNextDay = new Date('2026-09-06T09:00:00.000Z');
    const isDueNextDay = await isSourceDue(SOURCE_KEYS.SBV_FX_CENTRAL, { now: tNextDay, client: mockDbClient });
    assert.equal(isDueNextDay, true, 'Source must become due after backoff interval expires');
  });

  // 35. Exact Astra SBV URLs are treated as canonical provenance
  test('35. Exact Astra SBV URLs are treated as canonical provenance', () => {
    assert.equal(SBV_CANONICAL_URLS.CENTRAL_FX, 'https://sbv.gov.vn/vi/tỷ-giá');
    assert.equal(SBV_CANONICAL_URLS.INTERBANK_DAILY, 'https://sbv.gov.vn/vi/lãi-suất1');
    assert.equal(SBV_CANONICAL_URLS.CREDIT_GROWTH, 'https://sbv.gov.vn/vi/du-no-tin-dung-doi-voi-nen-kt-dttktt');
    assert.equal(SBV_CANONICAL_URLS.M2, 'https://sbv.gov.vn/vi/tổng-phương-tiện-thanh-toán-và-tiền-gửi-của-khách-hàng-tại-tctd');

    assert.equal(isCanonicalSbvUrl('https://sbv.gov.vn/vi/tỷ-giá'), true);
    assert.equal(isCanonicalSbvUrl('https://sbv.gov.vn/vi/lãi-suất1'), true);
    assert.equal(isCanonicalSbvUrl('https://sbv.gov.vn/vi/du-no-tin-dung-doi-voi-nen-kt-dttktt'), true);
    assert.equal(isCanonicalSbvUrl('https://sbv.gov.vn/vi/tổng-phương-tiện-thanh-toán-và-tiền-gửi-của-khách-hàng-tại-tctd'), true);

    // Percent-encoded forms also identify canonical identity
    assert.equal(isCanonicalSbvUrl(encodeURI('https://sbv.gov.vn/vi/tỷ-giá')), true);

    const obs = normalizeSbvMonetaryFacts({
      centralFx: { status: 'available', value: 24250, effectiveDate: '2026-09-05' },
      dailyOvernight: { status: 'available', value: 4.15, sessionDate: '2026-09-04' },
      creditGrowth: { status: 'available', value: 6.85, referencePeriod: '2026-07' },
      m2Level: { status: 'available', value: 16500000, referencePeriod: '2026-06' }
    });

    const fxObs = obs.find((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');
    const ibObs = obs.find((o) => o.factId === 'vn.monetary.interbank.vnd.overnight.daily_avg_rate');
    const crObs = obs.find((o) => o.factId === 'vn.monetary.credit.outstanding.ytd_growth');
    const m2Obs = obs.find((o) => o.factId === 'vn.monetary.money_supply.m2.level');

    assert.equal(fxObs.provenance.sourceUrl, 'https://sbv.gov.vn/vi/tỷ-giá');
    assert.equal(ibObs.provenance.sourceUrl, 'https://sbv.gov.vn/vi/lãi-suất1');
    assert.equal(crObs.provenance.sourceUrl, 'https://sbv.gov.vn/vi/du-no-tin-dung-doi-voi-nen-kt-dttktt');
    assert.equal(m2Obs.provenance.sourceUrl, 'https://sbv.gov.vn/vi/tổng-phương-tiện-thanh-toán-và-tiền-gửi-của-khách-hàng-tại-tctd');
  });

  // 36. Guessed generic SBV URLs are rejected / not treated as canonical
  test('36. Guessed generic SBV URLs are rejected / not treated as canonical', () => {
    const guessedUrls = [
      'https://sbv.gov.vn/vi/ty-gia-trung-tam',
      'https://sbv.gov.vn/vi/lai-suat-lien-ngan-hang',
      'https://sbv.gov.vn/vi/thong-ke-tien-te'
    ];

    for (const url of guessedUrls) {
      assert.equal(isSbvGuessedGenericUrl(url), true, `${url} must be identified as guessed generic`);
      assert.equal(isCanonicalSbvUrl(url), false, `${url} must NOT be treated as canonical provenance`);
    }

    // Legacy WebCenter URLs are historical fallbacks, NOT canonical
    assert.equal(isCanonicalSbvUrl(SBV_LEGACY_FALLBACK_URLS.CENTRAL_FX), false);
    assert.equal(isCanonicalSbvUrl(SBV_LEGACY_FALLBACK_URLS.INTERBANK_DAILY), false);

    // Supplying a guessed generic URL to the parser results in quarantine
    const parsed = parseSbvCentralFx(
      'Tỷ giá trung tâm ngày 05/09/2026 là 24.250 VND',
      'https://sbv.gov.vn/vi/ty-gia-trung-tam'
    );
    assert.equal(parsed.status, 'quarantined');
    assert.equal(parsed.reason, 'NON_CANONICAL_GUESSED_URL');
  });

  // 37. Quarter period end (2026-09-30) is NOT treated as publication date
  test('37. Quarter period end (2026-09-30) is NOT treated as publication date', () => {
    const gdpText = 'Báo cáo tình hình kinh tế - xã hội quý III năm 2026. Tổng sản phẩm trong nước (GDP) quý III năm 2026 tăng 7.40% so với cùng kỳ năm trước nhờ sản xuất công nghiệp và xuất khẩu phục hồi mạnh.';
    const parsedGdp = parseNsoQuarterlyGdp(gdpText);
    assert.notEqual(parsedGdp, null);
    assert.equal(parsedGdp.value, 7.4);
    assert.equal(parsedGdp.referenceTime, '2026-Q3');
    assert.equal(parsedGdp.periodEnd, '2026-09-30');

    // Document contains no publication date statement
    const sampleHtml = `<html><head><title>Kinh te xa hoi</title></head><body><p>${gdpText}</p></body></html>`;
    const release = parseNsoSocioeconomicRelease(sampleHtml, 'https://www.nso.gov.vn/gdp-q3-2026/');
    assert.equal(release.status, 'available');
    assert.equal(release.publishedAt, null, 'Document without explicit publication date must have null publishedAt');

    const observations = normalizeNsoMacroFacts(release);
    const gdpObs = observations.find((o) => o.factId === 'vn.macro.gdp.real.quarter_yoy');

    assert.notEqual(gdpObs, undefined);
    assert.equal(gdpObs.publishedAt, null, 'Quarter period end (2026-09-30) must NOT be assigned to publishedAt');
    assert.equal(gdpObs.periodEnd, '2026-09-30', 'Quarter period end must be preserved as periodEnd');
    assert.equal(gdpObs.provenance.periodEnd, '2026-09-30');
    assert.notEqual(gdpObs.publishedAt, gdpObs.periodEnd, 'publishedAt and periodEnd are distinct concepts');
  });

  // 38. Unknown publication date remains null (no fetchedAt substitution)
  test('38. Unknown publication date remains null (no fetchedAt substitution)', () => {
    const cpiText = 'Thông cáo báo chí tình hình giá cả. Chỉ số giá tiêu dùng (CPI) tháng 08/2026 tăng 3.45% so với cùng kỳ năm trước do nhóm lương thực và giáo dục điều chỉnh.';
    const sampleHtml = `<html><head><title>CPI thang 8</title></head><body><p>${cpiText}</p></body></html>`;
    const fetchTime = new Date('2026-09-05T14:30:00.000Z');

    // Release URL contains a date path /2026/09/ which formerly was used to synthesize a -01 day
    const release = parseNsoSocioeconomicRelease(sampleHtml, 'https://www.nso.gov.vn/tin-tuc/2026/09/cpi-thang-8/');
    assert.equal(release.status, 'available');
    assert.equal(release.publishedAt, null, 'Must NOT invent a -01 day from release URL date path');

    const observations = normalizeNsoMacroFacts(release, fetchTime);
    const cpiObs = observations.find((o) => o.factId === 'vn.macro.cpi.yoy');

    assert.notEqual(cpiObs, undefined);
    assert.equal(cpiObs.publishedAt, null, 'publishedAt must remain null');
    assert.equal(cpiObs.fetchedAt, fetchTime.toISOString(), 'fetchedAt is the fetch timestamp');
    assert.notEqual(cpiObs.publishedAt, cpiObs.fetchedAt, 'fetchedAt must NEVER be substituted for unknown publishedAt');
  });

  // 39. SBV WAF rejection preserves LKG timestamps
  test('39. SBV WAF rejection preserves LKG timestamps', async () => {
    const originalObs = createMarketObservation({
      factId: 'vn.monetary.fx.sbv_central.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'Tỷ giá trung tâm',
      value: 24250,
      unit: 'VND/USD',
      unitType: UNIT_TYPES.CURRENCY_RATIO,
      referenceTime: '2026-09-04',
      publishedAt: null,
      observedAt: '2026-09-04T02:00:00.000Z',
      fetchedAt: '2026-09-04T03:00:00.000Z'
    });
    await persistMarketObservations([originalObs], null);

    const wafBlockTime = new Date('2026-09-05T09:45:00.000Z');
    await runMarketContextCollector({
      now: wafBlockTime,
      client: null,
      fetchSbvMoneyMarketFn: async () => ({
        status: 'blocked',
        reason: 'PROVIDER_ACCESS_DENIED'
      }),
      fetchSbvOfficialFn: async () => ({
        status: 'blocked',
        reason: 'PROVIDER_ACCESS_DENIED'
      }),
      forceRefresh: true
    });

    const persisted = await fetchLatestPersistedObservations(null);
    const lkgFx = persisted.find((o) => o.factId === 'vn.monetary.fx.sbv_central.usd_vnd');

    assert.notEqual(lkgFx, undefined);
    assert.equal(lkgFx.value, 24250);
    assert.equal(lkgFx.observedAt, '2026-09-04T02:00:00.000Z', 'Observed timestamp must be identical');
    assert.equal(lkgFx.fetchedAt, '2026-09-04T03:00:00.000Z', 'Fetched timestamp must be identical');
    assert.notEqual(lkgFx.fetchedAt, wafBlockTime.toISOString(), 'WAF block time must not touch LKG timestamps');
  });

  // 40. Blocked SBV evidence produces no directional monetary stance
  test('40. Blocked SBV evidence produces no directional monetary stance', () => {
    const blockedMonetaryFacts = [
      createUnavailableObservation('monetary.sbv_central_usd_vnd', PILLARS.MONETARY, 'Tỷ giá trung tâm', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.fx.sbv_central.usd_vnd'
      }),
      createUnavailableObservation('monetary.vnd_overnight_daily_avg_rate', PILLARS.MONETARY, 'Lãi suất qua đêm', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.interbank.vnd.overnight.daily_avg_rate'
      }),
      createUnavailableObservation('monetary.credit_ytd_growth', PILLARS.MONETARY, 'Tăng trưởng tín dụng', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.credit.outstanding.ytd_growth'
      }),
      createUnavailableObservation('monetary.m2_level', PILLARS.MONETARY, 'Cung tiền M2', 'PROVIDER_ACCESS_DENIED', {
        factId: 'vn.monetary.money_supply.m2.level'
      })
    ];

    const signals = deriveMarketSignals(
      { macro: [], monetary: blockedMonetaryFacts, market: [], intermarket: [] },
      new Date()
    );

    const monetaryStance = signals.find((s) => s.signalType === 'MONETARY_STANCE');
    if (monetaryStance) {
      assert.notEqual(monetaryStance.state, 'tightening', 'Blocked SBV facts must not produce directional tightening signal');
      assert.notEqual(monetaryStance.state, 'easing', 'Blocked SBV facts must not produce directional easing signal');
      assert.equal(monetaryStance.state, 'neutral', 'If signal emitted, stance must be strictly non-directional neutral');
    } else {
      // Abstaining from signal generation is also compliant
      assert.equal(monetaryStance, undefined);
    }
  });

  // 41. NSO release scheduler cadence has no day-of-month or day-30 assumptions
  test('41. NSO release scheduler cadence has no day-of-month or day-30 assumptions', () => {
    // Check various days across the month for NSO_MONTHLY: always schedules 24h daily cadence
    const days = [1, 3, 10, 15, 25, 28, 31];
    for (const d of days) {
      const now = new Date(Date.UTC(2026, 7, d, 9, 0, 0)); // August 2026
      const nextDue = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, now);
      const diffHours = (Date.parse(nextDue) - now.getTime()) / (3600 * 1000);
      assert.equal(diffHours, 24, `NSO_MONTHLY on day ${d} must use safe 24h daily cadence`);
    }

    // Check NSO_QUARTERLY in quarter-end month (September): uses 24h daily cadence without assuming day 30
    const qDays = [5, 12, 20, 29, 30];
    for (const d of qDays) {
      const now = new Date(Date.UTC(2026, 8, d, 9, 0, 0)); // September 2026 (quarter-end)
      const nextDue = calculateNextDueAt(SOURCE_KEYS.NSO_QUARTERLY, now);
      const diffHours = (Date.parse(nextDue) - now.getTime()) / (3600 * 1000);
      assert.equal(diffHours, 24, `NSO_QUARTERLY on day ${d} of quarter-end month must use safe 24h daily cadence`);
    }

    // If authoritative nextReleaseAt is observed, uses exact timestamp
    const announcedTime = '2026-10-03T02:00:00.000Z';
    const now = new Date('2026-09-05T10:00:00.000Z');
    const scheduledDue = calculateNextDueAt(SOURCE_KEYS.NSO_MONTHLY, now, { nextReleaseAt: announcedTime });
    assert.equal(scheduledDue, announcedTime);
  });

});