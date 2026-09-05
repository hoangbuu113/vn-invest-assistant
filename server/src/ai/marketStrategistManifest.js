import { privateSupabase } from '../supabase.js';

const manifestMemoryStore = new Map();

/**
 * Validates that no private user or portfolio data exists in the manifest.
 */
function assertZeroPrivateData(manifest) {
  if (!manifest || typeof manifest !== 'object') return;
  const jsonStr = JSON.stringify(manifest);
  if (/(?:"userId"|"user_id"|"portfolio"|"holdings"|"cash"|"transactions"|"email")\s*:/i.test(jsonStr)) {
    const err = new Error('FORBIDDEN_USER_DATA_IN_MANIFEST: Run manifest must strictly contain zero private user or portfolio data');
    err.code = 'FORBIDDEN_USER_DATA';
    throw err;
  }
}

/**
 * Serializes a runtime manifest object to database row format.
 */
export function manifestToRow(manifest) {
  if (!manifest?.runId) return null;
  assertZeroPrivateData(manifest);

  return {
    run_id: manifest.runId,
    packet_fingerprint: manifest.packetFingerprint,
    selected_observation_ids: Array.isArray(manifest.selectedObservationIds) ? manifest.selectedObservationIds : [],
    selected_article_ids: Array.isArray(manifest.selectedArticleIds) ? manifest.selectedArticleIds : [],
    signal_ids: Array.isArray(manifest.signalIds) ? manifest.signalIds : [],
    prompt_version: manifest.promptVersion || 'unknown',
    schema_version: manifest.schemaVersion || 'unknown',
    selection_policy_version: manifest.selectionPolicyVersion || 'v1.2',
    model: manifest.model || 'unknown',
    generation_mode: manifest.generationMode || 'unknown',
    generated_at: manifest.generatedAt || new Date().toISOString(),
    data_as_of: manifest.dataAsOf || new Date().toISOString(),
    validation_result: manifest.validationResult && typeof manifest.validationResult === 'object'
      ? manifest.validationResult
      : { valid: true }
  };
}

/**
 * Deserializes a database row to a normalized manifest object.
 */
export function rowToManifest(row) {
  if (!row || !row.run_id) return null;
  return Object.freeze({
    runId: row.run_id,
    packetFingerprint: row.packet_fingerprint,
    selectedObservationIds: Array.isArray(row.selected_observation_ids) ? row.selected_observation_ids : [],
    selectedArticleIds: Array.isArray(row.selected_article_ids) ? row.selected_article_ids : [],
    signalIds: Array.isArray(row.signal_ids) ? row.signal_ids : [],
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    selectionPolicyVersion: row.selection_policy_version,
    model: row.model,
    generationMode: row.generation_mode,
    generatedAt: row.generated_at,
    dataAsOf: row.data_as_of,
    validationResult: row.validation_result || {},
    createdAt: row.created_at || null
  });
}

/**
 * Persists a run manifest durably to database with in-memory fallback.
 */
export async function persistRunManifest(manifest, client = privateSupabase) {
  if (!manifest || !manifest.runId) {
    return {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: 0,
      failedPersistence: 0,
      runId: null,
      error: new Error('INVALID_MANIFEST')
    };
  }

  assertZeroPrivateData(manifest);

  // Store in-memory
  const normalized = Object.freeze({
    runId: manifest.runId,
    packetFingerprint: manifest.packetFingerprint,
    selectedObservationIds: Array.isArray(manifest.selectedObservationIds) ? [...manifest.selectedObservationIds] : [],
    selectedArticleIds: Array.isArray(manifest.selectedArticleIds) ? [...manifest.selectedArticleIds] : [],
    signalIds: Array.isArray(manifest.signalIds) ? [...manifest.signalIds] : [],
    promptVersion: manifest.promptVersion,
    schemaVersion: manifest.schemaVersion,
    selectionPolicyVersion: manifest.selectionPolicyVersion,
    model: manifest.model,
    generationMode: manifest.generationMode,
    generatedAt: manifest.generatedAt,
    dataAsOf: manifest.dataAsOf,
    validationResult: manifest.validationResult || {}
  });

  manifestMemoryStore.set(manifest.runId, normalized);

  if (!client) {
    return {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: 1,
      failedPersistence: 0,
      runId: manifest.runId,
      error: null
    };
  }

  const row = manifestToRow(manifest);

  try {
    const { error } = await client
      .from('market_strategist_runs')
      .upsert(row, { onConflict: 'run_id' });

    if (error) {
      return {
        isDurable: false,
        durablyPersisted: 0,
        memoryAccepted: 1,
        failedPersistence: 1,
        runId: manifest.runId,
        error
      };
    }

    return {
      isDurable: true,
      durablyPersisted: 1,
      memoryAccepted: 1,
      failedPersistence: 0,
      runId: manifest.runId,
      error: null
    };
  } catch (err) {
    return {
      isDurable: false,
      durablyPersisted: 0,
      memoryAccepted: 1,
      failedPersistence: 1,
      runId: manifest.runId,
      error: err instanceof Error ? err : new Error(String(err))
    };
  }
}

/**
 * Fetches a run manifest by runId.
 */
export async function fetchRunManifest(runId, client = privateSupabase) {
  if (!runId) return null;

  if (client) {
    try {
      const { data, error } = await client
        .from('market_strategist_runs')
        .select('*')
        .eq('run_id', runId)
        .maybeSingle();

      if (!error && data) {
        return rowToManifest(data);
      }
    } catch {
      // Fallback to memory
    }
  }

  return manifestMemoryStore.get(runId) || null;
}

/**
 * Clears the in-memory manifest store (for testing).
 */
export function clearManifestStore() {
  manifestMemoryStore.clear();
}
