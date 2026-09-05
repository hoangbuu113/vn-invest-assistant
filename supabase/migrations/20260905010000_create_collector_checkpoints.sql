-- Migration: 20260905010000_create_collector_checkpoints.sql
-- Description: Durable scheduling and checkpoint tracking for slow-moving official macro and monetary context data sources.
-- Allows the Cloudflare 15-minute cron to skip sources that are not due, preventing excessive polling of NSO and SBV websites.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_context_collector_checkpoints (
    source_key TEXT PRIMARY KEY,
    last_attempted_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    next_due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (
        status IN ('idle', 'in_progress', 'success', 'failed', 'quarantined', 'blocked/access_denied')
    ),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_context_collector_checkpoints IS
    'Tracks durable due-gating and checkpoint metadata for background official market context sources (NSO, SBV). Read-only for public, writes restricted to service_role.';

-- Index for querying due source jobs quickly
CREATE INDEX IF NOT EXISTS idx_collector_checkpoints_due
    ON public.market_context_collector_checkpoints (next_due_at);

-- Enable Row Level Security (RLS)
ALTER TABLE public.market_context_collector_checkpoints ENABLE ROW LEVEL SECURITY;

-- Read policy: Checkpoint status is globally readable
DROP POLICY IF EXISTS collector_checkpoints_read ON public.market_context_collector_checkpoints;
CREATE POLICY collector_checkpoints_read
    ON public.market_context_collector_checkpoints
    FOR SELECT
    USING (true);

-- Revoke write privileges from public, anon, and authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_collector_checkpoints FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_collector_checkpoints FROM anon, authenticated;

-- Grant select to anon and authenticated
GRANT SELECT ON public.market_context_collector_checkpoints TO anon, authenticated;

-- Grant all privileges to backend service_role
GRANT ALL ON public.market_context_collector_checkpoints TO service_role;

COMMIT;