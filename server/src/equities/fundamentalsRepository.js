import { privateSupabase } from '../supabase.js';

const memoryFilings = new Map();
const memoryIdentityHashes = new Map();

function repositoryError(code, message, status = 503, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (cause) error.cause = cause;
  return error;
}

export function fundamentalFilingToRpc(filing) {
  return {
    id: filing.id,
    filing_identity_hash: filing.identityHash,
    asset_id: filing.assetId,
    ticker: filing.ticker,
    issuer_legal_name: filing.issuerLegalName,
    exchange: filing.exchange,
    company_type: filing.companyType,
    source_authority: filing.sourceAuthority,
    source_url: filing.sourceUrl,
    source_disclosure_id: filing.sourceDisclosureId,
    source_title: filing.sourceTitle,
    published_at: filing.publishedAt,
    source_available_at: filing.sourceAvailableAt,
    fetched_at: filing.fetchedAt,
    recorded_at: filing.recordedAt,
    first_seen_at: filing.firstSeenAt,
    system_knowable_at: filing.systemKnowableAt,
    statement_scope: filing.statementScope,
    audit_status: filing.auditStatus,
    accounting_regime: filing.accountingRegime,
    fiscal_year: filing.fiscalYear,
    fiscal_quarter: filing.fiscalQuarter,
    period_start: filing.periodStart,
    period_end: filing.periodEnd,
    period_kind: filing.periodKind,
    revision_number: filing.revisionNumber,
    supersedes_filing_id: filing.supersedesFilingId,
    document_hash: filing.documentHash,
    verification_status: filing.verificationStatus,
    methodology_version: filing.methodologyVersion
  };
}

export function fundamentalFactToRpc(fact) {
  return {
    id: fact.id,
    metric_code: fact.metricCode,
    source_line_code: fact.sourceLineCode,
    source_label: fact.sourceLabel,
    numeric_value: fact.numericValue,
    currency_code: fact.currencyCode,
    unit_scale: fact.unitScale,
    source_page: fact.sourcePage,
    source_sheet: fact.sourceSheet,
    source_cell: fact.sourceCell,
    value_kind: fact.valueKind,
    derivation_formula: fact.derivationFormula,
    confidence: fact.confidence,
    validation_status: fact.validationStatus,
    missing_reason: fact.missingReason
  };
}

function decimalText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function rowToFundamentalFact(row) {
  return Object.freeze({
    id: row.id,
    filingId: row.filing_id,
    metricCode: row.metric_code,
    sourceLineCode: row.source_line_code || null,
    sourceLabel: row.source_label,
    numericValue: decimalText(row.numeric_value),
    currencyCode: row.currency_code,
    unitScale: Number(row.unit_scale),
    sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
    sourceSheet: row.source_sheet || null,
    sourceCell: row.source_cell || null,
    valueKind: row.value_kind,
    derivationFormula: row.derivation_formula || null,
    confidence: Number(row.confidence),
    validationStatus: row.validation_status,
    missingReason: row.missing_reason || null
  });
}

export function rowToFundamentalFiling(row) {
  if (!row || typeof row !== 'object') return null;
  const firstSeenAt = new Date(row.first_seen_at).toISOString();
  const sourceAvailableAt = new Date(row.source_available_at).toISOString();
  const systemKnowableAt = new Date(Math.max(
    Date.parse(firstSeenAt),
    Date.parse(sourceAvailableAt)
  )).toISOString();
  const facts = Array.isArray(row.facts)
    ? row.facts.map(rowToFundamentalFact)
    : [];
  return Object.freeze({
    id: row.id,
    identityHash: row.filing_identity_hash,
    assetId: row.asset_id,
    ticker: row.ticker,
    issuerLegalName: row.issuer_legal_name,
    exchange: row.exchange,
    companyType: row.company_type,
    sourceAuthority: row.source_authority,
    sourceUrl: row.source_url,
    sourceDisclosureId: row.source_disclosure_id || null,
    sourceTitle: row.source_title,
    publishedAt: new Date(row.published_at).toISOString(),
    sourceAvailableAt,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null,
    recordedAt: new Date(row.recorded_at).toISOString(),
    firstSeenAt,
    systemKnowableAt,
    statementScope: row.statement_scope,
    auditStatus: row.audit_status,
    accountingRegime: row.accounting_regime || null,
    fiscalYear: Number(row.fiscal_year),
    fiscalQuarter: row.fiscal_quarter === null || row.fiscal_quarter === undefined
      ? null
      : Number(row.fiscal_quarter),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodKind: row.period_kind,
    revisionNumber: Number(row.revision_number),
    supersedesFilingId: row.supersedes_filing_id || null,
    documentHash: row.document_hash || null,
    verificationStatus: row.verification_status,
    methodologyVersion: row.methodology_version,
    facts: Object.freeze(facts)
  });
}

function immutableMemoryInsert(filing) {
  if (memoryFilings.has(filing.id) || memoryIdentityHashes.has(filing.identityHash)) {
    throw repositoryError('DUPLICATE_FUNDAMENTALS_FILING', 'This immutable filing already exists', 409);
  }
  if (filing.supersedesFilingId) {
    const previous = memoryFilings.get(filing.supersedesFilingId);
    if (!previous) {
      throw repositoryError('FUNDAMENTALS_SUPERSEDED_FILING_NOT_FOUND', 'The superseded filing does not exist', 409);
    }
    if (Array.from(memoryFilings.values()).some((item) => item.supersedesFilingId === previous.id)) {
      throw repositoryError('FUNDAMENTALS_REVISION_CONFLICT', 'The superseded filing already has a correction', 409);
    }
  }
  memoryFilings.set(filing.id, filing);
  memoryIdentityHashes.set(filing.identityHash, filing.id);
  return filing;
}

export async function persistManualFundamentalFiling(filing, client = privateSupabase) {
  if (!filing) throw repositoryError('INVALID_FUNDAMENTALS_FILING', 'A filing is required', 400);
  if (client === null) return immutableMemoryInsert(filing);
  if (!client || typeof client.rpc !== 'function') {
    throw repositoryError('FUNDAMENTALS_STORAGE_UNAVAILABLE', 'Fundamentals persistence is unavailable');
  }

  const { data, error } = await client.rpc('insert_vn_equity_fundamental_filing', {
    p_filing: fundamentalFilingToRpc(filing),
    p_facts: filing.facts.map(fundamentalFactToRpc)
  });
  if (error) {
    if (error.code === '23505') {
      throw repositoryError('DUPLICATE_FUNDAMENTALS_FILING', 'This immutable filing already exists', 409, error);
    }
    if (error.code === 'VF001') {
      throw repositoryError('FUNDAMENTALS_SUPERSEDED_FILING_NOT_FOUND', 'The superseded filing does not exist', 409, error);
    }
    if (error.code === 'VF002') {
      throw repositoryError('FUNDAMENTALS_REVISION_CONFLICT', 'The filing revision chain is invalid', 409, error);
    }
    throw repositoryError('FUNDAMENTALS_PERSISTENCE_FAILED', 'The official filing was not persisted', 503, error);
  }
  if (data !== filing.id) {
    throw repositoryError('FUNDAMENTALS_PERSISTENCE_FAILED', 'The official filing persistence result was invalid');
  }
  return filing;
}

export async function fetchFundamentalFilings(assetId, client = privateSupabase) {
  if (typeof assetId !== 'string' || !assetId.trim()) return [];
  if (client === null) {
    return Array.from(memoryFilings.values())
      .filter((filing) => filing.assetId === assetId.trim())
      .sort((left, right) => (
        right.periodEnd.localeCompare(left.periodEnd)
        || right.revisionNumber - left.revisionNumber
        || right.systemKnowableAt.localeCompare(left.systemKnowableAt)
      ));
  }
  if (!client || typeof client.rpc !== 'function') {
    throw repositoryError('FUNDAMENTALS_STORAGE_UNAVAILABLE', 'Fundamentals persistence is unavailable');
  }

  const { data, error } = await client.rpc('read_vn_equity_fundamental_filings', {
    p_asset_id: assetId.trim()
  });
  if (error) {
    throw repositoryError('FUNDAMENTALS_QUERY_FAILED', 'Failed to read official filing fundamentals', 503, error);
  }
  return (Array.isArray(data) ? data : []).map(rowToFundamentalFiling).filter(Boolean);
}

export function clearFundamentalFilingMemory() {
  memoryFilings.clear();
  memoryIdentityHashes.clear();
}
