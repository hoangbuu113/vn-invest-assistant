import { getHoldings } from './supabase.js';
import { getMarketRealtime, getMarketSnapshot } from './market.js';
import { getCashOverview } from './cash.js';
import {
  createUnavailableFxRate,
  getFxRate,
  normalizeFxRate,
  REPORTING_CURRENCY
} from './fx.js';

const CANONICAL_CURRENCY_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;

function canonicalQuoteCurrency(holding) {
  const value = holding?.asset?.quote_currency ?? holding?.asset?.quoteCurrency;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return CANONICAL_CURRENCY_PATTERN.test(normalized) ? normalized : null;
}

function validPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeNonNegativeFinancialNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function providerCurrencyMismatch(snapshot, canonicalCurrency) {
  if (!snapshot || snapshot.currency === null || snapshot.currency === undefined) return false;
  if (typeof snapshot.currency !== 'string' || !snapshot.currency.trim()) return true;
  return snapshot.currency.trim().toUpperCase() !== canonicalCurrency;
}

function snapshotPriceIsStale(snapshot) {
  return snapshot?.freshness === 'stale' || snapshot?.cacheStatus === 'stale';
}

function fxRateForCurrency(fxRatesMap, currency) {
  if (fxRatesMap instanceof Map) return fxRatesMap.get(currency);
  return fxRatesMap && typeof fxRatesMap === 'object' ? fxRatesMap[currency] : null;
}

function priceReferenceForSymbol(priceReferencesMap, symbol) {
  if (priceReferencesMap instanceof Map) return priceReferencesMap.get(symbol);
  return priceReferencesMap && typeof priceReferencesMap === 'object' ? priceReferencesMap[symbol] : null;
}

function normalizeCurrency(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return CANONICAL_CURRENCY_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Pure calculation function for portfolio holdings and aggregate summary.
 *
 * Rules:
 * 1. Native valuation requires a finite positive price and canonical quote currency.
 * 2. VND assets bypass FX; non-VND assets require one valid direct quote-to-VND rate.
 * 3. Legacy marketValue is the authoritative VND reporting value and remains null
 *    when price, currency integrity, or FX provenance is unavailable.
 * 4. Holdings VND cost basis is optional authoritative acquisition cost. Native
 *    opening cost may support same-currency P/L independently; current FX never
 *    backfills a missing historical VND basis.
 * 5. Aggregates use full precision, include only valid reporting market values,
 *    and expose valuation and P/L coverage independently.
 */
export function calculatePortfolioValuation(
  profile,
  holdings,
  snapshotsMap = {},
  fxRatesMap = {},
  nativePriceReferencesMap = {}
) {
  const cashAvailable = profile ? normalizeNonNegativeFinancialNumber(profile.cash_available) : null;
  const cashStatus = cashAvailable === null ? 'unavailable' : 'available';

  const holdingsWithMarket = (Array.isArray(holdings) ? holdings : []).map((holding) => {
    const quantity = normalizeNonNegativeFinancialNumber(holding.quantity);
    const rawAverageCost = holding.average_cost;
    const averageCost = normalizeNonNegativeFinancialNumber(rawAverageCost);
    const vndCostUnavailableReason = rawAverageCost === null || rawAverageCost === undefined
      ? 'VND_COST_BASIS_UNKNOWN'
      : 'MALFORMED_HOLDING_COST';

    const symbol = holding.asset?.symbol || null;
    const canonicalCurrency = canonicalQuoteCurrency(holding);
    const openingPosition = holding.opening_position ?? holding.openingPosition ?? null;
    const openingIsUnmodified = Boolean(
      openingPosition
      && !(openingPosition.locked_at || openingPosition.lockedAt)
      && !(openingPosition.cancelled_at || openingPosition.cancelledAt)
    );
    const persistedNativeAverageCost = normalizeNonNegativeFinancialNumber(
      holding.native_average_cost ?? holding.nativeAverageCost
    );
    const persistedNativeCostCurrency = normalizeCurrency(
      holding.native_cost_currency ?? holding.nativeCostCurrency
    );
    const nativeAverageCost = persistedNativeAverageCost ?? (openingIsUnmodified
      ? normalizeNonNegativeFinancialNumber(
          openingPosition.execution_unit_price
          ?? openingPosition.executionUnitPrice
          ?? openingPosition.native_average_cost
          ?? openingPosition.nativeAverageCost
        )
      : null);
    const nativeCostCurrency = persistedNativeCostCurrency ?? (openingIsUnmodified
      ? normalizeCurrency(
          openingPosition.price_currency
          ?? openingPosition.priceCurrency
          ?? openingPosition.native_cost_currency
          ?? openingPosition.nativeCostCurrency
        )
      : null);
    const nativeCurrency = nativeAverageCost !== null && nativeCostCurrency
      ? nativeCostCurrency
      : canonicalCurrency;

    let latestPrice = null;
    let marketValue = null;
    let nativePrice = null;
    let nativeMarketValue = null;
    let reportingMarketValue = null;
    let costBasis = null;
    let unrealizedPnL = null;
    let unrealizedPnLPercent = null;
    let marketUpdatedAt = null;
    let marketProvider = null;
    let marketFreshness = null;
    let marketCacheStatus = null;
    let pricingStatus = 'unavailable';
    let valuationStatus = 'unavailable';
    let valuationReason = 'MISSING_NATIVE_PRICE';
    let pnlStatus = 'unavailable';
    let pnlReason = 'MISSING_NATIVE_PRICE';
    let fxRateToReporting = null;
    let fxRateTimestamp = null;
    let fxProvider = null;
    let fxFreshness = null;
    let nativeCurrentPrice = null;
    let nativeCurrentPriceAsOf = null;
    let nativeCurrentPriceSource = null;
    let nativeCurrentPriceFreshness = null;
    const nativeAcquisitionCostBasis = quantity !== null && nativeAverageCost !== null
      ? quantity * nativeAverageCost
      : null;
    let nativeUnrealizedPnL = null;
    let nativeUnrealizedPnLPercent = null;
    let nativePnlStatus = 'unavailable';
    let nativePnlReason = nativeAverageCost === null || !nativeCostCurrency
      ? 'NATIVE_COST_BASIS_UNAVAILABLE'
      : 'MISSING_SAME_CURRENCY_PRICE';

    if (quantity === null) {
      valuationReason = 'MALFORMED_HOLDING_QUANTITY';
      pnlReason = 'MALFORMED_HOLDING_QUANTITY';
    } else if (averageCost === null) {
      pnlReason = vndCostUnavailableReason;
    }

    const nativeCostBasis = quantity !== null && averageCost !== null ? quantity * averageCost : null;

    const canonicalSnapshot = symbol ? snapshotsMap[symbol] : null;
    const nativeReference = symbol ? priceReferenceForSymbol(nativePriceReferencesMap, symbol) : null;
    const snapshot = validPositiveNumber(nativeReference?.price)
      && normalizeCurrency(nativeReference?.currency) === nativeCurrency
      ? nativeReference
      : canonicalSnapshot;
    const hasValidPrice = validPositiveNumber(snapshot?.price);

    if (hasValidPrice) {
      nativePrice = snapshot.price;
      latestPrice = nativePrice;
      marketUpdatedAt = snapshot.priceAsOf || snapshot.updatedAt || null;
      marketProvider = snapshot.source || snapshot.provider || null;
      marketFreshness = snapshot.freshness || null;
      marketCacheStatus = snapshot.cacheStatus || null;
    }

    const sameCurrencySnapshot = hasValidPrice
      && normalizeCurrency(snapshot?.currency) === nativeCostCurrency
      ? snapshot
      : null;
    const sameCurrencyReference = validPositiveNumber(nativeReference?.price)
      && normalizeCurrency(nativeReference?.currency) === nativeCostCurrency
      ? nativeReference
      : null;
    const acquisitionPriceSource = sameCurrencySnapshot || sameCurrencyReference;

    if (quantity !== null && nativeAcquisitionCostBasis !== null && acquisitionPriceSource) {
      nativeCurrentPrice = acquisitionPriceSource.price;
      nativeCurrentPriceAsOf = acquisitionPriceSource.priceAsOf
        || acquisitionPriceSource.observedAt
        || acquisitionPriceSource.updatedAt
        || null;
      nativeCurrentPriceSource = acquisitionPriceSource.source || acquisitionPriceSource.provider || null;
      nativeCurrentPriceFreshness = acquisitionPriceSource.freshness || acquisitionPriceSource.cacheStatus || null;
      nativeUnrealizedPnL = (nativeCurrentPrice * quantity) - nativeAcquisitionCostBasis;
      nativeUnrealizedPnLPercent = nativeAcquisitionCostBasis > 0
        ? (nativeUnrealizedPnL / nativeAcquisitionCostBasis) * 100
        : null;
      const nativeIsStale = nativeCurrentPriceFreshness === 'stale';
      nativePnlStatus = nativeIsStale ? 'stale' : 'available';
      nativePnlReason = nativeIsStale ? 'STALE_NATIVE_PRICE' : null;
    }

    if (quantity === null) {
      pricingStatus = hasValidPrice ? 'available' : 'unavailable';
      valuationStatus = 'unavailable';
      valuationReason = 'MALFORMED_HOLDING_QUANTITY';
      pnlStatus = 'unavailable';
      pnlReason = 'MALFORMED_HOLDING_QUANTITY';
      costBasis = null;
    } else if (!nativeCurrency) {
      valuationReason = 'MISSING_CANONICAL_CURRENCY';
      pnlReason = 'MISSING_CANONICAL_CURRENCY';
    } else if (!hasValidPrice) {
      valuationReason = 'MISSING_NATIVE_PRICE';
      pnlReason = averageCost === null ? vndCostUnavailableReason : 'MISSING_NATIVE_PRICE';
      if (averageCost !== null) {
        costBasis = nativeCostBasis;
      }
    } else if (providerCurrencyMismatch(snapshot, nativeCurrency)) {
      nativePrice = null;
      latestPrice = null;
      marketUpdatedAt = null;
      valuationReason = 'PROVIDER_CURRENCY_MISMATCH';
      pnlReason = averageCost === null ? vndCostUnavailableReason : 'PROVIDER_CURRENCY_MISMATCH';
      if (averageCost !== null) {
        costBasis = nativeCostBasis;
      }
    } else {
      nativeMarketValue = quantity * nativePrice;

      if (nativeCurrency === REPORTING_CURRENCY) {
        const isStale = snapshotPriceIsStale(snapshot);
        reportingMarketValue = nativeMarketValue;
        marketValue = reportingMarketValue;
        pricingStatus = isStale ? 'stale' : 'available';
        valuationStatus = isStale ? 'stale' : 'available';
        valuationReason = isStale ? 'STALE_MARKET_PRICE' : null;

        if (averageCost === null) {
          costBasis = null;
          pnlStatus = 'unavailable';
          pnlReason = vndCostUnavailableReason;
        } else {
          costBasis = nativeCostBasis;
          unrealizedPnL = reportingMarketValue - costBasis;
          unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
          pnlStatus = isStale ? 'stale' : 'available';
          pnlReason = isStale ? 'STALE_MARKET_PRICE' : null;
        }
      } else {
        const fxRate = normalizeFxRate(
          fxRateForCurrency(fxRatesMap, nativeCurrency),
          nativeCurrency,
          REPORTING_CURRENCY
        );
        fxRateToReporting = fxRate.rate;
        fxRateTimestamp = fxRate.sourceTimestamp;
        fxProvider = fxRate.provider;
        fxFreshness = fxRate.freshness;

        if (fxRate.availability === 'available') {
          const isStale = snapshotPriceIsStale(snapshot) || fxRate.freshness === 'stale';
          reportingMarketValue = nativeMarketValue * fxRate.rate;
          marketValue = reportingMarketValue;
          pricingStatus = isStale ? 'stale' : 'available';
          valuationStatus = isStale ? 'stale' : 'available';
          valuationReason = isStale ? 'STALE_PRICE_OR_FX' : null;

          if (averageCost === null) {
            costBasis = null;
            pnlStatus = 'unavailable';
            pnlReason = vndCostUnavailableReason;
          } else {
            costBasis = nativeCostBasis;
            unrealizedPnL = reportingMarketValue - costBasis;
            unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
            pnlStatus = isStale ? 'stale' : 'available';
            pnlReason = isStale ? 'STALE_PRICE_OR_FX' : null;
          }
        } else {
          reportingMarketValue = null;
          marketValue = null;
          pricingStatus = 'available';
          valuationStatus = 'unavailable';
          valuationReason = fxRate.reason || 'FX_UNAVAILABLE';
          costBasis = averageCost !== null ? nativeCostBasis : null;
          pnlStatus = 'unavailable';
          pnlReason = averageCost === null ? vndCostUnavailableReason : (fxRate.reason || 'FX_UNAVAILABLE');
        }
      }
    }

    return {
      id: holding.id,
      assetId: holding.asset_id,
      openingPositionId: holding.opening_position_id || holding.openingPositionId || null,
      symbol: symbol,
      name: holding.asset?.name || null,
      assetType: holding.asset?.asset_type || null,
      exchange: holding.asset?.exchange || null,
      quantityUnit: holding.asset?.quantity_unit || holding.asset?.quantityUnit || null,
      quantity: quantity,
      averageCost: averageCost,
      costBasis: costBasis,
      latestPrice: latestPrice,
      marketValue: marketValue,
      nativePrice,
      nativeCurrency,
      nativeMarketValue,
      nativeAverageCost,
      nativeCostCurrency,
      nativeCostBasis: nativeAcquisitionCostBasis,
      nativeCurrentPrice,
      nativeCurrentPriceAsOf,
      nativeCurrentPriceSource,
      nativeCurrentPriceFreshness,
      nativeUnrealizedPnL,
      nativeUnrealizedPnLPercent,
      nativePnlStatus,
      nativePnlReason,
      reportingCurrency: REPORTING_CURRENCY,
      reportingMarketValue,
      fxRateToReporting,
      fxRateTimestamp,
      fxProvider,
      fxFreshness,
      unrealizedPnL: unrealizedPnL,
      unrealizedPnLPercent: unrealizedPnLPercent,
      marketUpdatedAt: marketUpdatedAt,
      marketProvider,
      marketFreshness,
      marketCacheStatus,
      pricingStatus: pricingStatus,
      valuationStatus,
      valuationReason,
      pnlStatus,
      pnlReason,
      holdingUpdatedAt: holding.updated_at || holding.updatedAt || null,
      openingPositionUpdatedAt: openingPosition?.updated_at || openingPosition?.updatedAt || null
    };
  });

  // Aggregate totals using full precision
  let totalCostBasis = 0;
  let pricedCostBasis = 0;
  let totalMarketValue = 0;
  let valuedHoldingsCount = 0;
  let pnlComparableMarketValue = 0;
  let hasUnavailablePricing = false;
  let hasStalePricing = false;
  let comparablePnlCount = 0;
  let hasStalePnl = false;
  let hasUnknownCostBasis = false;

  for (const item of holdingsWithMarket) {
    if (typeof item.costBasis === 'number') {
      totalCostBasis += item.costBasis;
    } else {
      hasUnknownCostBasis = true;
    }
    if (['available', 'stale'].includes(item.valuationStatus) && typeof item.reportingMarketValue === 'number') {
      totalMarketValue += item.reportingMarketValue;
      valuedHoldingsCount += 1;
      if (item.valuationStatus === 'stale') hasStalePricing = true;
    } else {
      hasUnavailablePricing = true;
    }
    if (['available', 'stale'].includes(item.pnlStatus)) {
      pricedCostBasis += item.costBasis;
      pnlComparableMarketValue += item.reportingMarketValue;
      comparablePnlCount += 1;
      if (item.pnlStatus === 'stale') hasStalePnl = true;
    }
  }

  const totalUnrealizedPnL = comparablePnlCount > 0
    ? pnlComparableMarketValue - pricedCostBasis
    : holdingsWithMarket.length === 0
      ? 0
      : null;
  const totalUnrealizedPnLPercent = pricedCostBasis > 0
    ? (totalUnrealizedPnL / pricedCostBasis) * 100
    : null;

  const investedMarketValue = holdingsWithMarket.length > 0 && valuedHoldingsCount === 0
    ? null
    : totalMarketValue;
  const totalPortfolioValue = cashStatus === 'available' && investedMarketValue !== null
    ? cashAvailable + investedMarketValue
    : null;
  const valuationStatus = cashStatus === 'unavailable' || hasUnavailablePricing
    ? 'partial'
    : hasStalePricing
      ? 'stale'
      : 'complete';
  const pnlCoverageStatus = holdingsWithMarket.length === 0
    ? 'not_applicable'
    : comparablePnlCount === holdingsWithMarket.length
      ? (hasStalePnl ? 'stale' : 'complete')
      : comparablePnlCount > 0
        ? 'partial'
        : 'unavailable';

  return {
    summary: {
      cashAvailable: cashAvailable,
      cashStatus,
      cashReason: cashStatus === 'available' ? null : 'AUTHORITATIVE_CASH_UNAVAILABLE',
      cashLedgerEntryCount: Number.isInteger(profile?.cash_ledger_entry_count)
        && profile.cash_ledger_entry_count >= 0
        ? profile.cash_ledger_entry_count
        : null,
      cashLedgerStartAt: profile?.cash_ledger_start_at || null,
      reportingCurrency: REPORTING_CURRENCY,
      totalCostBasis: hasUnknownCostBasis ? null : totalCostBasis,
      costBasisStatus: holdingsWithMarket.length === 0
        ? 'not_applicable'
        : hasUnknownCostBasis
          ? (totalCostBasis > 0 ? 'partial' : 'unavailable')
          : 'complete',
      pricedCostBasis: pricedCostBasis,
      totalMarketValue: investedMarketValue,
      totalUnrealizedPnL: totalUnrealizedPnL,
      totalUnrealizedPnLPercent: totalUnrealizedPnLPercent,
      totalPortfolioValue: totalPortfolioValue,
      valuationStatus: valuationStatus,
      pnlCoverageStatus
    },
    holdings: holdingsWithMarket
  };
}

/**
 * Calculates and returns a deterministic portfolio overview.
 * Combines ledger-authoritative cash, holdings, and delayed market prices without
 * mutating or persisting derived metrics.
 */
export async function getPortfolioOverview({
  profileId,
  getCashOverviewFn = getCashOverview,
  getHoldingsFn = getHoldings,
  getMarketSnapshotFn = getMarketSnapshot,
  getMarketRealtimeFn = getMarketRealtime,
  getFxRateFn = getFxRate
} = {}) {
  const [cashOverview, holdings] = await Promise.all([
    Promise.resolve()
      .then(() => getCashOverviewFn(undefined, profileId ? { profileId } : {}))
      .catch(() => null),
    getHoldingsFn(undefined, profileId ? { profileId } : {})
  ]);

  // Collect unique symbols
  const symbols = Array.from(new Set(
    (holdings || [])
      .map((h) => h.asset?.symbol)
      .filter((sym) => typeof sym === 'string' && sym.trim().length > 0)
  ));

  // Fetch market quotes concurrently
  const snapshotsEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const snapshot = await getMarketSnapshotFn(symbol);
        return [symbol, snapshot];
      } catch {
        return [symbol, null];
      }
    })
  );

  const snapshotsMap = Object.fromEntries(snapshotsEntries);

  // Binance USDT is an exact native current-price source for holdings whose
  // persisted acquisition-cost currency is USDT. It never substitutes USD.
  const nativeReferenceSymbols = Array.from(new Set(
    (holdings || [])
      .filter((holding) => {
        const opening = holding.opening_position;
        const persistedCurrency = normalizeCurrency(
          holding.native_cost_currency ?? holding.nativeCostCurrency
        );
        return persistedCurrency === 'USDT' || (
          opening
          && !opening.locked_at
          && !opening.cancelled_at
          && normalizeCurrency(opening.price_currency) === 'USDT'
        );
      })
      .map((holding) => holding.asset?.symbol)
      .filter((symbol) => typeof symbol === 'string' && symbol.trim())
  ));
  const nativeReferenceEntries = await Promise.all(
    nativeReferenceSymbols.map(async (symbol) => {
      try {
        return [symbol, await getMarketRealtimeFn(symbol)];
      } catch {
        return [symbol, null];
      }
    })
  );
  const nativePriceReferencesMap = Object.fromEntries(nativeReferenceEntries);

  const fxCurrencies = Array.from(new Set(
    (holdings || [])
      .filter((holding) => {
        const persistedNativeAverage = normalizeNonNegativeFinancialNumber(
          holding.native_average_cost ?? holding.nativeAverageCost
        );
        const persistedNativeCurrency = normalizeCurrency(
          holding.native_cost_currency ?? holding.nativeCostCurrency
        );
        const opening = holding.opening_position ?? holding.openingPosition;
        const openingNativeCurrency = opening && !(opening.locked_at || opening.lockedAt)
          && !(opening.cancelled_at || opening.cancelledAt)
          && normalizeNonNegativeFinancialNumber(
            opening.execution_unit_price ?? opening.executionUnitPrice
          ) !== null
          ? normalizeCurrency(opening.price_currency ?? opening.priceCurrency)
          : null;
        const currency = persistedNativeAverage !== null && persistedNativeCurrency
          ? persistedNativeCurrency
          : openingNativeCurrency || canonicalQuoteCurrency(holding);
        const symbol = holding.asset?.symbol;
        const canonicalSnapshot = typeof symbol === 'string' ? snapshotsMap[symbol] : null;
        const nativeReference = typeof symbol === 'string' ? nativePriceReferencesMap[symbol] : null;
        const hasCompatiblePrice = (
          validPositiveNumber(nativeReference?.price)
          && normalizeCurrency(nativeReference?.currency) === currency
        ) || (
          validPositiveNumber(canonicalSnapshot?.price)
          && normalizeCurrency(canonicalSnapshot?.currency) === currency
        );
        return currency && currency !== REPORTING_CURRENCY && hasCompatiblePrice;
      })
      .map((holding) => {
        const persistedNativeAverage = normalizeNonNegativeFinancialNumber(
          holding.native_average_cost ?? holding.nativeAverageCost
        );
        const persistedNativeCurrency = normalizeCurrency(
          holding.native_cost_currency ?? holding.nativeCostCurrency
        );
        const opening = holding.opening_position ?? holding.openingPosition;
        const openingNativeCurrency = opening && !(opening.locked_at || opening.lockedAt)
          && !(opening.cancelled_at || opening.cancelledAt)
          && normalizeNonNegativeFinancialNumber(
            opening.execution_unit_price ?? opening.executionUnitPrice
          ) !== null
          ? normalizeCurrency(opening.price_currency ?? opening.priceCurrency)
          : null;
        return persistedNativeAverage !== null && persistedNativeCurrency
          ? persistedNativeCurrency
          : openingNativeCurrency || canonicalQuoteCurrency(holding);
      })
  ));

  const fxRateEntries = await Promise.all(
    fxCurrencies.map(async (currency) => {
      try {
        return [currency, await getFxRateFn(currency, REPORTING_CURRENCY)];
      } catch {
        return [currency, createUnavailableFxRate(
          currency,
          REPORTING_CURRENCY,
          'FX_RESOLUTION_FAILED'
        )];
      }
    })
  );

  const fxRatesMap = Object.fromEntries(fxRateEntries);

  return calculatePortfolioValuation(
    {
      cash_available: cashOverview?.currentCash ?? null,
      cash_ledger_entry_count: cashOverview?.entryCount ?? null,
      cash_ledger_start_at: cashOverview?.ledgerStartAt ?? null
    },
    holdings,
    snapshotsMap,
    fxRatesMap,
    nativePriceReferencesMap
  );
}
