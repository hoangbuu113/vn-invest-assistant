import { createMarketClaim } from './claimModel.js';
import { privateSupabase } from '../supabase.js';
import { recordJobHealth, HEALTH_STATES, OBSERVED_JOBS, ERROR_CATEGORIES } from '../observability/dataHealth.js';

// In-process memory store for fast testing and fallback
const memoryClaims = new Map();
const memoryEvidenceLinks = new Map();

/**
 * ARCHITECTURAL BOUNDARY (01D Historical Replay):
 * - `market_claims` stores the CURRENT reconciled assessment state (supportStatus, counts, dimensions, limitations).
 * - Point-in-time historical reconstruction is deferred to 01D and must query historical slices of
 *   timestamped `claim_evidence_links` and immutable observations/news versions.
 * - `market_claims` rows evolve via upsert and are NOT independently append-only ledger entries.
 */

/**
 * Converts a database row to a canonical MarketClaim object.
 */
export function rowToClaim(row) {
  if (!row || typeof row !== 'object') return null;

  return createMarketClaim({
    claimId: row.claim_id,
    claimType: row.claim_type,
    subject: row.subject,
    predicate: row.predicate,
    numericValue: row.numeric_value !== null && row.numeric_value !== undefined ? Number(row.numeric_value) : null,
    valueText: row.value_text || null,
    unit: row.unit || null,
    referencePeriod: row.reference_period || null,
    scope: row.scope || null,
    methodology: row.methodology || null,
    revisionMarker: row.revision_marker || null,
    authorityLevel: row.authority_level,
    supportStatus: row.support_status,
    sourceCount: row.source_count,
    independentSourceCount: row.independent_source_count,
    contradictionCount: row.contradiction_count,
    revisionOf: row.revision_of || null,
    confidenceDimensions: row.confidence_dimensions || {},
    limitations: row.limitations || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

/**
 * Converts a MarketClaim object to a database row for insertion.
 */
export function claimToRow(claim) {
  if (!claim) return null;

  return {
    claim_id: claim.claimId,
    claim_type: claim.claimType,
    subject: claim.subject,
    predicate: claim.predicate,
    numeric_value: claim.numericValue,
    value_text: claim.valueText,
    unit: claim.unit,
    reference_period: claim.referencePeriod,
    scope: claim.scope,
    methodology: claim.methodology,
    revision_marker: claim.revisionMarker,
    authority_level: claim.authorityLevel,
    support_status: claim.supportStatus,
    source_count: claim.sourceCount,
    independent_source_count: claim.independentSourceCount,
    contradiction_count: claim.contradictionCount,
    revision_of: claim.revisionOf,
    confidence_dimensions: claim.confidenceDimensions,
    limitations: claim.limitations,
    published_at: claim.publishedAt,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt
  };
}

/**
 * Persists reconciled claims and their evidence links to database and in-memory store.
 * Strictly guarantees:
 * - Independence must be positively established (isIndependent: ev.isIndependent === true).
 * - Omitted independence defaults strictly to false.
 * - dependencyGroup is durably recorded for future 01D historical replay reconstruction.
 */
export async function persistClaims(reconciledList = [], client = privateSupabase) {
  if (!Array.isArray(reconciledList) || reconciledList.length === 0) {
    return [];
  }

  const startTime = Date.now();
  const savedClaims = [];
  let dbError = null;
  let failedDbUpserts = 0;
  let totalDbAttempts = 0;

  for (const item of reconciledList) {
    const claim = item.claim || item;
    const links = item.supportingEvidence || [];

    // Save to in-memory store
    memoryClaims.set(claim.claimId, claim);
    if (!memoryEvidenceLinks.has(claim.claimId)) {
      memoryEvidenceLinks.set(claim.claimId, []);
    }
    const currentLinks = memoryEvidenceLinks.get(claim.claimId);
    const existingLinkKeys = new Set(currentLinks.map((l) => `${l.evidenceType}:${l.evidenceId}`));
    for (const ev of links) {
      const linkKey = `${ev.evidenceType || 'observation'}:${ev.evidenceId || ev.id}`;
      if (existingLinkKeys.has(linkKey)) continue;
      existingLinkKeys.add(linkKey);
      currentLinks.push({
        claimId: claim.claimId,
        evidenceType: ev.evidenceType || 'observation',
        evidenceId: ev.evidenceId || ev.id,
        sourceFamily: ev.sourceFamily || 'UNKNOWN',
        dependencyGroup: ev.dependencyGroup || 'UNKNOWN_DEPENDENCY',
        isIndependent: ev.isIndependent === true,
        createdAt: ev.createdAt || new Date().toISOString()
      });
    }

    savedClaims.push(claim);

    // Save to Postgres if client is available
    if (client && typeof client.from === 'function') {
      totalDbAttempts++;
      try {
        const row = claimToRow(claim);
        if (row) {
          const res = await client.from('market_claims').upsert(row, { onConflict: 'claim_id' });
          if (res?.error) {
            failedDbUpserts++;
            dbError = dbError || res.error;
          }
        }

        if (links.length > 0) {
          const linkRows = links.map((ev) => ({
            claim_id: claim.claimId,
            evidence_type: ev.evidenceType || 'observation',
            evidence_id: ev.evidenceId || ev.id,
            source_family: ev.sourceFamily || 'UNKNOWN',
            dependency_group: ev.dependencyGroup || 'UNKNOWN_DEPENDENCY',
            is_independent: ev.isIndependent === true,
            created_at: ev.createdAt || new Date().toISOString()
          }));
          const linkRes = await client.from('claim_evidence_links').upsert(linkRows, {
            onConflict: 'claim_id,evidence_type,evidence_id'
          });
          if (linkRes?.error) {
            dbError = dbError || linkRes.error;
          }
        }
      } catch (err) {
        failedDbUpserts++;
        dbError = dbError || err;
        // Log error non-critically for offline / test environments
        console.warn(`[claimRepository] Database upsert notice: ${err.message}`);
      }
    }
  }

  // Determine truthful health status
  let claimsHealthStatus = HEALTH_STATES.HEALTHY;
  if (totalDbAttempts > 0 && dbError) {
    claimsHealthStatus = (failedDbUpserts === totalDbAttempts)
      ? HEALTH_STATES.FAILED
      : HEALTH_STATES.DEGRADED;
  }

  try {
    await recordJobHealth({
      jobName: OBSERVED_JOBS.CLAIMS_RECONCILIATION,
      status: claimsHealthStatus,
      durationMs: Date.now() - startTime,
      recordsRead: reconciledList.length,
      recordsWritten: claimsHealthStatus === HEALTH_STATES.FAILED ? 0 : (savedClaims.length - failedDbUpserts),
      policyVersion: 'claims-v1',
      errorCode: dbError ? (dbError.code || 'DATABASE_ERROR') : null,
      errorCategory: dbError ? ERROR_CATEGORIES.DATABASE : null,
      error: dbError,
      client,
      now: new Date()
    });
  } catch {
    // Non-blocking telemetry
  }

  return savedClaims;
}

/**
 * Retrieves claims by subject and optional reference period.
 */
export async function getClaimsBySubject(subject, referencePeriod = null, client = privateSupabase) {
  // Query memory first
  const memoryMatches = Array.from(memoryClaims.values()).filter((c) => {
    if (c.subject !== subject) return false;
    if (referencePeriod && c.referencePeriod !== referencePeriod) return false;
    return true;
  });

  if (memoryMatches.length > 0) {
    return memoryMatches;
  }

  // Fallback to database
  if (client && typeof client.from === 'function') {
    try {
      let query = client.from('market_claims').select('*').eq('subject', subject);
      if (referencePeriod) {
        query = query.eq('reference_period', referencePeriod);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return data.map(rowToClaim).filter(Boolean);
      }
    } catch (err) {
      console.warn(`[claimRepository] Database query error: ${err.message}`);
    }
  }

  return [];
}

/**
 * Retrieves all currently active (non-superseded) claims.
 */
export async function getAllActiveClaims(client = privateSupabase) {
  const memoryActive = Array.from(memoryClaims.values()).filter(
    (c) => c.supportStatus !== 'SUPERSEDED'
  );

  if (memoryActive.length > 0) {
    return memoryActive;
  }

  if (client && typeof client.from === 'function') {
    try {
      const { data, error } = await client
        .from('market_claims')
        .select('*')
        .neq('support_status', 'SUPERSEDED');
      if (!error && Array.isArray(data)) {
        return data.map(rowToClaim).filter(Boolean);
      }
    } catch (err) {
      console.warn(`[claimRepository] Database query error: ${err.message}`);
    }
  }

  return [];
}

/**
 * Clears in-memory store for deterministic unit tests.
 */
export function clearMemoryClaims() {
  memoryClaims.clear();
  memoryEvidenceLinks.clear();
}

/**
 * Retrieves in-memory evidence links for a specific claim.
 */
export function getEvidenceLinksForClaim(claimId) {
  return memoryEvidenceLinks.get(claimId) || [];
}
