import { privateSupabase } from '../supabase.js';
import {
  createEquityEvidence,
  EQUITY_EVIDENCE_STATUS,
  EQUITY_EVIDENCE_TYPES,
  selectLatestEquityEvidence
} from './evidenceModel.js';

const memoryEvidence = new Map();

export function equityEvidenceToRow(item) {
  if (!item || item.status === EQUITY_EVIDENCE_STATUS.UNAVAILABLE) return null;
  return {
    observation_id: item.observationId,
    fact_id: item.factId,
    asset_id: item.assetId,
    symbol: item.symbol,
    exchange: item.exchange,
    company_name: item.companyName,
    evidence_type: item.evidenceType,
    metric: item.metric,
    numeric_value: item.numericValue,
    text_value: item.textValue,
    unit: item.unit,
    currency: item.currency,
    reference_period: item.referencePeriod,
    observed_at: item.observedAt,
    published_at: item.publishedAt,
    fetched_at: item.fetchedAt,
    first_seen_at: item.firstSeenAt,
    source_available_at: item.sourceAvailableAt,
    system_knowable_at: item.systemKnowableAt,
    source_id: item.sourceId,
    source_name: item.sourceName,
    source_family: item.sourceFamily,
    dependency_group: item.dependencyGroup,
    authority_level: item.authorityLevel,
    provenance: item.provenance,
    status: item.status,
    freshness: item.freshness,
    status_reason: item.statusReason,
    revision_marker: item.revisionMarker,
    source_content_hash: item.sourceContentHash,
    methodology_version: item.methodologyVersion
  };
}

export function rowToEquityEvidence(row) {
  if (!row || typeof row !== 'object') return null;
  return createEquityEvidence({
    assetId: row.asset_id,
    symbol: row.symbol,
    exchange: row.exchange,
    companyName: row.company_name,
    evidenceType: row.evidence_type,
    metric: row.metric,
    factId: row.fact_id,
    observationId: row.observation_id,
    numericValue: row.numeric_value === null || row.numeric_value === undefined
      ? null
      : Number(row.numeric_value),
    textValue: row.text_value,
    unit: row.unit,
    currency: row.currency,
    referencePeriod: row.reference_period,
    observedAt: row.observed_at,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    firstSeenAt: row.first_seen_at,
    sourceAvailableAt: row.source_available_at,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceFamily: row.source_family,
    dependencyGroup: row.dependency_group,
    authorityLevel: row.authority_level,
    provenance: row.provenance,
    status: row.status,
    freshness: row.freshness,
    statusReason: row.status_reason,
    revisionMarker: row.revision_marker,
    sourceContentHash: row.source_content_hash,
    methodologyVersion: row.methodology_version
  }, { allowLegacyFundamental: row.evidence_type === EQUITY_EVIDENCE_TYPES.FUNDAMENTAL });
}

function persistenceResult(overrides = {}) {
  return {
    isDurable: false,
    durablyAccepted: 0,
    memoryAccepted: 0,
    failedPersistence: 0,
    persisted: [],
    error: null,
    ...overrides
  };
}

/**
 * Persists immutable evidence vintages. In DB mode persistence succeeds before
 * the process cache is updated; exact duplicate IDs are ignored by the DB.
 */
export async function persistEquityEvidence(items, client = privateSupabase) {
  if ((Array.isArray(items) ? items : []).some(
    (item) => item?.evidenceType === EQUITY_EVIDENCE_TYPES.FUNDAMENTAL
  )) {
    const error = new Error('New generic fundamental evidence is disabled; use the governed V1A filing/fact authority');
    error.code = 'LEGACY_GENERIC_FUNDAMENTAL_INGESTION_REJECTED';
    error.status = 409;
    throw error;
  }
  const valid = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.status !== EQUITY_EVIDENCE_STATUS.UNAVAILABLE && equityEvidenceToRow(item)
  );
  if (valid.length === 0) return persistenceResult();

  if (client === null) {
    for (const item of valid) {
      if (!memoryEvidence.has(item.observationId)) memoryEvidence.set(item.observationId, item);
    }
    return persistenceResult({
      memoryAccepted: valid.length,
      persisted: valid,
      memoryOnly: true
    });
  }
  if (!client) {
    const error = new Error('EQUITY_EVIDENCE_CLIENT_UNCONFIGURED');
    error.code = 'EQUITY_EVIDENCE_CLIENT_UNCONFIGURED';
    throw error;
  }

  const rows = valid.map(equityEvidenceToRow);
  try {
    const query = client
      .from('vn_equity_evidence_observations')
      .upsert(rows, { onConflict: 'observation_id', ignoreDuplicates: true });
    const { data, error } = typeof query?.select === 'function'
      ? await query.select('*')
      : await query;
    if (error) {
      return persistenceResult({
        failedPersistence: valid.length,
        error: { code: error.code || 'DATABASE_ERROR', message: error.message || 'Equity evidence persistence failed' }
      });
    }

    const saved = Array.isArray(data) && data.length > 0
      ? data.map(rowToEquityEvidence).filter(Boolean)
      : valid;
    for (const item of saved) {
      if (!memoryEvidence.has(item.observationId)) memoryEvidence.set(item.observationId, item);
    }
    return persistenceResult({
      isDurable: true,
      durablyAccepted: valid.length,
      memoryAccepted: saved.length,
      persisted: saved
    });
  } catch (error) {
    return persistenceResult({
      failedPersistence: valid.length,
      error: { code: error.code || 'DATABASE_ERROR', message: error.message || 'Equity evidence persistence failed' }
    });
  }
}

/**
 * Provider-free read. A configured DB is authoritative; memory is consulted
 * only when client === null explicitly selects offline/test mode.
 */
export async function fetchEquityEvidenceVintages(symbol, client = privateSupabase) {
  const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (!normalizedSymbol) return [];

  if (client === null) {
    return Array.from(memoryEvidence.values())
      .filter((item) => item.symbol === normalizedSymbol)
      .sort((a, b) => (
        b.referencePeriod.localeCompare(a.referencePeriod)
        || b.systemKnowableAt.localeCompare(a.systemKnowableAt)
        || b.observationId.localeCompare(a.observationId)
      ));
  }
  if (!client) {
    const error = new Error('EQUITY_EVIDENCE_CLIENT_UNCONFIGURED');
    error.code = 'EQUITY_EVIDENCE_CLIENT_UNCONFIGURED';
    throw error;
  }

  const { data, error } = await client
    .from('vn_equity_evidence_observations')
    .select('*')
    .eq('symbol', normalizedSymbol)
    .order('reference_period', { ascending: false })
    .order('system_knowable_at', { ascending: false });
  if (error) {
    const dbError = new Error('Failed to read persisted equity evidence');
    dbError.code = 'EQUITY_EVIDENCE_QUERY_FAILED';
    dbError.cause = error;
    throw dbError;
  }
  return (Array.isArray(data) ? data : []).map(rowToEquityEvidence).filter(Boolean);
}

export async function fetchLatestEquityEvidence(symbol, client = privateSupabase) {
  return selectLatestEquityEvidence(await fetchEquityEvidenceVintages(symbol, client));
}

export function clearEquityEvidenceMemory() {
  memoryEvidence.clear();
}
