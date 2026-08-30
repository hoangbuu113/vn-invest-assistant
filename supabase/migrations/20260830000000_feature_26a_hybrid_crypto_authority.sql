-- Feature 26A.1: Hybrid Crypto market authority.
-- Canonical accounting quote remains USD (CoinGecko snapshot authority).
-- Binance Spot provides explicit USDT realtime and completed daily history mappings.

DO $$
DECLARE
    referenced_symbols TEXT;
BEGIN
    SELECT STRING_AGG(assets.symbol, ', ' ORDER BY assets.symbol)
    INTO referenced_symbols
    FROM public.assets AS assets
    WHERE assets.symbol IN ('HYPE', 'RAIN', 'XMR', 'WBT', 'LIT')
      AND (
          EXISTS (SELECT 1 FROM public.holdings WHERE holdings.asset_id = assets.id)
          OR EXISTS (SELECT 1 FROM public.portfolio_transactions WHERE portfolio_transactions.asset_id = assets.id)
          OR EXISTS (SELECT 1 FROM public.position_opening_baselines WHERE position_opening_baselines.asset_id = assets.id)
          OR EXISTS (SELECT 1 FROM public.watchlist_items WHERE watchlist_items.asset_id = assets.id)
          OR EXISTS (SELECT 1 FROM public.price_alerts WHERE price_alerts.asset_id = assets.id)
      );

    IF referenced_symbols IS NOT NULL THEN
        RAISE EXCEPTION 'Feature 26A cannot retire referenced Crypto assets: %', referenced_symbols;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('BTC', '1aca9503-acf1-4450-9b75-4f8935324398'::UUID),
                ('ETH', '66f2e0e6-e375-4693-8f9d-ea423f47e751'::UUID),
                ('SOL', '8ea1c52b-a999-4d1e-8b02-f8e7e8042118'::UUID),
                ('BNB', '66c7d650-f440-4e84-9469-ce0d070ede6b'::UUID),
                ('XRP', '4bebf6d3-cf96-4a88-8474-d4a4e706989a'::UUID),
                ('TRX', 'bdf8e845-dfe3-45a1-b852-642a0b886b7d'::UUID),
                ('ZEC', 'a9cdfcc6-1518-4087-bbcd-8ac4704474a4'::UUID),
                ('DOGE', '44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54'::UUID),
                ('LINK', 'c2534c6b-9eb5-4a78-b93f-969bb8f7df65'::UUID),
                ('ADA', '5af019d9-3cc5-4904-8cd1-25389feec501'::UUID),
                ('XLM', '5b3bea95-edd8-4a89-918b-d8c3b0156399'::UUID),
                ('BCH', '11a31ef1-568f-4c10-8a13-5007e7d57a5b'::UUID),
                ('GRAM', '04c0ebd5-d104-4b82-a447-16a3903ec01c'::UUID),
                ('LTC', '4cb6998d-3364-4734-ad73-d62ac3f47aff'::UUID),
                ('HBAR', 'c3825936-a57f-4361-a4e5-9d7cd96d284c'::UUID),
                ('AVAX', 'b0785af1-75d1-4fa3-99c1-d56985dfbade'::UUID),
                ('SHIB', 'bdc8770f-7311-4621-9067-3c61b907238b'::UUID),
                ('SUI', '81590371-79ba-44c3-8f48-31b86d53c3e3'::UUID),
                ('UNI', '79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3'::UUID),
                ('NEAR', '73b6f9b9-3b85-4c25-b1bf-6a34b4f18946'::UUID),
                ('TAO', '9ec01b5e-84c9-46b7-899a-772425d334af'::UUID),
                ('PUMP', 'c632abb3-22eb-49ea-ae63-c742c56f091f'::UUID),
                ('AAVE', 'cc4c6bb6-3d5c-487e-961c-80a2eb89585c'::UUID),
                ('ASTER', '9841e6e5-a8ff-4e71-b034-e7a4de3d6ded'::UUID),
                ('WLFI', '927dc869-7204-4d87-b744-fd6a03fc8c99'::UUID),
                ('ONDO', 'afa7bb4c-283a-4686-a570-c591b12cef66'::UUID),
                ('ENA', 'f8a74dcd-71f6-42d1-a3e7-2e6208cba86c'::UUID),
                ('MORPHO', 'b7abf464-981b-47c6-b587-1ac61cfe9e0e'::UUID),
                ('PEPE', '821eace1-4edc-4d91-a2b3-a43e51ff49b7'::UUID),
                ('DOT', 'e7c6ef68-a92f-4735-9d8b-aa3e7767f11f'::UUID),
                ('WLD', '4635d9d6-f30f-4dd4-9632-67873ce5e3b1'::UUID),
                ('ETC', 'd9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7'::UUID),
                ('POL', '22deaafe-2849-4c75-980c-c0c8e3b42bc9'::UUID),
                ('ATOM', '9c8f9012-9973-406e-89a3-6350f095b59b'::UUID),
                ('JUP', '871267a7-954b-4d39-8299-3c0299fe8be8'::UUID)
        ) AS expected(symbol, id)
        LEFT JOIN public.assets AS assets ON assets.symbol = expected.symbol
        WHERE assets.id IS DISTINCT FROM expected.id
    ) THEN
        RAISE EXCEPTION 'Feature 26A retained Crypto UUID precondition failed';
    END IF;
END
$$;

DELETE FROM public.assets
WHERE symbol IN ('HYPE', 'RAIN', 'XMR', 'WBT', 'LIT');

INSERT INTO public.assets (
    id, symbol, name, asset_type, exchange, market_code, quote_currency,
    base_currency, market_policy, market_timezone, quantity_unit, is_active
)
VALUES
    ('d3c678a1-5801-4475-8025-aa80e5572bb1', 'APT', 'Aptos', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('b6e3f422-9214-4a27-a169-d75fa6319c52', 'ARB', 'Arbitrum', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('c5a89233-1498-4d62-97ec-08e62d471e43', 'FET', 'Artificial Superintelligence Alliance', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('e9712a44-f655-4683-9b88-51829e1db874', 'INJ', 'Injective', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE),
    ('a8471b55-e7d9-4820-b0c3-f26e3c15aa65', 'FIL', 'Filecoin', 'crypto', NULL, 'GLOBAL', 'USD', NULL, 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE)
ON CONFLICT (symbol) DO UPDATE SET
    name = EXCLUDED.name,
    asset_type = EXCLUDED.asset_type,
    market_code = EXCLUDED.market_code,
    quote_currency = EXCLUDED.quote_currency,
    market_policy = EXCLUDED.market_policy,
    market_timezone = EXCLUDED.market_timezone,
    quantity_unit = EXCLUDED.quantity_unit,
    is_active = EXCLUDED.is_active;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('APT', 'd3c678a1-5801-4475-8025-aa80e5572bb1'::UUID),
                ('ARB', 'b6e3f422-9214-4a27-a169-d75fa6319c52'::UUID),
                ('FET', 'c5a89233-1498-4d62-97ec-08e62d471e43'::UUID),
                ('INJ', 'e9712a44-f655-4683-9b88-51829e1db874'::UUID),
                ('FIL', 'a8471b55-e7d9-4820-b0c3-f26e3c15aa65'::UUID)
        ) AS expected(symbol, id)
        INNER JOIN public.assets AS assets ON assets.symbol = expected.symbol
        WHERE assets.id IS DISTINCT FROM expected.id
    ) THEN
        RAISE EXCEPTION 'Feature 26A replacement Crypto UUID precondition failed';
    END IF;
END
$$;

UPDATE public.assets
SET quote_currency = 'USD'
WHERE asset_type = 'crypto';

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

INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol)
SELECT assets.id, 'coingecko', mappings.provider_symbol
FROM (
    VALUES
        ('APT', 'aptos'),
        ('ARB', 'arbitrum'),
        ('FET', 'fetch-ai'),
        ('INJ', 'injective-protocol'),
        ('FIL', 'filecoin')
) AS mappings(symbol, provider_symbol)
INNER JOIN public.assets AS assets ON assets.symbol = mappings.symbol
ON CONFLICT (asset_id, provider) DO UPDATE SET
    provider_symbol = EXCLUDED.provider_symbol,
    provider_market = NULL;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.assets WHERE asset_type = 'crypto' AND is_active) <> 40 THEN
        RAISE EXCEPTION 'Feature 26A expected exactly 40 active Crypto assets';
    END IF;
    IF (SELECT COUNT(*) FROM public.assets WHERE is_active) <> 49 THEN
        RAISE EXCEPTION 'Feature 26A expected exactly 49 active investable assets';
    END IF;
    IF EXISTS (SELECT 1 FROM public.assets WHERE asset_type = 'crypto' AND quote_currency <> 'USD') THEN
        RAISE EXCEPTION 'Feature 26A Crypto accounting quote must remain USD';
    END IF;
    IF (
        SELECT COUNT(*)
        FROM public.asset_provider_mappings AS mappings
        INNER JOIN public.assets AS assets ON assets.id = mappings.asset_id
        WHERE assets.asset_type = 'crypto' AND mappings.provider = 'binance'
    ) <> 40 THEN
        RAISE EXCEPTION 'Feature 26A expected exactly 40 Binance Crypto mappings';
    END IF;
    IF (
        SELECT COUNT(*)
        FROM public.asset_provider_mappings AS mappings
        INNER JOIN public.assets AS assets ON assets.id = mappings.asset_id
        WHERE assets.asset_type = 'crypto' AND mappings.provider = 'coingecko'
    ) <> 40 THEN
        RAISE EXCEPTION 'Feature 26A expected exactly 40 CoinGecko Crypto mappings';
    END IF;
END
$$;
