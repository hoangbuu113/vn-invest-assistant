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
    ('E1VFVN30', 'Dragon Capital VFMVN30 ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('FUEVFVND', 'Dragon Capital DCVFMVN Diamond ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('FUESSVFL', 'SSIAM VNFIN LEAD ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('BTC', 'Bitcoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('ETH', 'Ethereum', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('SOL', 'Solana', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('XAU/USD', 'Gold Spot / US Dollar', 'gold', NULL, 'GLOBAL', 'USD', 'XAU', 'GLOBAL_24_5', 'UTC', 'oz', TRUE),
    ('USD/VND', 'US Dollar / Vietnamese Dong', 'fx', NULL, 'GLOBAL', 'VND', 'USD', 'GLOBAL_24_5', 'Asia/Ho_Chi_Minh', NULL, TRUE)
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
WHERE assets.symbol IN ('FPT', 'VCB', 'HPG', 'VNM', 'E1VFVN30', 'FUEVFVND', 'FUESSVFL')
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'bitcoin'
FROM public.assets WHERE symbol = 'BTC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ethereum'
FROM public.assets WHERE symbol = 'ETH'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'solana'
FROM public.assets WHERE symbol = 'SOL'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'alphavantage', 'XAU'
FROM public.assets WHERE symbol = 'XAU/USD'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'twelvedata', 'USD/VND'
FROM public.assets WHERE symbol = 'USD/VND'
ON CONFLICT (asset_id, provider) DO NOTHING;

-- ==========================================================
-- Seed Data: 002_seed_investor_profile.sql
-- Purpose: Initial default investor profile record
-- Idempotent: Only insert if no profile row exists
-- ==========================================================

INSERT INTO public.investor_profile (singleton_key, cash_available, risk_tolerance, investment_horizon)
VALUES (1, 0, 'moderate', 'medium')
ON CONFLICT (singleton_key) DO NOTHING;

