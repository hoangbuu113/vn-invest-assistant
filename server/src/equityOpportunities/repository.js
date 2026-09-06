import { privateSupabase } from '../supabase.js';
import { createEquityOpportunityCandidate } from './model.js';

const memoryEvaluations = new Map();

export function equityOpportunityRecordToRow(record) {
  const candidate = record?.candidate;
  if (!candidate?.candidateId) return null;
  return {
    evaluation_id: candidate.candidateId,
    asset_id: candidate.assetId,
    symbol: candidate.symbol,
    exchange: candidate.exchange,
    company_name: candidate.companyName,
    as_of: candidate.asOf,
    evidence_version: candidate.evidenceVersion,
    evidence_fingerprint: candidate.evidenceFingerprint,
    qualification_status: candidate.qualificationStatus,
    qualification_reasons: candidate.qualificationReasons,
    disqualification_reasons: candidate.disqualificationReasons,
    evidence_refs: candidate.evidenceRefs,
    data_quality: candidate.dataQuality,
    missing_requirements: candidate.missingRequirements,
    evaluated_at: candidate.evaluatedAt,
    generated_at: candidate.generatedAt,
    policy_version: candidate.policyVersion,
    explanation: record.explanation || null
  };
}

export function rowToEquityOpportunityRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const candidate = createEquityOpportunityCandidate({
    candidateId: row.evaluation_id,
    assetId: row.asset_id,
    symbol: row.symbol,
    exchange: row.exchange,
    companyName: row.company_name,
    asOf: row.as_of,
    evidenceVersion: row.evidence_version,
    evidenceFingerprint: row.evidence_fingerprint,
    qualificationStatus: row.qualification_status,
    qualificationReasons: row.qualification_reasons,
    disqualificationReasons: row.disqualification_reasons,
    evidenceRefs: row.evidence_refs,
    dataQuality: row.data_quality,
    missingRequirements: row.missing_requirements,
    evaluatedAt: row.evaluated_at,
    generatedAt: row.generated_at,
    policyVersion: row.policy_version
  });
  return Object.freeze({ ...candidate, explanation: row.explanation || null });
}

function persistenceResult(overrides = {}) {
  return {
    isDurable: false,
    attempted: 0,
    durablyAccepted: 0,
    memoryAccepted: 0,
    failedPersistence: 0,
    persisted: [],
    error: null,
    ...overrides
  };
}

export async function persistEquityOpportunityEvaluations(records, client = privateSupabase) {
  const uniqueValid = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (equityOpportunityRecordToRow(record)) {
      uniqueValid.set(record.candidate.candidateId, record);
    }
  }
  const valid = Array.from(uniqueValid.values());
  if (valid.length === 0) return persistenceResult();

  if (client === null) {
    let accepted = 0;
    for (const record of valid) {
      if (!memoryEvaluations.has(record.candidate.candidateId)) {
        memoryEvaluations.set(record.candidate.candidateId, Object.freeze({
          ...record.candidate,
          explanation: record.explanation || null
        }));
        accepted += 1;
      }
    }
    return persistenceResult({
      attempted: valid.length,
      memoryAccepted: accepted,
      persisted: valid.map((record) => memoryEvaluations.get(record.candidate.candidateId)),
      memoryOnly: true
    });
  }
  if (!client) {
    const error = new Error('EQUITY_OPPORTUNITY_CLIENT_UNCONFIGURED');
    error.code = 'EQUITY_OPPORTUNITY_CLIENT_UNCONFIGURED';
    throw error;
  }

  const rows = valid.map(equityOpportunityRecordToRow);
  try {
    const query = client
      .from('vn_equity_opportunity_evaluations')
      .upsert(rows, { onConflict: 'evaluation_id', ignoreDuplicates: true });
    const { data, error } = typeof query?.select === 'function'
      ? await query.select('*')
      : await query;
    if (error) {
      return persistenceResult({
        attempted: valid.length,
        failedPersistence: valid.length,
        error: {
          code: error.code || 'DATABASE_ERROR',
          message: error.message || 'Equity opportunity persistence failed'
        }
      });
    }

    const inserted = Array.isArray(data)
      ? data.map(rowToEquityOpportunityRecord).filter(Boolean)
      : [];
    const mirror = inserted.length > 0
      ? inserted
      : valid.map((record) => Object.freeze({
        ...record.candidate,
        explanation: record.explanation || null
      }));
    for (const item of mirror) {
      if (!memoryEvaluations.has(item.candidateId)) memoryEvaluations.set(item.candidateId, item);
    }
    return persistenceResult({
      isDurable: true,
      attempted: valid.length,
      durablyAccepted: inserted.length,
      memoryAccepted: mirror.length,
      persisted: mirror
    });
  } catch (error) {
    return persistenceResult({
      attempted: valid.length,
      failedPersistence: valid.length,
      error: {
        code: error.code || 'DATABASE_ERROR',
        message: error.message || 'Equity opportunity persistence failed'
      }
    });
  }
}

export async function fetchEquityOpportunityEvaluations(symbol = null, client = privateSupabase) {
  const normalizedSymbol = typeof symbol === 'string' && symbol.trim()
    ? symbol.trim().toUpperCase()
    : null;
  if (client === null) {
    return Array.from(memoryEvaluations.values())
      .filter((item) => !normalizedSymbol || item.symbol === normalizedSymbol)
      .sort((left, right) => (
        right.asOf.localeCompare(left.asOf)
        || left.symbol.localeCompare(right.symbol)
        || right.candidateId.localeCompare(left.candidateId)
      ));
  }
  if (!client) {
    const error = new Error('EQUITY_OPPORTUNITY_CLIENT_UNCONFIGURED');
    error.code = 'EQUITY_OPPORTUNITY_CLIENT_UNCONFIGURED';
    throw error;
  }

  let query = client
    .from('vn_equity_opportunity_evaluations')
    .select('*');
  if (normalizedSymbol) query = query.eq('symbol', normalizedSymbol);
  const { data, error } = await query
    .order('as_of', { ascending: false })
    .order('symbol', { ascending: true });
  if (error) {
    const dbError = new Error('Failed to read persisted equity opportunities');
    dbError.code = 'EQUITY_OPPORTUNITY_QUERY_FAILED';
    dbError.cause = error;
    throw dbError;
  }
  return (Array.isArray(data) ? data : []).map(rowToEquityOpportunityRecord).filter(Boolean);
}

export async function fetchLatestEquityOpportunityEvaluations(symbol = null, client = privateSupabase) {
  const rows = await fetchEquityOpportunityEvaluations(symbol, client);
  const latestBySymbol = new Map();
  for (const row of rows) {
    const current = latestBySymbol.get(row.symbol);
    if (
      !current
      || row.asOf > current.asOf
      || (row.asOf === current.asOf && row.candidateId > current.candidateId)
    ) {
      latestBySymbol.set(row.symbol, row);
    }
  }
  return Array.from(latestBySymbol.values()).sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function clearEquityOpportunityMemory() {
  memoryEvaluations.clear();
}
