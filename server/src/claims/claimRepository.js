import { createMarketClaim } from './claimModel.js';
import { privateSupabase } from '../supabase.js';

// In-process memory store for fast testing and fallback
const memoryClaims = new Map();
const memoryEvidenceLinks = new Map();

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
 */
export async function persistClaims(reconciledList = [], client = privateSupabase) {
  if (!Array.isArray(reconciledList) || reconciledList.length === 0) {
    return [];
  }

  const savedClaims = [];

  for (const item of reconciledList) {
    const claim = item.claim || item;
    const links = item.supportingEvidence || [];

    // Save to in-memory store
    memoryClaims.set(claim.claimId, claim);
    if (!memoryEvidenceLinks.has(claim.claimId)) {
      memoryEvidenceLinks.set(claim.claimId, []);
    }
    const currentLinks = memoryEvidenceLinks.get(claim.claimId);
    for (const ev of links) {
      currentLinks.push({
        claimId: claim.claimId,
        evidenceType: ev.evidenceType || 'observation',
        evidenceId: ev.evidenceId || ev.id,
        sourceFamily: ev.sourceFamily || 'UNKNOWN',
        isIndependent: ev.isIndependent !== false
      });
    }

    savedClaims.push(claim);

    // Save to Postgres if client is available
    if (client && typeof client.from === 'function') {
      try {
        const row = claimToRow(claim);
        if (row) {
          await client.from('market_claims').upsert(row, { onConflict: 'claim_id' });
        }

        if (links.length > 0) {
          const linkRows = links.map((ev) => ({
            claim_id: claim.claimId,
            evidence_type: ev.evidenceType || 'observation',
            evidence_id: ev.evidenceId || ev.id,
            source_family: ev.sourceFamily || 'UNKNOWN',
            is_independent: ev.isIndependent !== false
          }));
          await client.from('claim_evidence_links').upsert(linkRows, {
            onConflict: 'claim_id,evidence_type,evidence_id'
          });
        }
      } catch (err) {
        // Log error non-critically for offline / test environments
        console.warn(`[claimRepository] Database upsert notice: ${err.message}`);
      }
    }
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
