-- Migration: 20260905000000_strategist_run_manifest_and_evidence_versioning.sql
-- Description: Run manifests and evidence versioning audit trail for AI Market Strategist.
-- Public market strategy run manifests: strictly non-private market evidence and audit receipts.
-- Read-only for authenticated and anonymous users, writes restricted to service_role.

BEGIN;

-- Add versioning columns to market_news_articles if missing
ALTER TABLE IF EXISTS public.market_news_articles
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS version_id TEXT;

-- Safe deterministic backfill for existing legacy rows lacking version_id or content_hash.
-- Derives content_hash using SHA-256 of canonical fields, preserving exact article_id identity.
UPDATE public.market_news_articles
SET
    content_hash = COALESCE(
        content_hash,
        SUBSTRING(encode(sha256(convert_to(concat_ws('|', COALESCE(title, ''), COALESCE(excerpt, ''), COALESCE(published_at::text, ''), COALESCE(canonical_url, '')), 'UTF8')), 'hex') FROM 1 FOR 12)
    ),
    version_id = COALESCE(
        version_id,
        article_id || ':v_' || SUBSTRING(encode(sha256(convert_to(concat_ws('|', COALESCE(title, ''), COALESCE(excerpt, ''), COALESCE(published_at::text, ''), COALESCE(canonical_url, '')), 'UTF8')), 'hex') FROM 1 FOR 12)
    )
WHERE version_id IS NULL OR content_hash IS NULL;

-- Index on version_id for fast exact version lookups
CREATE INDEX IF NOT EXISTS idx_market_news_version_id
    ON public.market_news_articles (version_id);

-- Create run manifests table
CREATE TABLE IF NOT EXISTS public.market_strategist_runs (
    run_id TEXT PRIMARY KEY,
    packet_fingerprint TEXT NOT NULL,
    selected_observation_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_observation_ids) = 'array'),
    selected_article_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_article_ids) = 'array'),
    signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(signal_ids) = 'array'),
    prompt_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    selection_policy_version TEXT NOT NULL,
    model TEXT NOT NULL,
    generation_mode TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    data_as_of TIMESTAMPTZ NOT NULL,
    validation_result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_result) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_strategist_runs IS
    'Lightweight run manifest recording exact evidence version IDs, model, prompt/schema versions, dataAsOf, and validation receipts for AI Market Strategist syntheses. Contains ZERO private user/portfolio data.';

CREATE INDEX IF NOT EXISTS idx_market_strategist_runs_fingerprint
    ON public.market_strategist_runs (packet_fingerprint, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_strategist_runs_generated_at
    ON public.market_strategist_runs (generated_at DESC);

ALTER TABLE public.market_strategist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_strategist_runs_read ON public.market_strategist_runs;
CREATE POLICY market_strategist_runs_read
    ON public.market_strategist_runs
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_strategist_runs FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_strategist_runs FROM anon, authenticated;

GRANT SELECT ON public.market_strategist_runs TO anon, authenticated;
GRANT ALL ON public.market_strategist_runs TO service_role;

COMMIT;
