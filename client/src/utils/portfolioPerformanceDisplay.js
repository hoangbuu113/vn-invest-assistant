export const PERFORMANCE_DATA_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  STALE: 'STALE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  UNAVAILABLE: 'UNAVAILABLE'
});

const STATE_LABELS = Object.freeze({
  AVAILABLE: 'Sẵn sàng',
  PARTIAL: 'Dữ liệu một phần',
  STALE: 'Dữ liệu cũ',
  NOT_APPLICABLE: 'Không áp dụng',
  INSUFFICIENT_HISTORY: 'Chưa đủ lịch sử',
  UNAVAILABLE: 'Chưa khả dụng'
});

export const PERFORMANCE_REASON_MESSAGES = Object.freeze({
  PORTFOLIO_NOT_ACTIVATED: 'Chưa có mốc bắt đầu để tính hiệu suất danh mục.',
  NO_STARTING_VALUATION: 'Chưa có định giá đầu kỳ phù hợp để tính hiệu suất.',
  NO_DAILY_VALUATION_HISTORY: 'Lịch sử định giá hằng ngày sẽ bắt đầu từ quan sát hợp lệ đầu tiên; không có dữ liệu hồi tố được tạo.',
  INSUFFICIENT_VALUATION_OBSERVATIONS: 'Cần ít nhất hai mốc định giá hoàn chỉnh liên tiếp để tính TWR.',
  MISSING_DAILY_OBSERVATION: 'Chuỗi định giá có ngày bị thiếu nên không được nối giả thành hiệu suất liên tục.',
  INCOMPLETE_DAILY_VALUATION: 'Một mốc định giá chưa đầy đủ nên không đủ điều kiện tính hiệu suất.',
  DAILY_VALUATION_UNAVAILABLE: 'Mốc định giá danh mục không khả dụng.',
  EXTERNAL_FLOW_EVIDENCE_UNAVAILABLE: 'Chưa đủ bằng chứng dòng tiền VND giữa hai mốc định giá.',
  VND_UNREALIZED_PNL_UNAVAILABLE: 'Lãi/lỗ chưa thực hiện bằng VND chưa có cơ sở đầy đủ.',
  INSUFFICIENT_DATE_SPAN: 'Khoảng thời gian hiện chưa có đủ dữ liệu hoàn chỉnh.',
  INSUFFICIENT_HISTORY: 'Chưa đủ lịch sử để tính lợi suất quy năm.',
  INSUFFICIENT_CASH_FLOW_COUNT: 'Chưa đủ dòng tiền để tính lợi suất theo dòng tiền.',
  INSUFFICIENT_COMMON_DATES: 'Chưa có đủ ngày chung để đối chiếu chỉ số tham chiếu.',
  INCOMPLETE_VALUATION_COVERAGE: 'Một số ngày trong kỳ chưa có đủ dữ liệu định giá.',
  NON_VND_HISTORICAL_FX_UNAVAILABLE: 'Chưa có lịch sử tỷ giá để tính hiệu suất VND đầy đủ cho tài sản ngoại tệ.',
  NON_VND_OR_MISSING_END_PRICE: 'Lãi/lỗ VND chưa đầy đủ do thiếu giá cuối kỳ hoặc lịch sử tỷ giá.',
  STALE_VALUATION_MARK: 'Dữ liệu giá lịch sử đã cũ và không được dùng như một định giá hiện hành.',
  ZERO_STARTING_VALUATION: 'Giá trị danh mục đầu kỳ bằng 0 nên chưa thể tính hiệu suất.',
  ZERO_CAPITAL_BREAK: 'Chuỗi hiệu suất bị gián đoạn tại thời điểm vốn danh mục bằng 0.',
  NO_SIGN_CHANGE: 'Dòng tiền trong kỳ không tạo được nghiệm XIRR hợp lệ.',
  NO_SOLUTION: 'Không thể xác định nghiệm XIRR duy nhất cho kỳ này.',
  CASH_ONLY_PORTFOLIO: 'Danh mục chỉ có tiền mặt nên benchmark không áp dụng.',
  BENCHMARK_NOT_SELECTED: 'Không sử dụng chỉ số tham chiếu cho kỳ này.',
  TWR_UNAVAILABLE: 'TWR hiện chưa khả dụng.',
  PORTFOLIO_PERIOD_UNAVAILABLE: 'Kỳ đo của danh mục hiện chưa khả dụng.'
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function performanceReasonMessage(reason, fallback = 'Dữ liệu hiện chưa khả dụng.') {
  return PERFORMANCE_REASON_MESSAGES[reason] || fallback;
}

export function normalizePerformanceState(status, reasons = []) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const reasonList = Array.isArray(reasons) ? reasons : [reasons];
  if (reasonList.includes('STALE_VALUATION_MARK')) return PERFORMANCE_DATA_STATES.STALE;
  if (normalized === 'available' || normalized === 'complete') return PERFORMANCE_DATA_STATES.AVAILABLE;
  if (normalized === 'partial') return PERFORMANCE_DATA_STATES.PARTIAL;
  if (normalized === 'stale') return PERFORMANCE_DATA_STATES.STALE;
  if (normalized === 'not_applicable') return PERFORMANCE_DATA_STATES.NOT_APPLICABLE;
  if (normalized === 'insufficient_data' || normalized === 'insufficient_history') {
    return PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY;
  }
  return PERFORMANCE_DATA_STATES.UNAVAILABLE;
}

export function performanceStateMeta(state) {
  const normalized = Object.prototype.hasOwnProperty.call(PERFORMANCE_DATA_STATES, state)
    ? state
    : PERFORMANCE_DATA_STATES.UNAVAILABLE;
  const tone = normalized === PERFORMANCE_DATA_STATES.AVAILABLE
    ? 'available'
    : normalized === PERFORMANCE_DATA_STATES.PARTIAL
      ? 'partial'
      : normalized === PERFORMANCE_DATA_STATES.STALE
        ? 'stale'
        : normalized === PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY
          ? 'insufficient'
          : 'unavailable';
  return { state: normalized, label: STATE_LABELS[normalized], tone };
}

function metricValue(metric, field) {
  return metric?.status === 'available' && finiteNumber(metric?.[field])
    ? metric[field]
    : null;
}

function validPerformanceSeries(series) {
  return (Array.isArray(series) ? series : []).filter((point) => (
    typeof point?.date === 'string'
    && finiteNumber(point?.twrIndex)
  ));
}

export function buildPortfolioPerformanceDisplay(performance, { holdingsCount = 0 } = {}) {
  if (!performance || typeof performance !== 'object') {
    return {
      state: PERFORMANCE_DATA_STATES.UNAVAILABLE,
      stateMeta: performanceStateMeta(PERFORMANCE_DATA_STATES.UNAVAILABLE),
      series: [],
      observationCount: 0,
      historyMode: 'UNAVAILABLE',
      canRenderChart: false,
      isCashOnly: holdingsCount === 0,
      coverageReasons: [],
      coverage: null
    };
  }

  const coverageReasons = Array.isArray(performance?.valuationCoverage?.reasons)
    ? performance.valuationCoverage.reasons.filter(Boolean)
    : [];
  const primaryReason = coverageReasons[0] || performance?.twr?.reason || null;
  const state = normalizePerformanceState(performance.status, coverageReasons);
  const series = validPerformanceSeries(performance.series);
  const reportedObservationCount = performance?.valuationCoverage?.observationCount
    ?? performance?.valuationCoverage?.valuationMarks;
  const observationCount = Number.isInteger(reportedObservationCount) && reportedObservationCount >= 0
    ? reportedObservationCount
    : series.length;
  const twr = metricValue(performance.twr, 'returnPct');
  const isCashOnly = holdingsCount === 0;
  const historyMode = observationCount <= 1
    ? 'INSUFFICIENT_HISTORY'
    : observationCount <= 3
      ? 'SPARSE'
      : 'SUFFICIENT';

  const drawdownValue = metricValue(performance.drawdown, 'maxDrawdownPct');

  return {
    state,
    stateMeta: performanceStateMeta(state),
    primaryReason,
    primaryReasonMessage: performanceReasonMessage(primaryReason),
    coverageReasons,
    period: {
      requestedRange: performance?.period?.range || null,
      startDate: performance?.period?.actualStartDate || null,
      endDate: performance?.period?.endDate || null,
      clippedToInception: Boolean(performance?.period?.clippedToInception)
    },
    historicalAsOf: performance?.period?.endDate || null,
    observationCount,
    series,
    historyMode,
    canRenderChart: !isCashOnly && historyMode === 'SUFFICIENT' && twr !== null,
    isCashOnly,
    twr: {
      value: twr,
      state: normalizePerformanceState(performance?.twr?.status, performance?.twr?.reason),
      reason: performance?.twr?.reason || null
    },
    mwr: {
      value: metricValue(performance.mwr, 'annualizedReturnPct'),
      state: normalizePerformanceState(performance?.mwr?.status, performance?.mwr?.reason),
      reason: performance?.mwr?.reason || null
    },
    drawdown: {
      value: drawdownValue,
      currentValue: metricValue(performance.drawdown, 'currentDrawdownPct'),
      state: normalizePerformanceState(performance?.drawdown?.status, performance?.drawdown?.reason),
      reason: performance?.drawdown?.reason || null,
      isZero: drawdownValue === 0,
      peakDate: drawdownValue !== null && drawdownValue < 0 ? performance?.drawdown?.peakDate || null : null,
      troughDate: drawdownValue !== null && drawdownValue < 0 ? performance?.drawdown?.troughDate || null : null
    },
    pnl: {
      state: normalizePerformanceState(performance?.pnl?.status, performance?.pnl?.reason),
      reason: performance?.pnl?.reason || null,
      asOfDate: performance?.pnl?.asOfDate || null,
      totalAtEnd: finiteNumber(performance?.pnl?.totalAccountingPnlAtEnd)
        ? performance.pnl.totalAccountingPnlAtEnd
        : null,
      realizedDuringPeriod: finiteNumber(performance?.pnl?.realizedPnlDuringPeriod)
        ? performance.pnl.realizedPnlDuringPeriod
        : null,
      cumulativeRealizedToEnd: finiteNumber(performance?.pnl?.cumulativeRealizedPnlToEnd)
        ? performance.pnl.cumulativeRealizedPnlToEnd
        : null,
      unrealizedAtEnd: finiteNumber(performance?.pnl?.unrealizedPnlAtEnd)
        ? performance.pnl.unrealizedPnlAtEnd
        : null
    },
    coverage: performance?.valuationCoverage || null,
    methodology: performance?.methodology || null
  };
}

export function buildBenchmarkDisplay({
  benchmarkId = 'NONE',
  benchmark = null,
  loading = false,
  error = null,
  holdingsCount = 0
} = {}) {
  const id = typeof benchmarkId === 'string' ? benchmarkId.toUpperCase() : 'NONE';
  if (holdingsCount === 0) {
    return {
      id: 'NONE',
      state: PERFORMANCE_DATA_STATES.NOT_APPLICABLE,
      reason: 'CASH_ONLY_PORTFOLIO',
      name: null,
      series: [],
      canOverlay: false,
      isReferenceOnly: false,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      differencePctPoints: null
    };
  }
  if (id === 'NONE') {
    return {
      id,
      state: PERFORMANCE_DATA_STATES.NOT_APPLICABLE,
      reason: 'BENCHMARK_NOT_SELECTED',
      name: null,
      series: [],
      canOverlay: false,
      isReferenceOnly: false,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      differencePctPoints: null
    };
  }
  if (loading && !benchmark) {
    return {
      id,
      state: 'LOADING',
      reason: null,
      name: id === 'SP500' ? 'S&P 500' : 'VN-Index',
      series: [],
      canOverlay: false,
      isReferenceOnly: false,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      differencePctPoints: null
    };
  }

  const state = error
    ? PERFORMANCE_DATA_STATES.UNAVAILABLE
    : normalizePerformanceState(benchmark?.status, benchmark?.reason);
  const isReferenceOnly = benchmark?.benchmark?.comparability === 'REFERENCE_ONLY_CURRENCY_MISMATCH';
  const series = Array.isArray(benchmark?.series) ? benchmark.series : [];
  const available = state === PERFORMANCE_DATA_STATES.AVAILABLE;
  return {
    id,
    state,
    reason: error?.code || benchmark?.reason || null,
    name: benchmark?.benchmark?.name || (id === 'SP500' ? 'S&P 500' : 'VN-Index'),
    series,
    canOverlay: available && !isReferenceOnly && series.length >= 2,
    isReferenceOnly,
    period: benchmark?.period || null,
    portfolioReturnPct: available && finiteNumber(benchmark?.portfolio?.returnPctOnCommonPeriod)
      ? benchmark.portfolio.returnPctOnCommonPeriod
      : null,
    benchmarkReturnPct: available && finiteNumber(benchmark?.benchmarkReturnPct)
      ? benchmark.benchmarkReturnPct
      : null,
    differencePctPoints: available && !isReferenceOnly && finiteNumber(benchmark?.returnDifferencePctPoints)
      ? benchmark.returnDifferencePctPoints
      : null
  };
}
