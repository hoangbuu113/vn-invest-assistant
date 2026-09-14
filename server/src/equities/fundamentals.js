import { getAssetById, getAssetBySymbol } from '../supabase.js';
import {
  buildFundamentalsResponse,
  createManualFundamentalFiling,
  parseFundamentalsAsOf
} from './fundamentalsModel.js';
import {
  fetchFundamentalFilings,
  persistManualFundamentalFiling
} from './fundamentalsRepository.js';

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateRevision(previous, next, filings) {
  if (!next.supersedesFilingId) return;
  if (!previous) {
    throw serviceError(
      'FUNDAMENTALS_SUPERSEDED_FILING_NOT_FOUND',
      'The superseded filing does not exist',
      409
    );
  }
  const sameIdentity = previous.assetId === next.assetId
    && previous.statementScope === next.statementScope
    && previous.periodKind === next.periodKind
    && previous.periodStart === next.periodStart
    && previous.periodEnd === next.periodEnd
    && previous.fiscalYear === next.fiscalYear
    && previous.fiscalQuarter === next.fiscalQuarter;
  if (!sameIdentity || next.revisionNumber !== previous.revisionNumber + 1) {
    throw serviceError(
      'FUNDAMENTALS_REVISION_CONFLICT',
      'A correction must preserve the filing period and increment revisionNumber by one',
      409
    );
  }
  if (filings.some((filing) => filing.supersedesFilingId === previous.id)) {
    throw serviceError(
      'FUNDAMENTALS_REVISION_CONFLICT',
      'The superseded filing already has a correction',
      409
    );
  }
}

export async function ingestManualOfficialFundamentalFiling(payload, {
  client,
  now = new Date(),
  getAssetByIdFn = getAssetById,
  fetchFilingsFn = fetchFundamentalFilings,
  persistFilingFn = persistManualFundamentalFiling,
  idFactory
} = {}) {
  const assetId = typeof payload?.assetId === 'string' ? payload.assetId.trim() : '';
  if (!assetId) {
    throw serviceError('INVALID_FUNDAMENTALS_FILING', 'assetId is required', 400);
  }
  const asset = await getAssetByIdFn(assetId, client);
  if (!asset) throw serviceError('ASSET_NOT_FOUND', 'Asset does not exist', 404);

  const filing = createManualFundamentalFiling(payload, { asset, now, idFactory });
  const existing = await fetchFilingsFn(filing.assetId, client);
  const previous = filing.supersedesFilingId
    ? existing.find((item) => item.id === filing.supersedesFilingId)
    : null;
  validateRevision(previous, filing, existing);
  await persistFilingFn(filing, client);

  return Object.freeze({
    filingId: filing.id,
    assetId: filing.assetId,
    ticker: filing.ticker,
    identityHash: filing.identityHash,
    verificationStatus: filing.verificationStatus,
    revisionNumber: filing.revisionNumber,
    supersedesFilingId: filing.supersedesFilingId,
    systemKnowableAt: filing.systemKnowableAt,
    factCount: filing.facts.length
  });
}

export async function getEquityFundamentals(symbol, {
  client,
  now = new Date(),
  asOf,
  sourceProvisioned = true,
  getAssetBySymbolFn = getAssetBySymbol,
  fetchFilingsFn = fetchFundamentalFilings
} = {}) {
  if (typeof symbol !== 'string' || !symbol.trim()) {
    throw serviceError('INVALID_EQUITY_SYMBOL', 'Equity symbol is required', 400);
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw serviceError('INVALID_TIME_CONTEXT', 'A valid current time is required', 400);
  }
  const normalizedSymbol = symbol.trim().toUpperCase();
  const asset = await getAssetBySymbolFn(normalizedSymbol, client);
  if (!asset) {
    throw serviceError('ASSET_NOT_FOUND', `Asset '${normalizedSymbol}' not found`, 404);
  }

  const effectiveAsOf = parseFundamentalsAsOf(asOf, now);
  const eligibleEquity = (asset.assetType ?? asset.asset_type) === 'stock'
    && (asset.marketPolicy ?? asset.market_policy) === 'VN_EXCHANGE';
  const companyType = String(
    asset.fundamentalsCompanyType ?? asset.fundamentals_company_type ?? ''
  ).trim().toUpperCase();
  const filings = eligibleEquity && companyType === 'INDUSTRIAL'
    ? await fetchFilingsFn(asset.id, client)
    : [];
  return buildFundamentalsResponse(asset, filings, {
    asOf: effectiveAsOf,
    sourceProvisioned
  });
}
