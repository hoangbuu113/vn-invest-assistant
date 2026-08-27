-- ==========================================================
-- Seed Data: 002_seed_assets.sql
-- Purpose: Initial well-known Vietnamese listed assets
-- Idempotent: ON CONFLICT (symbol) DO NOTHING / UPDATE
-- ==========================================================

INSERT INTO public.assets (symbol, name, asset_type, exchange)
VALUES
    ('VCB', 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)', 'stock', 'HOSE'),
    ('FPT', 'FPT Corporation', 'stock', 'HOSE'),
    ('HPG', 'Hoa Phat Group Joint Stock Company', 'stock', 'HOSE'),
    ('VNM', 'Vietnam Dairy Products Joint Stock Company (Vinamilk)', 'stock', 'HOSE'),
    ('E1VFVN30', 'Dragon Capital VFMVN30 ETF', 'etf', 'HOSE')
ON CONFLICT (symbol) DO UPDATE SET
    name = EXCLUDED.name,
    asset_type = EXCLUDED.asset_type,
    exchange = EXCLUDED.exchange;

-- ==========================================================
-- Seed Data: 002_seed_investor_profile.sql
-- Purpose: Initial default investor profile record
-- Idempotent: Only insert if no profile row exists
-- ==========================================================

INSERT INTO public.investor_profile (cash_available, risk_tolerance, investment_horizon)
SELECT 0, 'moderate', 'medium'
WHERE NOT EXISTS (SELECT 1 FROM public.investor_profile);


