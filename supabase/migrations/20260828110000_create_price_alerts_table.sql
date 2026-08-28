-- Migration: Create price_alerts table for single-user investor profile (Feature 12)

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.price_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('above', 'below')),
    target_price NUMERIC(15, 2) NOT NULL CHECK (target_price > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered')),
    last_evaluated_price NUMERIC(15, 2) DEFAULT NULL,
    last_evaluated_at TIMESTAMPTZ DEFAULT NULL,
    triggered_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_price_alerts_identity UNIQUE (profile_id, asset_id, direction, target_price)
);

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_price_alerts_profile_id ON public.price_alerts (profile_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_asset_id ON public.price_alerts (asset_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_status ON public.price_alerts (status);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

-- 4. Allow public read access to price_alerts
DROP POLICY IF EXISTS "Allow public read access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public read access to price_alerts"
    ON public.price_alerts
    FOR SELECT
    USING (true);

-- 5. Allow public insert access to price_alerts
DROP POLICY IF EXISTS "Allow public insert access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public insert access to price_alerts"
    ON public.price_alerts
    FOR INSERT
    WITH CHECK (true);

-- 6. Allow public update access to price_alerts
DROP POLICY IF EXISTS "Allow public update access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public update access to price_alerts"
    ON public.price_alerts
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- 7. Allow public delete access to price_alerts
DROP POLICY IF EXISTS "Allow public delete access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public delete access to price_alerts"
    ON public.price_alerts
    FOR DELETE
    USING (true);

