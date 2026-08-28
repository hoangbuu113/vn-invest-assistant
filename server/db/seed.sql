-- ==========================================================
-- Seed Data: 002_seed_assets.sql
-- Purpose: Initial well-known Vietnamese listed assets
-- Idempotent: ON CONFLICT (symbol) DO NOTHING / UPDATE
-- ==========================================================

INSERT INTO public.assets (
    symbol,
    name,
    asset_type,
    exchange,
    market_code,
    quote_currency,
    base_currency,
    market_policy,
    market_timezone,
    quantity_unit,
    is_active
)
VALUES
    ('VCB', 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('FPT', 'FPT Corporation', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('HPG', 'Hoa Phat Group Joint Stock Company', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('VNM', 'Vietnam Dairy Products Joint Stock Company (Vinamilk)', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('E1VFVN30', 'Dragon Capital VFMVN30 ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE)
ON CONFLICT (symbol) DO UPDATE SET
    name = EXCLUDED.name,
    asset_type = EXCLUDED.asset_type,
    exchange = EXCLUDED.exchange,
    market_code = EXCLUDED.market_code,
    quote_currency = EXCLUDED.quote_currency,
    base_currency = EXCLUDED.base_currency,
    market_policy = EXCLUDED.market_policy,
    market_timezone = EXCLUDED.market_timezone,
    quantity_unit = EXCLUDED.quantity_unit,
    is_active = EXCLUDED.is_active;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'yahoo', assets.symbol || '.VN'
FROM public.assets AS assets
WHERE assets.symbol IN ('FPT', 'VCB', 'HPG', 'VNM', 'E1VFVN30')
ON CONFLICT (asset_id, provider) DO NOTHING;

-- ==========================================================
-- Seed Data: 002_seed_investor_profile.sql
-- Purpose: Initial default investor profile record
-- Idempotent: Only insert if no profile row exists
-- ==========================================================

INSERT INTO public.investor_profile (singleton_key, cash_available, risk_tolerance, investment_horizon)
VALUES (1, 0, 'moderate', 'medium')
ON CONFLICT (singleton_key) DO NOTHING;

