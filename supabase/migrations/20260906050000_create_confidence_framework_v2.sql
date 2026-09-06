-- Migration: 20260906050000_create_confidence_framework_v2.sql
-- Immutable, public confidence assessments and calibration-manifest foundation.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calibration_manifests (
    manifest_id TEXT PRIMARY KEY,
    cohort TEXT,
    target_type TEXT NOT NULL CHECK (target_type IN ('MARKET_STRATEGY', 'CLAIM', 'PILLAR')),
    claim_type TEXT,
    scope TEXT NOT NULL,
    horizon TEXT,
    policy_version TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    model_version TEXT,
    dataset_start_at TIMESTAMPTZ,
    dataset_end_at TIMESTAMPTZ,
    evaluation_method JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evaluation_method) = 'object'),
    applicability JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(applicability) = 'object'),
    release_criteria JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(release_criteria) = 'object'),
    status TEXT NOT NULL DEFAULT 'UNVALIDATED' CHECK (status IN ('UNVALIDATED', 'PARTIAL', 'VALIDATED', 'SUSPENDED')),
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.confidence_assessments (
    assessment_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('MARKET_STRATEGY', 'CLAIM', 'PILLAR')),
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    horizon TEXT,
    cutoff TIMESTAMPTZ NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    input_fingerprint TEXT NOT NULL,
    profile_version TEXT,
    policy_version TEXT NOT NULL,
    evidence_support TEXT NOT NULL CHECK (evidence_support IN ('STRONG', 'ADEQUATE', 'FRAGILE', 'INSUFFICIENT')),
    candidate_grade TEXT CHECK (candidate_grade IS NULL OR candidate_grade IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    public_grade TEXT CHECK (public_grade IS NULL OR public_grade IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    assessment_status TEXT NOT NULL CHECK (assessment_status IN ('ASSESSED', 'NOT_ASSESSED')),
    calibration_status TEXT NOT NULL DEFAULT 'UNVALIDATED' CHECK (calibration_status IN ('UNVALIDATED', 'PARTIAL', 'VALIDATED', 'SUSPENDED')),
    calibration_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    calibration_manifest_id TEXT REFERENCES public.calibration_manifests(manifest_id) ON DELETE RESTRICT,
    calibration_knowable_at TIMESTAMPTZ,
    gate_results JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gate_results) = 'array'),
    caps JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(caps) = 'array'),
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
    upgrade_requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(upgrade_requirements) = 'array'),
    strategy_assessment_id TEXT REFERENCES public.strategy_assessments(assessment_id) ON DELETE RESTRICT,
    strategy_id TEXT REFERENCES public.strategy_versions(strategy_id) ON DELETE RESTRICT,
    strategy_version TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (
        (assessment_status = 'NOT_ASSESSED' AND candidate_grade IS NULL AND public_grade IS NULL)
        OR
        (assessment_status = 'ASSESSED' AND candidate_grade IS NOT NULL AND public_grade IS NOT NULL)
    ),
    CHECK (candidate_grade <> 'INSUFFICIENT_EVIDENCE' OR public_grade = 'INSUFFICIENT_EVIDENCE'),
    CHECK (
        public_grade <> 'HIGH'
        OR (
            assessment_status = 'ASSESSED'
            AND candidate_grade = 'HIGH'
            AND calibration_status = 'VALIDATED'
            AND calibration_applicable = TRUE
            AND calibration_manifest_id IS NOT NULL
            AND calibration_knowable_at IS NOT NULL
            AND calibration_knowable_at <= cutoff
            AND jsonb_array_length(caps) = 0
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_confidence_assessments_target_as_of
    ON public.confidence_assessments (target_type, target_id, scope, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_confidence_assessments_input_policy
    ON public.confidence_assessments (input_fingerprint, profile_version, policy_version);
CREATE INDEX IF NOT EXISTS idx_calibration_manifests_applicability
    ON public.calibration_manifests (target_type, scope, profile_version, policy_version, effective_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_confidence_framework_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Confidence framework records are append-only: UPDATE and DELETE are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_confidence_assessments_mutation ON public.confidence_assessments;
CREATE TRIGGER trg_prevent_confidence_assessments_mutation
    BEFORE UPDATE OR DELETE ON public.confidence_assessments
    FOR EACH ROW EXECUTE FUNCTION public.prevent_confidence_framework_mutation();

DROP TRIGGER IF EXISTS trg_prevent_calibration_manifests_mutation ON public.calibration_manifests;
CREATE TRIGGER trg_prevent_calibration_manifests_mutation
    BEFORE UPDATE OR DELETE ON public.calibration_manifests
    FOR EACH ROW EXECUTE FUNCTION public.prevent_confidence_framework_mutation();

ALTER TABLE public.confidence_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY confidence_assessments_public_read ON public.confidence_assessments FOR SELECT USING (true);
CREATE POLICY calibration_manifests_public_read ON public.calibration_manifests FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.confidence_assessments FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.confidence_assessments FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.calibration_manifests FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.calibration_manifests FROM service_role;

GRANT SELECT ON public.confidence_assessments TO anon, authenticated;
GRANT SELECT, INSERT ON public.confidence_assessments TO service_role;
GRANT SELECT ON public.calibration_manifests TO anon, authenticated;
GRANT SELECT, INSERT ON public.calibration_manifests TO service_role;

COMMIT;
