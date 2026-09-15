import { formatNativeAmount, formatVNDReporting } from './formatting.js';

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

export function buildPortfolioAllocationDisplay(snapshot) {
  const allocation = snapshot?.allocation || {};
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : [];
  const state = normalizedState(allocation?.status || snapshot?.status);
  const concentrationState = normalizedState(allocation?.concentrationStatus, PORTFOLIO_DISPLAY_STATES.NOT_APPLICABLE);
  const totalHoldingsCount = allocation?.totalHoldingsCount ?? holdings.length;
  const pricedHoldingsCount = allocation?.pricedHoldingsCount ?? holdings.filter((h) => ['AVAILABLE', 'STALE'].includes(normalizedState(h?.dataStatus))).length;
  const unpricedHoldingsCount = allocation?.unpricedHoldingsCount ?? (totalHoldingsCount - pricedHoldingsCount);
  const isCashOnly = totalHoldingsCount === 0 && snapshot?.cash?.value !== null && snapshot?.cash?.value !== undefined;
  const isEmpty = totalHoldingsCount === 0 && snapshot?.cash?.value === 0;

  const cashValue = finiteNumber(allocation?.cashValue)
    ? allocation.cashValue
    : (finiteNumber(snapshot?.cash?.value) ? snapshot.cash.value : null);
  const investedMarketValue = finiteNumber(allocation?.pricedHoldingsMarketValue)
    ? allocation.pricedHoldingsMarketValue
    : (finiteNumber(snapshot?.investedMarketValue) ? snapshot.investedMarketValue : 0);
  const totalValue = finiteNumber(snapshot?.totalPortfolioValue)
    ? snapshot.totalPortfolioValue
    : (finiteNumber(allocation?.knownAllocationValue) ? allocation.knownAllocationValue : null);

  let cashWeightPct = null;
  let investedWeightPct = null;
  let top3Concentration = null;
  let largestHolding = null;
  let assetTypeGroups = [];

  if (isCashOnly) {
    cashWeightPct = 100;
    investedWeightPct = 0;
  } else if (!isEmpty && totalValue !== null && totalValue > 0) {
    cashWeightPct = finiteNumber(allocation?.cashWeightPct)
      ? allocation.cashWeightPct
      : (cashValue !== null ? (cashValue / totalValue) * 100 : null);
    investedWeightPct = finiteNumber(allocation?.pricedAssetsWeightPct)
      ? allocation.pricedAssetsWeightPct
      : (investedMarketValue !== null ? (investedMarketValue / totalValue) * 100 : null);
  }

  if (!isCashOnly && !isEmpty && pricedHoldingsCount > 0) {
    // Top-3 concentration: denominator strictly on invested assets only (excluding cash)
    if (finiteNumber(allocation?.top3InvestedWeightPct)) {
      top3Concentration = allocation.top3InvestedWeightPct;
    } else if (investedMarketValue > 0 && Array.isArray(allocation?.holdingAllocations)) {
      const pricedAllocations = allocation.holdingAllocations.filter((h) => h.isPriced && finiteNumber(h.marketValue));
      const top3Sum = pricedAllocations.slice(0, 3).reduce((sum, h) => sum + h.marketValue, 0);
      top3Concentration = (top3Sum / investedMarketValue) * 100;
    }

    if (allocation?.largestHolding) {
      const lh = allocation.largestHolding;
      largestHolding = {
        id: lh.id || lh.assetId,
        assetId: lh.assetId,
        symbol: lh.symbol || '—',
        name: lh.name || 'Tài sản',
        assetType: lh.assetType || null,
        marketValue: finiteNumber(lh.marketValue) ? lh.marketValue : null,
        weightPct: finiteNumber(lh.weightPct) ? lh.weightPct : null,
        investedWeightPct: finiteNumber(lh.investedWeightPct)
          ? lh.investedWeightPct
          : (investedMarketValue > 0 && finiteNumber(lh.marketValue) ? (lh.marketValue / investedMarketValue) * 100 : null)
      };
    }

    if (Array.isArray(allocation?.assetTypeGroups)) {
      assetTypeGroups = allocation.assetTypeGroups.map((g) => ({
        assetType: g.assetType,
        marketValue: finiteNumber(g.marketValue) ? g.marketValue : 0,
        weightPct: finiteNumber(g.weightPct) ? g.weightPct : null,
        holdingCount: g.holdingCount || 0
      }));
    }
  }

  return {
    snapshotId: snapshot?.snapshotId || null,
    state,
    stateLabel: getPortfolioStateLabel(state),
    stateTone: getPortfolioStateTone(state),
    concentrationState,
    isCashOnly,
    isEmpty,
    isPartial: state === PORTFOLIO_DISPLAY_STATES.PARTIAL || unpricedHoldingsCount > 0,
    isStale: state === PORTFOLIO_DISPLAY_STATES.STALE,
    totalHoldingsCount,
    pricedHoldingsCount,
    unpricedHoldingsCount,
    cashValue,
    cashWeightPct,
    investedMarketValue,
    investedWeightPct,
    totalValue,
    top3Concentration,
    largestHolding,
    assetTypeGroups
  };
}

export function formatActivityDate(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(isoString);
  }
}

function formatQuantityNumber(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return Number(val).toLocaleString('vi-VN', { maximumFractionDigits: 6 });
}

function assetUnitLabel(quantityUnit, assetType, symbol) {
  if (quantityUnit) {
    const map = { share: 'cổ phiếu', coin: symbol || 'coin', oz: 'oz', unit: 'đơn vị' };
    return map[quantityUnit] || quantityUnit;
  }
  if (assetType === 'stock') return 'cổ phiếu';
  if (assetType === 'crypto') return symbol || 'coin';
  if (assetType === 'gold') return 'oz';
  return '';
}

function normalizedCurrency(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

export function buildPortfolioTransactionDisplay(transaction = {}) {
  const quantity = finiteNumber(transaction?.quantity) ? transaction.quantity : null;
  const executionUnitPrice = finiteNumber(transaction?.executionUnitPrice)
    && transaction.executionUnitPrice > 0
    ? transaction.executionUnitPrice
    : null;
  const executionCurrency = normalizedCurrency(transaction?.priceCurrency);
  const hasNativeExecutionPrice = executionUnitPrice !== null && executionCurrency !== null;
  const accountingUnitPriceVnd = finiteNumber(transaction?.price) && transaction.price > 0
    ? transaction.price
    : null;
  const executionTotal = hasNativeExecutionPrice && quantity !== null
    ? quantity * executionUnitPrice
    : null;
  const accountingTotalVnd = accountingUnitPriceVnd !== null && quantity !== null
    ? quantity * accountingUnitPriceVnd
    : null;
  const accountingStatus = accountingUnitPriceVnd === null ? 'UNAVAILABLE' : 'AVAILABLE';
  const showAccountingBasis = hasNativeExecutionPrice && executionCurrency !== 'VND'
    ? true
    : accountingUnitPriceVnd !== null && (
      !hasNativeExecutionPrice || executionUnitPrice !== accountingUnitPriceVnd
    );

  return {
    quantity,
    quantityLabel: formatQuantityNumber(quantity),
    hasNativeExecutionPrice,
    executionUnitPrice: hasNativeExecutionPrice ? executionUnitPrice : null,
    executionCurrency: hasNativeExecutionPrice ? executionCurrency : null,
    executionPriceLabel: hasNativeExecutionPrice
      ? formatNativeAmount(executionUnitPrice, executionCurrency, {
        decimals: executionCurrency === 'VND' ? 0 : 8
      })
      : '—',
    executionTotal,
    executionTotalLabel: executionTotal !== null
      ? formatNativeAmount(executionTotal, executionCurrency, {
        decimals: executionCurrency === 'VND' ? 0 : 8
      })
      : '—',
    accountingUnitPriceVnd,
    accountingStatus,
    accountingUnitPriceLabel: accountingUnitPriceVnd !== null
      ? formatVNDReporting(accountingUnitPriceVnd)
      : 'Chưa có tỷ giá quy đổi VND',
    accountingTotalVnd,
    accountingTotalLabel: accountingTotalVnd !== null
      ? formatVNDReporting(accountingTotalVnd)
      : 'Chưa có tỷ giá quy đổi VND',
    showAccountingBasis
  };
}

export function buildPortfolioRecentActivity({ transactions = [], holdings = [], cashLedger = [] } = {}) {
  const events = [];

  // 1. Transactions (BUY / SELL / BUY_REVERSAL / SELL_REVERSAL)
  if (Array.isArray(transactions)) {
    for (const t of transactions) {
      if (!t) continue;
      const isBuy = t.transactionType === 'BUY';
      const isSell = t.transactionType === 'SELL';
      const isBuyReversal = t.transactionType === 'BUY_REVERSAL';
      const isSellReversal = t.transactionType === 'SELL_REVERSAL';
      if (!isBuy && !isSell && !isBuyReversal && !isSellReversal) continue;

      const symbol = t.symbol || 'Tài sản';
      let action = 'Giao dịch';
      if (isBuy) action = 'Mua';
      else if (isSell) action = 'Bán';
      else if (isBuyReversal) action = 'Hoàn tác Mua';
      else if (isSellReversal) action = 'Hoàn tác Bán';

      const effectiveAt = t.executedAt || t.createdAt || null;
      const transactionDisplay = buildPortfolioTransactionDisplay(t);
      const quantityStr = transactionDisplay.quantityLabel;
      const unit = assetUnitLabel(t.quantityUnit, t.assetType, symbol);

      let detail = `${quantityStr}${unit ? ` ${unit}` : ''}`;
      detail += transactionDisplay.hasNativeExecutionPrice
        ? ` · ${transactionDisplay.executionPriceLabel}`
        : ' · Giá thực hiện: —';
      if (transactionDisplay.showAccountingBasis && transactionDisplay.accountingStatus === 'UNAVAILABLE') {
        detail += ' · Hạch toán VND: Chưa có tỷ giá quy đổi VND';
      }

      const isReversedStatus = t.isReversed ? ' (Đã hoàn tác)' : '';

      events.push({
        id: `tx-${t.id || Math.random()}`,
        type: t.transactionType,
        action,
        symbol,
        title: `${action} ${symbol}${isReversedStatus}`,
        detail,
        effectiveAt,
        formattedDate: formatActivityDate(effectiveAt),
        isReversed: Boolean(t.isReversed),
        isReversal: Boolean(t.isReversal || isBuyReversal || isSellReversal)
      });
    }
  }

  // 2. Opening Positions
  if (Array.isArray(holdings)) {
    for (const h of holdings) {
      if (!h || (!h.openingPositionId && !h.opening_position_id && !h.opening_position)) continue;
      const symbol = h.symbol || 'Tài sản';
      const effectiveAt = h.openingPositionUpdatedAt
        || h.opening_position?.updated_at
        || h.updatedAt
        || h.createdAt
        || null;
      const quantityStr = formatQuantityNumber(h.quantity);
      const unit = assetUnitLabel(h.quantityUnit, h.assetType, symbol);

      let costStr = null;
      if (finiteNumber(h.nativeAverageCost) && h.nativeCostCurrency && h.nativeCostCurrency !== 'VND') {
        costStr = `${formatQuantityNumber(h.nativeAverageCost)} ${h.nativeCostCurrency}`;
      } else if (finiteNumber(h.averageCost)) {
        costStr = `${Number(h.averageCost).toLocaleString('vi-VN')} ₫`;
      }

      let detail = `${quantityStr}${unit ? ` ${unit}` : ''}`;
      if (costStr) {
        detail += ` · ${costStr}`;
      }

      events.push({
        id: `op-${h.openingPositionId || h.id || Math.random()}`,
        type: 'OPENING_POSITION',
        action: 'Khai báo vị thế',
        symbol,
        title: `Khai báo vị thế ${symbol}`,
        detail,
        effectiveAt,
        formattedDate: formatActivityDate(effectiveAt)
      });
    }
  }

  // 3. Cash Events (DEPOSIT, WITHDRAWAL, OPENING_BALANCE only - trade movements already in transactions)
  if (Array.isArray(cashLedger)) {
    for (const e of cashLedger) {
      if (!e) continue;
      if (!['DEPOSIT', 'WITHDRAWAL', 'OPENING_BALANCE'].includes(e.entryType)) continue;

      let action = 'Biến động tiền';
      if (e.isReversal) {
        action = e.entryType === 'DEPOSIT' ? 'Hoàn tác rút tiền' : 'Hoàn tác nạp tiền';
      } else if (e.entryType === 'DEPOSIT') {
        action = 'Nạp tiền';
      } else if (e.entryType === 'WITHDRAWAL') {
        action = 'Rút tiền';
      } else if (e.entryType === 'OPENING_BALANCE') {
        action = 'Số dư ban đầu';
      }

      const effectiveAt = e.effectiveAt || e.createdAt || null;
      const sign = e.entryType === 'WITHDRAWAL' ? '−' : '+';
      const amountStr = finiteNumber(e.amount) ? `${sign}${Number(e.amount).toLocaleString('vi-VN')} ₫` : '—';
      const isReversedStatus = e.isReversed ? ' (Đã hoàn tác)' : '';

      events.push({
        id: `cash-${e.id || Math.random()}`,
        type: e.entryType,
        action,
        symbol: 'Tiền mặt',
        title: `${action}${isReversedStatus}`,
        detail: amountStr,
        effectiveAt,
        formattedDate: formatActivityDate(effectiveAt),
        isReversed: Boolean(e.isReversed),
        isReversal: Boolean(e.isReversal)
      });
    }
  }

  // Sort descending by effective date
  events.sort((a, b) => {
    const timeA = a.effectiveAt ? Date.parse(a.effectiveAt) : 0;
    const timeB = b.effectiveAt ? Date.parse(b.effectiveAt) : 0;
    return timeB - timeA;
  });

  // Main Portfolio page shows MAX 5 latest relevant events
  return events.slice(0, 5);
}
