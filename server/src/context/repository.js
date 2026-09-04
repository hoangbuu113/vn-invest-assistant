import {
  createMarketObservation,
  compareObservationVintages,
  OBSERVATION_FRESHNESS,
  OBSERVATION_STATUS,
  PILLARS,
  AUTHORITY_LEVELS
} from './factModel.js';
import { applyRuntimeFreshness } from './freshnessPolicy.js';
import { privateSupabase } from '../supabase.js';

// In-process memory store for fallback and tests
const memoryStore = new Map();

/**
 * Converts a database row to a normalized MarketObservation.
 * Preserves the complete fact contract across round-trips.
 */
export function rowToObservation(row) {
  if (!row || typeof row !== 'object') return null;

  return createMarketObservation({
    id: row.fact_id,
    factId: row.fact_id,
    observationId: row.observation_id,
    pillar: row.pillar,
    label: row.label || row.metric,
    metric: row.metric,
    value: Number(row.numeric_value),
    unit: row.unit,
    unitType: row.unit_type || null,
    change: row.change_value !== null && row.change_value !== undefined ? Number(row.change_value) : null,
    changeUnit: row.change_unit || null,
    changeUnitType: row.change_unit_type || null,
    changePercent: row.change_percent !== null && row.change_percent !== undefined ? Number(row.change_percent) : null,
    changeBasis: row.change_basis || null,
    previousValue: row.previous_value !== null && row.previous_value !== undefined ? Number(row.previous_value) : null,
    volume: row.volume !== null && row.volume !== undefined ? Number(row.volume) : null,
    volumeUnit: row.volume_unit || null,
    quoteDirection: row.quote_direction || null,
    referenceTime: row.reference_time || null,
    observedAt: row.observed_at || null,
    publishedAt: row.published_at || null,
    fetchedAt: row.fetched_at || new Date().toISOString(),
    source: row.source_id,
    authorityLevel: row.authority_level || AUTHORITY_LEVELS.MARKET_REFERENCE,
    provenance: row.provenance || {},
    freshness: row.freshness || OBSERVATION_FRESHNESS.FRESH,
    status: row.status || OBSERVATION_STATUS.AVAILABLE,
    qualityStatus: row.quality_status || 'available',
    revisionMarker: row.revision_marker || null,
    sourceContentHash: row.source_content_hash || null,
    methodologyVersion: row.methodology_version || 'v1.2'
  });
}

/**
 * Converts a MarketObservation to a database row.
 * Serializes all 26+ structured fields of the fact contract.
 * Does not fabricate missing referenceTime; preserves clean qualityStatus.
 */
export function observationToRow(obs) {
  if (!obs || obs.value === null || !Number.isFinite(obs.value)) return null;

  return {
    fact_id: obs.factId,
    observation_id: obs.observationId,
    pillar: obs.pillar,
    metric: obs.metric || obs.label,
    label: obs.label || obs.metric,
    numeric_value: obs.value,
    unit: obs.unit,
    unit_type: obs.unitType || null,
    change_value: obs.change,
    change_unit: obs.changeUnit || null,
    change_unit_type: obs.changeUnitType || null,
    change_percent: obs.changePercent,
    change_basis: obs.changeBasis || null,
    previous_value: obs.previousValue,
    volume: obs.volume,
    volume_unit: obs.volumeUnit || null,
    quote_direction: obs.quoteDirection || null,
    reference_time: obs.referenceTime || null,
    observed_at: obs.observedAt || null,
    published_at: obs.publishedAt || null,
    fetched_at: obs.fetchedAt || new Date().toISOString(),
    source_id: obs.source || 'UNKNOWN',
    authority_level: obs.authorityLevel || 'MARKET_REFERENCE',
    provenance: obs.provenance || {},
    status: obs.status || 'available',
    freshness: obs.freshness || 'fresh',
    quality_status: obs.qualityStatus || 'available',
    revision_marker: obs.revisionMarker || null,
    source_content_hash: obs.sourceContentHash || null,
    methodology_version: obs.methodologyVersion || 'v1.2',
    updated_at: new Date().toISOString()
  };
}

/**
 * Persists validated finite observations to the database (service_role authoritative).
 * Distinguishes durable database persistence from in-memory fallback.
 * Reports exact accounting: isDurable, durablyPersisted, memoryAccepted, failedPersistence.
 */
export async function persistMarketObservations(observations, client = privateSupabase) {
  const validObservations = (Array.isArray(observations) ? observations : []).filter(
    (o) => o && typeof o.value === 'number' && Number.isFinite(o.value) && o.status !== OBSERVATION_STATUS.UNAVAILABLE
  );

  if (validObservations.length === 0) {
    return Object.assign([], {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: 0,
      failedPersistence: 0,
      persisted: [],
      failed: [],
      error: null
    });
  }

  // Update in-memory fallback store
  for (const obs of validObservations) {
    memoryStore.set(obs.observationId, obs);
  }

  // If no durable client provided (in-memory execution)
  if (!client) {
    return Object.assign([...validObservations], {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: validObservations.length,
      failedPersistence: 0,
      persisted: [...validObservations],
      failed: [],
      error: null,
      memoryOnly: true
    });
  }

  const rows = validObservations.map(observationToRow).filter(Boolean);

  try {
    const query = client
      .from('market_context_observations')
      .upsert(rows, { onConflict: 'observation_id' });
    const { data, error } = typeof query?.select === 'function' ? await query.select() : await query;

    if (error) {
      // Visible persistence failure: DO NOT claim rows were durably persisted
      return Object.assign([], {
        isDurable: false,
        durablyPersisted: 0,
        memoryAccepted: validObservations.length,
        failedPersistence: validObservations.length,
        persisted: [],
        failed: validObservations,
        error: typeof error === 'object' && error !== null ? error : { message: String(error) }
      });
    }

    const persistedObs = Array.isArray(data) ? data.map(rowToObservation) : validObservations;
    for (const obs of persistedObs) {
      memoryStore.set(obs.observationId, obs);
    }

    return Object.assign([...persistedObs], {
      isDurable: true,
      durablyPersisted: persistedObs.length,
      memoryAccepted: persistedObs.length,
      failedPersistence: 0,
      persisted: persistedObs,
      failed: [],
      error: null
    });
  } catch (err) {
    return Object.assign([], {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: validObservations.length,
      failedPersistence: validObservations.length,
      persisted: [],
      failed: validObservations,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) }
    });
  }
}

/**
 * Fetches the latest persisted observations for all facts.
 * Guaranteed to return fast from persistence without contacting live third-party APIs.
 * Applies runtime freshness recalculation dynamically based on metric cadence and current time.
 */
export async function fetchLatestPersistedObservations(client = privateSupabase, now = new Date()) {
  let observations = [];

  if (client) {
    try {
      const { data, error } = await client
        .from('market_context_observations')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('observed_at', { ascending: false, nullsFirst: false })
        .order('fetched_at', { ascending: false })
        .order('reference_time', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        const latestByFactId = new Map();
        for (const row of data) {
          const obs = rowToObservation(row);
          if (obs) {
            const existing = latestByFactId.get(obs.factId);
            if (!existing || compareObservationVintages(obs, existing) < 0) {
              latestByFactId.set(obs.factId, obs);
            }
          }
        }
        observations = Array.from(latestByFactId.values());
      }
    } catch {
      // Fallback to in-process memory store if DB unreachable
    }
  }

  // Fallback to in-memory store if DB query returned nothing
  if (observations.length === 0 && memoryStore.size > 0) {
    const latestByFactId = new Map();
    for (const obs of memoryStore.values()) {
      const existing = latestByFactId.get(obs.factId);
      if (!existing || compareObservationVintages(obs, existing) < 0) {
        latestByFactId.set(obs.factId, obs);
      }
    }
    observations = Array.from(latestByFactId.values());
  }

  // Dynamically recalculate runtime freshness relative to `now`
  return observations.map((obs) => applyRuntimeFreshness(obs, now));
}

/**
 * Fetches a specific immutable observation by vintage ID.
 */
export async function fetchObservationByVintageId(observationId, client = privateSupabase, now = new Date()) {
  if (!observationId) return null;

  if (client) {
    try {
      const { data, error } = await client
        .from('market_context_observations')
        .select('*')
        .eq('observation_id', observationId)
        .maybeSingle();

      if (!error && data) {
        return applyRuntimeFreshness(rowToObservation(data), now);
      }
    } catch {
      // Fallback to memory
    }
  }

  const memoryObs = memoryStore.get(observationId);
  return memoryObs ? applyRuntimeFreshness(memoryObs, now) : null;
}

/**
 * Clears the in-memory persistence store (for tests).
 */
export function clearPersistenceStore() {
  memoryStore.clear();
}
