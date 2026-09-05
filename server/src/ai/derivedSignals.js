/**
 * Server-side Derived Signals Engine for Market Strategist.
 *
 * Implements the contract:
 * OBSERVED_FACT -> DERIVED_SIGNAL -> AI_INTERPRETATION -> TACTICAL_ORIENTATION
 *
 * Guaranteed invariants:
 * 1. Signals are deterministically computed on server from verified observations.
 * 2. Signals are ONLY generated when required observation inputs exist.
 * 3. Exact observation IDs are tracked in inputEvidenceIds.
 * 4. Structured limitations are attached to each signal.
 */

export const SIGNAL_METHODOLOGY_VERSION = 'v1';

export const SIGNAL_TYPES = Object.freeze([
  'VN_MARKET_TREND',
  'INFLATION_CONTEXT',
  'DOMESTIC_GROWTH_MOMENTUM',
  'MONETARY_STANCE',
  'FX_PRESSURE',
  'GLOBAL_YIELD_PRESSURE',
  'GLOBAL_USD_PRESSURE',
  'COMMODITY_PRESSURE'
]);

/**
 * Derives explicit market signals from validated observation inputs.
 *
 * @param {object} params
 * @param {Array<object>} params.observations - Verified observation items.
 * @param {Date} [params.now] - Current timestamp.
 * @returns {Array<object>} Array of valid derived signal objects.
 */
export function deriveMarketSignals({ observations = [], now = new Date() } = {}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return [];
  }

  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const signals = [];

  // Group observations by factId and id
  const obsMap = new Map();
  for (const obs of observations) {
    if (!obs || typeof obs !== 'object') continue;
    const observationId = obs.observationId || obs.id;
    if (!observationId) continue;
    if (obs.factId) obsMap.set(obs.factId, obs);
    obsMap.set(observationId, obs);
  }

  // Helper to find observation by factId prefix or id
  const findObs = (factIdPrefix) => {
    if (obsMap.has(factIdPrefix)) return obsMap.get(factIdPrefix);
    for (const [key, obs] of obsMap.entries()) {
      if (typeof key === 'string' && key.startsWith(factIdPrefix)) {
        return obs;
      }
      if (obs?.factId && obs.factId.startsWith(factIdPrefix)) {
        return obs;
      }
    }
    return null;
  };

  // 1. VN_MARKET_TREND: requires VN-Index observation
  const vnIndexObs = findObs('vn.market.vnindex.close');
  if (vnIndexObs && typeof vnIndexObs.value === 'number') {
    const obsId = vnIndexObs.observationId || vnIndexObs.id;
    const chg = typeof vnIndexObs.change === 'number' ? vnIndexObs.change : null;
    const chgPct = typeof vnIndexObs.changePercent === 'number' ? vnIndexObs.changePercent : null;

    let state = 'watch';
    if (chg !== null) {
      if (chg > 0) state = 'positive';
      else if (chg < 0) state = 'negative';
      else state = 'neutral';
    } else if (chgPct !== null) {
      if (chgPct > 0) state = 'positive';
      else if (chgPct < 0) state = 'negative';
      else state = 'neutral';
    }

    signals.push({
      signalId: `sig.vn_market_trend:${obsId}`,
      signalType: 'VN_MARKET_TREND',
      state,
      value: vnIndexObs.value,
      unit: vnIndexObs.unit || 'điểm',
      change: chg,
      changePercent: chgPct,
      inputEvidenceIds: [obsId],
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Biến động điểm số phiên giao dịch gần nhất của chỉ số VN-Index; chưa tích hợp độ rộng thanh khoản và diễn biến phái sinh trong phiên.'
    });
  }

  // 2. INFLATION_CONTEXT: requires CPI YoY observation (headline or core)
  const cpiObs = findObs('vn.macro.cpi.yoy');
  const coreCpiObs = findObs('vn.macro.core_cpi.yoy');
  if ((cpiObs && typeof cpiObs.value === 'number') || (coreCpiObs && typeof coreCpiObs.value === 'number')) {
    const primaryObs = cpiObs || coreCpiObs;
    const obsId = primaryObs.observationId || primaryObs.id;
    const val = typeof cpiObs?.value === 'number' ? cpiObs.value : coreCpiObs.value;
    const inputEvidenceIds = [
      cpiObs?.observationId || cpiObs?.id,
      coreCpiObs?.observationId || coreCpiObs?.id
    ].filter(Boolean);

    let state = 'moderate';
    if (val > 4.5) state = 'elevated';
    else if (val < 3.0) state = 'subdued';

    signals.push({
      signalId: `sig.inflation_context:${obsId}`,
      signalType: 'INFLATION_CONTEXT',
      state,
      value: val,
      unit: primaryObs.unit || '%',
      inputEvidenceIds,
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Dữ liệu lạm phát công bố định kỳ theo kỳ báo cáo của Tổng cục Thống kê (NSO); bao gồm CPI chung và lạm phát cơ bản khi có sẵn.'
    });
  }

  // 3. DOMESTIC_GROWTH_MOMENTUM: requires GDP, IIP, or Retail observation
  const gdpObs = findObs('vn.macro.gdp.real.quarter_yoy') || findObs('vn.macro.gdp.growth_rate');
  const iipObs = findObs('vn.macro.iip.month_yoy');
  const retailObs = findObs('vn.macro.retail.nominal.month_yoy');

  if ((gdpObs && typeof gdpObs.value === 'number') ||
      (iipObs && typeof iipObs.value === 'number') ||
      (retailObs && typeof retailObs.value === 'number')) {
    const primary = gdpObs || iipObs || retailObs;
    const obsId = primary.observationId || primary.id;
    const inputEvidenceIds = [
      gdpObs?.observationId || gdpObs?.id,
      iipObs?.observationId || iipObs?.id,
      retailObs?.observationId || retailObs?.id
    ].filter(Boolean);

    let state = 'moderate';
    if (gdpObs && typeof gdpObs.value === 'number') {
      if (gdpObs.value >= 6.5) state = 'expansion';
      else if (gdpObs.value < 5.0) state = 'slowing';
      else state = 'moderate';
    } else if (iipObs && typeof iipObs.value === 'number') {
      if (iipObs.value >= 8.0) state = 'expansion';
      else if (iipObs.value < 3.0) state = 'slowing';
      else state = 'moderate';
    }

    signals.push({
      signalId: `sig.domestic_growth:${obsId}`,
      signalType: 'DOMESTIC_GROWTH_MOMENTUM',
      state,
      value: primary.value,
      unit: primary.unit || '%',
      inputEvidenceIds,
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Chỉ báo tăng trưởng kinh tế tổng hợp từ dữ liệu NSO (GDP quý, IIP tháng, doanh thu bán lẻ); phản ánh chu kỳ hoạt động sản xuất và tiêu dùng thực tế.'
    });
  }

  // 4. MONETARY_STANCE: requires daily/weekly overnight rate, credit growth, M2, or central FX
  const dailyOnObs = findObs('vn.monetary.interbank.vnd.overnight.daily_avg_rate');
  const weeklyOnObs = findObs('vn.monetary.rate.vnd_overnight');
  const onObs = dailyOnObs || weeklyOnObs;
  const creditObs = findObs('vn.monetary.credit.outstanding.ytd_growth');
  const m2Obs = findObs('vn.monetary.money_supply.m2.level');
  const centralFxObs = findObs('vn.monetary.fx.sbv_central.usd_vnd');

  if ((onObs && typeof onObs.value === 'number') ||
      (creditObs && typeof creditObs.value === 'number') ||
      (m2Obs && typeof m2Obs.value === 'number') ||
      (centralFxObs && typeof centralFxObs.value === 'number')) {
    const primary = onObs || creditObs || m2Obs || centralFxObs;
    const obsId = primary.observationId || primary.id;
    const inputEvidenceIds = [
      dailyOnObs?.observationId || dailyOnObs?.id,
      weeklyOnObs?.observationId || weeklyOnObs?.id,
      creditObs?.observationId || creditObs?.id,
      m2Obs?.observationId || m2Obs?.id,
      centralFxObs?.observationId || centralFxObs?.id
    ].filter(Boolean);

    let state = 'neutral';
    if (onObs && typeof onObs.value === 'number') {
      if (onObs.value >= 5.0) state = 'tightening';
      else if (onObs.value <= 2.0) state = 'accommodative';
      else state = 'neutral';
    }

    const hasM2Boundary = m2Obs && m2Obs.methodologyVersion === 'sbv_m2_post_202510';

    signals.push({
      signalId: `sig.monetary_stance:${obsId}`,
      signalType: 'MONETARY_STANCE',
      state,
      value: primary.value,
      unit: primary.unit || '%',
      inputEvidenceIds,
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: `Dữ liệu điều hành tiền tệ từ NHNN (SBV); theo dõi thanh khoản liên ngân hàng, tăng trưởng tín dụng và cung tiền M2${hasM2Boundary ? ' (áp dụng ranh giới phương pháp M2 từ 10/2025)' : ''}.`
    });
  }

  // 3. FX_PRESSURE: requires USD/VND observation
  const usdVndObs = findObs('vn.monetary.fx.usd_vnd');
  if (usdVndObs && typeof usdVndObs.value === 'number') {
    const obsId = usdVndObs.observationId || usdVndObs.id;
    const chg = typeof usdVndObs.change === 'number' ? usdVndObs.change : null;

    let state = 'moderate';
    if (chg !== null) {
      if (chg > 0) state = 'elevated';
      else if (chg < 0) state = 'subdued';
      else state = 'moderate';
    }

    signals.push({
      signalId: `sig.fx_pressure:${obsId}`,
      signalType: 'FX_PRESSURE',
      state,
      value: usdVndObs.value,
      unit: usdVndObs.unit || 'VND',
      change: chg,
      inputEvidenceIds: [obsId],
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Tỷ giá giao ngay tham chiếu USD/VND; chưa phản ánh mức chênh lệch swap liên ngân hàng và động thái can thiệp dự trữ ngoại hối.'
    });
  }

  // 4. GLOBAL_USD_PRESSURE: requires DXY quote observation
  const dxyObs = findObs('global.intermarket.dxy.quote');
  if (dxyObs && typeof dxyObs.value === 'number') {
    const obsId = dxyObs.observationId || dxyObs.id;
    const val = dxyObs.value;

    let state = 'moderate';
    if (val >= 104) state = 'elevated';
    else if (val < 100) state = 'subdued';

    signals.push({
      signalId: `sig.global_usd_pressure:${obsId}`,
      signalType: 'GLOBAL_USD_PRESSURE',
      state,
      value: val,
      unit: dxyObs.unit || 'điểm',
      inputEvidenceIds: [obsId],
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Chỉ số sức mạnh USD (DXY) so với rổ tiền tệ quốc tế chủ chốt.'
    });
  }

  // 5. GLOBAL_YIELD_PRESSURE: requires US10Y yield observation
  const us10yObs = findObs('global.intermarket.us10y.yield');
  if (us10yObs && typeof us10yObs.value === 'number') {
    const obsId = us10yObs.observationId || us10yObs.id;
    const val = us10yObs.value;

    let state = 'moderate';
    if (val >= 4.5) state = 'elevated';
    else if (val < 3.5) state = 'subdued';

    signals.push({
      signalId: `sig.global_yield_pressure:${obsId}`,
      signalType: 'GLOBAL_YIELD_PRESSURE',
      state,
      value: val,
      unit: us10yObs.unit || '%',
      inputEvidenceIds: [obsId],
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Lợi suất trái phiếu chính phủ Mỹ kỳ hạn 10 năm tham chiếu.'
    });
  }

  // 6. COMMODITY_PRESSURE: requires Brent futures observation
  const brentObs = findObs('global.intermarket.brent.futures');
  if (brentObs && typeof brentObs.value === 'number') {
    const obsId = brentObs.observationId || brentObs.id;
    const val = brentObs.value;

    let state = 'moderate';
    if (val >= 90) state = 'elevated';
    else if (val < 70) state = 'subdued';

    signals.push({
      signalId: `sig.commodity_pressure:${obsId}`,
      signalType: 'COMMODITY_PRESSURE',
      state,
      value: val,
      unit: brentObs.unit || 'USD/thùng',
      inputEvidenceIds: [obsId],
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: 'Giá dầu thô Brent tương lai giao gần; tác động gián tiếp đến kỳ vọng lạm phát năng lượng đầu vào.'
    });
  }

  return signals;
}
