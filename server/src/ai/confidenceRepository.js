import { privateSupabase } from '../supabase.js';
import { CALIBRATION_STATUS, createCalibrationManifest, createConfidenceAssessment } from './confidenceModel.js';

const memoryAssessments = new Map();
const memoryManifests = new Map();

function isTestEnvironment() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NODE_ENV === 'test'
    || process.execArgv.some((arg) => String(arg).includes('--test'))
    || process.argv.some((arg) => /(?:node:test|\.test\.js)/.test(String(arg)));
}

function resolveClient(client) {
  if (client === null) {
    if (isTestEnvironment() || process.env.CONFIDENCE_REPOSITORY_OFFLINE === 'true') return null;
    const error = new Error('CONFIDENCE_MEMORY_MODE_NOT_AUTHORIZED');
    error.code = 'CONFIDENCE_MEMORY_MODE_NOT_AUTHORIZED';
    throw error;
  }
  if (client !== undefined) return client;
  if (isTestEnvironment()) return null;
  if (!privateSupabase) {
    const error = new Error('CONFIDENCE_REPOSITORY_CLIENT_UNCONFIGURED');
    error.code = 'CONFIDENCE_REPOSITORY_CLIENT_UNCONFIGURED';
    throw error;
  }
  return privateSupabase;
}

export function confidenceAssessmentToRow(assessment) {
  return {
    assessment_id: assessment.assessmentId,
    target_type: assessment.targetType,
    target_id: assessment.targetId,
    scope: assessment.scope,
    horizon: assessment.horizon,
    cutoff: assessment.cutoff,
    as_of: assessment.asOf,
    input_fingerprint: assessment.inputFingerprint,
    profile_version: assessment.profileVersion,
    policy_version: assessment.policyVersion,
    evidence_support: assessment.evidenceSupport,
    candidate_grade: assessment.candidateGrade,
    public_grade: assessment.publicGrade,
    assessment_status: assessment.assessmentStatus,
    calibration_status: assessment.calibrationStatus,
    calibration_applicable: assessment.calibrationApplicable,
    calibration_manifest_id: assessment.calibrationManifestId,
    gate_results: assessment.gateResults,
    caps: assessment.caps,
    reasons: assessment.reasons,
    upgrade_requirements: assessment.upgradeRequirements,
    strategy_assessment_id: assessment.strategyAssessmentId,
    strategy_id: assessment.strategyId,
    strategy_version: assessment.strategyVersion,
    created_at: assessment.createdAt
  };
}

export function rowToConfidenceAssessment(row) {
  if (!row?.assessment_id) return null;
  return createConfidenceAssessment({
    assessmentId: row.assessment_id,
    targetType: row.target_type,
    targetId: row.target_id,
    scope: row.scope,
    horizon: row.horizon,
    cutoff: row.cutoff,
    asOf: row.as_of,
    inputFingerprint: row.input_fingerprint,
    profileVersion: row.profile_version,
    policyVersion: row.policy_version,
    evidenceSupport: row.evidence_support,
    candidateGrade: row.candidate_grade,
    publicGrade: row.public_grade,
    assessmentStatus: row.assessment_status,
    calibrationStatus: row.calibration_status,
    calibrationApplicable: row.calibration_applicable === true,
    calibrationManifestId: row.calibration_manifest_id,
    gateResults: row.gate_results || [],
    caps: row.caps || [],
    reasons: row.reasons || [],
    upgradeRequirements: row.upgrade_requirements || [],
    strategyAssessmentId: row.strategy_assessment_id,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    createdAt: row.created_at
  });
}

export async function persistConfidenceAssessment(assessment, client = undefined) {
  const row = confidenceAssessmentToRow(assessment);
  const target = resolveClient(client);
  if (target === null) {
    if (!memoryAssessments.has(assessment.assessmentId)) memoryAssessments.set(assessment.assessmentId, assessment);
    return { isDurable: false, memoryOnly: true, assessment };
  }
  const query = target.from('confidence_assessments').upsert(row, { onConflict: 'assessment_id', ignoreDuplicates: true });
  const { data, error } = typeof query?.select === 'function' ? await query.select('*') : await query;
  if (error) {
    const dbError = new Error('CONFIDENCE_ASSESSMENT_PERSISTENCE_FAILED');
    dbError.code = 'CONFIDENCE_ASSESSMENT_PERSISTENCE_FAILED';
    dbError.cause = error;
    throw dbError;
  }
  const persisted = Array.isArray(data) && data[0] ? rowToConfidenceAssessment(data[0]) : assessment;
  memoryAssessments.set(persisted.assessmentId, persisted);
  return { isDurable: true, memoryOnly: false, assessment: persisted };
}

export async function getConfidenceAssessmentById(assessmentId, client = undefined) {
  const target = resolveClient(client);
  if (target === null) return memoryAssessments.get(assessmentId) || null;
  const { data, error } = await target.from('confidence_assessments').select('*').eq('assessment_id', assessmentId).maybeSingle();
  if (error) throw Object.assign(new Error('CONFIDENCE_ASSESSMENT_QUERY_FAILED'), { code: 'CONFIDENCE_ASSESSMENT_QUERY_FAILED', cause: error });
  const assessment = data ? rowToConfidenceAssessment(data) : null;
  if (assessment) memoryAssessments.set(assessment.assessmentId, assessment);
  return assessment;
}

export async function getLatestConfidenceAssessment(targetId, scope, client = undefined) {
  const target = resolveClient(client);
  if (target === null) {
    return [...memoryAssessments.values()].filter((item) => item.targetId === targetId && item.scope === scope).sort((left, right) => right.asOf.localeCompare(left.asOf) || right.assessmentId.localeCompare(left.assessmentId))[0] || null;
  }
  const { data, error } = await target.from('confidence_assessments').select('*').eq('target_id', targetId).eq('scope', scope).order('as_of', { ascending: false }).order('assessment_id', { ascending: false }).limit(1);
  if (error) throw Object.assign(new Error('CONFIDENCE_ASSESSMENT_QUERY_FAILED'), { code: 'CONFIDENCE_ASSESSMENT_QUERY_FAILED', cause: error });
  const assessment = Array.isArray(data) && data[0] ? rowToConfidenceAssessment(data[0]) : null;
  if (assessment) memoryAssessments.set(assessment.assessmentId, assessment);
  return assessment;
}

export function calibrationManifestToRow(manifest) {
  return {
    manifest_id: manifest.manifestId,
    cohort: manifest.cohort,
    target_type: manifest.targetType,
    claim_type: manifest.claimType,
    scope: manifest.scope,
    horizon: manifest.horizon,
    policy_version: manifest.policyVersion,
    profile_version: manifest.profileVersion,
    model_version: manifest.modelVersion,
    dataset_start_at: manifest.datasetStartAt,
    dataset_end_at: manifest.datasetEndAt,
    evaluation_method: manifest.evaluationMethod,
    applicability: manifest.applicability,
    release_criteria: manifest.releaseCriteria,
    status: manifest.status,
    effective_at: manifest.effectiveAt,
    created_at: manifest.createdAt
  };
}

export function rowToCalibrationManifest(row) {
  if (!row?.manifest_id) return null;
  return createCalibrationManifest({
    manifestId: row.manifest_id,
    cohort: row.cohort,
    targetType: row.target_type,
    claimType: row.claim_type,
    scope: row.scope,
    horizon: row.horizon,
    policyVersion: row.policy_version,
    profileVersion: row.profile_version,
    modelVersion: row.model_version,
    datasetStartAt: row.dataset_start_at,
    datasetEndAt: row.dataset_end_at,
    evaluationMethod: row.evaluation_method || {},
    applicability: row.applicability || {},
    releaseCriteria: row.release_criteria || {},
    status: row.status,
    effectiveAt: row.effective_at,
    createdAt: row.created_at
  });
}

export async function persistCalibrationManifest(manifest, client = undefined, { allowValidatedTestFixture = false } = {}) {
  const target = resolveClient(client);
  if (manifest.status === CALIBRATION_STATUS.VALIDATED && !(target === null && allowValidatedTestFixture)) {
    throw Object.assign(new Error('PRODUCTION_VALIDATED_CALIBRATION_NOT_AUTHORIZED'), { code: 'PRODUCTION_VALIDATED_CALIBRATION_NOT_AUTHORIZED' });
  }
  if (target === null) {
    memoryManifests.set(manifest.manifestId, manifest);
    return { isDurable: false, memoryOnly: true, manifest };
  }
  const { data, error } = await target.from('calibration_manifests').insert(calibrationManifestToRow(manifest)).select('*');
  if (error) throw Object.assign(new Error('CALIBRATION_MANIFEST_PERSISTENCE_FAILED'), { code: 'CALIBRATION_MANIFEST_PERSISTENCE_FAILED', cause: error });
  const persisted = Array.isArray(data) && data[0] ? rowToCalibrationManifest(data[0]) : manifest;
  memoryManifests.set(persisted.manifestId, persisted);
  return { isDurable: true, memoryOnly: false, manifest: persisted };
}

export async function listCalibrationManifests({ targetType, scope, policyVersion, client = undefined } = {}) {
  const target = resolveClient(client);
  if (target === null) return [...memoryManifests.values()].filter((item) => (!targetType || item.targetType === targetType) && (!scope || item.scope === scope) && (!policyVersion || item.policyVersion === policyVersion)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  let query = target.from('calibration_manifests').select('*');
  if (targetType) query = query.eq('target_type', targetType);
  if (scope) query = query.eq('scope', scope);
  if (policyVersion) query = query.eq('policy_version', policyVersion);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw Object.assign(new Error('CALIBRATION_MANIFEST_QUERY_FAILED'), { code: 'CALIBRATION_MANIFEST_QUERY_FAILED', cause: error });
  return (Array.isArray(data) ? data : []).map(rowToCalibrationManifest).filter(Boolean);
}

export function clearConfidenceMemoryForTest() {
  memoryAssessments.clear();
  memoryManifests.clear();
}

export function getConfidenceMemorySnapshotForTest() {
  return { assessments: new Map(memoryAssessments), manifests: new Map(memoryManifests) };
}
