-- ==========================================================
-- Seed Data: 002_seed_assets.sql
-- Purpose: Initial canonical universe of 49 assets (VN Equities, ETFs, Crypto, Gold Spot, FX Context)
-- Feature 26A.1: 40 Crypto assets with USD accounting snapshots and Binance Spot/USDT history
-- Idempotent: ON CONFLICT (symbol) DO NOTHING
-- ==========================================================

INSERT INTO public.assets (
    id,
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
    -- 1. VN Equities & ETFs (Yahoo Finance)
    ('059ff499-2297-4d88-96a0-a7e36be40edf', 'VCB', 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('34ad7d87-9065-4111-b38d-ebc92c4a74dd', 'FPT', 'FPT Corporation', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('5dc6426e-590e-4d9e-95cd-0fa584cc0b11', 'HPG', 'Hoa Phat Group Joint Stock Company', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('a3625689-2620-410a-8c1c-9ebef3cf802d', 'VNM', 'Vietnam Dairy Products Joint Stock Company (Vinamilk)', 'stock', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('039f6974-626b-4145-ab57-b19f91bac2ca', 'E1VFVN30', 'Dragon Capital VFMVN30 ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('9f0ffc4f-950f-4125-94b0-d5911cdfaad7', 'FUEVFVND', 'Dragon Capital DCVFMVN Diamond ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),
    ('557ba9ab-fca8-44ff-a230-4166796e3d62', 'FUESSVFL', 'SSIAM VNFIN LEAD ETF', 'etf', 'HOSE', 'HOSE', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE),

    -- 2. 40 Liquid Cryptocurrencies (Feature 26A Binance Spot Universe)
    ('1aca9503-acf1-4450-9b75-4f8935324398', 'BTC', 'Bitcoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('66f2e0e6-e375-4693-8f9d-ea423f47e751', 'ETH', 'Ethereum', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('8ea1c52b-a999-4d1e-8b02-f8e7e8042118', 'SOL', 'Solana', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('66c7d650-f440-4e84-9469-ce0d070ede6b', 'BNB', 'BNB', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('4bebf6d3-cf96-4a88-8474-d4a4e706989a', 'XRP', 'XRP', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('bdf8e845-dfe3-45a1-b852-642a0b886b7d', 'TRX', 'TRON', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('a9cdfcc6-1518-4087-bbcd-8ac4704474a4', 'ZEC', 'Zcash', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54', 'DOGE', 'Dogecoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('c2534c6b-9eb5-4a78-b93f-969bb8f7df65', 'LINK', 'Chainlink', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('5af019d9-3cc5-4904-8cd1-25389feec501', 'ADA', 'Cardano', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('5b3bea95-edd8-4a89-918b-d8c3b0156399', 'XLM', 'Stellar', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('11a31ef1-568f-4c10-8a13-5007e7d57a5b', 'BCH', 'Bitcoin Cash', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('04c0ebd5-d104-4b82-a447-16a3903ec01c', 'GRAM', 'Gram (prev. Toncoin)', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('4cb6998d-3364-4734-ad73-d62ac3f47aff', 'LTC', 'Litecoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('c3825936-a57f-4361-a4e5-9d7cd96d284c', 'HBAR', 'Hedera', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('b0785af1-75d1-4fa3-99c1-d56985dfbade', 'AVAX', 'Avalanche', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('bdc8770f-7311-4621-9067-3c61b907238b', 'SHIB', 'Shiba Inu', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('81590371-79ba-44c3-8f48-31b86d53c3e3', 'SUI', 'Sui', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3', 'UNI', 'Uniswap', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('73b6f9b9-3b85-4c25-b1bf-6a34b4f18946', 'NEAR', 'NEAR Protocol', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('9ec01b5e-84c9-46b7-899a-772425d334af', 'TAO', 'Bittensor', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('c632abb3-22eb-49ea-ae63-c742c56f091f', 'PUMP', 'Pump.fun', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('cc4c6bb6-3d5c-487e-961c-80a2eb89585c', 'AAVE', 'Aave', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('9841e6e5-a8ff-4e71-b034-e7a4de3d6ded', 'ASTER', 'Aster', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('927dc869-7204-4d87-b744-fd6a03fc8c99', 'WLFI', 'World Liberty Financial', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('afa7bb4c-283a-4686-a570-c591b12cef66', 'ONDO', 'Ondo', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('f8a74dcd-71f6-42d1-a3e7-2e6208cba86c', 'ENA', 'Ethena', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('b7abf464-981b-47c6-b587-1ac61cfe9e0e', 'MORPHO', 'Morpho', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('821eace1-4edc-4d91-a2b3-a43e51ff49b7', 'PEPE', 'Pepe', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('e7c6ef68-a92f-4735-9d8b-aa3e7767f11f', 'DOT', 'Polkadot', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('4635d9d6-f30f-4dd4-9632-67873ce5e3b1', 'WLD', 'Worldcoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('d9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7', 'ETC', 'Ethereum Classic', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('22deaafe-2849-4c75-980c-c0c8e3b42bc9', 'POL', 'POL (ex-MATIC)', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('9c8f9012-9973-406e-89a3-6350f095b59b', 'ATOM', 'Cosmos Hub', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('871267a7-954b-4d39-8299-3c0299fe8be8', 'JUP', 'Jupiter', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('d3c678a1-5801-4475-8025-aa80e5572bb1', 'APT', 'Aptos', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('b6e3f422-9214-4a27-a169-d75fa6319c52', 'ARB', 'Arbitrum', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('c5a89233-1498-4d62-97ec-08e62d471e43', 'FET', 'Artificial Superintelligence Alliance', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('e9712a44-f655-4683-9b88-51829e1db874', 'INJ', 'Injective', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('a8471b55-e7d9-4820-b0c3-f26e3c15aa65', 'FIL', 'Filecoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),

    -- 3. Gold Spot (Feature 20A)
    ('28f1c02e-9974-4d44-95ff-34837390ca74', 'XAU/USD', 'Gold Spot / US Dollar', 'gold', NULL, 'GLOBAL', 'USD', 'XAU', 'GLOBAL_24_5', 'UTC', 'oz', TRUE),

    -- 4. Foreign Exchange Context (Feature 20A)
    ('d18509bc-f7fa-47f1-9a90-7d347c7b4038', 'USD/VND', 'US Dollar / Vietnamese Dong', 'fx', NULL, 'GLOBAL', 'VND', 'USD', 'GLOBAL_24_5', 'Asia/Ho_Chi_Minh', NULL, TRUE)
ON CONFLICT (symbol) DO NOTHING;

-- Fundamentals V1A issuer eligibility is explicit. Financial-sector issuers remain unsupported.
UPDATE public.assets
SET fundamentals_company_type = CASE symbol
    WHEN 'VCB' THEN 'BANK'
    WHEN 'FPT' THEN 'INDUSTRIAL'
    WHEN 'HPG' THEN 'INDUSTRIAL'
    WHEN 'VNM' THEN 'INDUSTRIAL'
END
WHERE fundamentals_company_type IS NULL
  AND symbol IN ('VCB', 'FPT', 'HPG', 'VNM');

-- Explicit Provider Mappings (Yahoo Finance)
INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'yahoo', assets.symbol || '.VN'
FROM public.assets AS assets
WHERE assets.symbol IN ('FPT', 'VCB', 'HPG', 'VNM', 'E1VFVN30', 'FUEVFVND', 'FUESSVFL')
ON CONFLICT (asset_id, provider) DO NOTHING;

-- Explicit Provider Mappings (Binance Spot)
INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol, provider_market)
SELECT assets.id, 'binance', mappings.provider_symbol, 'SPOT'
FROM (
    VALUES
        ('BTC', 'BTCUSDT'), ('ETH', 'ETHUSDT'), ('SOL', 'SOLUSDT'), ('BNB', 'BNBUSDT'),
        ('XRP', 'XRPUSDT'), ('TRX', 'TRXUSDT'), ('ZEC', 'ZECUSDT'), ('DOGE', 'DOGEUSDT'),
        ('LINK', 'LINKUSDT'), ('ADA', 'ADAUSDT'), ('XLM', 'XLMUSDT'), ('BCH', 'BCHUSDT'),
        ('GRAM', 'GRAMUSDT'), ('LTC', 'LTCUSDT'), ('HBAR', 'HBARUSDT'), ('AVAX', 'AVAXUSDT'),
        ('SHIB', 'SHIBUSDT'), ('SUI', 'SUIUSDT'), ('UNI', 'UNIUSDT'), ('NEAR', 'NEARUSDT'),
        ('TAO', 'TAOUSDT'), ('PUMP', 'PUMPUSDT'), ('AAVE', 'AAVEUSDT'), ('ASTER', 'ASTERUSDT'),
        ('WLFI', 'WLFIUSDT'), ('ONDO', 'ONDOUSDT'), ('ENA', 'ENAUSDT'), ('MORPHO', 'MORPHOUSDT'),
        ('PEPE', 'PEPEUSDT'), ('DOT', 'DOTUSDT'), ('WLD', 'WLDUSDT'), ('ETC', 'ETCUSDT'),
        ('POL', 'POLUSDT'), ('ATOM', 'ATOMUSDT'), ('JUP', 'JUPUSDT'), ('APT', 'APTUSDT'),
        ('ARB', 'ARBUSDT'), ('FET', 'FETUSDT'), ('INJ', 'INJUSDT'), ('FIL', 'FILUSDT')
) AS mappings(symbol, provider_symbol)
INNER JOIN public.assets AS assets ON assets.symbol = mappings.symbol
ON CONFLICT (asset_id, provider) DO UPDATE SET
    provider_symbol = EXCLUDED.provider_symbol,
    provider_market = EXCLUDED.provider_market;

-- Explicit Provider Mappings (CoinGecko)
INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'bitcoin' FROM public.assets WHERE symbol = 'BTC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ethereum' FROM public.assets WHERE symbol = 'ETH'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'solana' FROM public.assets WHERE symbol = 'SOL'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'binancecoin' FROM public.assets WHERE symbol = 'BNB'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ripple' FROM public.assets WHERE symbol = 'XRP'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'tron' FROM public.assets WHERE symbol = 'TRX'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'zcash' FROM public.assets WHERE symbol = 'ZEC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'dogecoin' FROM public.assets WHERE symbol = 'DOGE'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'chainlink' FROM public.assets WHERE symbol = 'LINK'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'cardano' FROM public.assets WHERE symbol = 'ADA'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'stellar' FROM public.assets WHERE symbol = 'XLM'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'bitcoin-cash' FROM public.assets WHERE symbol = 'BCH'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'the-open-network' FROM public.assets WHERE symbol = 'GRAM'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'litecoin' FROM public.assets WHERE symbol = 'LTC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'hedera-hashgraph' FROM public.assets WHERE symbol = 'HBAR'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'avalanche-2' FROM public.assets WHERE symbol = 'AVAX'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'shiba-inu' FROM public.assets WHERE symbol = 'SHIB'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'sui' FROM public.assets WHERE symbol = 'SUI'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'uniswap' FROM public.assets WHERE symbol = 'UNI'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'near' FROM public.assets WHERE symbol = 'NEAR'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'bittensor' FROM public.assets WHERE symbol = 'TAO'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'pump-fun' FROM public.assets WHERE symbol = 'PUMP'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'aave' FROM public.assets WHERE symbol = 'AAVE'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'aster-2' FROM public.assets WHERE symbol = 'ASTER'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'world-liberty-financial' FROM public.assets WHERE symbol = 'WLFI'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ondo-finance' FROM public.assets WHERE symbol = 'ONDO'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ethena' FROM public.assets WHERE symbol = 'ENA'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'morpho' FROM public.assets WHERE symbol = 'MORPHO'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'pepe' FROM public.assets WHERE symbol = 'PEPE'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'polkadot' FROM public.assets WHERE symbol = 'DOT'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'worldcoin-wld' FROM public.assets WHERE symbol = 'WLD'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'ethereum-classic' FROM public.assets WHERE symbol = 'ETC'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'polygon-ecosystem-token' FROM public.assets WHERE symbol = 'POL'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'cosmos' FROM public.assets WHERE symbol = 'ATOM'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'jupiter-exchange-solana' FROM public.assets WHERE symbol = 'JUP'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'aptos' FROM public.assets WHERE symbol = 'APT'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'arbitrum' FROM public.assets WHERE symbol = 'ARB'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'fetch-ai' FROM public.assets WHERE symbol = 'FET'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'injective-protocol' FROM public.assets WHERE symbol = 'INJ'
ON CONFLICT (asset_id, provider) DO NOTHING;

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', 'filecoin' FROM public.assets WHERE symbol = 'FIL'
ON CONFLICT (asset_id, provider) DO NOTHING;

-- Explicit Provider Mappings (Alpha Vantage Gold Spot)
INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'alphavantage', 'XAU'
FROM public.assets WHERE symbol = 'XAU/USD'
ON CONFLICT (asset_id, provider) DO NOTHING;

-- Explicit Provider Mappings (Twelve Data FX)
INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'twelvedata', 'USD/VND'
FROM public.assets WHERE symbol = 'USD/VND'
ON CONFLICT (asset_id, provider) DO NOTHING;

-- ==========================================================
-- Seed Data: 002_seed_investor_profile.sql
-- Purpose: Initial default investor profile record
-- Idempotent: Only insert if no profile row exists
-- ==========================================================

INSERT INTO public.investor_profile (cash_available, risk_tolerance, investment_horizon)
SELECT 0, 'moderate', 'medium'
WHERE NOT EXISTS (SELECT 1 FROM public.investor_profile LIMIT 1);
