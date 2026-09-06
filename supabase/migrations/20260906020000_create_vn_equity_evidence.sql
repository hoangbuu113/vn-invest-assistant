-- Migration: 20260906020000_create_vn_equity_evidence.sql
-- Description: Immutable public evidence vintages for canonical Vietnam-listed equities.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vn_equity_evidence_observations (
    observation_id TEXT PRIMARY KEY,
    fact_id TEXT NOT NULL,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    company_name TEXT NOT NULL,
    evidence_type TEXT NOT NULL CHECK (
        evidence_type IN ('market_price', 'fundamental', 'disclosure')
    ),
    metric TEXT NOT NULL,
    numeric_value NUMERIC CHECK (
        numeric_value IS NULL OR numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    text_value TEXT,
    unit TEXT,
    currency TEXT,
    reference_period TEXT NOT NULL,
    observed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    source_available_at TIMESTAMPTZ,
    system_knowable_at TIMESTAMPTZ NOT NULL CHECK (
        system_knowable_at >= first_seen_at
        AND (source_available_at IS NULL OR system_knowable_at >= source_available_at)
    ),
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_family TEXT NOT NULL,
    dependency_group TEXT NOT NULL,
    authority_level TEXT NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('available', 'stale')),
    freshness TEXT NOT NULL CHECK (freshness IN ('fresh', 'delayed', 'stale')),
    status_reason TEXT,
    revision_marker TEXT,
    source_content_hash TEXT NOT NULL,
    methodology_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        numeric_value IS NOT NULL OR (text_value IS NOT NULL AND btrim(text_value) <> '')
    ),
    CHECK (metric <> 'close' OR (numeric_value IS NOT NULL AND numeric_value > 0)),
    CHECK (metric <> 'volume' OR (numeric_value IS NOT NULL AND numeric_value >= 0))
);

COMMENT ON TABLE public.vn_equity_evidence_observations IS
    'Immutable, replay-safe public evidence vintages for canonical Vietnam-listed equities. Provider collection is backend-only.';

CREATE INDEX IF NOT EXISTS idx_vn_equity_evidence_symbol_fact_vintage
    ON public.vn_equity_evidence_observations (
        symbol,
        fact_id,
        reference_period DESC,
        system_knowable_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_vn_equity_evidence_asset_type_period
    ON public.vn_equity_evidence_observations (
        asset_id,
        evidence_type,
        reference_period DESC
    );

ALTER TABLE public.vn_equity_evidence_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vn_equity_evidence_read ON public.vn_equity_evidence_observations;
CREATE POLICY vn_equity_evidence_read
    ON public.vn_equity_evidence_observations
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM service_role;

GRANT SELECT ON public.vn_equity_evidence_observations TO anon, authenticated;
GRANT SELECT, INSERT ON public.vn_equity_evidence_observations TO service_role;

COMMIT;
