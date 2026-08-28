-- ==========================================================
-- Feature 20B: Controlled Crypto Universe Expansion
-- Fail-fast, idempotent migration onboarding 37 liquid canonical crypto assets with explicit CoinGecko mappings.
-- Identity Safety Rules:
-- 1. Preflight asserts no symbol->UUID or UUID->symbol conflict.
-- 2. Preflight asserts no existing provider mapping mismatch.
-- 3. Preflight asserts exact canonical semantics on existing matches.
-- 4. Re-run with identical records is a clean NO-OP.
-- 5. Strict prohibition of silent conflict overwriting on canonical asset identity.
-- ==========================================================

DO $$
DECLARE
    candidate RECORD;
    existing_asset RECORD;
    existing_mapping RECORD;
    candidates CONSTANT jsonb := '[
        {"id": "66c7d650-f440-4e84-9469-ce0d070ede6b", "symbol": "BNB", "name": "BNB", "provider_symbol": "binancecoin"},
        {"id": "4bebf6d3-cf96-4a88-8474-d4a4e706989a", "symbol": "XRP", "name": "XRP", "provider_symbol": "ripple"},
        {"id": "bdf8e845-dfe3-45a1-b852-642a0b886b7d", "symbol": "TRX", "name": "TRON", "provider_symbol": "tron"},
        {"id": "40bd9c87-9fdb-47d2-962d-96df16f58c00", "symbol": "HYPE", "name": "Hyperliquid", "provider_symbol": "hyperliquid"},
        {"id": "a9cdfcc6-1518-4087-bbcd-8ac4704474a4", "symbol": "ZEC", "name": "Zcash", "provider_symbol": "zcash"},
        {"id": "44c7fdab-fbaf-45ce-84e5-3ed3e8fe5b54", "symbol": "DOGE", "name": "Dogecoin", "provider_symbol": "dogecoin"},
        {"id": "98736587-f37d-42a9-9c22-237dbf82187f", "symbol": "RAIN", "name": "Rain", "provider_symbol": "rain"},
        {"id": "f80f1162-2b13-4b2b-84dc-e208fc3fbedc", "symbol": "XMR", "name": "Monero", "provider_symbol": "monero"},
        {"id": "c2534c6b-9eb5-4a78-b93f-969bb8f7df65", "symbol": "LINK", "name": "Chainlink", "provider_symbol": "chainlink"},
        {"id": "8f755ede-0630-4055-aef5-84ecc2512c59", "symbol": "WBT", "name": "WhiteBIT Coin", "provider_symbol": "whitebit"},
        {"id": "5af019d9-3cc5-4904-8cd1-25389feec501", "symbol": "ADA", "name": "Cardano", "provider_symbol": "cardano"},
        {"id": "5b3bea95-edd8-4a89-918b-d8c3b0156399", "symbol": "XLM", "name": "Stellar", "provider_symbol": "stellar"},
        {"id": "11a31ef1-568f-4c10-8a13-5007e7d57a5b", "symbol": "BCH", "name": "Bitcoin Cash", "provider_symbol": "bitcoin-cash"},
        {"id": "04c0ebd5-d104-4b82-a447-16a3903ec01c", "symbol": "GRAM", "name": "Gram (prev. Toncoin)", "provider_symbol": "the-open-network"},
        {"id": "4cb6998d-3364-4734-ad73-d62ac3f47aff", "symbol": "LTC", "name": "Litecoin", "provider_symbol": "litecoin"},
        {"id": "c3825936-a57f-4361-a4e5-9d7cd96d284c", "symbol": "HBAR", "name": "Hedera", "provider_symbol": "hedera-hashgraph"},
        {"id": "b0785af1-75d1-4fa3-99c1-d56985dfbade", "symbol": "AVAX", "name": "Avalanche", "provider_symbol": "avalanche-2"},
        {"id": "bdc8770f-7311-4621-9067-3c61b907238b", "symbol": "SHIB", "name": "Shiba Inu", "provider_symbol": "shiba-inu"},
        {"id": "81590371-79ba-44c3-8f48-31b86d53c3e3", "symbol": "SUI", "name": "Sui", "provider_symbol": "sui"},
        {"id": "79b9f5fe-1f5d-4bd8-94aa-4e6c8b29dfb3", "symbol": "UNI", "name": "Uniswap", "provider_symbol": "uniswap"},
        {"id": "73b6f9b9-3b85-4c25-b1bf-6a34b4f18946", "symbol": "NEAR", "name": "NEAR Protocol", "provider_symbol": "near"},
        {"id": "9ec01b5e-84c9-46b7-899a-772425d334af", "symbol": "TAO", "name": "Bittensor", "provider_symbol": "bittensor"},
        {"id": "c632abb3-22eb-49ea-ae63-c742c56f091f", "symbol": "PUMP", "name": "Pump.fun", "provider_symbol": "pump-fun"},
        {"id": "cc4c6bb6-3d5c-487e-961c-80a2eb89585c", "symbol": "AAVE", "name": "Aave", "provider_symbol": "aave"},
        {"id": "9841e6e5-a8ff-4e71-b034-e7a4de3d6ded", "symbol": "ASTER", "name": "Aster", "provider_symbol": "aster-2"},
        {"id": "927dc869-7204-4d87-b744-fd6a03fc8c99", "symbol": "WLFI", "name": "World Liberty Financial", "provider_symbol": "world-liberty-financial"},
        {"id": "afa7bb4c-283a-4686-a570-c591b12cef66", "symbol": "ONDO", "name": "Ondo", "provider_symbol": "ondo-finance"},
        {"id": "f8a74dcd-71f6-42d1-a3e7-2e6208cba86c", "symbol": "ENA", "name": "Ethena", "provider_symbol": "ethena"},
        {"id": "b7abf464-981b-47c6-b587-1ac61cfe9e0e", "symbol": "MORPHO", "name": "Morpho", "provider_symbol": "morpho"},
        {"id": "821eace1-4edc-4d91-a2b3-a43e51ff49b7", "symbol": "PEPE", "name": "Pepe", "provider_symbol": "pepe"},
        {"id": "e7c6ef68-a92f-4735-9d8b-aa3e7767f11f", "symbol": "DOT", "name": "Polkadot", "provider_symbol": "polkadot"},
        {"id": "4635d9d6-f30f-4dd4-9632-67873ce5e3b1", "symbol": "WLD", "name": "Worldcoin", "provider_symbol": "worldcoin-wld"},
        {"id": "d9ac0ecd-fab0-4e6e-98a9-0cff5b1b3fe7", "symbol": "ETC", "name": "Ethereum Classic", "provider_symbol": "ethereum-classic"},
        {"id": "22deaafe-2849-4c75-980c-c0c8e3b42bc9", "symbol": "POL", "name": "POL (ex-MATIC)", "provider_symbol": "polygon-ecosystem-token"},
        {"id": "f64d16cc-1bce-4f81-a64b-e5acbbe1a07e", "symbol": "LIT", "name": "Lighter", "provider_symbol": "lighter"},
        {"id": "9c8f9012-9973-406e-89a3-6350f095b59b", "symbol": "ATOM", "name": "Cosmos Hub", "provider_symbol": "cosmos"},
        {"id": "871267a7-954b-4d39-8299-3c0299fe8be8", "symbol": "JUP", "name": "Jupiter", "provider_symbol": "jupiter-exchange-solana"}
    ]'::jsonb;
BEGIN
    -- 1. Preflight Identity & Mapping Validation
    FOR candidate IN SELECT * FROM jsonb_to_recordset(candidates) AS x(id uuid, symbol text, name text, provider_symbol text)
    LOOP
        -- Check 1A: Symbol exists under a DIFFERENT UUID
        SELECT * INTO existing_asset FROM public.assets WHERE symbol = candidate.symbol;
        IF FOUND AND existing_asset.id <> candidate.id THEN
            RAISE EXCEPTION 'Identity Conflict: Asset symbol % already exists with UUID % (expected %)',
                candidate.symbol, existing_asset.id, candidate.id;
        END IF;

        -- Check 1B: UUID exists under a DIFFERENT symbol
        SELECT * INTO existing_asset FROM public.assets WHERE id = candidate.id;
        IF FOUND AND existing_asset.symbol <> candidate.symbol THEN
            RAISE EXCEPTION 'Identity Conflict: Asset UUID % already exists with symbol % (expected %)',
                candidate.id, existing_asset.symbol, candidate.symbol;
        END IF;

        -- Check 1C: Existing asset has incompatible semantics
        IF FOUND THEN
            IF existing_asset.asset_type <> 'crypto' OR
               existing_asset.quote_currency <> 'USD' OR
               existing_asset.market_policy <> 'CONTINUOUS_24_7' OR
               existing_asset.market_timezone <> 'UTC' OR
               existing_asset.quantity_unit <> 'coin' THEN
                RAISE EXCEPTION 'Semantics Conflict: Existing asset % (%) has incompatible canonical semantics',
                    candidate.symbol, candidate.id;
            END IF;
        END IF;

        -- Check 1D: Existing CoinGecko mapping has conflicting provider_symbol
        SELECT * INTO existing_mapping FROM public.asset_provider_mappings
        WHERE asset_id = candidate.id AND provider = 'coingecko';
        IF FOUND AND existing_mapping.provider_symbol <> candidate.provider_symbol THEN
            RAISE EXCEPTION 'Mapping Conflict: Asset % (%) already mapped to coingecko with provider_symbol % (expected %)',
                candidate.symbol, candidate.id, existing_mapping.provider_symbol, candidate.provider_symbol;
        END IF;
    END LOOP;

    -- 2. Safe Idempotent Insertion
    FOR candidate IN SELECT * FROM jsonb_to_recordset(candidates) AS x(id uuid, symbol text, name text, provider_symbol text)
    LOOP
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
        VALUES (
            candidate.id,
            candidate.symbol,
            candidate.name,
            'crypto',
            NULL,
            'GLOBAL',
            'USD',
            NULL,
            'CONTINUOUS_24_7',
            'UTC',
            'coin',
            TRUE
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.asset_provider_mappings (
            asset_id,
            provider,
            provider_symbol,
            provider_market
        )
        VALUES (
            candidate.id,
            'coingecko',
            candidate.provider_symbol,
            NULL
        )
        ON CONFLICT (asset_id, provider) DO NOTHING;
    END LOOP;
END $$;
