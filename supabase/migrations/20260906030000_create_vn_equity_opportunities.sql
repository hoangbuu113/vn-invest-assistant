-- Migration: 20260906030000_create_vn_equity_opportunities.sql
-- Description: Immutable deterministic Vietnam equity opportunity evaluations.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vn_equity_opportunity_evaluations (
    evaluation_id TEXT PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    company_name TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    evidence_version TEXT NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    qualification_status TEXT NOT NULL CHECK (
        qualification_status IN ('QUALIFIED', 'WATCH', 'INSUFFICIENT_EVIDENCE', 'REJECTED')
    ),
    qualification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(qualification_reasons) = 'array'
    ),
    disqualification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(disqualification_reasons) = 'array'
    ),
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(evidence_refs) = 'array'
    ),
    data_quality JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(data_quality) = 'object'
    ),
    missing_requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(missing_requirements) = 'array'
    ),
    explanation JSONB CHECK (
        explanation IS NULL OR jsonb_typeof(explanation) = 'object'
    ),
    evaluated_at TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (asset_id, as_of, evidence_fingerprint, policy_version)
);

COMMENT ON TABLE public.vn_equity_opportunity_evaluations IS
    'Immutable public deterministic evidence-screen evaluations. Ordering is not investment preference.';

CREATE INDEX IF NOT EXISTS idx_vn_equity_opportunities_symbol_as_of
    ON public.vn_equity_opportunity_evaluations (symbol, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_vn_equity_opportunities_status_as_of
    ON public.vn_equity_opportunity_evaluations (qualification_status, as_of DESC);

ALTER TABLE public.vn_equity_opportunity_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vn_equity_opportunity_read ON public.vn_equity_opportunity_evaluations;
CREATE POLICY vn_equity_opportunity_read
    ON public.vn_equity_opportunity_evaluations
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM service_role;

GRANT SELECT ON public.vn_equity_opportunity_evaluations TO anon, authenticated;
GRANT SELECT, INSERT ON public.vn_equity_opportunity_evaluations TO service_role;

COMMIT;
