-- ==========================================================
-- Feature 20A: Real Multi-Asset Providers + Representative Assets
-- Idempotent migration adding representative VN ETFs, Crypto, Gold Spot, and FX context assets.
-- Preserves all existing asset UUIDs and financial data.
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
    -- 1. Exchange-Traded VN ETFs (Yahoo Finance)
    ('FUEVFVND', 'Dragon Capital DCVFMVN Diamond ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('FUESSVFL', 'SSIAM VNFIN LEAD ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),

    -- 2. Representative Cryptocurrencies (CoinGecko)
    ('BTC', 'Bitcoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('ETH', 'Ethereum', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('SOL', 'Solana', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),

    -- 3. Gold Spot (Alpha Vantage)
    ('XAU/USD', 'Gold Spot / US Dollar', 'gold', NULL, 'GLOBAL', 'USD', 'XAU', 'GLOBAL_24_5', 'UTC', 'oz', TRUE),

    -- 4. FX Market-Context Asset (Twelve Data)
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

-- Explicit Provider Mappings
INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'yahoo', 'FUEVFVND.VN', NULL
FROM public.assets WHERE symbol = 'FUEVFVND'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'yahoo', 'FUESSVFL.VN', NULL
FROM public.assets WHERE symbol = 'FUESSVFL'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'coingecko', 'bitcoin', NULL
FROM public.assets WHERE symbol = 'BTC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'coingecko', 'ethereum', NULL
FROM public.assets WHERE symbol = 'ETH'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'coingecko', 'solana', NULL
FROM public.assets WHERE symbol = 'SOL'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'alphavantage', 'XAU', NULL
FROM public.assets WHERE symbol = 'XAU/USD'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT assets.id, 'twelvedata', 'USD/VND', NULL
FROM public.assets WHERE symbol = 'USD/VND'
ON CONFLICT (asset_id, provider) DO NOTHING;

