import { getHoldings } from './supabase.js';
import { getMarketSnapshot } from './market.js';
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

function fxRateForCurrency(fxRatesMap, currency) {
  if (fxRatesMap instanceof Map) return fxRatesMap.get(currency);
  return fxRatesMap && typeof fxRatesMap === 'object' ? fxRatesMap[currency] : null;
}

/**
 * Pure calculation function for portfolio holdings and aggregate summary.
 *
 * Rules:
 * 1. Native valuation requires a finite positive price and canonical quote currency.
 * 2. VND assets bypass FX; non-VND assets require one valid direct quote-to-VND rate.
 * 3. Legacy marketValue is the authoritative VND reporting value and remains null
 *    when price, currency integrity, or FX provenance is unavailable.
 * 4. Holdings cost basis is stored in VND (authoritative acquisition cost); non-VND
 *    current unrealized P/L evaluates against current reporting market value (native
 *    price converted via current authoritative FX). Missing current price or FX rate
 *    marks valuation and P/L unavailable without mutating historical basis.
 * 5. Aggregates use full precision, include only valid reporting market values,
 *    and expose valuation and P/L coverage independently.
 */
export function calculatePortfolioValuation(profile, holdings, snapshotsMap = {}, fxRatesMap = {}) {
  const cashAvailable = profile ? normalizeNonNegativeFinancialNumber(profile.cash_available) ?? 0 : 0;

  const holdingsWithMarket = (Array.isArray(holdings) ? holdings : []).map((holding) => {
    const quantity = normalizeNonNegativeFinancialNumber(holding.quantity);
    const averageCost = normalizeNonNegativeFinancialNumber(holding.average_cost);

    const symbol = holding.asset?.symbol || null;
    const nativeCurrency = canonicalQuoteCurrency(holding);

    let latestPrice = null;
    let marketValue = null;
    let nativePrice = null;
    let nativeMarketValue = null;
    let reportingMarketValue = null;
    let costBasis = null;
    let unrealizedPnL = null;
    let unrealizedPnLPercent = null;
    let marketUpdatedAt = null;
    let pricingStatus = 'unavailable';
    let valuationStatus = 'unavailable';
    let valuationReason = 'MISSING_NATIVE_PRICE';
    let pnlStatus = 'unavailable';
    let pnlReason = 'MISSING_NATIVE_PRICE';
    let fxRateToReporting = null;
    let fxRateTimestamp = null;
    let fxProvider = null;
    let fxFreshness = null;

    if (quantity === null) {
      valuationReason = 'MALFORMED_HOLDING_QUANTITY';
      pnlReason = 'MALFORMED_HOLDING_QUANTITY';
    } else if (averageCost === null) {
      pnlReason = 'MALFORMED_HOLDING_COST';
    }

    const nativeCostBasis = quantity !== null && averageCost !== null ? quantity * averageCost : null;

    const snapshot = symbol ? snapshotsMap[symbol] : null;
    const hasValidPrice = validPositiveNumber(snapshot?.price);

    if (hasValidPrice) {
      nativePrice = snapshot.price;
      latestPrice = nativePrice;
      marketUpdatedAt = snapshot.priceAsOf || snapshot.updatedAt || null;
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
      pnlReason = averageCost === null ? 'MALFORMED_HOLDING_COST' : 'MISSING_NATIVE_PRICE';
      if (averageCost !== null) {
        costBasis = nativeCostBasis;
      }
    } else if (providerCurrencyMismatch(snapshot, nativeCurrency)) {
      nativePrice = null;
      latestPrice = null;
      marketUpdatedAt = null;
      valuationReason = 'PROVIDER_CURRENCY_MISMATCH';
      pnlReason = averageCost === null ? 'MALFORMED_HOLDING_COST' : 'PROVIDER_CURRENCY_MISMATCH';
      if (averageCost !== null) {
        costBasis = nativeCostBasis;
      }
    } else {
      nativeMarketValue = quantity * nativePrice;

      if (nativeCurrency === REPORTING_CURRENCY) {
        reportingMarketValue = nativeMarketValue;
        marketValue = reportingMarketValue;
        pricingStatus = 'available';
        valuationStatus = 'available';
        valuationReason = null;

        if (averageCost === null) {
          costBasis = null;
          pnlStatus = 'unavailable';
          pnlReason = 'MALFORMED_HOLDING_COST';
        } else {
          costBasis = nativeCostBasis;
          unrealizedPnL = reportingMarketValue - costBasis;
          unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
          pnlStatus = 'available';
          pnlReason = null;
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
          reportingMarketValue = nativeMarketValue * fxRate.rate;
          marketValue = reportingMarketValue;
          pricingStatus = 'available';
          valuationStatus = 'available';
          valuationReason = null;

          if (averageCost === null) {
            costBasis = null;
            pnlStatus = 'unavailable';
            pnlReason = 'MALFORMED_HOLDING_COST';
          } else {
            costBasis = nativeCostBasis;
            unrealizedPnL = reportingMarketValue - costBasis;
            unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
            pnlStatus = 'available';
            pnlReason = null;
          }
        } else {
          reportingMarketValue = null;
          marketValue = null;
          pricingStatus = 'available';
          valuationStatus = 'unavailable';
          valuationReason = fxRate.reason || 'FX_UNAVAILABLE';
          costBasis = averageCost !== null ? nativeCostBasis : null;
          pnlStatus = 'unavailable';
          pnlReason = averageCost === null ? 'MALFORMED_HOLDING_COST' : (fxRate.reason || 'FX_UNAVAILABLE');
        }
      }
    }

    return {
      id: holding.id,
      assetId: holding.asset_id,
      symbol: symbol,
      name: holding.asset?.name || null,
      assetType: holding.asset?.asset_type || null,
      exchange: holding.asset?.exchange || null,
      quantity: quantity,
      averageCost: averageCost,
      costBasis: costBasis,
      latestPrice: latestPrice,
      marketValue: marketValue,
      nativePrice,
      nativeCurrency,
      nativeMarketValue,
      reportingCurrency: REPORTING_CURRENCY,
      reportingMarketValue,
      fxRateToReporting,
      fxRateTimestamp,
      fxProvider,
      fxFreshness,
      unrealizedPnL: unrealizedPnL,
      unrealizedPnLPercent: unrealizedPnLPercent,
      marketUpdatedAt: marketUpdatedAt,
      pricingStatus: pricingStatus,
      valuationStatus,
      valuationReason,
      pnlStatus,
      pnlReason
    };
  });

  // Aggregate totals using full precision
  let totalCostBasis = 0;
  let pricedCostBasis = 0;
  let totalMarketValue = 0;
  let pnlComparableMarketValue = 0;
  let hasUnavailablePricing = false;
  let availablePnlCount = 0;

  for (const item of holdingsWithMarket) {
    if (typeof item.costBasis === 'number') {
      totalCostBasis += item.costBasis;
    }
    if (item.valuationStatus === 'available' && typeof item.reportingMarketValue === 'number') {
      totalMarketValue += item.reportingMarketValue;
    } else {
      hasUnavailablePricing = true;
    }
    if (item.pnlStatus === 'available') {
      pricedCostBasis += item.costBasis;
      pnlComparableMarketValue += item.reportingMarketValue;
      availablePnlCount += 1;
    }
  }

  const totalUnrealizedPnL = pnlComparableMarketValue - pricedCostBasis;
  const totalUnrealizedPnLPercent = pricedCostBasis > 0
    ? (totalUnrealizedPnL / pricedCostBasis) * 100
    : null;

  const totalPortfolioValue = cashAvailable + totalMarketValue;
  const valuationStatus = hasUnavailablePricing ? 'partial' : 'complete';
  const pnlCoverageStatus = holdingsWithMarket.length === 0
    ? 'not_applicable'
    : availablePnlCount === holdingsWithMarket.length
      ? 'complete'
      : availablePnlCount > 0
        ? 'partial'
        : 'unavailable';

  return {
    summary: {
      cashAvailable: cashAvailable,
      reportingCurrency: REPORTING_CURRENCY,
      totalCostBasis: totalCostBasis,
      pricedCostBasis: pricedCostBasis,
      totalMarketValue: totalMarketValue,
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
  getCashOverviewFn = getCashOverview,
  getHoldingsFn = getHoldings,
  getMarketSnapshotFn = getMarketSnapshot,
  getFxRateFn = getFxRate
} = {}) {
  const [cashOverview, holdings] = await Promise.all([
    getCashOverviewFn(),
    getHoldingsFn()
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

  const fxCurrencies = Array.from(new Set(
    (holdings || [])
      .filter((holding) => {
        const currency = canonicalQuoteCurrency(holding);
        const symbol = holding.asset?.symbol;
        const snapshot = typeof symbol === 'string' ? snapshotsMap[symbol] : null;
        return currency
          && currency !== REPORTING_CURRENCY
          && validPositiveNumber(snapshot?.price)
          && !providerCurrencyMismatch(snapshot, currency);
      })
      .map(canonicalQuoteCurrency)
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
    { cash_available: cashOverview.currentCash },
    holdings,
    snapshotsMap,
    fxRatesMap
  );
}
