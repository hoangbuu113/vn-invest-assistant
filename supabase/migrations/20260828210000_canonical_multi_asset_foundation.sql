-- ==========================================================
-- Feature 16: Canonical multi-asset foundation
-- Additive asset metadata, explicit provider identities, and VND ledger guard.
-- ==========================================================

DO $$
DECLARE
    v_invalid_rows TEXT;
BEGIN
    SELECT string_agg(format('%s (%s)', symbol, asset_type), ', ' ORDER BY symbol)
    INTO v_invalid_rows
    FROM public.assets
    WHERE asset_type NOT IN ('stock', 'etf');

    IF v_invalid_rows IS NOT NULL THEN
        RAISE EXCEPTION 'Unverified existing asset types must be reviewed before Feature 16 migration: %', v_invalid_rows;
    END IF;

    SELECT string_agg(format('%s (%s)', symbol, COALESCE(exchange, 'NULL')), ', ' ORDER BY symbol)
    INTO v_invalid_rows
    FROM public.assets
    WHERE asset_type IN ('stock', 'etf')
      AND exchange IS DISTINCT FROM 'HOSE';

    IF v_invalid_rows IS NOT NULL THEN
        RAISE EXCEPTION 'Unverified existing stock/ETF venues must be reviewed before Feature 16 migration: %', v_invalid_rows;
    END IF;
END;
$$;

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS market_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS quote_currency VARCHAR(12),
    ADD COLUMN IF NOT EXISTS base_currency VARCHAR(12),
    ADD COLUMN IF NOT EXISTS market_policy VARCHAR(32),
    ADD COLUMN IF NOT EXISTS market_timezone VARCHAR(64),
    ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.assets
SET market_code = exchange,
    quote_currency = 'VND',
    base_currency = NULL,
    market_policy = 'VN_EXCHANGE',
    market_timezone = 'Asia/Ho_Chi_Minh',
    quantity_unit = 'share',
    is_active = TRUE
WHERE asset_type IN ('stock', 'etf')
  AND exchange = 'HOSE';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_asset_type_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check
            CHECK (asset_type IN ('stock', 'etf', 'fund', 'gold', 'fx', 'crypto'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_quote_currency_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_quote_currency_check
            CHECK (quote_currency IS NULL OR quote_currency ~ '^[A-Z][A-Z0-9]{0,11}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_base_currency_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_base_currency_check
            CHECK (base_currency IS NULL OR base_currency ~ '^[A-Z][A-Z0-9]{0,11}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_distinct_currency_pair_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_distinct_currency_pair_check
            CHECK (base_currency IS NULL OR quote_currency IS NULL OR base_currency <> quote_currency);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_market_policy_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_market_policy_check
            CHECK (
                market_policy IS NULL OR market_policy IN (
                    'VN_EXCHANGE',
                    'CONTINUOUS_24_7',
                    'GLOBAL_24_5',
                    'NAV_SCHEDULED',
                    'INSTRUMENT_DEFINED'
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_active_quote_currency_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_active_quote_currency_check
            CHECK (NOT is_active OR quote_currency IS NOT NULL);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname = 'assets_optional_metadata_nonempty_check'
    ) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_optional_metadata_nonempty_check
            CHECK (
                (market_code IS NULL OR BTRIM(market_code) <> '')
                AND (market_timezone IS NULL OR BTRIM(market_timezone) <> '')
                AND (quantity_unit IS NULL OR BTRIM(quantity_unit) <> '')
            );
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.asset_provider_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_symbol VARCHAR(255) NOT NULL,
    provider_market VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT asset_provider_mappings_provider_check CHECK (
        provider = LOWER(BTRIM(provider))
        AND provider ~ '^[a-z][a-z0-9_-]*$'
    ),
    CONSTRAINT asset_provider_mappings_symbol_check CHECK (BTRIM(provider_symbol) <> ''),
    CONSTRAINT asset_provider_mappings_market_check CHECK (
        provider_market IS NULL OR BTRIM(provider_market) <> ''
    ),
    CONSTRAINT uq_asset_provider_mappings_asset_provider UNIQUE (asset_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_provider_mappings_provider_identity
    ON public.asset_provider_mappings (
        provider,
        provider_symbol,
        COALESCE(provider_market, '')
    );
CREATE INDEX IF NOT EXISTS idx_asset_provider_mappings_asset_id
    ON public.asset_provider_mappings (asset_id);

ALTER TABLE public.asset_provider_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to asset_provider_mappings"
    ON public.asset_provider_mappings;
CREATE POLICY "Allow public read access to asset_provider_mappings"
    ON public.asset_provider_mappings
    FOR SELECT
    USING (TRUE);

INSERT INTO public.asset_provider_mappings (
    asset_id,
    provider,
    provider_symbol,
    provider_market
)
SELECT
    assets.id,
    'yahoo',
    assets.symbol || '.VN',
    NULL
FROM public.assets AS assets
WHERE assets.symbol IN ('FPT', 'VCB', 'HPG', 'VNM', 'E1VFVN30')
  AND assets.asset_type IN ('stock', 'etf')
  AND assets.exchange = 'HOSE'
ON CONFLICT (asset_id, provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_vnd_portfolio_transaction_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_quote_currency TEXT;
BEGIN
    SELECT assets.quote_currency
    INTO v_quote_currency
    FROM public.assets AS assets
    WHERE assets.id = NEW.asset_id;

    IF v_quote_currency IS DISTINCT FROM 'VND' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PT005',
            MESSAGE = 'non-VND asset transactions are unsupported until FX accounting exists';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vnd_portfolio_transaction_asset
    ON public.portfolio_transactions;
CREATE TRIGGER enforce_vnd_portfolio_transaction_asset
    BEFORE INSERT ON public.portfolio_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_vnd_portfolio_transaction_asset();

REVOKE ALL ON FUNCTION public.enforce_vnd_portfolio_transaction_asset() FROM PUBLIC;

COMMENT ON TABLE public.asset_provider_mappings IS
    'Explicit provider identities for canonical assets; provider symbols never define canonical asset identity.';
COMMENT ON FUNCTION public.enforce_vnd_portfolio_transaction_asset() IS
    'Prevents non-VND asset prices from mutating the VND-only cash ledger before FX accounting exists.';
