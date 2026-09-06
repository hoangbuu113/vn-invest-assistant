import { privateSupabase } from '../supabase.js';
import {
  createStrategyVersion,
  createStrategyAssessment,
  assertZeroPrivateData,
  STRATEGY_LIFECYCLE_STATUSES,
  EVALUATION_STATUSES
} from './strategyStabilityModel.js';

// In-process memory stores for testing and fallback
const memoryStrategyVersions = new Map();
const memoryStrategyAssessments = new Map();

/**
 * Resets the in-memory stability store (for tests).
 */
export function clearStabilityMemoryStore() {
  memoryStrategyVersions.clear();
  memoryStrategyAssessments.clear();
}

/**
 * Converts a database row to a canonical StrategyVersion object.
 */
export function rowToStrategyVersion(row) {
  if (!row || typeof row !== 'object' || !row.strategy_id) return null;

  return createStrategyVersion({
    strategyId: row.strategy_id,
    previousStrategyId: row.previous_strategy_id || null,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
    dataAsOf: row.data_as_of,
    evidenceFingerprint: row.evidence_fingerprint,
    decisionFingerprint: row.decision_fingerprint,
    triggerReason: row.trigger_reason || {},
    materialChanges: row.material_changes || [],
    confidence: row.confidence,
    regime: row.regime || {},
    executiveDecision: row.executive_decision || {},
    assetStrategy: row.asset_strategy || [],
    preferredThemes: row.preferred_themes || [],
    avoidOrUnderweight: row.avoid_or_underweight || [],
    riskOverlay: row.risk_overlay || {},
    horizon: row.horizon || 'medium',
    invalidationConditions: row.invalidation_conditions || [],
    status: row.status,
    lifecycleState: row.lifecycle_state,
    dataQualityState: row.data_quality_state,
    watchReasons: row.watch_reasons || [],
    shockOverride: row.shock_override || null,
    policyVersion: row.policy_version,
    runManifestId: row.run_manifest_id || null,
    nextReviewDueAt: row.next_review_due_at || null,
    limitations: row.limitations || null,
    createdAt: row.created_at
  });
}

/**
 * Converts a StrategyVersion object to a database row.
 */
export function strategyVersionToRow(version) {
  if (!version) return null;
  assertZeroPrivateData(version, 'STRATEGY_VERSION_ROW');

  return {
    strategy_id: version.strategyId,
    previous_strategy_id: version.previousStrategyId || null,
    generated_at: version.generatedAt,
    published_at: version.publishedAt,
    data_as_of: version.dataAsOf,
    evidence_fingerprint: version.evidenceFingerprint,
    decision_fingerprint: version.decisionFingerprint,
    trigger_reason: version.triggerReason || {},
    material_changes: version.materialChanges || [],
    confidence: version.confidence,
    regime: version.regime || {},
    executive_decision: version.executiveDecision || {},
    asset_strategy: version.assetStrategy || [],
    preferred_themes: version.preferredThemes || [],
    avoid_or_underweight: version.avoidOrUnderweight || [],
    risk_overlay: version.riskOverlay || {},
    horizon: version.horizon || 'medium',
    invalidation_conditions: version.invalidationConditions || [],
    status: version.status,
    lifecycle_state: version.lifecycleState,
    data_quality_state: version.dataQualityState,
    watch_reasons: version.watchReasons || [],
    shock_override: version.shockOverride || null,
    policy_version: version.policyVersion,
    run_manifest_id: version.runManifestId || null,
    next_review_due_at: version.nextReviewDueAt || null,
    limitations: version.limitations || null,
    created_at: version.createdAt
  };
}

/**
 * Converts a database row to a canonical StrategyAssessment object.
 */
export function rowToStrategyAssessment(row) {
  if (!row || typeof row !== 'object' || !row.assessment_id) return null;

  return createStrategyAssessment({
    assessmentId: row.assessment_id,
    strategyId: row.strategy_id,
    assessedAt: row.assessed_at,
    dataAsOf: row.data_as_of,
    evidenceFingerprint: row.evidence_fingerprint,
    previousEvidenceFingerprint: row.previous_evidence_fingerprint || null,
    decisionFingerprint: row.decision_fingerprint,
    confidence: row.confidence,
    previousConfidence: row.previous_confidence || null,
    result: row.result,
    evaluationStatus: row.evaluation_status,
    triggerReason: row.trigger_reason || {},
    materialChanges: row.material_changes || [],
    limitations: row.limitations || null,
    lifecycleState: row.lifecycle_state,
    dataQualityState: row.data_quality_state,
    watchReasons: row.watch_reasons || [],
    shockOverride: row.shock_override || null,
    confirmationKeys: row.confirmation_keys || [],
    idempotencyKey: row.idempotency_key || null,
    policyVersion: row.policy_version,
    runManifestId: row.run_manifest_id || null,
    createdAt: row.created_at
  });
}

/**
 * Converts a StrategyAssessment object to a database row.
 */
export function strategyAssessmentToRow(assessment) {
  if (!assessment) return null;
  assertZeroPrivateData(assessment, 'STRATEGY_ASSESSMENT_ROW');

  return {
    assessment_id: assessment.assessmentId,
    strategy_id: assessment.strategyId,
    assessed_at: assessment.assessedAt,
    data_as_of: assessment.dataAsOf,
    evidence_fingerprint: assessment.evidenceFingerprint,
    previous_evidence_fingerprint: assessment.previousEvidenceFingerprint || null,
    decision_fingerprint: assessment.decisionFingerprint,
    confidence: assessment.confidence,
    previous_confidence: assessment.previousConfidence || null,
    result: assessment.result,
    evaluation_status: assessment.evaluationStatus,
    trigger_reason: assessment.triggerReason || {},
    material_changes: assessment.materialChanges || [],
    limitations: assessment.limitations || null,
    lifecycle_state: assessment.lifecycleState,
    data_quality_state: assessment.dataQualityState,
    watch_reasons: assessment.watchReasons || [],
    shock_override: assessment.shockOverride || null,
    confirmation_keys: assessment.confirmationKeys || [],
    idempotency_key: assessment.idempotencyKey || null,
    policy_version: assessment.policyVersion,
    run_manifest_id: assessment.runManifestId || null,
    created_at: assessment.createdAt
  };
}

/**
 * Retrieves the currently published StrategyVersion.
 */
export async function getCurrentPublishedStrategy(client = privateSupabase) {
  // Check memory store first for immediate cache
  let latestMemory = null;
  for (const item of memoryStrategyVersions.values()) {
    if (item.status === STRATEGY_LIFECYCLE_STATUSES.PUBLISHED) {
      if (!latestMemory || item.publishedAt > latestMemory.publishedAt) {
        latestMemory = item;
      }
    }
  }

  if (!client) {
    return latestMemory;
  }

  try {
    const { data, error } = await client
      .from('strategy_versions')
      .select('*')
      .eq('status', STRATEGY_LIFECYCLE_STATUSES.PUBLISHED)
      .order('published_at', { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data) || data.length === 0) {
      return latestMemory;
    }

    const version = rowToStrategyVersion(data[0]);
    if (version) {
      memoryStrategyVersions.set(version.strategyId, version);
    }
    return version;
  } catch {
    return latestMemory;
  }
}

/**
 * Retrieves a StrategyVersion by ID.
 */
export async function getStrategyVersionById(strategyId, client = privateSupabase) {
  if (!strategyId) return null;
  if (memoryStrategyVersions.has(strategyId)) {
    return memoryStrategyVersions.get(strategyId);
  }

  if (!client) return null;

  try {
    const { data, error } = await client
      .from('strategy_versions')
      .select('*')
      .eq('strategy_id', strategyId)
      .maybeSingle();

    if (error || !data) return null;
    const version = rowToStrategyVersion(data);
    if (version) {
      memoryStrategyVersions.set(version.strategyId, version);
    }
    return version;
  } catch {
    return null;
  }
}

/**
 * Persists a StrategyVersion to database and memory store.
 * Enforces single published strategy constraint.
 */
export async function persistStrategyVersion(strategyVersion, client = privateSupabase) {
  if (!strategyVersion?.strategyId) {
    throw new Error('persistStrategyVersion requires a valid strategyVersion with strategyId');
  }

  assertZeroPrivateData(strategyVersion, 'PERSIST_STRATEGY_VERSION');

  // Enforce single published strategy constraint in memory store (mirrors idx_strategy_versions_single_published)
  if (strategyVersion.status === STRATEGY_LIFECYCLE_STATUSES.PUBLISHED) {
    for (const [id, existing] of memoryStrategyVersions.entries()) {
      if (id !== strategyVersion.strategyId && existing.status === STRATEGY_LIFECYCLE_STATUSES.PUBLISHED) {
        const err = new Error('Unique constraint violation: idx_strategy_versions_single_published (multiple published versions forbidden)');
        err.code = '23505';
        err.constraint = 'idx_strategy_versions_single_published';
        throw err;
      }
    }
  }

  // In-memory update
  memoryStrategyVersions.set(strategyVersion.strategyId, strategyVersion);

  if (!client) {
    return { isDurable: false, strategyId: strategyVersion.strategyId };
  }

  const row = strategyVersionToRow(strategyVersion);
  try {
    const { error } = await client
      .from('strategy_versions')
      .upsert(row, { onConflict: 'strategy_id' });

    if (error) {
      if (error.code === '23505' || error.message?.includes('idx_strategy_versions_single_published')) {
        await getCurrentPublishedStrategy(client);
        const err = new Error('Unique constraint violation: idx_strategy_versions_single_published (multiple published versions forbidden)');
        err.code = '23505';
        err.constraint = 'idx_strategy_versions_single_published';
        throw err;
      }
      return { isDurable: false, strategyId: strategyVersion.strategyId, error };
    }
    return { isDurable: true, strategyId: strategyVersion.strategyId };
  } catch (err) {
    await getCurrentPublishedStrategy(client);
    throw err;
  }
}

/**
 * Marks a previous strategy version as superseded.
 */
export async function supersedeStrategyVersion(strategyId, client = privateSupabase) {
  if (!strategyId) return;

  const existing = memoryStrategyVersions.get(strategyId);
  if (existing) {
    const updated = createStrategyVersion({
      ...existing,
      status: STRATEGY_LIFECYCLE_STATUSES.SUPERSEDED
    });
    memoryStrategyVersions.set(strategyId, updated);
  }

  if (!client) return;

  try {
    await client
      .from('strategy_versions')
      .update({ status: STRATEGY_LIFECYCLE_STATUSES.SUPERSEDED })
      .eq('strategy_id', strategyId);
  } catch {
    // Non-blocking
  }
}

/**
 * Atomically supersedes expected current published strategy and inserts new StrategyVersion.
 * In Supabase: calls the atomic PostgreSQL RPC publish_strategy_version_atomic in a single transaction.
 * In memory: performs a transactional state update with full rollback if constraints fail.
 *
 * Guarantees:
 * - If insertion fails, supersession is rolled back (zero-published prevention).
 * - If expectedCurrentStrategyId does not match current published strategy, fails with conflict error.
 * - Single published strategy invariant is preserved.
 */
export async function publishStrategyVersionAtomic({
  newVersion,
  expectedCurrentStrategyId = null
} = {}, client = privateSupabase) {
  if (!newVersion || !newVersion.strategyId) {
    throw new Error('publishStrategyVersionAtomic requires a valid newVersion with strategyId');
  }

  assertZeroPrivateData(newVersion, 'PUBLISH_STRATEGY_VERSION_ATOMIC');

  // In-memory atomic execution helper with rollback snapshot
  const executeMemoryAtomic = () => {
    const prevVersionsSnapshot = new Map(memoryStrategyVersions);
    try {
      let currentPublished = null;
      for (const v of memoryStrategyVersions.values()) {
        if (v.status === STRATEGY_LIFECYCLE_STATUSES.PUBLISHED) {
          currentPublished = v;
          break;
        }
      }

      if (expectedCurrentStrategyId !== null) {
        if (!currentPublished) {
          const err = new Error(`STRATEGY_VERSION_CONFLICT: Expected published strategy ${expectedCurrentStrategyId} but none was found`);
          err.code = 'P0001';
          err.isConflict = true;
          throw err;
        }
        if (currentPublished.strategyId !== expectedCurrentStrategyId) {
          const err = new Error(`STRATEGY_VERSION_CONFLICT: Expected published strategy ${expectedCurrentStrategyId} but found ${currentPublished.strategyId}`);
          err.code = 'P0001';
          err.isConflict = true;
          throw err;
        }
      } else {
        // Cold start bootstrap check: no published strategy may already exist
        if (currentPublished) {
          const err = new Error(`STRATEGY_VERSION_CONFLICT: Cold-start bootstrap conflict; published strategy ${currentPublished.strategyId} already exists`);
          err.code = 'P0001';
          err.isConflict = true;
          throw err;
        }
      }

      // Supersede current published version if present
      if (currentPublished) {
        memoryStrategyVersions.set(currentPublished.strategyId, createStrategyVersion({
          ...currentPublished,
          status: STRATEGY_LIFECYCLE_STATUSES.SUPERSEDED
        }));
      }

      // Insert new version as published
      memoryStrategyVersions.set(newVersion.strategyId, newVersion);
      return { isDurable: false, strategy: newVersion };
    } catch (err) {
      // Rollback to prior snapshot
      memoryStrategyVersions.clear();
      for (const [k, v] of prevVersionsSnapshot.entries()) {
        memoryStrategyVersions.set(k, v);
      }
      throw err;
    }
  };

  if (!client) {
    return executeMemoryAtomic();
  }

  const row = strategyVersionToRow(newVersion);
  try {
    const { data, error } = await client.rpc('publish_strategy_version_atomic', {
      p_new_version: row,
      p_expected_current_strategy_id: expectedCurrentStrategyId
    });

    if (error) {
      if (error.code === 'P0001' || error.message?.includes('STRATEGY_VERSION_CONFLICT')) {
        const conflictErr = new Error(error.message);
        conflictErr.code = 'P0001';
        conflictErr.isConflict = true;
        throw conflictErr;
      }
      if (error.code === '23505' || error.message?.includes('idx_strategy_versions_single_published')) {
        const conflictErr = new Error('Unique constraint violation: idx_strategy_versions_single_published (multiple published versions forbidden)');
        conflictErr.code = '23505';
        conflictErr.isConflict = true;
        throw conflictErr;
      }
      if (error.code === 'PGRST202' || error.message?.includes('publish_strategy_version_atomic')) {
        // Function not yet present in remote schema cache (local/unapplied migration); fallback to memory atomic
        return executeMemoryAtomic();
      }
      throw error;
    }

    // Mirror to memory on successful DB commit
    executeMemoryAtomic();
    return { isDurable: true, strategy: rowToStrategyVersion(data) || newVersion };
  } catch (err) {
    await getCurrentPublishedStrategy(client);
    throw err;
  }
}

/**
 * Retrieves the latest StrategyAssessment for a given strategyId, or latest overall.
 * Supports { completedOnly: true } to isolate COMPLETED assessments from FAILED/DEFERRED attempts.
 */
export async function getLatestStrategyAssessment(strategyId = null, client = privateSupabase, options = {}) {
  let targetStrategyId = strategyId;
  let targetClient = client;
  let targetOptions = options;

  if (strategyId && typeof strategyId === 'object' && !('from' in strategyId)) {
    targetOptions = strategyId;
    targetStrategyId = null;
    targetClient = privateSupabase;
  } else if (client && typeof client === 'object' && !('from' in client) && ('completedOnly' in client)) {
    targetOptions = client;
    targetClient = privateSupabase;
  }

  const completedOnly = Boolean(targetOptions?.completedOnly);

  let latestMemory = null;
  for (const asmt of memoryStrategyAssessments.values()) {
    if (!targetStrategyId || asmt.strategyId === targetStrategyId) {
      if (completedOnly && asmt.evaluationStatus !== EVALUATION_STATUSES.COMPLETED) {
        continue;
      }
      if (!latestMemory || asmt.assessedAt > latestMemory.assessedAt) {
        latestMemory = asmt;
      }
    }
  }

  if (!targetClient) return latestMemory;

  try {
    let query = targetClient
      .from('strategy_assessments')
      .select('*');

    if (targetStrategyId) {
      query = query.eq('strategy_id', targetStrategyId);
    }
    if (completedOnly) {
      query = query.eq('evaluation_status', EVALUATION_STATUSES.COMPLETED);
    }

    query = query.order('assessed_at', { ascending: false }).limit(1);

    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length === 0) {
      return latestMemory;
    }

    const assessment = rowToStrategyAssessment(data[0]);
    if (assessment) {
      memoryStrategyAssessments.set(assessment.assessmentId, assessment);
    }
    return assessment;
  } catch {
    return latestMemory;
  }
}

/**
 * Retrieves the latest completed StrategyAssessment for a given strategyId or overall.
 * GUARANTEE: Incomplete, failed, or deferred assessments are strictly excluded.
 */
export async function getLatestCompletedStrategyAssessment(strategyId = null, client = privateSupabase) {
  return getLatestStrategyAssessment(strategyId, client, { completedOnly: true });
}

/**
 * Persists a StrategyAssessment (append-only).
 */
export async function persistStrategyAssessment(assessment, client = privateSupabase) {
  if (!assessment?.assessmentId) {
    throw new Error('persistStrategyAssessment requires a valid assessment with assessmentId');
  }

  assertZeroPrivateData(assessment, 'PERSIST_STRATEGY_ASSESSMENT');

  // In-memory append
  memoryStrategyAssessments.set(assessment.assessmentId, assessment);

  if (!client) {
    return { isDurable: false, assessmentId: assessment.assessmentId };
  }

  const row = strategyAssessmentToRow(assessment);
  try {
    const { error } = await client
      .from('strategy_assessments')
      .insert(row);

    if (error) {
      return { isDurable: false, assessmentId: assessment.assessmentId, error };
    }
    return { isDurable: true, assessmentId: assessment.assessmentId };
  } catch (err) {
    return { isDurable: false, assessmentId: assessment.assessmentId, error: err };
  }
}

/**
 * Lists StrategyAssessments for audit trail.
 */
export async function listStrategyAssessments(strategyId = null, client = privateSupabase, limit = 50) {
  const memoryList = Array.from(memoryStrategyAssessments.values())
    .filter((a) => !strategyId || a.strategyId === strategyId)
    .sort((a, b) => b.assessedAt.localeCompare(a.assessedAt))
    .slice(0, limit);

  if (!client) return memoryList;

  try {
    let query = client
      .from('strategy_assessments')
      .select('*')
      .order('assessed_at', { ascending: false })
      .limit(limit);

    if (strategyId) {
      query = query.eq('strategy_id', strategyId);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return memoryList;
    }

    return data.map(rowToStrategyAssessment).filter(Boolean);
  } catch {
    return memoryList;
  }
}

/**
 * Retrieves a StrategyAssessment by its idempotencyKey.
 */
export async function getStrategyAssessmentByIdempotencyKey(idempotencyKey, client = privateSupabase) {
  if (!idempotencyKey) return null;

  for (const asmt of memoryStrategyAssessments.values()) {
    if (asmt.idempotencyKey === idempotencyKey) {
      return asmt;
    }
  }

  if (!client) return null;

  try {
    const { data, error } = await client
      .from('strategy_assessments')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error || !data) return null;
    const assessment = rowToStrategyAssessment(data);
    if (assessment) {
      memoryStrategyAssessments.set(assessment.assessmentId, assessment);
    }
    return assessment;
  } catch {
    return null;
  }
}

/**
 * Strategy assessments are append-only.
 * Any attempt to UPDATE an assessment is rejected (mirrors DB trigger trg_prevent_strategy_assessments_mutation).
 */
export async function updateStrategyAssessment(assessmentId, updates = {}, client = privateSupabase) {
  const err = new Error('strategy_assessments is append-only: UPDATE and DELETE operations are forbidden.');
  err.code = 'APPEND_ONLY_VIOLATION';
  throw err;
}

/**
 * Strategy assessments are append-only.
 * Any attempt to DELETE an assessment is rejected (mirrors DB trigger trg_prevent_strategy_assessments_mutation).
 */
export async function deleteStrategyAssessment(assessmentId, client = privateSupabase) {
  const err = new Error('strategy_assessments is append-only: UPDATE and DELETE operations are forbidden.');
  err.code = 'APPEND_ONLY_VIOLATION';
  throw err;
}
