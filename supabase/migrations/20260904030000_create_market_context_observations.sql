-- Migration: 20260904030000_create_market_context_observations.sql
-- Description: Durable persistence table for validated global market context observations.
-- Global public market data: strictly global financial observations. Read-only for public, writes restricted to service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_context_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id TEXT NOT NULL,
    observation_id TEXT NOT NULL UNIQUE,
    pillar TEXT NOT NULL CHECK (pillar IN ('macro', 'monetary', 'market', 'intermarket')),
    metric TEXT NOT NULL,
    label TEXT,
    numeric_value NUMERIC NOT NULL CHECK (
        numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    unit TEXT NOT NULL,
    unit_type TEXT,
    change_value NUMERIC CHECK (
        change_value IS NULL OR change_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    change_unit TEXT,
    change_unit_type TEXT,
    change_percent NUMERIC CHECK (
        change_percent IS NULL OR change_percent::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    change_basis TEXT,
    previous_value NUMERIC CHECK (
        previous_value IS NULL OR previous_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    volume NUMERIC CHECK (
        volume IS NULL OR (volume >= 0 AND volume::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'))
    ),
    volume_unit TEXT,
    quote_direction TEXT,
    reference_time TEXT,
    observed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_id TEXT NOT NULL,
    authority_level TEXT,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'available' CHECK (
        status IN ('available', 'unavailable', 'stale')
    ),
    freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (
        freshness IN ('fresh', 'stale', 'delayed')
    ),
    quality_status TEXT NOT NULL DEFAULT 'available' CHECK (
        quality_status IN ('available', 'verified', 'preliminary', 'revised', 'reported')
    ),
    revision_marker TEXT,
    source_content_hash TEXT,
    methodology_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_context_observations IS
    'Durable persistence for validated global market context facts across macro, monetary, Vietnam equities, and intermarket indicators. Strictly public/global. Writes restricted to backend service_role.';

-- Indices for fast retrieval of latest observations per fact
CREATE INDEX IF NOT EXISTS idx_market_context_fact_vintage
    ON public.market_context_observations (fact_id, reference_time DESC, published_at DESC NULLS LAST, observed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_market_context_pillar_observed
    ON public.market_context_observations (pillar, observed_at DESC NULLS LAST);

-- Enable Row Level Security (RLS)
ALTER TABLE public.market_context_observations ENABLE ROW LEVEL SECURITY;

-- Read policy: Public global data is readable by all (anon, authenticated, service_role)
DROP POLICY IF EXISTS market_context_observations_read ON public.market_context_observations;
CREATE POLICY market_context_observations_read
    ON public.market_context_observations
    FOR SELECT
    USING (true);

-- Revoke all table modifications from public, anon, and authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_observations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_observations FROM anon, authenticated;

-- Grant select to anon and authenticated
GRANT SELECT ON public.market_context_observations TO anon, authenticated;

-- Grant all privileges to service_role (backend authorizer)
GRANT ALL ON public.market_context_observations TO service_role;

COMMIT;
