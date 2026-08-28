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
 * 4. Non-VND cost basis and P/L remain unavailable until acquisition-time FX
 *    accounting exists; VND cost basis and P/L retain their established formulas.
 * 5. Aggregates use full precision, include only valid reporting market values,
 *    and expose valuation and P/L coverage independently.
 */
export function calculatePortfolioValuation(profile, holdings, snapshotsMap = {}, fxRatesMap = {}) {
  const cashAvailable = profile && typeof profile.cash_available === 'number' && !isNaN(profile.cash_available) && isFinite(profile.cash_available)
    ? profile.cash_available
    : (typeof profile?.cash_available === 'string' && !isNaN(Number(profile.cash_available)) ? Number(profile.cash_available) : 0);

  const holdingsWithMarket = (Array.isArray(holdings) ? holdings : []).map((holding) => {
    const rawQuantity = holding.quantity;
    const quantity = typeof rawQuantity === 'number' && !isNaN(rawQuantity) && isFinite(rawQuantity)
      ? rawQuantity
      : Number(rawQuantity || 0);

    const rawAvgCost = holding.average_cost;
    const averageCost = typeof rawAvgCost === 'number' && !isNaN(rawAvgCost) && isFinite(rawAvgCost)
      ? rawAvgCost
      : Number(rawAvgCost || 0);

    const nativeCostBasis = quantity * averageCost;
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

    const snapshot = symbol ? snapshotsMap[symbol] : null;
    const hasValidPrice = validPositiveNumber(snapshot?.price);

    if (hasValidPrice) {
      nativePrice = snapshot.price;
      latestPrice = nativePrice;
      marketUpdatedAt = snapshot.priceAsOf || snapshot.updatedAt || null;
    }

    if (!nativeCurrency) {
      valuationReason = 'MISSING_CANONICAL_CURRENCY';
      pnlReason = 'MISSING_CANONICAL_CURRENCY';
    } else if (!hasValidPrice) {
      valuationReason = 'MISSING_NATIVE_PRICE';
      pnlReason = 'MISSING_NATIVE_PRICE';
      if (nativeCurrency === REPORTING_CURRENCY) {
        costBasis = nativeCostBasis;
      }
    } else if (providerCurrencyMismatch(snapshot, nativeCurrency)) {
      nativePrice = null;
      latestPrice = null;
      marketUpdatedAt = null;
      valuationReason = 'PROVIDER_CURRENCY_MISMATCH';
      pnlReason = 'PROVIDER_CURRENCY_MISMATCH';
      if (nativeCurrency === REPORTING_CURRENCY) {
        costBasis = nativeCostBasis;
      }
    } else {
      nativeMarketValue = quantity * nativePrice;

      if (nativeCurrency === REPORTING_CURRENCY) {
        reportingMarketValue = nativeMarketValue;
        marketValue = reportingMarketValue;
        costBasis = nativeCostBasis;
        unrealizedPnL = reportingMarketValue - costBasis;
        unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
        pricingStatus = 'available';
        valuationStatus = 'available';
        valuationReason = null;
        pnlStatus = 'available';
        pnlReason = null;
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
        pnlReason = 'NON_VND_PNL_UNAVAILABLE';

        if (fxRate.availability === 'available') {
          reportingMarketValue = nativeMarketValue * fxRate.rate;
          marketValue = reportingMarketValue;
          pricingStatus = 'available';
          valuationStatus = 'available';
          valuationReason = null;
        } else {
          valuationReason = fxRate.reason || 'FX_UNAVAILABLE';
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
