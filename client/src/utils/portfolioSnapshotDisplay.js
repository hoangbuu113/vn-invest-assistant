export const PORTFOLIO_DISPLAY_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  STALE: 'STALE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  UNAVAILABLE: 'UNAVAILABLE'
});

const DISPLAYABLE_VALUE_STATES = new Set([
  PORTFOLIO_DISPLAY_STATES.AVAILABLE,
  PORTFOLIO_DISPLAY_STATES.PARTIAL,
  PORTFOLIO_DISPLAY_STATES.STALE
]);

const STATE_LABELS = Object.freeze({
  AVAILABLE: 'Đã cập nhật',
  PARTIAL: 'Dữ liệu một phần',
  STALE: 'Dữ liệu cũ',
  NOT_APPLICABLE: 'Không áp dụng',
  INSUFFICIENT_HISTORY: 'Chưa đủ lịch sử',
  UNAVAILABLE: 'Chưa khả dụng'
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedState(value, fallback = PORTFOLIO_DISPLAY_STATES.UNAVAILABLE) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value;
  return Object.prototype.hasOwnProperty.call(PORTFOLIO_DISPLAY_STATES, normalized)
    ? normalized
    : fallback;
}

function displayableNumber(value, state) {
  return finiteNumber(value) && DISPLAYABLE_VALUE_STATES.has(normalizedState(state))
    ? value
    : null;
}

export function getPortfolioStateLabel(state) {
  return STATE_LABELS[normalizedState(state)] || STATE_LABELS.UNAVAILABLE;
}

export function getPortfolioStateTone(state) {
  switch (normalizedState(state)) {
    case PORTFOLIO_DISPLAY_STATES.AVAILABLE:
      return 'available';
    case PORTFOLIO_DISPLAY_STATES.STALE:
      return 'stale';
    case PORTFOLIO_DISPLAY_STATES.PARTIAL:
      return 'partial';
    default:
      return 'unavailable';
  }
}

export function buildPortfolioSummaryDisplay(snapshot) {
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : [];
  const state = normalizedState(snapshot?.status);
  const cashState = normalizedState(snapshot?.cash?.status);
  const investedState = normalizedState(snapshot?.summary?.metricStates?.investedMarketValue);
  const pnlState = normalizedState(snapshot?.summary?.metricStates?.unrealizedPnl);
  const totalState = normalizedState(snapshot?.summary?.metricStates?.totalPortfolioValue, state);

  const cash = displayableNumber(snapshot?.cash?.value, cashState);
  const invested = displayableNumber(snapshot?.investedMarketValue, investedState);
  const total = displayableNumber(snapshot?.totalPortfolioValue, totalState);
  const unrealizedPnl = displayableNumber(snapshot?.unrealizedPnL, pnlState);
  const unrealizedPnlPercent = unrealizedPnl === null || !finiteNumber(snapshot?.unrealizedPnLPercent)
    ? null
    : snapshot.unrealizedPnLPercent;

  return {
    snapshotId: snapshot?.snapshotId || null,
    state,
    stateLabel: getPortfolioStateLabel(state),
    stateTone: getPortfolioStateTone(state),
    valuationAsOf: snapshot?.valuationAsOf || snapshot?.calculatedAt || null,
    total,
    totalState,
    cash,
    cashState,
    invested,
    investedState,
    unrealizedPnl,
    unrealizedPnlPercent,
    pnlState,
    holdingsCount: holdings.length,
    isCashOnly: holdings.length === 0 && cash !== null
  };
}

function findAllocation(holding, allocation) {
  const allocations = Array.isArray(allocation?.holdingAllocations)
    ? allocation.holdingAllocations
    : [];
  return allocations.find((item) => (
    (holding?.assetId && item?.assetId === holding.assetId)
    || (holding?.id && item?.id === holding.id)
  )) || null;
}

function validNativeCost(holding) {
  return finiteNumber(holding?.nativeAverageCost)
    && typeof holding?.nativeCostCurrency === 'string'
    && holding.nativeCostCurrency.trim().length > 0;
}

function selectCurrentPrice(holding) {
  if (
    validNativeCost(holding)
    && finiteNumber(holding?.nativeCurrentPrice)
    && holding.nativeCurrentPrice > 0
  ) {
    return {
      value: holding.nativeCurrentPrice,
      currency: holding.nativeCostCurrency,
      asOf: holding.nativeCurrentPriceAsOf || holding.priceAsOf || null,
      source: holding.nativeCurrentPriceSource || null,
      freshness: holding.nativeCurrentPriceFreshness || null
    };
  }

  if (finiteNumber(holding?.nativePrice) && holding.nativePrice > 0) {
    return {
      value: holding.nativePrice,
      currency: holding.nativeCurrency || null,
      asOf: holding.priceAsOf || holding.marketUpdatedAt || null,
      source: holding.marketProvider || null,
      freshness: holding.marketFreshness || null
    };
  }

  return null;
}

function selectAverageCost(holding) {
  if (validNativeCost(holding)) {
    return { value: holding.nativeAverageCost, currency: holding.nativeCostCurrency };
  }
  if (finiteNumber(holding?.averageCost)) {
    return { value: holding.averageCost, currency: 'VND' };
  }
  return null;
}

function selectUnrealizedPnl(holding) {
  if (
    DISPLAYABLE_VALUE_STATES.has(normalizedState(holding?.nativePnlStatus))
    && finiteNumber(holding?.nativeUnrealizedPnL)
    && typeof holding?.nativeCostCurrency === 'string'
  ) {
    return {
      value: holding.nativeUnrealizedPnL,
      percent: finiteNumber(holding.nativeUnrealizedPnLPercent) ? holding.nativeUnrealizedPnLPercent : null,
      currency: holding.nativeCostCurrency,
      state: normalizedState(holding.nativePnlStatus)
    };
  }

  if (
    DISPLAYABLE_VALUE_STATES.has(normalizedState(holding?.pnlStatus))
    && finiteNumber(holding?.unrealizedPnL)
  ) {
    return {
      value: holding.unrealizedPnL,
      percent: finiteNumber(holding.unrealizedPnLPercent) ? holding.unrealizedPnLPercent : null,
      currency: 'VND',
      state: normalizedState(holding.pnlStatus)
    };
  }

  return null;
}

function holdingStatusText(holding, state) {
  if (state === PORTFOLIO_DISPLAY_STATES.STALE) return 'Dữ liệu cũ';
  if (state === PORTFOLIO_DISPLAY_STATES.AVAILABLE) return 'Đã cập nhật';
  if (holding?.valuationReason === 'FX_UNAVAILABLE' || holding?.valuationReason === 'FX_RESOLUTION_FAILED') {
    return 'Chưa có tỷ giá quy đổi';
  }
  if (holding?.valuationReason === 'MISSING_NATIVE_PRICE') return 'Chưa có dữ liệu giá';
  if (state === PORTFOLIO_DISPLAY_STATES.PARTIAL) return 'Dữ liệu một phần';
  return 'Chưa định giá được';
}

export function buildPortfolioHoldingDisplay(holding, allocation) {
  const state = normalizedState(holding?.dataStatus || String(holding?.valuationStatus || '').toUpperCase());
  const allocationItem = findAllocation(holding, allocation);
  const marketValueVnd = displayableNumber(holding?.reportingMarketValue, state);
  const weightPct = finiteNumber(allocationItem?.weightPct) ? allocationItem.weightPct : null;
  const currentPrice = selectCurrentPrice(holding);

  return {
    id: holding?.id || holding?.assetId || holding?.symbol || null,
    assetId: holding?.assetId || null,
    symbol: holding?.symbol || '—',
    name: holding?.name || 'Tài sản',
    assetType: holding?.assetType || null,
    exchange: holding?.exchange || null,
    quantity: finiteNumber(holding?.quantity) ? holding.quantity : null,
    quantityUnit: holding?.quantityUnit || null,
    currentPrice,
    averageCost: selectAverageCost(holding),
    unrealizedPnl: selectUnrealizedPnl(holding),
    marketValueVnd,
    isApproximateVnd: Boolean(holding?.nativeCurrency && holding.nativeCurrency !== 'VND'),
    weightPct,
    state,
    stateLabel: holdingStatusText(holding, state),
    stateTone: getPortfolioStateTone(state),
    priceAsOf: currentPrice?.asOf || holding?.priceAsOf || holding?.marketUpdatedAt || null,
    valuationReason: holding?.valuationReason || null
  };
}

export function buildPortfolioHoldingsDisplay(snapshot) {
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : [];
  return holdings.map((holding) => buildPortfolioHoldingDisplay(holding, snapshot?.allocation));
}
