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
  'COMMODITY_PRESSURE',
  'VN_TRADE_CONTEXT'
]);

/**
 * Derives explicit market signals from validated observation inputs.
 *
 * @param {object} params
 * @param {Array<object>} params.observations - Verified observation items.
 * @param {Date} [params.now] - Current timestamp.
 * @returns {Array<object>} Array of valid derived signal objects.
 */
export function deriveMarketSignals({ observations = [], marketObservations = null, now = new Date() } = {}) {
  const obsList = Array.isArray(observations) && observations.length > 0
    ? observations
    : (Array.isArray(marketObservations) ? marketObservations : (observations || []));

  if (!Array.isArray(obsList) || obsList.length === 0) {
    return [];
  }

  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const signals = [];

  // Group observations by factId and id
  const obsMap = new Map();
  for (const obs of obsList) {
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

  // Helper to check if an observation has finite numerical value and is not unavailable
  const isUsable = (o) => Boolean(o && typeof o.value === 'number' && Number.isFinite(o.value) && o.status !== 'unavailable');

  // 3. DOMESTIC_GROWTH_MOMENTUM: requires GDP, IIP, or Retail observation
  const gdpObs = findObs('vn.macro.gdp.real.quarter_yoy') || findObs('vn.macro.gdp.growth_rate');
  const iipObs = findObs('vn.macro.iip.month_yoy');
  const retailObs = findObs('vn.macro.retail.nominal.month_yoy');

  const usableGdp = isUsable(gdpObs) ? gdpObs : null;
  const usableIip = isUsable(iipObs) ? iipObs : null;
  const usableRetail = isUsable(retailObs) ? retailObs : null;

  if (usableGdp || usableIip || usableRetail) {
    const primary = usableGdp || usableIip || usableRetail;
    const obsId = primary.observationId || primary.id;
    const inputEvidenceIds = [
      usableGdp?.observationId || usableGdp?.id,
      usableIip?.observationId || usableIip?.id,
      usableRetail?.observationId || usableRetail?.id
    ].filter(Boolean);

    const isStale = (primary.status === 'stale' || primary.freshness === 'stale');
    let state = 'moderate';
    if (isStale) {
      state = 'neutral';
    } else if (usableGdp) {
      if (usableGdp.value >= 6.5) state = 'expansion';
      else if (usableGdp.value < 5.0) state = 'slowing';
      else state = 'moderate';
    } else if (usableIip) {
      if (usableIip.value >= 8.0) state = 'expansion';
      else if (usableIip.value < 3.0) state = 'slowing';
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
      limitations: isStale
        ? 'Dữ liệu vĩ mô đã quá hạn (stale); tín hiệu duy trì trạng thái trung tính/không định hướng cho tới kỳ công bố mới.'
        : 'Chỉ báo tăng trưởng kinh tế tổng hợp từ dữ liệu NSO (GDP quý, IIP tháng, doanh thu bán lẻ); phản ánh chu kỳ hoạt động sản xuất và tiêu dùng thực tế.'
    });
  }

  // 4. MONETARY_STANCE: requires daily/weekly overnight rate, credit growth, M2, or central FX
  const dailyOnObs = findObs('vn.monetary.interbank.vnd.overnight.daily_avg_rate');
  const weeklyOnObs = findObs('vn.monetary.rate.vnd_overnight');
  const onObs = dailyOnObs || weeklyOnObs;
  const creditObs = findObs('vn.monetary.credit.outstanding.ytd_growth');
  const m2Obs = findObs('vn.monetary.money_supply.m2.level');
  const centralFxObs = findObs('vn.monetary.fx.sbv_central.usd_vnd');

  const usableOn = isUsable(onObs) ? onObs : null;
  const usableCredit = isUsable(creditObs) ? creditObs : null;
  const usableM2 = isUsable(m2Obs) ? m2Obs : null;
  const usableCentralFx = isUsable(centralFxObs) ? centralFxObs : null;

  if (usableOn || usableCredit || usableM2 || usableCentralFx) {
    const primary = usableOn || usableCredit || usableM2 || usableCentralFx;
    const obsId = primary.observationId || primary.id;
    const inputEvidenceIds = [
      usableOn?.observationId || usableOn?.id,
      usableCredit?.observationId || usableCredit?.id,
      usableM2?.observationId || usableM2?.id,
      usableCentralFx?.observationId || usableCentralFx?.id
    ].filter(Boolean);

    const isStale = (primary.status === 'stale' || primary.freshness === 'stale');
    let state = 'neutral';
    if (!isStale && usableOn) {
      if (usableOn.value >= 5.0) state = 'tightening';
      else if (usableOn.value <= 2.0) state = 'accommodative';
      else state = 'neutral';
    }

    const hasM2Boundary = usableM2 && usableM2.methodologyVersion === 'sbv_m2_post_202510';

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
      limitations: isStale
        ? 'Dữ liệu tiền tệ SBV đã quá hạn (stale); tín hiệu duy trì trạng thái trung tính (không định hướng) cho tới khi có dữ liệu mới.'
        : `Dữ liệu điều hành tiền tệ từ NHNN (SBV); theo dõi thanh khoản liên ngân hàng, tăng trưởng tín dụng và cung tiền M2${hasM2Boundary ? ' (áp dụng ranh giới phương pháp M2 từ 10/2025)' : ''}.`
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

  // 7. VN_TRADE_CONTEXT: requires merchandise trade observations (balance, exports, imports)
  const balanceObs = findObs('vn.trade.goods.balance.month_usd');
  const exportsObs = findObs('vn.trade.goods.exports.month_usd');
  const importsObs = findObs('vn.trade.goods.imports.month_usd');

  const usableBalance = isUsable(balanceObs) ? balanceObs : null;
  const usableExports = isUsable(exportsObs) ? exportsObs : null;
  const usableImports = isUsable(importsObs) ? importsObs : null;

  if (usableBalance || (usableExports && usableImports)) {
    const primary = usableBalance || usableExports;
    const obsId = primary.observationId || primary.id;
    const inputEvidenceIds = [
      usableBalance?.observationId || usableBalance?.id,
      usableExports?.observationId || usableExports?.id,
      usableImports?.observationId || usableImports?.id
    ].filter(Boolean);

    const isStale = (primary.status === 'stale' || primary.freshness === 'stale');
    const balanceVal = usableBalance ? usableBalance.value : (usableExports.value - usableImports.value);

    let state = 'neutral';
    if (isStale) {
      state = 'neutral';
    } else if (balanceVal > 0) {
      state = 'surplus';
    } else if (balanceVal < 0) {
      state = 'deficit';
    } else {
      state = 'balanced';
    }

    signals.push({
      signalId: `sig.vn_trade_context:${obsId}`,
      signalType: 'VN_TRADE_CONTEXT',
      state,
      value: balanceVal,
      unit: primary.unit || 'USD',
      inputEvidenceIds,
      methodologyVersion: SIGNAL_METHODOLOGY_VERSION,
      generatedAt,
      status: 'active',
      limitations: isStale
        ? 'Số liệu thương mại hải quan đã quá hạn (stale); tín hiệu duy trì trạng thái trung tính/không định hướng cho tới kỳ công bố mới.'
        : 'Số liệu cán cân thương mại hàng hóa công bố định kỳ bởi Tổng cục Hải quan; phản ánh tình trạng xuất nhập khẩu hàng hóa thực tế và không hàm ý xu hướng trực tiếp cho thị trường chứng khoán (không suy diễn "thặng dư => cổ phiếu tăng"). Chưa bao gồm thương mại dịch vụ và cán cân vốn.'
    });
  }

  return signals;
}
