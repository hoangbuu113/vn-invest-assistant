-- ==========================================================
-- Schema Migration: 001_create_assets_table.sql
-- Purpose: Master table for investment assets
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(50) NOT NULL,
    exchange VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast symbol lookup and filtering by asset type
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON public.assets (symbol);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON public.assets (asset_type);

-- Enable Row Level Security (RLS)
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Allow public read access to assets table (for SELECT operations)
DROP POLICY IF EXISTS "Allow public read access to assets" ON public.assets;
CREATE POLICY "Allow public read access to assets"
    ON public.assets
    FOR SELECT
    USING (true);

-- ==========================================================
-- Schema Migration: 002_create_investor_profile_table.sql
-- Purpose: Single-user investor profile table for capital, risk & horizon
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.investor_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    singleton_key SMALLINT NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
    cash_available NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cash_available >= 0),
    risk_tolerance VARCHAR(20) NOT NULL CHECK (risk_tolerance IN ('low', 'moderate', 'high')),
    investment_horizon VARCHAR(20) NOT NULL CHECK (investment_horizon IN ('short', 'medium', 'long')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.investor_profile ENABLE ROW LEVEL SECURITY;

-- Allow public read access to investor_profile table
DROP POLICY IF EXISTS "Allow public read access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public read access to investor_profile"
    ON public.investor_profile
    FOR SELECT
    USING (true);

-- Allow public insert access to investor_profile table
DROP POLICY IF EXISTS "Allow public insert access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public insert access to investor_profile"
    ON public.investor_profile
    FOR INSERT
    WITH CHECK (true);

-- Allow public update access to investor_profile table
DROP POLICY IF EXISTS "Allow public update access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public update access to investor_profile"
    ON public.investor_profile
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- ==========================================================
-- Schema Migration: 003_create_holdings_table.sql
-- Purpose: User asset portfolio holdings table
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    quantity NUMERIC(15, 4) NOT NULL CHECK (quantity > 0),
    average_cost NUMERIC(15, 2) NOT NULL CHECK (average_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_holdings_profile_asset UNIQUE (profile_id, asset_id)
);

-- Index for fast lookups by profile_id and asset_id
CREATE INDEX IF NOT EXISTS idx_holdings_profile_id ON public.holdings (profile_id);
CREATE INDEX IF NOT EXISTS idx_holdings_asset_id ON public.holdings (asset_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

-- Allow public read access to holdings table
DROP POLICY IF EXISTS "Allow public read access to holdings" ON public.holdings;
CREATE POLICY "Allow public read access to holdings"
    ON public.holdings
    FOR SELECT
    USING (true);

-- Allow public insert access to holdings table
DROP POLICY IF EXISTS "Allow public insert access to holdings" ON public.holdings;
CREATE POLICY "Allow public insert access to holdings"
    ON public.holdings
    FOR INSERT
    WITH CHECK (true);

-- Allow public update access to holdings table
DROP POLICY IF EXISTS "Allow public update access to holdings" ON public.holdings;
CREATE POLICY "Allow public update access to holdings"
    ON public.holdings
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Allow public delete access to holdings table
DROP POLICY IF EXISTS "Allow public delete access to holdings" ON public.holdings;
CREATE POLICY "Allow public delete access to holdings"
    ON public.holdings
    FOR DELETE
    USING (true);



