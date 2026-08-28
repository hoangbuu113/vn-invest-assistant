-- Migration: Create watchlist_items table for single-user investor profile

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.watchlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_watchlist_items_profile_asset UNIQUE (profile_id, asset_id)
);

-- 2. Indexes for fast lookups by profile_id and asset_id
CREATE INDEX IF NOT EXISTS idx_watchlist_items_profile_id ON public.watchlist_items (profile_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_asset_id ON public.watchlist_items (asset_id);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

-- 4. Allow public read access to watchlist_items
DROP POLICY IF EXISTS "Allow public read access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public read access to watchlist_items"
    ON public.watchlist_items
    FOR SELECT
    USING (true);

-- 5. Allow public insert access to watchlist_items
DROP POLICY IF EXISTS "Allow public insert access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public insert access to watchlist_items"
    ON public.watchlist_items
    FOR INSERT
    WITH CHECK (true);

-- 6. Allow public delete access to watchlist_items
DROP POLICY IF EXISTS "Allow public delete access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public delete access to watchlist_items"
    ON public.watchlist_items
    FOR DELETE
    USING (true);

