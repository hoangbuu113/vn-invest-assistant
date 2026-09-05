-- Migration: 20260906000000_create_strategy_stability_foundation.sql
-- Description: Creates public.strategy_versions and public.strategy_assessments tables
-- for AI Market Strategist Two-Clock Stability architecture.
-- Immutable published strategy versions and append-only evaluation audit trail.
-- Public read-only via RLS; writes strictly restricted to service_role. Zero private user/portfolio data.

BEGIN;

CREATE TABLE IF NOT EXISTS public.strategy_versions (
    strategy_id TEXT PRIMARY KEY,
    previous_strategy_id TEXT REFERENCES public.strategy_versions(strategy_id),
    generated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    data_as_of TIMESTAMPTZ NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    decision_fingerprint TEXT NOT NULL,
    trigger_reason JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_reason) = 'object'),
    material_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(material_changes) = 'array'),
    confidence TEXT NOT NULL CHECK (
        confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')
    ),
    regime JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(regime) = 'object'),
    executive_decision JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(executive_decision) = 'object'),
    asset_strategy JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(asset_strategy) = 'array'),
    preferred_themes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preferred_themes) = 'array'),
    avoid_or_underweight JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(avoid_or_underweight) = 'array'),
    risk_overlay JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(risk_overlay) = 'object'),
    horizon TEXT NOT NULL,
    invalidation_conditions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(invalidation_conditions) = 'array'),
    status TEXT NOT NULL CHECK (status IN ('published', 'superseded')),
    policy_version TEXT NOT NULL,
    run_manifest_id TEXT,
    next_review_due_at TIMESTAMPTZ,
    limitations TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'STABLE' CHECK (
        lifecycle_state IN ('STABLE', 'WATCH', 'REVIEW_REQUIRED', 'EVALUATING')
    ),
    data_quality_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (
        data_quality_state IN ('HEALTHY', 'DEGRADED', 'INSUFFICIENT')
    ),
    watch_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watch_reasons) = 'array'),
    shock_override JSONB DEFAULT NULL CHECK (shock_override IS NULL OR jsonb_typeof(shock_override) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.strategy_versions IS
    'Immutable published market strategy decisions. Strictly non-private global market intelligence.';

CREATE TABLE IF NOT EXISTS public.strategy_assessments (
    assessment_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES public.strategy_versions(strategy_id),
    assessed_at TIMESTAMPTZ NOT NULL,
    data_as_of TIMESTAMPTZ NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    previous_evidence_fingerprint TEXT,
    decision_fingerprint TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK (
        confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')
    ),
    previous_confidence TEXT CHECK (
        previous_confidence IS NULL OR previous_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')
    ),
    result TEXT NOT NULL CHECK (
        result IN ('KEEP', 'DETAILS', 'CONFIDENCE', 'PUBLISH_NEW')
    ),
    evaluation_status TEXT NOT NULL CHECK (
        evaluation_status IN ('COMPLETED', 'FAILED', 'DEFERRED', 'SUPERSEDED')
    ),
    trigger_reason JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_reason) = 'object'),
    material_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(material_changes) = 'array'),
    limitations TEXT,
    policy_version TEXT NOT NULL,
    run_manifest_id TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'STABLE' CHECK (
        lifecycle_state IN ('STABLE', 'WATCH', 'REVIEW_REQUIRED', 'EVALUATING')
    ),
    data_quality_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (
        data_quality_state IN ('HEALTHY', 'DEGRADED', 'INSUFFICIENT')
    ),
    watch_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watch_reasons) = 'array'),
    shock_override JSONB DEFAULT NULL CHECK (shock_override IS NULL OR jsonb_typeof(shock_override) = 'object'),
    confirmation_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(confirmation_keys) = 'array'),
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.strategy_assessments IS
    'Append-only evaluation log assessing incoming evidence packets against active strategy versions. Strictly non-private.';

-- Indices
-- Concurrency Hardening: Partial unique index ensuring at most ONE active published strategy version
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_versions_single_published
    ON public.strategy_versions ((status))
    WHERE (status = 'published');

CREATE INDEX IF NOT EXISTS idx_strategy_versions_status_published
    ON public.strategy_versions (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_versions_decision_fp
    ON public.strategy_versions (decision_fingerprint);

CREATE INDEX IF NOT EXISTS idx_strategy_versions_evidence_fp
    ON public.strategy_versions (evidence_fingerprint);

CREATE INDEX IF NOT EXISTS idx_strategy_assessments_strategy
    ON public.strategy_assessments (strategy_id, assessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_assessments_assessed_at
    ON public.strategy_assessments (assessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_assessments_evidence_fp
    ON public.strategy_assessments (evidence_fingerprint);

CREATE INDEX IF NOT EXISTS idx_strategy_assessments_idempotency
    ON public.strategy_assessments (idempotency_key)
    WHERE (idempotency_key IS NOT NULL);

-- Append-Only Hardening: PostgreSQL trigger blocking UPDATE and DELETE on strategy_assessments
CREATE OR REPLACE FUNCTION public.prevent_strategy_assessments_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'strategy_assessments is append-only: UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_strategy_assessments_mutation ON public.strategy_assessments;
CREATE TRIGGER trg_prevent_strategy_assessments_mutation
    BEFORE UPDATE OR DELETE ON public.strategy_assessments
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_strategy_assessments_mutation();

-- Row Level Security (RLS)
ALTER TABLE public.strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_assessments ENABLE ROW LEVEL SECURITY;

-- Read policy: Public global data readable by all (anon, authenticated, service_role)
DROP POLICY IF EXISTS strategy_versions_read ON public.strategy_versions;
CREATE POLICY strategy_versions_read
    ON public.strategy_versions
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS strategy_assessments_read ON public.strategy_assessments;
CREATE POLICY strategy_assessments_read
    ON public.strategy_assessments
    FOR SELECT
    USING (true);

-- Revoke modifications from public, anon, authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_versions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_versions FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_assessments FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_assessments FROM anon, authenticated;

-- Grant select to anon and authenticated
GRANT SELECT ON public.strategy_versions TO anon, authenticated;
GRANT SELECT ON public.strategy_assessments TO anon, authenticated;

-- Grant privileges to service_role (SELECT, INSERT, UPDATE on strategy_versions for status supersession)
GRANT ALL ON public.strategy_versions TO service_role;
GRANT SELECT, INSERT ON public.strategy_assessments TO service_role;

COMMIT;
