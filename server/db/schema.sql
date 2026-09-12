-- ==========================================================
-- Schema Migration: 001_create_assets_table.sql
-- Purpose: Master table for investment assets
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(50) NOT NULL CHECK (asset_type IN ('stock', 'etf', 'fund', 'gold', 'fx', 'crypto')),
    exchange VARCHAR(20),
    market_code VARCHAR(50),
    quote_currency VARCHAR(12) CHECK (
        quote_currency IS NULL OR quote_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
    ),
    base_currency VARCHAR(12) CHECK (
        base_currency IS NULL OR base_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
    ),
    market_policy VARCHAR(32) CHECK (
        market_policy IS NULL OR market_policy IN (
            'VN_EXCHANGE', 'CONTINUOUS_24_7', 'GLOBAL_24_5', 'NAV_SCHEDULED', 'INSTRUMENT_DEFINED'
        )
    ),
    market_timezone VARCHAR(64),
    quantity_unit VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT assets_distinct_currency_pair_check CHECK (
        base_currency IS NULL OR quote_currency IS NULL OR base_currency <> quote_currency
    ),
    CONSTRAINT assets_active_quote_currency_check CHECK (NOT is_active OR quote_currency IS NOT NULL),
    CONSTRAINT assets_optional_metadata_nonempty_check CHECK (
        (market_code IS NULL OR BTRIM(market_code) <> '')
        AND (market_timezone IS NULL OR BTRIM(market_timezone) <> '')
        AND (quantity_unit IS NULL OR BTRIM(quantity_unit) <> '')
    )
);

-- Index for fast symbol lookup and filtering by asset type
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON public.assets (symbol);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON public.assets (asset_type);

-- Enable Row Level Security (RLS)
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Allow public read access to assets table (for SELECT operations)
DROP POLICY IF EXISTS "Allow public read access to assets" ON public.assets;
CREATE POLICY "Allow public read access to assets"
    ON public.assets
    FOR SELECT
    USING (true);

CREATE TABLE IF NOT EXISTS public.asset_provider_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (
        provider = LOWER(BTRIM(provider)) AND provider ~ '^[a-z][a-z0-9_-]*$'
    ),
    provider_symbol VARCHAR(255) NOT NULL CHECK (BTRIM(provider_symbol) <> ''),
    provider_market VARCHAR(100) CHECK (provider_market IS NULL OR BTRIM(provider_market) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_asset_provider_mappings_asset_provider UNIQUE (asset_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_provider_mappings_provider_identity
    ON public.asset_provider_mappings (provider, provider_symbol, COALESCE(provider_market, ''));
CREATE INDEX IF NOT EXISTS idx_asset_provider_mappings_asset_id
    ON public.asset_provider_mappings (asset_id);

ALTER TABLE public.asset_provider_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to asset_provider_mappings"
    ON public.asset_provider_mappings;
CREATE POLICY "Allow public read access to asset_provider_mappings"
    ON public.asset_provider_mappings
    FOR SELECT
    USING (true);

-- ==========================================================
-- Schema Migration: 002_create_investor_profile_table.sql
-- Purpose: Single-user investor profile table for capital, risk & horizon
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.investor_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Bootstrap compatibility for immutable pre-multi-user migrations. The
    -- Feature 13B section below removes this legacy singleton authority.
    singleton_key SMALLINT NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
    cash_available NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cash_available >= 0),
    risk_tolerance VARCHAR(20) NOT NULL CHECK (risk_tolerance IN ('low', 'moderate', 'high')),
    investment_horizon VARCHAR(20) NOT NULL CHECK (investment_horizon IN ('short', 'medium', 'long')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.investor_profile ENABLE ROW LEVEL SECURITY;

-- Allow public read access to investor_profile table
DROP POLICY IF EXISTS "Allow public read access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public read access to investor_profile"
    ON public.investor_profile
    FOR SELECT
    USING (true);

-- Allow public insert access to investor_profile table
DROP POLICY IF EXISTS "Allow public insert access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public insert access to investor_profile"
    ON public.investor_profile
    FOR INSERT
    WITH CHECK (true);

-- Allow public update access to investor_profile table
DROP POLICY IF EXISTS "Allow public update access to investor_profile" ON public.investor_profile;
CREATE POLICY "Allow public update access to investor_profile"
    ON public.investor_profile
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- ==========================================================
-- Schema Migration: 003_create_holdings_table.sql
-- Purpose: User asset portfolio holdings table
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL CHECK (
        quantity > 0 AND quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    average_cost NUMERIC NOT NULL CHECK (
        average_cost >= 0 AND average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_holdings_profile_asset UNIQUE (profile_id, asset_id)
);

-- Index for fast lookups by profile_id and asset_id
CREATE INDEX IF NOT EXISTS idx_holdings_profile_id ON public.holdings (profile_id);
CREATE INDEX IF NOT EXISTS idx_holdings_asset_id ON public.holdings (asset_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

-- Allow public read access to holdings table
DROP POLICY IF EXISTS "Allow public read access to holdings" ON public.holdings;
CREATE POLICY "Allow public read access to holdings"
    ON public.holdings
    FOR SELECT
    USING (true);

-- Allow public insert access to holdings table
DROP POLICY IF EXISTS "Allow public insert access to holdings" ON public.holdings;
CREATE POLICY "Allow public insert access to holdings"
    ON public.holdings
    FOR INSERT
    WITH CHECK (true);

-- Allow public update access to holdings table
DROP POLICY IF EXISTS "Allow public update access to holdings" ON public.holdings;
CREATE POLICY "Allow public update access to holdings"
    ON public.holdings
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Allow public delete access to holdings table
DROP POLICY IF EXISTS "Allow public delete access to holdings" ON public.holdings;
CREATE POLICY "Allow public delete access to holdings"
    ON public.holdings
    FOR DELETE
    USING (true);

-- ==========================================================
-- Schema Migration: 004_create_watchlist_items_table.sql
-- Purpose: User watchlist items table for saved assets
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.watchlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_watchlist_items_profile_asset UNIQUE (profile_id, asset_id)
);

-- Index for fast lookups by profile_id and asset_id
CREATE INDEX IF NOT EXISTS idx_watchlist_items_profile_id ON public.watchlist_items (profile_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_asset_id ON public.watchlist_items (asset_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

-- Allow public read access to watchlist_items table
DROP POLICY IF EXISTS "Allow public read access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public read access to watchlist_items"
    ON public.watchlist_items
    FOR SELECT
    USING (true);

-- Allow public insert access to watchlist_items table
DROP POLICY IF EXISTS "Allow public insert access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public insert access to watchlist_items"
    ON public.watchlist_items
    FOR INSERT
    WITH CHECK (true);

-- Allow public delete access to watchlist_items table
DROP POLICY IF EXISTS "Allow public delete access to watchlist_items" ON public.watchlist_items;
CREATE POLICY "Allow public delete access to watchlist_items"
    ON public.watchlist_items
    FOR DELETE
    USING (true);

-- ==========================================================
-- Schema Migration: 005_create_price_alerts_table.sql (Feature 12)
-- Purpose: User persistent price alert conditions table
-- ==========================================================

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

-- Index for fast lookups by profile_id, asset_id, and status
CREATE INDEX IF NOT EXISTS idx_price_alerts_profile_id ON public.price_alerts (profile_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_asset_id ON public.price_alerts (asset_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_status ON public.price_alerts (status);

-- Enable Row Level Security (RLS)
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

-- Allow public read access to price_alerts table
DROP POLICY IF EXISTS "Allow public read access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public read access to price_alerts"
    ON public.price_alerts
    FOR SELECT
    USING (true);

-- Allow public insert access to price_alerts table
DROP POLICY IF EXISTS "Allow public insert access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public insert access to price_alerts"
    ON public.price_alerts
    FOR INSERT
    WITH CHECK (true);

-- Allow public update access to price_alerts table
DROP POLICY IF EXISTS "Allow public update access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public update access to price_alerts"
    ON public.price_alerts
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Allow public delete access to price_alerts table
DROP POLICY IF EXISTS "Allow public delete access to price_alerts" ON public.price_alerts;
CREATE POLICY "Allow public delete access to price_alerts"
    ON public.price_alerts
    FOR DELETE
    USING (true);

-- ==========================================================
-- Schema Migration: 006_create_portfolio_transactions.sql (Feature 14)
-- Purpose: Immutable BUY/SELL ledger with atomic holdings updates
-- Existing holdings remain valid opening positions and are not backfilled.
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.portfolio_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    transaction_type VARCHAR(4) NOT NULL CHECK (transaction_type IN ('BUY', 'SELL')),
    quantity NUMERIC NOT NULL CHECK (
        quantity > 0 AND quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    price NUMERIC NOT NULL CHECK (
        price > 0 AND price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    realized_pnl NUMERIC DEFAULT NULL CHECK (
        realized_pnl IS NULL OR realized_pnl::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_transactions_realized_pnl_semantics_check CHECK (
        (transaction_type = 'BUY' AND realized_pnl IS NULL)
        OR (transaction_type = 'SELL' AND realized_pnl IS NOT NULL)
    )
);

COMMENT ON TABLE public.portfolio_transactions IS
    'Immutable transaction history beginning at Feature 14; existing holdings may predate ledger history.';

CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_profile_order
    ON public.portfolio_transactions (profile_id, executed_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_asset_id
    ON public.portfolio_transactions (asset_id);

ALTER TABLE public.portfolio_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to portfolio_transactions" ON public.portfolio_transactions;
CREATE POLICY "Allow public read access to portfolio_transactions"
    ON public.portfolio_transactions
    FOR SELECT
    USING (true);

-- No INSERT/UPDATE/DELETE policies are created. All ledger writes go through
-- the atomic SECURITY DEFINER function.

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

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
BEGIN
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;

    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;

    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    SELECT ip.id
    INTO v_profile_id
    FROM public.investor_profile AS ip
    WHERE ip.singleton_key = 1;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT a.* INTO v_asset
        FROM public.assets AS a
        WHERE a.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT a.* INTO v_asset
        FROM public.assets AS a
        WHERE a.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    SELECT h.*
    INTO v_existing_holding
    FROM public.holdings AS h
    WHERE h.profile_id = v_profile_id
      AND h.asset_id = v_asset.id
    FOR UPDATE;
    v_has_holding := FOUND;

    IF p_transaction_type = 'BUY' THEN
        v_realized_pnl := NULL;
        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost)
                + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;
    ELSE
        IF NOT v_has_holding THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot SELL an asset without an existing holding';
        END IF;
        IF p_quantity > v_existing_holding.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT003', MESSAGE = 'sell quantity exceeds current holding quantity';
        END IF;

        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        v_holding_removed := v_new_quantity = 0;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at
    )
    VALUES (
        v_profile_id, v_asset.id, p_transaction_type, p_quantity, p_price,
        v_realized_pnl, COALESCE(p_executed_at, NOW())
    )
    RETURNING * INTO v_transaction;

    IF p_transaction_type = 'BUY' AND v_has_holding THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = NOW()
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile_id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile_id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile_id;
    ELSE
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            updated_at = NOW()
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile_id
        RETURNING * INTO v_result_holding;
    END IF;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(p_symbol TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    INNER JOIN public.investor_profile AS ip ON ip.id = t.profile_id
    WHERE ip.singleton_key = 1
      AND (p_symbol IS NULL OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
$$;

REVOKE ALL ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
    FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT)
    FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(TEXT)
    TO anon, authenticated, service_role;

-- ==========================================================
-- Schema Migration: 007_create_cash_capital_ledger.sql (Feature 15)
-- Purpose: Auditable current cash and atomic BUY/SELL reconciliation
-- ==========================================================
-- Feature 15: auditable cash/capital ledger and atomic cash reconciliation.
-- Existing cash is captured once as an activation baseline. Historical
-- portfolio transactions are intentionally not replayed or backfilled.

ALTER TABLE public.investor_profile
    ALTER COLUMN cash_available TYPE NUMERIC USING cash_available::NUMERIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'investor_profile_cash_finite_nonnegative_check'
    ) THEN
        ALTER TABLE public.investor_profile
            ADD CONSTRAINT investor_profile_cash_finite_nonnegative_check
            CHECK (
                cash_available >= 0
                AND cash_available::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cash_ledger_activation (
    profile_id UUID PRIMARY KEY REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    opening_balance_amount NUMERIC NOT NULL CHECK (
        opening_balance_amount >= 0
        AND opening_balance_amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.cash_ledger_activation IS
    'Feature 15 accounting boundary: current cash at activation, not lifetime original capital. A zero opening balance is represented here without a fake positive ledger entry.';

CREATE TABLE IF NOT EXISTS public.cash_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    entry_type VARCHAR(20) NOT NULL CHECK (
        entry_type IN ('OPENING_BALANCE', 'DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL')
    ),
    amount NUMERIC NOT NULL CHECK (
        amount > 0 AND amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    portfolio_transaction_id UUID DEFAULT NULL
        REFERENCES public.portfolio_transactions(id) ON DELETE RESTRICT,
    effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(metadata) = 'object'),
    CONSTRAINT cash_ledger_transaction_link_semantics_check CHECK (
        (entry_type IN ('BUY', 'SELL') AND portfolio_transaction_id IS NOT NULL)
        OR
        (entry_type IN ('OPENING_BALANCE', 'DEPOSIT', 'WITHDRAWAL') AND portfolio_transaction_id IS NULL)
    )
);

COMMENT ON TABLE public.cash_ledger_entries IS
    'Immutable cash movements from Feature 15 activation onward. Legacy portfolio transactions are not retroactively represented.';
COMMENT ON COLUMN public.cash_ledger_entries.effective_at IS
    'Cash accounting time. A newly recorded transaction affects current cash now even when its executed_at is historical.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_ledger_opening_balance_per_profile
    ON public.cash_ledger_entries (profile_id)
    WHERE entry_type = 'OPENING_BALANCE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_ledger_portfolio_transaction
    ON public.cash_ledger_entries (portfolio_transaction_id)
    WHERE portfolio_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_ledger_profile_order
    ON public.cash_ledger_entries (profile_id, effective_at DESC, created_at DESC, id DESC);

ALTER TABLE public.cash_ledger_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Reads and all writes use the narrowly scoped RPCs below. No direct mutation
-- policies exist for either ledger table.

CREATE OR REPLACE FUNCTION public.initialize_cash_ledger_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_activated_at TIMESTAMPTZ := NOW();
BEGIN
    INSERT INTO public.cash_ledger_activation (
        profile_id,
        opening_balance_amount,
        activated_at
    )
    VALUES (NEW.id, NEW.cash_available, v_activated_at)
    ON CONFLICT (profile_id) DO NOTHING;

    IF NEW.cash_available > 0 THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id,
            entry_type,
            amount,
            effective_at,
            created_at,
            metadata
        )
        VALUES (
            NEW.id,
            'OPENING_BALANCE',
            NEW.cash_available,
            v_activated_at,
            v_activated_at,
            jsonb_build_object(
                'semantics', 'feature_15_activation_current_cash_baseline',
                'historicalCapitalClaim', FALSE
            )
        )
        ON CONFLICT (profile_id) WHERE entry_type = 'OPENING_BALANCE' DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_initialize_cash_ledger_account ON public.investor_profile;
CREATE TRIGGER trg_initialize_cash_ledger_account
    AFTER INSERT ON public.investor_profile
    FOR EACH ROW
    EXECUTE FUNCTION public.initialize_cash_ledger_account();

-- Preserve the existing singleton cash exactly once. Re-running this migration
-- cannot shift the activation boundary or duplicate the opening entry.
INSERT INTO public.cash_ledger_activation (
    profile_id,
    opening_balance_amount,
    activated_at
)
SELECT ip.id, ip.cash_available, NOW()
FROM public.investor_profile AS ip
WHERE ip.singleton_key = 1
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.cash_ledger_entries (
    profile_id,
    entry_type,
    amount,
    effective_at,
    created_at,
    metadata
)
SELECT
    activation.profile_id,
    'OPENING_BALANCE',
    activation.opening_balance_amount,
    activation.activated_at,
    activation.activated_at,
    jsonb_build_object(
        'semantics', 'feature_15_activation_current_cash_baseline',
        'historicalCapitalClaim', FALSE
    )
FROM public.cash_ledger_activation AS activation
WHERE activation.opening_balance_amount > 0
ON CONFLICT (profile_id) WHERE entry_type = 'OPENING_BALANCE' DO NOTHING;

CREATE OR REPLACE FUNCTION public.calculate_cash_ledger_balance(p_profile_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        activation.opening_balance_amount
        + COALESCE(SUM(
            CASE entries.entry_type
                WHEN 'DEPOSIT' THEN entries.amount
                WHEN 'WITHDRAWAL' THEN -entries.amount
                WHEN 'BUY' THEN -entries.amount
                WHEN 'SELL' THEN entries.amount
                ELSE 0
            END
        ), 0)
    FROM public.cash_ledger_activation AS activation
    LEFT JOIN public.cash_ledger_entries AS entries
      ON entries.profile_id = activation.profile_id
    WHERE activation.profile_id = p_profile_id
    GROUP BY activation.profile_id, activation.opening_balance_amount;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_activation public.cash_ledger_activation%ROWTYPE;
    v_current_cash NUMERIC;
    v_total_deposits NUMERIC;
    v_total_withdrawals NUMERIC;
    v_buy_outflows NUMERIC;
    v_sell_inflows NUMERIC;
    v_entry_count BIGINT;
BEGIN
    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.singleton_key = 1;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    SELECT activation.*
    INTO v_activation
    FROM public.cash_ledger_activation AS activation
    WHERE activation.profile_id = v_profile.id;

    IF v_activation.profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;

    SELECT
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'DEPOSIT'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'WITHDRAWAL'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'BUY'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'SELL'), 0),
        COUNT(*)
    INTO
        v_total_deposits,
        v_total_withdrawals,
        v_buy_outflows,
        v_sell_inflows,
        v_entry_count
    FROM public.cash_ledger_entries AS entries
    WHERE entries.profile_id = v_profile.id;

    v_current_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_current_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    RETURN jsonb_build_object(
        'current_cash', v_current_cash,
        'opening_balance', v_activation.opening_balance_amount,
        'total_deposits', v_total_deposits,
        'total_withdrawals', v_total_withdrawals,
        'buy_outflows', v_buy_outflows,
        'sell_inflows', v_sell_inflows,
        'entry_count', v_entry_count,
        'ledger_start_at', v_activation.activated_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_cash_ledger_entries()
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    entry_type TEXT,
    amount NUMERIC,
    portfolio_transaction_id UUID,
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    metadata JSONB,
    symbol TEXT,
    transaction_executed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        entries.id,
        entries.profile_id,
        entries.entry_type::TEXT,
        entries.amount,
        entries.portfolio_transaction_id,
        entries.effective_at,
        entries.created_at,
        entries.metadata,
        assets.symbol::TEXT,
        transactions.executed_at
    FROM public.cash_ledger_entries AS entries
    INNER JOIN public.investor_profile AS profile
      ON profile.id = entries.profile_id
     AND profile.singleton_key = 1
    LEFT JOIN public.portfolio_transactions AS transactions
      ON transactions.id = entries.portfolio_transaction_id
    LEFT JOIN public.assets AS assets
      ON assets.id = transactions.asset_id
    ORDER BY entries.effective_at DESC, entries.created_at DESC, entries.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.create_cash_movement(
    p_entry_type TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_entry public.cash_ledger_entries%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_entry_type IS NULL OR p_entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'entryType must be DEPOSIT or WITHDRAWAL';
    END IF;
    IF p_amount IS NULL
        OR p_amount <= 0
        OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'amount must be a finite number greater than 0';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.singleton_key = 1
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_entry_type = 'WITHDRAWAL' AND p_amount > v_ledger_cash THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
    END IF;

    v_new_cash := CASE
        WHEN p_entry_type = 'DEPOSIT' THEN v_ledger_cash + p_amount
        ELSE v_ledger_cash - p_amount
    END;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        effective_at,
        created_at
    )
    VALUES (
        v_profile.id,
        p_entry_type,
        p_amount,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'entry', jsonb_build_object(
            'id', v_entry.id,
            'profile_id', v_entry.profile_id,
            'entry_type', v_entry.entry_type,
            'amount', v_entry.amount,
            'portfolio_transaction_id', v_entry.portfolio_transaction_id,
            'effective_at', v_entry.effective_at,
            'created_at', v_entry.created_at,
            'metadata', v_entry.metadata
        ),
        'currentCash', v_new_cash
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_investor_profile_preferences(
    p_risk_tolerance TEXT,
    p_investment_horizon TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
BEGIN
    IF p_risk_tolerance IS NULL OR p_risk_tolerance NOT IN ('low', 'moderate', 'high') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP001', MESSAGE = 'invalid risk tolerance';
    END IF;
    IF p_investment_horizon IS NULL OR p_investment_horizon NOT IN ('short', 'medium', 'long') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP001', MESSAGE = 'invalid investment horizon';
    END IF;

    UPDATE public.investor_profile
    SET risk_tolerance = p_risk_tolerance,
        investment_horizon = p_investment_horizon,
        updated_at = NOW()
    WHERE singleton_key = 1
    RETURNING * INTO v_profile;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    RETURN jsonb_build_object(
        'id', v_profile.id,
        'cash_available', v_profile.cash_available,
        'risk_tolerance', v_profile.risk_tolerance,
        'investment_horizon', v_profile.investment_horizon,
        'created_at', v_profile.created_at,
        'updated_at', v_profile.updated_at
    );
END;
$$;

-- Replace Feature 14's transaction RPC so portfolio transaction, holdings,
-- linked cash entry, and cached current cash commit or roll back together.
CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.singleton_key = 1
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.*
        INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.*
        INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;
    v_has_holding := FOUND;
    v_cash_amount := p_quantity * p_price;

    IF p_transaction_type = 'BUY' THEN
        IF v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'insufficient current cash for BUY transaction';
        END IF;

        v_realized_pnl := NULL;
        v_new_cash := v_ledger_cash - v_cash_amount;
        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost)
                + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;
    ELSE
        IF NOT v_has_holding THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot SELL an asset without an existing holding';
        END IF;
        IF p_quantity > v_existing_holding.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT003', MESSAGE = 'sell quantity exceeds current holding quantity';
        END IF;

        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        v_holding_removed := v_new_quantity = 0;
        v_new_cash := v_ledger_cash + v_cash_amount;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id,
        asset_id,
        transaction_type,
        quantity,
        price,
        realized_pnl,
        executed_at
    )
    VALUES (
        v_profile.id,
        v_asset.id,
        p_transaction_type,
        p_quantity,
        p_price,
        v_realized_pnl,
        COALESCE(p_executed_at, v_accounted_at)
    )
    RETURNING * INTO v_transaction;

    IF p_transaction_type = 'BUY' AND v_has_holding THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    ELSE
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    END IF;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        portfolio_transaction_id,
        effective_at,
        created_at,
        metadata
    )
    VALUES (
        v_profile.id,
        p_transaction_type,
        v_cash_amount,
        v_transaction.id,
        v_accounted_at,
        v_accounted_at,
        jsonb_build_object(
            'accountingSemantics', 'recorded_now_affects_current_cash',
            'historicalCashReconstruction', FALSE
        )
    )
    RETURNING * INTO v_cash_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', jsonb_build_object(
            'id', v_cash_entry.id,
            'profile_id', v_cash_entry.profile_id,
            'entry_type', v_cash_entry.entry_type,
            'amount', v_cash_entry.amount,
            'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
            'effective_at', v_cash_entry.effective_at,
            'created_at', v_cash_entry.created_at,
            'metadata', v_cash_entry.metadata,
            'symbol', v_asset.symbol
        ),
        'currentCash', v_new_cash
    );
END;
$$;

-- cash_available is no longer independently writable through table REST.
DROP POLICY IF EXISTS "Allow public update access to investor_profile" ON public.investor_profile;

REVOKE ALL ON FUNCTION public.initialize_cash_ledger_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_cash_ledger_balance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_cash_movement(TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_cash_overview() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(TEXT, NUMERIC) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_cash_overview()
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries()
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(TEXT, NUMERIC)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT)
    TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ) IS
    'Atomically inserts an immutable transaction, mutates holdings, creates one linked cash entry, and reconciles current cash. Recording time controls current cash even when executed_at is historical.';

-- ==========================================================
-- Schema Migration: 009_create_position_opening_baselines.sql (Feature 17)
-- Purpose: Explicit opening provenance and ledger-authoritative holdings
-- ==========================================================
-- Feature 17: explicit opening-position provenance and ledger-authoritative holdings.
-- Existing holdings are snapshotted at activation without replaying or fabricating history.

CREATE TABLE IF NOT EXISTS public.position_ledger_activation (
    profile_id UUID PRIMARY KEY REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.position_ledger_activation IS
    'Feature 17 position-accounting cutoff. Existing holdings are captured as known activation state, not reconstructed purchase history.';

CREATE TABLE IF NOT EXISTS public.position_opening_baselines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    opening_quantity NUMERIC NOT NULL CHECK (
        opening_quantity > 0
        AND opening_quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    opening_average_cost NUMERIC NOT NULL CHECK (
        opening_average_cost >= 0
        AND opening_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    accounting_cutoff_at TIMESTAMPTZ NOT NULL,
    provenance_type VARCHAR(32) NOT NULL CHECK (
        provenance_type IN ('USER_RECORDED', 'LEGACY_ACTIVATION', 'LEGACY_MIXED_ACTIVATION')
    ),
    locked_at TIMESTAMPTZ DEFAULT NULL,
    cancelled_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_position_opening_baseline_profile_asset UNIQUE (profile_id, asset_id),
    CONSTRAINT uq_position_opening_baseline_identity UNIQUE (id, profile_id, asset_id),
    CONSTRAINT position_opening_baseline_state_check CHECK (
        cancelled_at IS NULL OR locked_at IS NULL
    )
);

COMMENT ON TABLE public.position_opening_baselines IS
    'Cash-neutral opening position provenance. It is not a BUY ledger and does not claim unavailable purchase history.';
COMMENT ON COLUMN public.position_opening_baselines.accounting_cutoff_at IS
    'Accounting-order cutoff. Only portfolio transactions recorded after this point are subsequent position effects; executed_at may be historical.';

CREATE INDEX IF NOT EXISTS idx_position_opening_baselines_profile
    ON public.position_opening_baselines (profile_id);
CREATE INDEX IF NOT EXISTS idx_position_opening_baselines_asset
    ON public.position_opening_baselines (asset_id);

ALTER TABLE public.position_opening_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_ledger_activation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to position_opening_baselines"
    ON public.position_opening_baselines;
CREATE POLICY "Allow public read access to position_opening_baselines"
    ON public.position_opening_baselines
    FOR SELECT
    USING (true);

ALTER TABLE public.holdings
    ADD COLUMN IF NOT EXISTS opening_position_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.holdings'::regclass
          AND conname = 'holdings_opening_position_identity_fkey'
    ) THEN
        ALTER TABLE public.holdings
            ADD CONSTRAINT holdings_opening_position_identity_fkey
            FOREIGN KEY (opening_position_id, profile_id, asset_id)
            REFERENCES public.position_opening_baselines (id, profile_id, asset_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_holdings_opening_position_id
    ON public.holdings (opening_position_id)
    WHERE opening_position_id IS NOT NULL;

INSERT INTO public.position_ledger_activation (profile_id, activated_at)
SELECT ip.id, NOW()
FROM public.investor_profile AS ip
WHERE ip.singleton_key = 1
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.position_opening_baselines (
    profile_id,
    asset_id,
    opening_quantity,
    opening_average_cost,
    accounting_cutoff_at,
    provenance_type,
    locked_at,
    created_at,
    updated_at
)
SELECT
    holdings.profile_id,
    holdings.asset_id,
    holdings.quantity,
    holdings.average_cost,
    activation.activated_at,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM public.portfolio_transactions AS transactions
            WHERE transactions.profile_id = holdings.profile_id
              AND transactions.asset_id = holdings.asset_id
              AND transactions.created_at <= activation.activated_at
        ) THEN 'LEGACY_MIXED_ACTIVATION'
        ELSE 'LEGACY_ACTIVATION'
    END,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM public.portfolio_transactions AS transactions
            WHERE transactions.profile_id = holdings.profile_id
              AND transactions.asset_id = holdings.asset_id
              AND transactions.created_at <= activation.activated_at
        ) THEN activation.activated_at
        ELSE NULL
    END,
    activation.activated_at,
    activation.activated_at
FROM public.holdings AS holdings
INNER JOIN public.position_ledger_activation AS activation
    ON activation.profile_id = holdings.profile_id
WHERE holdings.created_at <= activation.activated_at
ON CONFLICT (profile_id, asset_id) DO NOTHING;

UPDATE public.holdings AS holdings
SET opening_position_id = baselines.id
FROM public.position_opening_baselines AS baselines
WHERE holdings.profile_id = baselines.profile_id
  AND holdings.asset_id = baselines.asset_id
  AND holdings.opening_position_id IS NULL
  AND baselines.provenance_type IN ('LEGACY_ACTIVATION', 'LEGACY_MIXED_ACTIVATION')
  AND baselines.cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    SELECT assets.*
    INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;
    IF v_asset.quote_currency IS DISTINCT FROM 'VND' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'non-VND opening positions are unsupported until FX accounting exists';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
    ) OR EXISTS (
        SELECT 1
        FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'asset already has a holding or opening baseline';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id,
        asset_id,
        opening_quantity,
        opening_average_cost,
        accounting_cutoff_at,
        provenance_type,
        created_at,
        updated_at
    )
    VALUES (
        v_profile_id,
        v_asset.id,
        p_quantity,
        p_average_cost,
        v_accounted_at,
        'USER_RECORDED',
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id,
        asset_id,
        opening_position_id,
        quantity,
        average_cost,
        created_at,
        updated_at
    )
    VALUES (
        v_profile_id,
        v_asset.id,
        v_baseline.id,
        p_quantity,
        p_average_cost,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.locked_at IS NOT NULL OR v_baseline.cancelled_at IS NOT NULL OR EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_baseline.profile_id
          AND transactions.asset_id = v_baseline.asset_id
          AND transactions.created_at > v_baseline.accounting_cutoff_at
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'opening position is locked and cannot be corrected';
    END IF;

    SELECT holdings.*
    INTO v_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile_id
      AND holdings.asset_id = v_baseline.asset_id
      AND holdings.opening_position_id = v_baseline.id
    FOR UPDATE;

    IF v_holding.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'opening position holding projection is unavailable';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE id = v_holding.id
      AND profile_id = v_profile_id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_opening_position(p_opening_position_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.locked_at IS NOT NULL OR v_baseline.cancelled_at IS NOT NULL OR EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_baseline.profile_id
          AND transactions.asset_id = v_baseline.asset_id
          AND transactions.created_at > v_baseline.accounting_cutoff_at
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'opening position is locked and cannot be cancelled';
    END IF;

    SELECT holdings.*
    INTO v_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile_id
      AND holdings.asset_id = v_baseline.asset_id
      AND holdings.opening_position_id = v_baseline.id
    FOR UPDATE;

    IF v_holding.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'opening position holding projection is unavailable';
    END IF;

    UPDATE public.position_opening_baselines
    SET cancelled_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    DELETE FROM public.holdings
    WHERE id = v_holding.id
      AND profile_id = v_profile_id;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', NULL
    );
END;
$$;

-- Lock opening correction by accounting order inside the same atomic transaction
-- that records the BUY/SELL, mutates holdings, and reconciles cash.
CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND locked_at IS NULL
      AND cancelled_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;
    v_has_holding := FOUND;
    v_cash_amount := p_quantity * p_price;

    IF p_transaction_type = 'BUY' THEN
        IF v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'insufficient current cash for BUY transaction';
        END IF;

        v_realized_pnl := NULL;
        v_new_cash := v_ledger_cash - v_cash_amount;
        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost)
                + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;
    ELSE
        IF NOT v_has_holding THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot SELL an asset without an existing holding';
        END IF;
        IF p_quantity > v_existing_holding.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT003', MESSAGE = 'sell quantity exceeds current holding quantity';
        END IF;

        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        v_holding_removed := v_new_quantity = 0;
        v_new_cash := v_ledger_cash + v_cash_amount;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price,
        v_realized_pnl, COALESCE(p_executed_at, v_accounted_at)
    )
    RETURNING * INTO v_transaction;

    IF p_transaction_type = 'BUY' AND v_has_holding THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    ELSE
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    END IF;

    INSERT INTO public.cash_ledger_entries (
        profile_id, entry_type, amount, portfolio_transaction_id,
        effective_at, created_at, metadata
    )
    VALUES (
        v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
        v_accounted_at, v_accounted_at,
        jsonb_build_object(
            'accountingSemantics', 'recorded_now_affects_current_cash',
            'historicalCashReconstruction', FALSE
        )
    )
    RETURNING * INTO v_cash_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', jsonb_build_object(
            'id', v_cash_entry.id,
            'profile_id', v_cash_entry.profile_id,
            'entry_type', v_cash_entry.entry_type,
            'amount', v_cash_entry.amount,
            'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
            'effective_at', v_cash_entry.effective_at,
            'created_at', v_cash_entry.created_at,
            'metadata', v_cash_entry.metadata,
            'symbol', v_asset.symbol
        ),
        'currentCash', v_new_cash
    );
END;
$$;

-- The application roles may read holdings/provenance but may mutate holdings only
-- through the approved SECURITY DEFINER opening and transaction RPCs.
DROP POLICY IF EXISTS "Allow public insert access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public update access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public delete access to holdings" ON public.holdings;

REVOKE INSERT, UPDATE, DELETE ON public.holdings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.holdings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.position_opening_baselines FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.position_opening_baselines FROM anon, authenticated;
REVOKE ALL ON public.position_ledger_activation FROM PUBLIC;
REVOKE ALL ON public.position_ledger_activation FROM anon, authenticated;

GRANT SELECT ON public.holdings TO anon, authenticated, service_role;
GRANT SELECT ON public.position_opening_baselines TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_opening_position(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(TEXT)
    TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC) IS
    'Atomically establishes a cash-neutral opening baseline and holdings projection for an already-owned active VND asset.';
COMMENT ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC) IS
    'Corrects an unlocked opening baseline and its holdings projection without creating transaction or cash entries.';
COMMENT ON FUNCTION public.cancel_opening_position(TEXT) IS
    'Cancels an unlocked opening baseline, preserves provenance, and removes its holdings projection without changing cash.';

-- ==========================================================
-- Feature 30B1: single-owner security boundary
-- ==========================================================
-- The browser never receives database authority. Canonical assets and provider
-- mappings remain public; all personal state is backend/service-role only.

DROP POLICY IF EXISTS "Allow public read access to investor_profile" ON public.investor_profile;
DROP POLICY IF EXISTS "Allow public insert access to investor_profile" ON public.investor_profile;
DROP POLICY IF EXISTS "Allow public update access to investor_profile" ON public.investor_profile;

DROP POLICY IF EXISTS "Allow public read access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public insert access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public update access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public delete access to holdings" ON public.holdings;

DROP POLICY IF EXISTS "Allow public read access to watchlist_items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Allow public insert access to watchlist_items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Allow public delete access to watchlist_items" ON public.watchlist_items;

DROP POLICY IF EXISTS "Allow public read access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public insert access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public update access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public delete access to price_alerts" ON public.price_alerts;

DROP POLICY IF EXISTS "Allow public read access to portfolio_transactions" ON public.portfolio_transactions;
DROP POLICY IF EXISTS "Allow public read access to position_opening_baselines" ON public.position_opening_baselines;

REVOKE ALL PRIVILEGES ON TABLE
  public.investor_profile,
  public.holdings,
  public.watchlist_items,
  public.price_alerts,
  public.portfolio_transactions,
  public.cash_ledger_activation,
  public.cash_ledger_entries,
  public.position_ledger_activation,
  public.position_opening_baselines
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.investor_profile,
  public.holdings,
  public.watchlist_items,
  public.price_alerts,
  public.portfolio_transactions,
  public.cash_ledger_activation,
  public.cash_ledger_entries,
  public.position_ledger_activation,
  public.position_opening_baselines
TO service_role;

REVOKE ALL ON FUNCTION public.enforce_vnd_portfolio_transaction_asset()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_cash_ledger_account()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_cash_ledger_balance(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cash_overview()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cash_overview()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(TEXT, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(TEXT)
  TO service_role;

-- ==========================================================
-- Schema Migration: 20260901010000_v1_1_cross_currency_accounting_foundation.sql (Improvement 07C)
-- Purpose: Cross-Currency Accounting Foundation (Dual Settlement + VND Basis)
-- ==========================================================

-- 1. Extend portfolio_transactions with execution metadata
ALTER TABLE public.portfolio_transactions
    ADD COLUMN IF NOT EXISTS execution_unit_price NUMERIC,
    ADD COLUMN IF NOT EXISTS price_currency VARCHAR(12) NOT NULL DEFAULT 'VND',
    ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(32) NOT NULL DEFAULT 'INTERNAL_VND_CASH',
    ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(12) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fx_rate_to_vnd NUMERIC DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fx_provenance VARCHAR(64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fx_observed_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill existing transaction rows
UPDATE public.portfolio_transactions
SET execution_unit_price = COALESCE(execution_unit_price, price),
    price_currency = COALESCE(price_currency, 'VND'),
    settlement_mode = COALESCE(settlement_mode, 'INTERNAL_VND_CASH'),
    settlement_currency = CASE
        WHEN COALESCE(settlement_mode, 'INTERNAL_VND_CASH') = 'INTERNAL_VND_CASH' THEN 'VND'
        ELSE settlement_currency
    END
WHERE price_currency IS NULL OR settlement_mode IS NULL OR execution_unit_price IS NULL OR (settlement_mode = 'INTERNAL_VND_CASH' AND settlement_currency IS NULL);

-- Add constraints on portfolio_transactions
ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS chk_portfolio_transactions_settlement_mode,
    ADD CONSTRAINT chk_portfolio_transactions_settlement_mode
        CHECK (settlement_mode IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT'));

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS chk_portfolio_transactions_internal_vnd_cash,
    ADD CONSTRAINT chk_portfolio_transactions_internal_vnd_cash
        CHECK (settlement_mode <> 'INTERNAL_VND_CASH' OR settlement_currency = 'VND');

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS chk_portfolio_transactions_execution_unit_price,
    ADD CONSTRAINT chk_portfolio_transactions_execution_unit_price
        CHECK (execution_unit_price IS NULL OR (execution_unit_price > 0 AND execution_unit_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')));

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS chk_portfolio_transactions_fx_rate_to_vnd,
    ADD CONSTRAINT chk_portfolio_transactions_fx_rate_to_vnd
        CHECK (fx_rate_to_vnd IS NULL OR (fx_rate_to_vnd > 0 AND fx_rate_to_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')));


-- 2. Extend position_opening_baselines with execution metadata
ALTER TABLE public.position_opening_baselines
    ADD COLUMN IF NOT EXISTS execution_unit_price NUMERIC,
    ADD COLUMN IF NOT EXISTS price_currency VARCHAR(12) NOT NULL DEFAULT 'VND',
    ADD COLUMN IF NOT EXISTS fx_rate_to_vnd NUMERIC DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fx_provenance VARCHAR(64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fx_observed_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill existing baseline rows
UPDATE public.position_opening_baselines
SET execution_unit_price = COALESCE(execution_unit_price, opening_average_cost),
    price_currency = COALESCE(price_currency, 'VND')
WHERE price_currency IS NULL OR execution_unit_price IS NULL;

ALTER TABLE public.position_opening_baselines
    DROP CONSTRAINT IF EXISTS chk_position_opening_baselines_execution_unit_price,
    ADD CONSTRAINT chk_position_opening_baselines_execution_unit_price
        CHECK (execution_unit_price IS NULL OR (execution_unit_price >= 0 AND execution_unit_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')));

ALTER TABLE public.position_opening_baselines
    DROP CONSTRAINT IF EXISTS chk_position_opening_baselines_fx_rate_to_vnd,
    ADD CONSTRAINT chk_position_opening_baselines_fx_rate_to_vnd
        CHECK (fx_rate_to_vnd IS NULL OR (fx_rate_to_vnd > 0 AND fx_rate_to_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')));


-- 3. Replace enforce_vnd_portfolio_transaction_asset trigger function with cross-field accounting validation
CREATE OR REPLACE FUNCTION public.enforce_vnd_portfolio_transaction_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asset public.assets%ROWTYPE;
    v_expected_vnd_price NUMERIC;
BEGIN
    SELECT *
    INTO v_asset
    FROM public.assets
    WHERE id = NEW.asset_id;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found for transaction validation';
    END IF;

    -- Normalize string fields
    NEW.price_currency := UPPER(COALESCE(BTRIM(NEW.price_currency), 'VND'));
    NEW.settlement_mode := UPPER(COALESCE(BTRIM(NEW.settlement_mode), 'INTERNAL_VND_CASH'));

    IF NEW.settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF NEW.settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF NEW.settlement_currency IS NOT NULL AND BTRIM(NEW.settlement_currency) <> '' AND UPPER(BTRIM(NEW.settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        NEW.settlement_currency := 'VND';
    ELSE
        -- EXTERNAL_SETTLEMENT: preserve explicit currency if provided, otherwise NULL. Never infer from price_currency.
        IF NEW.settlement_currency IS NOT NULL AND BTRIM(NEW.settlement_currency) <> '' THEN
            NEW.settlement_currency := UPPER(BTRIM(NEW.settlement_currency));
        ELSE
            NEW.settlement_currency := NULL;
        END IF;
    END IF;

    IF NEW.price_currency = 'VND' THEN
        NEW.execution_unit_price := COALESCE(NEW.execution_unit_price, NEW.price);
        IF NEW.execution_unit_price IS DISTINCT FROM NEW.price THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND transaction execution_unit_price must equal effective price';
        END IF;
    ELSE
        -- Non-VND Price Currency
        IF NEW.execution_unit_price IS NULL OR NEW.execution_unit_price <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'non-VND transaction requires execution_unit_price greater than 0';
        END IF;

        IF NEW.price_currency = 'USDT' THEN
            -- USDT cannot assume 1:1 USD parity without explicit USDT provenance or user-supplied VND basis
            IF NEW.fx_provenance IS NULL OR BTRIM(NEW.fx_provenance) = '' OR NEW.fx_provenance IN ('TWELVE_DATA_USD_VND', 'USD_VND_DIRECT') THEN
                RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'USDT transactions require explicit USDT provenance or user-supplied VND basis';
            END IF;
        END IF;

        IF NEW.fx_provenance = 'USER_SUPPLIED_VND_BASIS' THEN
            IF NEW.price IS NULL OR NEW.price <= 0 THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'USER_SUPPLIED_VND_BASIS requires explicit effective VND price';
            END IF;
        ELSIF NEW.fx_rate_to_vnd IS NOT NULL AND NEW.fx_rate_to_vnd > 0 THEN
            IF NEW.fx_provenance IS NULL OR BTRIM(NEW.fx_provenance) = '' THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'verified FX conversion requires fx_provenance';
            END IF;
            v_expected_vnd_price := NEW.execution_unit_price * NEW.fx_rate_to_vnd;
            -- Decimal-safe tolerance (within 0.05 VND or 0.01%)
            IF ABS(NEW.price - v_expected_vnd_price) > 0.05 AND (ABS(NEW.price - v_expected_vnd_price) / v_expected_vnd_price) > 0.0001 THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND price does not match execution_unit_price * fx_rate_to_vnd';
            END IF;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'non-VND transaction requires verified fx_rate_to_vnd or USER_SUPPLIED_VND_BASIS';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- 4. Update create_portfolio_transaction RPC to support cross-currency and dual settlement
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_settlement_mode TEXT DEFAULT 'INTERNAL_VND_CASH',
    p_settlement_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_unit_price NUMERIC;
BEGIN
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        v_settlement_currency := 'VND';
    ELSE
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' THEN
            v_settlement_currency := UPPER(BTRIM(p_settlement_currency));
        ELSE
            v_settlement_currency := NULL;
        END IF;
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_unit_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price ELSE NULL END);

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND locked_at IS NULL
      AND cancelled_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;
    v_has_holding := FOUND;
    v_cash_amount := p_quantity * p_price;

    IF p_transaction_type = 'BUY' THEN
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            IF v_cash_amount > v_ledger_cash THEN
                RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'insufficient current cash for BUY transaction';
            END IF;
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;

        v_realized_pnl := NULL;
        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost)
                + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;
    ELSE
        IF NOT v_has_holding THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot SELL an asset without an existing holding';
        END IF;
        IF p_quantity > v_existing_holding.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT003', MESSAGE = 'sell quantity exceeds current holding quantity';
        END IF;

        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        v_holding_removed := v_new_quantity = 0;

        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at, executed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price,
        v_realized_pnl, v_execution_unit_price, v_price_currency, v_settlement_mode, v_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at, COALESCE(p_executed_at, v_accounted_at)
    )
    RETURNING * INTO v_transaction;

    IF p_transaction_type = 'BUY' AND v_has_holding THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (
            profile_id,
            asset_id,
            quantity,
            average_cost,
            created_at,
            updated_at
        )
        VALUES (
            v_profile.id,
            v_asset.id,
            v_new_quantity,
            v_new_average_cost,
            v_accounted_at,
            v_accounted_at
        )
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    ELSE
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_transaction_type = 'BUY' THEN
            INSERT INTO public.cash_ledger_entries (
                profile_id, entry_type, amount, balance_after,
                description, transaction_id, created_at
            )
            VALUES (
                v_profile.id, 'BUY', -v_cash_amount, v_new_cash,
                format('BUY %s %s', p_quantity, v_asset.symbol),
                v_transaction.id, v_accounted_at
            )
            RETURNING * INTO v_cash_entry;
        ELSE
            INSERT INTO public.cash_ledger_entries (
                profile_id, entry_type, amount, balance_after,
                description, transaction_id, created_at
            )
            VALUES (
                v_profile.id, 'SELL', v_cash_amount, v_new_cash,
                format('SELL %s %s', p_quantity, v_asset.symbol),
                v_transaction.id, v_accounted_at
            )
            RETURNING * INTO v_cash_entry;
        END IF;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'execution_unit_price', v_transaction.execution_unit_price,
            'price_currency', v_transaction.price_currency,
            'settlement_mode', v_transaction.settlement_mode,
            'settlement_currency', v_transaction.settlement_currency,
            'fx_rate_to_vnd', v_transaction.fx_rate_to_vnd,
            'fx_provenance', v_transaction.fx_provenance,
            'fx_observed_at', v_transaction.fx_observed_at,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_cash_entry.id IS NULL THEN NULL
            ELSE jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'balance_after', v_cash_entry.balance_after,
                'description', v_cash_entry.description,
                'transaction_id', v_cash_entry.transaction_id,
                'created_at', v_cash_entry.created_at
            )
        END,
        'currentCash', v_new_cash
    );
END;
$$;


-- 5. Update list_portfolio_transactions RPC with execution metadata
DROP FUNCTION IF EXISTS public.list_portfolio_transactions(TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(
    p_symbol TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    execution_unit_price NUMERIC,
    price_currency TEXT,
    settlement_mode TEXT,
    settlement_currency TEXT,
    fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT,
    fx_observed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.execution_unit_price,
        t.price_currency::TEXT,
        t.settlement_mode::TEXT,
        t.settlement_currency::TEXT,
        t.fx_rate_to_vnd,
        t.fx_provenance::TEXT,
        t.fx_observed_at,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    INNER JOIN public.investor_profile AS ip ON ip.id = t.profile_id
    WHERE ip.singleton_key = 1
      AND (p_symbol IS NULL OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
$$;


-- 6. Update create_opening_position RPC for cross-currency support
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_effective_avg_cost NUMERIC := p_average_cost;
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_execution_unit_price NUMERIC := p_execution_unit_price;
BEGIN
    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;

    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    SELECT assets.*
    INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    IF v_asset.quote_currency IS DISTINCT FROM 'VND' THEN
        -- Non-VND asset opening position validation
        IF v_effective_avg_cost IS NULL OR v_effective_avg_cost < 0 THEN
            IF v_execution_unit_price IS NOT NULL AND v_execution_unit_price >= 0 AND p_fx_rate_to_vnd IS NOT NULL AND p_fx_rate_to_vnd > 0 THEN
                v_effective_avg_cost := v_execution_unit_price * p_fx_rate_to_vnd;
            ELSE
                RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'non-VND opening positions require valid VND average cost or verified execution price and FX rate';
            END IF;
        END IF;

        IF v_price_currency = 'USDT' THEN
            IF p_fx_provenance IS NULL OR BTRIM(p_fx_provenance) = '' OR p_fx_provenance IN ('TWELVE_DATA_USD_VND', 'USD_VND_DIRECT') THEN
                RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'USDT opening positions require explicit USDT provenance or user-supplied VND basis';
            END IF;
        END IF;
    ELSE
        IF v_effective_avg_cost IS NULL
            OR v_effective_avg_cost < 0
            OR v_effective_avg_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
        END IF;
        v_execution_unit_price := COALESCE(v_execution_unit_price, v_effective_avg_cost);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
    ) OR EXISTS (
        SELECT 1
        FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'asset already has a holding or opening baseline';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id,
        asset_id,
        opening_quantity,
        opening_average_cost,
        execution_unit_price,
        price_currency,
        fx_rate_to_vnd,
        fx_provenance,
        fx_observed_at,
        accounting_cutoff_at,
        provenance_type,
        created_at,
        updated_at
    )
    VALUES (
        v_profile_id,
        v_asset.id,
        p_quantity,
        v_effective_avg_cost,
        v_execution_unit_price,
        v_price_currency,
        p_fx_rate_to_vnd,
        p_fx_provenance,
        p_fx_observed_at,
        v_accounted_at,
        'USER_RECORDED',
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id,
        asset_id,
        opening_position_id,
        quantity,
        average_cost,
        created_at,
        updated_at
    )
    VALUES (
        v_profile_id,
        v_asset.id,
        v_baseline.id,
        p_quantity,
        v_effective_avg_cost,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'execution_unit_price', v_baseline.execution_unit_price,
            'price_currency', v_baseline.price_currency,
            'fx_rate_to_vnd', v_baseline.fx_rate_to_vnd,
            'fx_provenance', v_baseline.fx_provenance,
            'fx_observed_at', v_baseline.fx_observed_at,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;


-- 7. Security: Grant and revoke permissions according to Feature 30 single-owner model
REVOKE ALL ON FUNCTION public.enforce_vnd_portfolio_transaction_asset() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;

-- ==========================================================
-- Schema Migration: 20260903000000_feature_12b_alert_notification_deliveries.sql
-- Purpose: Price Alert Outbox & Delivery Foundation (Feature 12B)
-- ==========================================================

-- ==============================================================================
-- Feature 12: Web Push Alert Notification Outbox Foundation (Feature 12B)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
    ON public.push_subscriptions (profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

CREATE TABLE IF NOT EXISTS public.alert_notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES public.price_alerts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    trigger_event_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,

    -- Immutable trigger event snapshot
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('above', 'below')),
    target_price NUMERIC(15, 2) NOT NULL CHECK (target_price > 0),
    observed_price NUMERIC NOT NULL CHECK (
        observed_price > 0
        AND observed_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    trigger_event_at TIMESTAMPTZ NOT NULL,

    -- Delivery lifecycle state machine
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'sending',
            'sent',
            'failed_retryable',
            'failed_permanent'
        )
    ),
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_alert_delivery_event_sub UNIQUE (trigger_event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_claim
    ON public.alert_notification_deliveries (status, next_attempt_at, lease_expires_at)
    WHERE status IN ('pending', 'sending', 'failed_retryable');

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_alert
    ON public.alert_notification_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_subscription
    ON public.alert_notification_deliveries (subscription_id);

ALTER TABLE public.alert_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.alert_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.alert_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_price_alert_atomic(
    p_alert_id UUID,
    p_profile_id UUID,
    p_observed_price NUMERIC,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alert RECORD;
    v_trigger_event_id UUID;
    v_delivery_count INT := 0;
BEGIN
    -- 1. Conditionally lock and transition alert from active -> triggered
    UPDATE public.price_alerts
    SET
        status = 'triggered',
        triggered_at = p_now,
        last_evaluated_price = p_observed_price,
        last_evaluated_at = p_now,
        updated_at = p_now
    WHERE id = p_alert_id
      AND profile_id = p_profile_id
      AND status = 'active'
    RETURNING * INTO v_alert;

    -- If alert was already triggered or does not exist, return idempotent non-triggered response
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'triggered', false,
            'trigger_event_id', null,
            'delivery_count', 0
        );
    END IF;

    -- 2. Generate unique trigger event ID
    v_trigger_event_id := gen_random_uuid();

    -- 3. Fan out pending delivery rows for all current push subscriptions of this profile
    INSERT INTO public.alert_notification_deliveries (
        alert_id,
        profile_id,
        subscription_id,
        trigger_event_id,
        asset_id,
        direction,
        target_price,
        observed_price,
        trigger_event_at,
        status,
        attempt_count,
        created_at,
        updated_at
    )
    SELECT
        v_alert.id,
        v_alert.profile_id,
        s.id,
        v_trigger_event_id,
        v_alert.asset_id,
        v_alert.direction,
        v_alert.target_price,
        p_observed_price,
        p_now,
        'pending',
        0,
        p_now,
        p_now
    FROM public.push_subscriptions s
    WHERE s.profile_id = p_profile_id;

    GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'triggered', true,
        'trigger_event_id', v_trigger_event_id,
        'delivery_count', v_delivery_count,
        'alert', to_jsonb(v_alert)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_price_alert_atomic(UUID, UUID, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_price_alert_atomic(UUID, UUID, NUMERIC, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pending_alert_deliveries(
    p_batch_size INT DEFAULT 5,
    p_lease_seconds INT DEFAULT 120,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    id UUID,
    alert_id UUID,
    profile_id UUID,
    subscription_id UUID,
    trigger_event_id UUID,
    asset_id UUID,
    direction VARCHAR(10),
    target_price NUMERIC(15, 2),
    observed_price NUMERIC,
    trigger_event_at TIMESTAMPTZ,
    status VARCHAR(30),
    attempt_count INT,
    last_attempt_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch_size INT;
    v_lease_seconds INT;
BEGIN
    -- Strict sanity bounds: batch size [1, 25], lease seconds [30, 600]
    v_batch_size := LEAST(GREATEST(COALESCE(p_batch_size, 5), 1), 25);
    v_lease_seconds := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 600);

    -- 1. Terminalize expired sending jobs with attempt_count >= 3 (Third-attempt crash & zombie elimination)
    UPDATE public.alert_notification_deliveries
    SET
        status = 'failed_permanent',
        last_error = 'MAX_ATTEMPTS_EXHAUSTED',
        lease_expires_at = NULL,
        updated_at = p_now
    WHERE alert_notification_deliveries.status = 'sending'
      AND alert_notification_deliveries.lease_expires_at <= p_now
      AND alert_notification_deliveries.attempt_count >= 3;

    -- 2. Claim eligible rows with row-level locking (SKIP LOCKED)
    RETURN QUERY
    WITH eligible AS (
        SELECT d.id
        FROM public.alert_notification_deliveries d
        WHERE (
            -- Brand new pending deliveries
            d.status = 'pending'
            OR
            -- Expired leases for crashed attempts (< 3 attempts)
            (d.status = 'sending' AND d.lease_expires_at <= p_now AND d.attempt_count < 3)
            OR
            -- Retryable failures whose backoff timer has elapsed
            (d.status = 'failed_retryable' AND d.next_attempt_at <= p_now AND d.attempt_count < 3)
        )
        ORDER BY d.created_at ASC
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.alert_notification_deliveries d
    SET
        status = 'sending',
        attempt_count = d.attempt_count + 1,
        last_attempt_at = p_now,
        lease_expires_at = p_now + (v_lease_seconds || ' seconds')::INTERVAL,
        updated_at = p_now
    FROM eligible
    WHERE d.id = eligible.id
    RETURNING
        d.id,
        d.alert_id,
        d.profile_id,
        d.subscription_id,
        d.trigger_event_id,
        d.asset_id,
        d.direction,
        d.target_price,
        d.observed_price,
        d.trigger_event_at,
        d.status,
        d.attempt_count,
        d.last_attempt_at,
        d.lease_expires_at,
        d.next_attempt_at,
        d.delivered_at,
        d.last_error,
        d.created_at,
        d.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_alert_deliveries(INT, INT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_alert_deliveries(INT, INT, TIMESTAMPTZ) TO service_role;

-- Migration: 20260904000000_feature_13b_multi_user_ownership_foundation.sql
-- Feature 13B: Rebaseline investor_profile and financial RPCs for multi-user ownership.
-- Retires singleton_key constraints and establishes 1:1 auth.users -> investor_profile linkage.
-- Existing production profile is preserved in place with user_id = NULL.

BEGIN;

-- ============================================================================
-- 1. ALTER public.investor_profile FOR MULTI-USER IDENTITY
-- ============================================================================

-- Add nullable user_id referencing auth.users(id).
-- Existing production profile remains in place with user_id = NULL until claimed.
ALTER TABLE public.investor_profile
    ADD COLUMN IF NOT EXISTS user_id UUID NULL UNIQUE
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop legacy singleton constraints
ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_check;

ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_unique;

-- Drop legacy singleton column
ALTER TABLE public.investor_profile
    DROP COLUMN IF EXISTS singleton_key;

-- Invariant: At most ONE unowned legacy profile may exist across the entire database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_profile_legacy_unowned
    ON public.investor_profile ((user_id IS NULL))
    WHERE user_id IS NULL;

COMMENT ON COLUMN public.investor_profile.user_id IS
    'Links this investor profile to Supabase auth.users. Nullable only for the legacy unowned production profile awaiting claim.';


-- ============================================================================
-- 2. CASH LEDGER RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_cash_overview();
DROP FUNCTION IF EXISTS public.get_cash_overview(UUID);

CREATE OR REPLACE FUNCTION public.get_cash_overview(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_activation public.cash_ledger_activation%ROWTYPE;
    v_current_cash NUMERIC;
    v_total_deposits NUMERIC;
    v_total_withdrawals NUMERIC;
    v_buy_outflows NUMERIC;
    v_sell_inflows NUMERIC;
    v_entry_count BIGINT;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT activation.*
    INTO v_activation
    FROM public.cash_ledger_activation AS activation
    WHERE activation.profile_id = v_profile.id;

    IF v_activation.profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;

    SELECT
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'DEPOSIT'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'WITHDRAWAL'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'BUY'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'SELL'), 0),
        COUNT(*)
    INTO
        v_total_deposits,
        v_total_withdrawals,
        v_buy_outflows,
        v_sell_inflows,
        v_entry_count
    FROM public.cash_ledger_entries AS entries
    WHERE entries.profile_id = v_profile.id;

    v_current_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_current_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    RETURN jsonb_build_object(
        'current_cash', v_current_cash,
        'opening_balance', v_activation.opening_balance_amount,
        'total_deposits', v_total_deposits,
        'total_withdrawals', v_total_withdrawals,
        'buy_outflows', v_buy_outflows,
        'sell_inflows', v_sell_inflows,
        'entry_count', v_entry_count,
        'ledger_start_at', v_activation.activated_at
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_cash_ledger_entries();
DROP FUNCTION IF EXISTS public.list_cash_ledger_entries(UUID);

CREATE OR REPLACE FUNCTION public.list_cash_ledger_entries(p_profile_id UUID)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    entry_type TEXT,
    amount NUMERIC,
    portfolio_transaction_id UUID,
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    metadata JSONB,
    symbol TEXT,
    transaction_executed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        entries.id,
        entries.profile_id,
        entries.entry_type::TEXT,
        entries.amount,
        entries.portfolio_transaction_id,
        entries.effective_at,
        entries.created_at,
        entries.metadata,
        assets.symbol::TEXT,
        transactions.executed_at AS transaction_executed_at
    FROM public.cash_ledger_entries AS entries
    LEFT JOIN public.portfolio_transactions AS transactions
      ON transactions.id = entries.portfolio_transaction_id
    LEFT JOIN public.assets AS assets
      ON assets.id = transactions.asset_id
    WHERE entries.profile_id = p_profile_id
    ORDER BY entries.effective_at DESC, entries.created_at DESC, entries.id DESC;
$$;

DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.create_cash_movement(
    p_profile_id UUID,
    p_entry_type TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_entry public.cash_ledger_entries%ROWTYPE;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_entry_type IS NULL OR p_entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'entryType must be DEPOSIT or WITHDRAWAL';
    END IF;
    IF p_amount IS NULL
        OR p_amount <= 0
        OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'amount must be a finite number greater than 0';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_entry_type = 'WITHDRAWAL' AND p_amount > v_ledger_cash THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
    END IF;

    v_new_cash := CASE
        WHEN p_entry_type = 'DEPOSIT' THEN v_ledger_cash + p_amount
        ELSE v_ledger_cash - p_amount
    END;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        effective_at,
        created_at
    )
    VALUES (
        v_profile.id,
        p_entry_type,
        p_amount,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'entry', jsonb_build_object(
            'id', v_entry.id,
            'profile_id', v_entry.profile_id,
            'entry_type', v_entry.entry_type,
            'amount', v_entry.amount,
            'portfolio_transaction_id', v_entry.portfolio_transaction_id,
            'effective_at', v_entry.effective_at,
            'created_at', v_entry.created_at,
            'metadata', v_entry.metadata,
            'symbol', NULL
        ),
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_investor_profile_preferences(
    p_profile_id UUID,
    p_risk_tolerance TEXT,
    p_investment_horizon TEXT
)
RETURNS public.investor_profile
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_risk_tolerance IS NULL OR p_risk_tolerance NOT IN ('low', 'moderate', 'high') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP001', MESSAGE = 'invalid risk_tolerance';
    END IF;
    IF p_investment_horizon IS NULL OR p_investment_horizon NOT IN ('short', 'medium', 'long') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP002', MESSAGE = 'invalid investment_horizon';
    END IF;

    UPDATE public.investor_profile
    SET risk_tolerance = p_risk_tolerance,
        investment_horizon = p_investment_horizon,
        updated_at = NOW()
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    RETURN v_profile;
END;
$$;


-- ============================================================================
-- 3. PORTFOLIO TRANSACTION RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_profile_id UUID,
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_settlement_mode TEXT DEFAULT 'INTERNAL_VND_CASH',
    p_settlement_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_unit_price NUMERIC;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        v_settlement_currency := 'VND';
    ELSE
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' THEN
            v_settlement_currency := UPPER(BTRIM(p_settlement_currency));
        ELSE
            v_settlement_currency := NULL;
        END IF;
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_unit_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price ELSE NULL END);

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = COALESCE(locked_at, v_accounted_at),
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND cancelled_at IS NULL
      AND locked_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;

    IF v_existing_holding.id IS NOT NULL THEN
        v_has_holding := TRUE;
    END IF;

    IF p_transaction_type = 'BUY' THEN
        v_cash_amount := p_quantity * p_price;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'buy amount exceeds current cash';
        END IF;

        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost) + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;

        v_realized_pnl := NULL;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
    ELSE
        IF NOT v_has_holding OR v_existing_holding.quantity < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot sell more than held quantity';
        END IF;

        v_cash_amount := p_quantity * p_price;
        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
        IF v_new_quantity = 0 THEN
            v_holding_removed := TRUE;
        END IF;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized_pnl,
        COALESCE(p_executed_at, v_accounted_at),
        v_execution_unit_price, v_price_currency, v_settlement_mode, v_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_transaction;

    IF v_has_holding AND NOT v_holding_removed THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            effective_at, created_at, metadata
        )
        VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
            v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'accountingSemantics', 'recorded_now_affects_current_cash',
                'historicalCashReconstruction', FALSE
            )
        )
        RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'execution_unit_price', v_transaction.execution_unit_price,
            'price_currency', v_transaction.price_currency,
            'settlement_mode', v_transaction.settlement_mode,
            'settlement_currency', v_transaction.settlement_currency,
            'fx_rate_to_vnd', v_transaction.fx_rate_to_vnd,
            'fx_provenance', v_transaction.fx_provenance,
            'fx_observed_at', v_transaction.fx_observed_at,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
                'effective_at', v_cash_entry.effective_at,
                'created_at', v_cash_entry.created_at,
                'metadata', v_cash_entry.metadata,
                'symbol', v_asset.symbol
            )
            ELSE NULL
        END,
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_portfolio_transactions(TEXT);
DROP FUNCTION IF EXISTS public.list_portfolio_transactions(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(
    p_profile_id UUID,
    p_symbol TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    execution_unit_price NUMERIC,
    price_currency TEXT,
    settlement_mode TEXT,
    settlement_currency TEXT,
    fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT,
    fx_observed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.execution_unit_price,
        t.price_currency::TEXT,
        t.settlement_mode::TEXT,
        t.settlement_currency::TEXT,
        t.fx_rate_to_vnd,
        t.fx_provenance::TEXT,
        t.fx_observed_at,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    WHERE t.profile_id = p_profile_id
      AND (p_symbol IS NULL OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
$$;


-- ============================================================================
-- 4. OPENING POSITION BASELINE RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_effective_avg_cost NUMERIC := p_average_cost;
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_execution_unit_price NUMERIC := p_execution_unit_price;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;

    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT assets.*
    INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    IF v_price_currency = 'VND' THEN
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
    ELSE
        IF p_fx_rate_to_vnd IS NULL OR p_fx_rate_to_vnd <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires valid fx_rate_to_vnd';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires non-negative execution_unit_price';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
        v_effective_avg_cost := p_execution_unit_price * p_fx_rate_to_vnd;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile_id, v_asset.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, 'USER_DECLARED_INITIAL', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost,
        created_at, updated_at
    )
    VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'execution_unit_price', v_baseline.execution_unit_price,
            'price_currency', v_baseline.price_currency,
            'fx_rate_to_vnd', v_baseline.fx_rate_to_vnd,
            'fx_provenance', v_baseline.fx_provenance,
            'fx_observed_at', v_baseline.fx_observed_at,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.correct_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'cannot correct cancelled opening position';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_opening_position(TEXT);
DROP FUNCTION IF EXISTS public.cancel_opening_position(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.cancel_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position already cancelled';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET cancelled_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    DELETE FROM public.holdings
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', NULL,
        'holdingRemoved', TRUE
    );
END;
$$;


-- ============================================================================
-- 5. PERMISSIONS & SECURITY BOUNDARY
-- ============================================================================

-- Revoke all permissions on new RPCs from public and client roles
REVOKE ALL ON FUNCTION public.get_cash_overview(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Grant execution exclusively to backend service_role
GRANT EXECUTE ON FUNCTION public.get_cash_overview(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(UUID, TEXT) TO service_role;

COMMIT;

-- Migration: 20260904000000_feature_13b_multi_user_ownership_foundation.sql
-- Feature 13B: Rebaseline investor_profile and financial RPCs for multi-user ownership.
-- Retires singleton_key constraints and establishes 1:1 auth.users -> investor_profile linkage.
-- Existing production profile is preserved in place with user_id = NULL.

BEGIN;

-- ============================================================================
-- 1. ALTER public.investor_profile FOR MULTI-USER IDENTITY
-- ============================================================================

-- Add nullable user_id referencing auth.users(id).
-- Existing production profile remains in place with user_id = NULL until claimed.
ALTER TABLE public.investor_profile
    ADD COLUMN IF NOT EXISTS user_id UUID NULL UNIQUE
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop legacy singleton constraints
ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_check;

ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_unique;

-- Drop legacy singleton column
ALTER TABLE public.investor_profile
    DROP COLUMN IF EXISTS singleton_key;

-- Invariant: At most ONE unowned legacy profile may exist across the entire database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_profile_legacy_unowned
    ON public.investor_profile ((user_id IS NULL))
    WHERE user_id IS NULL;

COMMENT ON COLUMN public.investor_profile.user_id IS
    'Links this investor profile to Supabase auth.users. Nullable only for the legacy unowned production profile awaiting claim.';


-- ============================================================================
-- 2. CASH LEDGER RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_cash_overview();
DROP FUNCTION IF EXISTS public.get_cash_overview(UUID);

CREATE OR REPLACE FUNCTION public.get_cash_overview(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_activation public.cash_ledger_activation%ROWTYPE;
    v_current_cash NUMERIC;
    v_total_deposits NUMERIC;
    v_total_withdrawals NUMERIC;
    v_buy_outflows NUMERIC;
    v_sell_inflows NUMERIC;
    v_entry_count BIGINT;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT activation.*
    INTO v_activation
    FROM public.cash_ledger_activation AS activation
    WHERE activation.profile_id = v_profile.id;

    IF v_activation.profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;

    SELECT
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'DEPOSIT'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'WITHDRAWAL'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'BUY'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'SELL'), 0),
        COUNT(*)
    INTO
        v_total_deposits,
        v_total_withdrawals,
        v_buy_outflows,
        v_sell_inflows,
        v_entry_count
    FROM public.cash_ledger_entries AS entries
    WHERE entries.profile_id = v_profile.id;

    v_current_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_current_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    RETURN jsonb_build_object(
        'current_cash', v_current_cash,
        'opening_balance', v_activation.opening_balance_amount,
        'total_deposits', v_total_deposits,
        'total_withdrawals', v_total_withdrawals,
        'buy_outflows', v_buy_outflows,
        'sell_inflows', v_sell_inflows,
        'entry_count', v_entry_count,
        'ledger_start_at', v_activation.activated_at
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_cash_ledger_entries();
DROP FUNCTION IF EXISTS public.list_cash_ledger_entries(UUID);

CREATE OR REPLACE FUNCTION public.list_cash_ledger_entries(p_profile_id UUID)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    entry_type TEXT,
    amount NUMERIC,
    portfolio_transaction_id UUID,
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    metadata JSONB,
    symbol TEXT,
    transaction_executed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        entries.id,
        entries.profile_id,
        entries.entry_type::TEXT,
        entries.amount,
        entries.portfolio_transaction_id,
        entries.effective_at,
        entries.created_at,
        entries.metadata,
        assets.symbol::TEXT,
        transactions.executed_at AS transaction_executed_at
    FROM public.cash_ledger_entries AS entries
    LEFT JOIN public.portfolio_transactions AS transactions
      ON transactions.id = entries.portfolio_transaction_id
    LEFT JOIN public.assets AS assets
      ON assets.id = transactions.asset_id
    WHERE entries.profile_id = p_profile_id
    ORDER BY entries.effective_at DESC, entries.created_at DESC, entries.id DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.create_cash_movement(
    p_profile_id UUID,
    p_entry_type TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_entry public.cash_ledger_entries%ROWTYPE;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_entry_type IS NULL OR p_entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'entryType must be DEPOSIT or WITHDRAWAL';
    END IF;
    IF p_amount IS NULL
        OR p_amount <= 0
        OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'amount must be a finite number greater than 0';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_entry_type = 'WITHDRAWAL' AND p_amount > v_ledger_cash THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
    END IF;

    v_new_cash := CASE
        WHEN p_entry_type = 'DEPOSIT' THEN v_ledger_cash + p_amount
        ELSE v_ledger_cash - p_amount
    END;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        effective_at,
        created_at
    )
    VALUES (
        v_profile.id,
        p_entry_type,
        p_amount,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'entry', jsonb_build_object(
            'id', v_entry.id,
            'profile_id', v_entry.profile_id,
            'entry_type', v_entry.entry_type,
            'amount', v_entry.amount,
            'portfolio_transaction_id', v_entry.portfolio_transaction_id,
            'effective_at', v_entry.effective_at,
            'created_at', v_entry.created_at,
            'metadata', v_entry.metadata,
            'symbol', NULL
        ),
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_investor_profile_preferences(
    p_profile_id UUID,
    p_risk_tolerance TEXT,
    p_investment_horizon TEXT
)
RETURNS public.investor_profile
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_risk_tolerance IS NULL OR p_risk_tolerance NOT IN ('low', 'moderate', 'high') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP001', MESSAGE = 'invalid risk_tolerance';
    END IF;
    IF p_investment_horizon IS NULL OR p_investment_horizon NOT IN ('short', 'medium', 'long') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP002', MESSAGE = 'invalid investment_horizon';
    END IF;

    UPDATE public.investor_profile
    SET risk_tolerance = p_risk_tolerance,
        investment_horizon = p_investment_horizon,
        updated_at = NOW()
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    RETURN v_profile;
END;
$$;


-- ============================================================================
-- 3. PORTFOLIO TRANSACTION RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_profile_id UUID,
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_settlement_mode TEXT DEFAULT 'INTERNAL_VND_CASH',
    p_settlement_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_unit_price NUMERIC;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        v_settlement_currency := 'VND';
    ELSE
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' THEN
            v_settlement_currency := UPPER(BTRIM(p_settlement_currency));
        ELSE
            v_settlement_currency := NULL;
        END IF;
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_unit_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price ELSE NULL END);

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = COALESCE(locked_at, v_accounted_at),
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND cancelled_at IS NULL
      AND locked_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;

    IF v_existing_holding.id IS NOT NULL THEN
        v_has_holding := TRUE;
    END IF;

    IF p_transaction_type = 'BUY' THEN
        v_cash_amount := p_quantity * p_price;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'buy amount exceeds current cash';
        END IF;

        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost) + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;

        v_realized_pnl := NULL;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
    ELSE
        IF NOT v_has_holding OR v_existing_holding.quantity < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot sell more than held quantity';
        END IF;

        v_cash_amount := p_quantity * p_price;
        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
        IF v_new_quantity = 0 THEN
            v_holding_removed := TRUE;
        END IF;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized_pnl,
        COALESCE(p_executed_at, v_accounted_at),
        v_execution_unit_price, v_price_currency, v_settlement_mode, v_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_transaction;

    IF v_has_holding AND NOT v_holding_removed THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            effective_at, created_at, metadata
        )
        VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
            v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'accountingSemantics', 'recorded_now_affects_current_cash',
                'historicalCashReconstruction', FALSE
            )
        )
        RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'execution_unit_price', v_transaction.execution_unit_price,
            'price_currency', v_transaction.price_currency,
            'settlement_mode', v_transaction.settlement_mode,
            'settlement_currency', v_transaction.settlement_currency,
            'fx_rate_to_vnd', v_transaction.fx_rate_to_vnd,
            'fx_provenance', v_transaction.fx_provenance,
            'fx_observed_at', v_transaction.fx_observed_at,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
                'effective_at', v_cash_entry.effective_at,
                'created_at', v_cash_entry.created_at,
                'metadata', v_cash_entry.metadata,
                'symbol', v_asset.symbol
            )
            ELSE NULL
        END,
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_portfolio_transactions(TEXT);
DROP FUNCTION IF EXISTS public.list_portfolio_transactions(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(
    p_profile_id UUID,
    p_symbol TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    execution_unit_price NUMERIC,
    price_currency TEXT,
    settlement_mode TEXT,
    settlement_currency TEXT,
    fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT,
    fx_observed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.execution_unit_price,
        t.price_currency::TEXT,
        t.settlement_mode::TEXT,
        t.settlement_currency::TEXT,
        t.fx_rate_to_vnd,
        t.fx_provenance::TEXT,
        t.fx_observed_at,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    WHERE t.profile_id = p_profile_id
      AND (p_symbol IS NULL OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
END;
$$;


-- ============================================================================
-- 4. OPENING POSITION BASELINE RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_effective_avg_cost NUMERIC := p_average_cost;
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_execution_unit_price NUMERIC := p_execution_unit_price;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;

    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT assets.*
    INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    IF v_price_currency = 'VND' THEN
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
    ELSE
        IF p_fx_rate_to_vnd IS NULL OR p_fx_rate_to_vnd <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires valid fx_rate_to_vnd';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires non-negative execution_unit_price';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
        v_effective_avg_cost := p_execution_unit_price * p_fx_rate_to_vnd;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile_id, v_asset.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, 'USER_DECLARED_INITIAL', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost,
        created_at, updated_at
    )
    VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'execution_unit_price', v_baseline.execution_unit_price,
            'price_currency', v_baseline.price_currency,
            'fx_rate_to_vnd', v_baseline.fx_rate_to_vnd,
            'fx_provenance', v_baseline.fx_provenance,
            'fx_observed_at', v_baseline.fx_observed_at,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.correct_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'cannot correct cancelled opening position';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_opening_position(TEXT);
DROP FUNCTION IF EXISTS public.cancel_opening_position(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.cancel_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position already cancelled';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET cancelled_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    DELETE FROM public.holdings
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', NULL,
        'holdingRemoved', TRUE
    );
END;
$$;


-- ============================================================================
-- 5. PERMISSIONS & SECURITY BOUNDARY
-- ============================================================================

-- Revoke all permissions on new RPCs from public and client roles
REVOKE ALL ON FUNCTION public.get_cash_overview(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Grant execution exclusively to backend service_role
GRANT EXECUTE ON FUNCTION public.get_cash_overview(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(UUID, TEXT) TO service_role;

COMMIT;

-- Migration: 20260904000000_feature_13b_multi_user_ownership_foundation.sql
-- Feature 13B: Rebaseline investor_profile and financial RPCs for multi-user ownership.
-- Retires singleton_key constraints and establishes 1:1 auth.users -> investor_profile linkage.
-- Existing production profile is preserved in place with user_id = NULL.

BEGIN;

-- ============================================================================
-- 1. ALTER public.investor_profile FOR MULTI-USER IDENTITY
-- ============================================================================

-- Add nullable user_id referencing auth.users(id).
-- Existing production profile remains in place with user_id = NULL until claimed.
ALTER TABLE public.investor_profile
    ADD COLUMN IF NOT EXISTS user_id UUID NULL UNIQUE
    REFERENCES auth.users(id) ON DELETE RESTRICT;

-- Drop legacy singleton constraints
ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_check;

ALTER TABLE public.investor_profile
    DROP CONSTRAINT IF EXISTS investor_profile_singleton_unique;

-- Drop legacy singleton column
ALTER TABLE public.investor_profile
    DROP COLUMN IF EXISTS singleton_key;

-- Invariant: At most ONE unowned legacy profile may exist across the entire database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_profile_legacy_unowned
    ON public.investor_profile ((user_id IS NULL))
    WHERE user_id IS NULL;

COMMENT ON COLUMN public.investor_profile.user_id IS
    'Links this investor profile to Supabase auth.users. Nullable only for the legacy unowned production profile awaiting claim.';


-- ============================================================================
-- 2. CASH LEDGER RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_cash_overview();
DROP FUNCTION IF EXISTS public.get_cash_overview(UUID);

CREATE OR REPLACE FUNCTION public.get_cash_overview(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_activation public.cash_ledger_activation%ROWTYPE;
    v_current_cash NUMERIC;
    v_total_deposits NUMERIC;
    v_total_withdrawals NUMERIC;
    v_buy_outflows NUMERIC;
    v_sell_inflows NUMERIC;
    v_entry_count BIGINT;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT activation.*
    INTO v_activation
    FROM public.cash_ledger_activation AS activation
    WHERE activation.profile_id = v_profile.id;

    IF v_activation.profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;

    SELECT
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'DEPOSIT'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'WITHDRAWAL'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'BUY'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'SELL'), 0),
        COUNT(*)
    INTO
        v_total_deposits,
        v_total_withdrawals,
        v_buy_outflows,
        v_sell_inflows,
        v_entry_count
    FROM public.cash_ledger_entries AS entries
    WHERE entries.profile_id = v_profile.id;

    v_current_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_current_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    RETURN jsonb_build_object(
        'current_cash', v_current_cash,
        'opening_balance', v_activation.opening_balance_amount,
        'total_deposits', v_total_deposits,
        'total_withdrawals', v_total_withdrawals,
        'buy_outflows', v_buy_outflows,
        'sell_inflows', v_sell_inflows,
        'entry_count', v_entry_count,
        'ledger_start_at', v_activation.activated_at
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_cash_ledger_entries();
DROP FUNCTION IF EXISTS public.list_cash_ledger_entries(UUID);

CREATE OR REPLACE FUNCTION public.list_cash_ledger_entries(p_profile_id UUID)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    entry_type TEXT,
    amount NUMERIC,
    portfolio_transaction_id UUID,
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    metadata JSONB,
    symbol TEXT,
    transaction_executed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        entries.id,
        entries.profile_id,
        entries.entry_type::TEXT,
        entries.amount,
        entries.portfolio_transaction_id,
        entries.effective_at,
        entries.created_at,
        entries.metadata,
        assets.symbol::TEXT,
        transactions.executed_at AS transaction_executed_at
    FROM public.cash_ledger_entries AS entries
    LEFT JOIN public.portfolio_transactions AS transactions
      ON transactions.id = entries.portfolio_transaction_id
    LEFT JOIN public.assets AS assets
      ON assets.id = transactions.asset_id
    WHERE entries.profile_id = p_profile_id
    ORDER BY entries.effective_at DESC, entries.created_at DESC, entries.id DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.create_cash_movement(
    p_profile_id UUID,
    p_entry_type TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_entry public.cash_ledger_entries%ROWTYPE;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_entry_type IS NULL OR p_entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'entryType must be DEPOSIT or WITHDRAWAL';
    END IF;
    IF p_amount IS NULL
        OR p_amount <= 0
        OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'amount must be a finite number greater than 0';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_entry_type = 'WITHDRAWAL' AND p_amount > v_ledger_cash THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
    END IF;

    v_new_cash := CASE
        WHEN p_entry_type = 'DEPOSIT' THEN v_ledger_cash + p_amount
        ELSE v_ledger_cash - p_amount
    END;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        effective_at,
        created_at
    )
    VALUES (
        v_profile.id,
        p_entry_type,
        p_amount,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    RETURN jsonb_build_object(
        'entry', jsonb_build_object(
            'id', v_entry.id,
            'profile_id', v_entry.profile_id,
            'entry_type', v_entry.entry_type,
            'amount', v_entry.amount,
            'portfolio_transaction_id', v_entry.portfolio_transaction_id,
            'effective_at', v_entry.effective_at,
            'created_at', v_entry.created_at,
            'metadata', v_entry.metadata,
            'symbol', NULL
        ),
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_investor_profile_preferences(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_investor_profile_preferences(
    p_profile_id UUID,
    p_risk_tolerance TEXT,
    p_investment_horizon TEXT
)
RETURNS public.investor_profile
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_risk_tolerance IS NULL OR p_risk_tolerance NOT IN ('low', 'moderate', 'high') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP001', MESSAGE = 'invalid risk_tolerance';
    END IF;
    IF p_investment_horizon IS NULL OR p_investment_horizon NOT IN ('short', 'medium', 'long') THEN
        RAISE EXCEPTION USING ERRCODE = 'IP002', MESSAGE = 'invalid investment_horizon';
    END IF;

    UPDATE public.investor_profile
    SET risk_tolerance = p_risk_tolerance,
        investment_horizon = p_investment_horizon,
        updated_at = NOW()
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    RETURN v_profile;
END;
$$;


-- ============================================================================
-- 3. PORTFOLIO TRANSACTION RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_profile_id UUID,
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_settlement_mode TEXT DEFAULT 'INTERNAL_VND_CASH',
    p_settlement_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_unit_price NUMERIC;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        v_settlement_currency := 'VND';
    ELSE
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' THEN
            v_settlement_currency := UPPER(BTRIM(p_settlement_currency));
        ELSE
            v_settlement_currency := NULL;
        END IF;
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_unit_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price ELSE NULL END);

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = COALESCE(locked_at, v_accounted_at),
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND cancelled_at IS NULL
      AND locked_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;

    IF v_existing_holding.id IS NOT NULL THEN
        v_has_holding := TRUE;
    END IF;

    IF p_transaction_type = 'BUY' THEN
        v_cash_amount := p_quantity * p_price;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'buy amount exceeds current cash';
        END IF;

        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost) + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;

        v_realized_pnl := NULL;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
    ELSE
        IF NOT v_has_holding OR v_existing_holding.quantity < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot sell more than held quantity';
        END IF;

        v_cash_amount := p_quantity * p_price;
        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
        IF v_new_quantity = 0 THEN
            v_holding_removed := TRUE;
        END IF;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized_pnl,
        COALESCE(p_executed_at, v_accounted_at),
        v_execution_unit_price, v_price_currency, v_settlement_mode, v_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_transaction;

    IF v_has_holding AND NOT v_holding_removed THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            effective_at, created_at, metadata
        )
        VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
            v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'accountingSemantics', 'recorded_now_affects_current_cash',
                'historicalCashReconstruction', FALSE
            )
        )
        RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    RETURN jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'execution_unit_price', v_transaction.execution_unit_price,
            'price_currency', v_transaction.price_currency,
            'settlement_mode', v_transaction.settlement_mode,
            'settlement_currency', v_transaction.settlement_currency,
            'fx_rate_to_vnd', v_transaction.fx_rate_to_vnd,
            'fx_provenance', v_transaction.fx_provenance,
            'fx_observed_at', v_transaction.fx_observed_at,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
                'effective_at', v_cash_entry.effective_at,
                'created_at', v_cash_entry.created_at,
                'metadata', v_cash_entry.metadata,
                'symbol', v_asset.symbol
            )
            ELSE NULL
        END,
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_portfolio_transactions(TEXT);
DROP FUNCTION IF EXISTS public.list_portfolio_transactions(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(
    p_profile_id UUID,
    p_symbol TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    execution_unit_price NUMERIC,
    price_currency TEXT,
    settlement_mode TEXT,
    settlement_currency TEXT,
    fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT,
    fx_observed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.execution_unit_price,
        t.price_currency::TEXT,
        t.settlement_mode::TEXT,
        t.settlement_currency::TEXT,
        t.fx_rate_to_vnd,
        t.fx_provenance::TEXT,
        t.fx_observed_at,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    WHERE t.profile_id = p_profile_id
      AND (p_symbol IS NULL OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
END;
$$;


-- ============================================================================
-- 4. OPENING POSITION BASELINE RPCs WITH AUTHORITATIVE p_profile_id
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_effective_avg_cost NUMERIC := p_average_cost;
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_execution_unit_price NUMERIC := p_execution_unit_price;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;

    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT assets.*
    INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    IF v_price_currency = 'VND' THEN
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
    ELSE
        IF p_fx_rate_to_vnd IS NULL OR p_fx_rate_to_vnd <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires valid fx_rate_to_vnd';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'non-VND opening position requires non-negative execution_unit_price';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
        v_effective_avg_cost := p_execution_unit_price * p_fx_rate_to_vnd;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile_id, v_asset.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, 'USER_DECLARED_INITIAL', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost,
        created_at, updated_at
    )
    VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, v_effective_avg_cost,
        v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'execution_unit_price', v_baseline.execution_unit_price,
            'price_currency', v_baseline.price_currency,
            'fx_rate_to_vnd', v_baseline.fx_rate_to_vnd,
            'fx_provenance', v_baseline.fx_provenance,
            'fx_observed_at', v_baseline.fx_observed_at,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.correct_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL
        OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite number';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'cannot correct cancelled opening position';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', jsonb_build_object(
            'id', v_holding.id,
            'profile_id', v_holding.profile_id,
            'asset_id', v_holding.asset_id,
            'opening_position_id', v_holding.opening_position_id,
            'quantity', v_holding.quantity,
            'average_cost', v_holding.average_cost,
            'created_at', v_holding.created_at,
            'updated_at', v_holding.updated_at
        )
    );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_opening_position(TEXT);
DROP FUNCTION IF EXISTS public.cancel_opening_position(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.cancel_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset_id UUID;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;

    SELECT profiles.id
    INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.asset_id
    INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));

    SELECT baselines.*
    INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;

    IF v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position already cancelled';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel locked opening position';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id
          AND transactions.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot cancel opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET cancelled_at = v_accounted_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    DELETE FROM public.holdings
    WHERE profile_id = v_profile_id
      AND asset_id = v_asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', jsonb_build_object(
            'id', v_baseline.id,
            'profile_id', v_baseline.profile_id,
            'asset_id', v_baseline.asset_id,
            'opening_quantity', v_baseline.opening_quantity,
            'opening_average_cost', v_baseline.opening_average_cost,
            'accounting_cutoff_at', v_baseline.accounting_cutoff_at,
            'provenance_type', v_baseline.provenance_type,
            'locked_at', v_baseline.locked_at,
            'cancelled_at', v_baseline.cancelled_at,
            'created_at', v_baseline.created_at,
            'updated_at', v_baseline.updated_at
        ),
        'holding', NULL,
        'holdingRemoved', TRUE
    );
END;
$$;


DROP FUNCTION IF EXISTS public.claim_legacy_profile(UUID);

CREATE OR REPLACE FUNCTION public.claim_legacy_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'user_id is required';
    END IF;

    -- Check if user already owns a profile
    IF EXISTS (SELECT 1 FROM public.investor_profile WHERE user_id = p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'IP005', MESSAGE = 'User already has an assigned profile';
    END IF;

    -- Atomically update the single unowned legacy profile
    UPDATE public.investor_profile
    SET user_id = p_user_id,
        updated_at = NOW()
    WHERE user_id IS NULL
    RETURNING * INTO v_profile;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'IP006', MESSAGE = 'No unclaimed legacy profile available';
    END IF;

    RETURN jsonb_build_object(
        'id', v_profile.id,
        'user_id', v_profile.user_id,
        'cash_available', v_profile.cash_available,
        'risk_tolerance', v_profile.risk_tolerance,
        'investment_horizon', v_profile.investment_horizon,
        'created_at', v_profile.created_at,
        'updated_at', v_profile.updated_at
    );
END;
$$;


-- ============================================================================
-- 5. PERMISSIONS & SECURITY BOUNDARY
-- ============================================================================

-- Revoke all permissions on new RPCs from public and client roles
REVOKE ALL ON FUNCTION public.get_cash_overview(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_legacy_profile(UUID) FROM PUBLIC, anon, authenticated;

-- Grant execution exclusively to backend service_role
GRANT EXECUTE ON FUNCTION public.get_cash_overview(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_legacy_profile(UUID) TO service_role;

COMMIT;

-- ============================================================================
-- Schema Migration: 20260904010000_finalize_public_multi_user_auth.sql
-- Purpose: Final cutover to public multi-user authentication.
-- Purges disposable unowned legacy test profile and private child data,
-- drops legacy claim database function and partial index, and enforces
-- NOT NULL on investor_profile.user_id.
-- ============================================================================

BEGIN;

DELETE FROM public.alert_notification_deliveries
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.push_subscriptions
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.price_alerts
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.watchlist_items
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.cash_ledger_entries
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.cash_ledger_activation
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.holdings
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.position_opening_baselines
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.position_ledger_activation
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.portfolio_transactions
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.investor_profile
WHERE user_id IS NULL;

DROP FUNCTION IF EXISTS public.claim_legacy_profile(UUID);

DROP INDEX IF EXISTS public.uq_investor_profile_legacy_unowned;

ALTER TABLE public.investor_profile
    ALTER COLUMN user_id SET NOT NULL;

COMMENT ON COLUMN public.investor_profile.user_id IS
    'Authoritative 1:1 link to Supabase auth.users(id). Mandatory for all profiles.';

ALTER TABLE public.price_alerts
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMIT;

-- ============================================================================
-- Schema Migration: 20260904030000_create_market_context_observations.sql
-- Purpose: Durable persistence table for validated global market context observations.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_context_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id TEXT NOT NULL,
    observation_id TEXT NOT NULL UNIQUE,
    pillar TEXT NOT NULL CHECK (pillar IN ('macro', 'monetary', 'market', 'intermarket')),
    metric TEXT NOT NULL,
    label TEXT,
    numeric_value NUMERIC NOT NULL CHECK (
        numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    unit TEXT NOT NULL,
    unit_type TEXT,
    change_value NUMERIC CHECK (
        change_value IS NULL OR change_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    change_unit TEXT,
    change_unit_type TEXT,
    change_percent NUMERIC CHECK (
        change_percent IS NULL OR change_percent::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    change_basis TEXT,
    previous_value NUMERIC CHECK (
        previous_value IS NULL OR previous_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    volume NUMERIC CHECK (
        volume IS NULL OR (volume >= 0 AND volume::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'))
    ),
    volume_unit TEXT,
    quote_direction TEXT,
    reference_time TEXT,
    observed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_id TEXT NOT NULL,
    authority_level TEXT,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'available' CHECK (
        status IN ('available', 'unavailable', 'stale')
    ),
    freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (
        freshness IN ('fresh', 'stale', 'delayed')
    ),
    quality_status TEXT NOT NULL DEFAULT 'available' CHECK (
        quality_status IN ('available', 'verified', 'preliminary', 'revised', 'reported')
    ),
    revision_marker TEXT,
    source_content_hash TEXT,
    methodology_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_context_observations IS
    'Durable persistence for validated global market context facts across macro, monetary, Vietnam equities, and intermarket indicators. Strictly public/global. Writes restricted to backend service_role.';

CREATE INDEX IF NOT EXISTS idx_market_context_fact_vintage
    ON public.market_context_observations (fact_id, reference_time DESC, published_at DESC NULLS LAST, observed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_market_context_pillar_observed
    ON public.market_context_observations (pillar, observed_at DESC NULLS LAST);

ALTER TABLE public.market_context_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_context_observations_read ON public.market_context_observations;
CREATE POLICY market_context_observations_read
    ON public.market_context_observations
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_observations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_context_observations FROM anon, authenticated;

GRANT SELECT ON public.market_context_observations TO anon, authenticated;
GRANT ALL ON public.market_context_observations TO service_role;

COMMIT;

-- ============================================================================
-- Schema Migration: 20260904040000_create_market_news_articles.sql
-- Purpose: Durable public store for validated normalized market-news metadata.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_news_articles (
    article_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT,
    canonical_url TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    language TEXT NOT NULL,
    category TEXT,
    topic TEXT,
    related_assets JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(related_assets) = 'array'),
    geography TEXT NOT NULL CHECK (geography IN ('vietnam', 'global')),
    source_authority TEXT NOT NULL,
    quality TEXT NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'stale')),
    freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (freshness IN ('fresh', 'stale')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_news_articles IS
    'Global normalized market-news metadata. Provider collection is backend-only; public clients have read-only access.';

CREATE INDEX IF NOT EXISTS idx_market_news_published_at
    ON public.market_news_articles (published_at DESC, article_id);

CREATE INDEX IF NOT EXISTS idx_market_news_geography_topic
    ON public.market_news_articles (geography, topic, published_at DESC);

ALTER TABLE public.market_news_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_news_articles_read ON public.market_news_articles;
CREATE POLICY market_news_articles_read
    ON public.market_news_articles
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_news_articles FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_news_articles FROM anon, authenticated;

GRANT SELECT ON public.market_news_articles TO anon, authenticated;
GRANT ALL ON public.market_news_articles TO service_role;

COMMIT;


-- ============================================================================
-- Schema Migration: 20260906020000_create_vn_equity_evidence.sql
-- Purpose: Immutable public evidence vintages for canonical Vietnam-listed equities.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vn_equity_evidence_observations (
    observation_id TEXT PRIMARY KEY,
    fact_id TEXT NOT NULL,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    company_name TEXT NOT NULL,
    evidence_type TEXT NOT NULL CHECK (
        evidence_type IN ('market_price', 'fundamental', 'disclosure')
    ),
    metric TEXT NOT NULL,
    numeric_value NUMERIC CHECK (
        numeric_value IS NULL OR numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    text_value TEXT,
    unit TEXT,
    currency TEXT,
    reference_period TEXT NOT NULL,
    observed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    source_available_at TIMESTAMPTZ,
    system_knowable_at TIMESTAMPTZ NOT NULL CHECK (
        system_knowable_at >= first_seen_at
        AND (source_available_at IS NULL OR system_knowable_at >= source_available_at)
    ),
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_family TEXT NOT NULL,
    dependency_group TEXT NOT NULL,
    authority_level TEXT NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('available', 'stale')),
    freshness TEXT NOT NULL CHECK (freshness IN ('fresh', 'delayed', 'stale')),
    status_reason TEXT,
    revision_marker TEXT,
    source_content_hash TEXT NOT NULL,
    methodology_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        numeric_value IS NOT NULL OR (text_value IS NOT NULL AND btrim(text_value) <> '')
    ),
    CHECK (metric <> 'close' OR (numeric_value IS NOT NULL AND numeric_value > 0)),
    CHECK (metric <> 'volume' OR (numeric_value IS NOT NULL AND numeric_value >= 0))
);

COMMENT ON TABLE public.vn_equity_evidence_observations IS
    'Immutable, replay-safe public evidence vintages for canonical Vietnam-listed equities. Provider collection is backend-only.';

CREATE INDEX IF NOT EXISTS idx_vn_equity_evidence_symbol_fact_vintage
    ON public.vn_equity_evidence_observations (
        symbol,
        fact_id,
        reference_period DESC,
        system_knowable_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_vn_equity_evidence_asset_type_period
    ON public.vn_equity_evidence_observations (
        asset_id,
        evidence_type,
        reference_period DESC
    );

ALTER TABLE public.vn_equity_evidence_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vn_equity_evidence_read ON public.vn_equity_evidence_observations;
CREATE POLICY vn_equity_evidence_read
    ON public.vn_equity_evidence_observations
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.vn_equity_evidence_observations FROM service_role;

GRANT SELECT ON public.vn_equity_evidence_observations TO anon, authenticated;
GRANT SELECT, INSERT ON public.vn_equity_evidence_observations TO service_role;

COMMIT;

-- Schema Migration: 20260906030000_create_vn_equity_opportunities.sql
-- Immutable deterministic Vietnam equity opportunity evaluations.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vn_equity_opportunity_evaluations (
    evaluation_id TEXT PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    company_name TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    evidence_version TEXT NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    qualification_status TEXT NOT NULL CHECK (
        qualification_status IN ('QUALIFIED', 'WATCH', 'INSUFFICIENT_EVIDENCE', 'REJECTED')
    ),
    qualification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(qualification_reasons) = 'array'
    ),
    disqualification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(disqualification_reasons) = 'array'
    ),
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(evidence_refs) = 'array'
    ),
    data_quality JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(data_quality) = 'object'
    ),
    missing_requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(missing_requirements) = 'array'
    ),
    explanation JSONB CHECK (
        explanation IS NULL OR jsonb_typeof(explanation) = 'object'
    ),
    evaluated_at TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (asset_id, as_of, evidence_fingerprint, policy_version)
);

COMMENT ON TABLE public.vn_equity_opportunity_evaluations IS
    'Immutable public deterministic evidence-screen evaluations. Ordering is not investment preference.';

CREATE INDEX IF NOT EXISTS idx_vn_equity_opportunities_symbol_as_of
    ON public.vn_equity_opportunity_evaluations (symbol, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_vn_equity_opportunities_status_as_of
    ON public.vn_equity_opportunity_evaluations (qualification_status, as_of DESC);

ALTER TABLE public.vn_equity_opportunity_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vn_equity_opportunity_read ON public.vn_equity_opportunity_evaluations;
CREATE POLICY vn_equity_opportunity_read
    ON public.vn_equity_opportunity_evaluations
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.vn_equity_opportunity_evaluations FROM service_role;

GRANT SELECT ON public.vn_equity_opportunity_evaluations TO anon, authenticated;
GRANT SELECT, INSERT ON public.vn_equity_opportunity_evaluations TO service_role;

COMMIT;


-- Strategy Stability foundation required by the current-schema bootstrap.
CREATE TABLE IF NOT EXISTS public.strategy_versions (
    strategy_id TEXT PRIMARY KEY,
    previous_strategy_id TEXT REFERENCES public.strategy_versions(strategy_id),
    generated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    data_as_of TIMESTAMPTZ NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    decision_fingerprint TEXT NOT NULL,
    trigger_reason JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_reason) = 'object'),
    material_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(material_changes) = 'array'),
    confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    regime JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(regime) = 'object'),
    executive_decision JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(executive_decision) = 'object'),
    asset_strategy JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(asset_strategy) = 'array'),
    preferred_themes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preferred_themes) = 'array'),
    avoid_or_underweight JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(avoid_or_underweight) = 'array'),
    risk_overlay JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(risk_overlay) = 'object'),
    horizon TEXT NOT NULL,
    invalidation_conditions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(invalidation_conditions) = 'array'),
    status TEXT NOT NULL CHECK (status IN ('published', 'superseded')),
    policy_version TEXT NOT NULL,
    run_manifest_id TEXT,
    next_review_due_at TIMESTAMPTZ,
    limitations TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'STABLE' CHECK (lifecycle_state IN ('STABLE', 'WATCH', 'REVIEW_REQUIRED', 'EVALUATING')),
    data_quality_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (data_quality_state IN ('HEALTHY', 'DEGRADED', 'INSUFFICIENT')),
    watch_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watch_reasons) = 'array'),
    shock_override JSONB DEFAULT NULL CHECK (shock_override IS NULL OR jsonb_typeof(shock_override) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.strategy_versions IS
    'Immutable published market strategy decisions. Strictly non-private global market intelligence.';

CREATE TABLE IF NOT EXISTS public.strategy_assessments (
    assessment_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES public.strategy_versions(strategy_id),
    assessed_at TIMESTAMPTZ NOT NULL,
    data_as_of TIMESTAMPTZ NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    previous_evidence_fingerprint TEXT,
    decision_fingerprint TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    previous_confidence TEXT CHECK (previous_confidence IS NULL OR previous_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    result TEXT NOT NULL CHECK (result IN ('KEEP', 'DETAILS', 'CONFIDENCE', 'PUBLISH_NEW')),
    evaluation_status TEXT NOT NULL CHECK (evaluation_status IN ('COMPLETED', 'FAILED', 'DEFERRED', 'SUPERSEDED')),
    trigger_reason JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_reason) = 'object'),
    material_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(material_changes) = 'array'),
    limitations TEXT,
    policy_version TEXT NOT NULL,
    run_manifest_id TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'STABLE' CHECK (lifecycle_state IN ('STABLE', 'WATCH', 'REVIEW_REQUIRED', 'EVALUATING')),
    data_quality_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (data_quality_state IN ('HEALTHY', 'DEGRADED', 'INSUFFICIENT')),
    watch_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watch_reasons) = 'array'),
    shock_override JSONB DEFAULT NULL CHECK (shock_override IS NULL OR jsonb_typeof(shock_override) = 'object'),
    confirmation_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(confirmation_keys) = 'array'),
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.strategy_assessments IS
    'Append-only evaluation log assessing incoming evidence packets against active strategy versions. Strictly non-private.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_versions_single_published
    ON public.strategy_versions ((status)) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_strategy_versions_status_published
    ON public.strategy_versions (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_decision_fp
    ON public.strategy_versions (decision_fingerprint);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_evidence_fp
    ON public.strategy_versions (evidence_fingerprint);
CREATE INDEX IF NOT EXISTS idx_strategy_assessments_strategy
    ON public.strategy_assessments (strategy_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_assessments_assessed_at
    ON public.strategy_assessments (assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_assessments_evidence_fp
    ON public.strategy_assessments (evidence_fingerprint);
CREATE INDEX IF NOT EXISTS idx_strategy_assessments_idempotency
    ON public.strategy_assessments (idempotency_key)
    WHERE (idempotency_key IS NOT NULL);

CREATE OR REPLACE FUNCTION public.prevent_strategy_assessments_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'strategy_assessments is append-only: UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_strategy_assessments_mutation ON public.strategy_assessments;
CREATE TRIGGER trg_prevent_strategy_assessments_mutation
    BEFORE UPDATE OR DELETE ON public.strategy_assessments
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_strategy_assessments_mutation();

ALTER TABLE public.strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategy_versions_read ON public.strategy_versions;
CREATE POLICY strategy_versions_read ON public.strategy_versions FOR SELECT USING (true);
DROP POLICY IF EXISTS strategy_assessments_read ON public.strategy_assessments;
CREATE POLICY strategy_assessments_read ON public.strategy_assessments FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_versions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.strategy_assessments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.strategy_versions TO anon, authenticated;
GRANT SELECT ON public.strategy_assessments TO anon, authenticated;
GRANT ALL ON public.strategy_versions TO service_role;
GRANT SELECT, INSERT ON public.strategy_assessments TO service_role;

-- ============================================================================
-- Schema Migration: 20260906040000_fix_market_strategist_publication_null.sql
-- Purpose: Hardens publish_strategy_version_atomic shock_override null handling
-- ============================================================================

-- Migration: 20260906040000_fix_market_strategist_publication_null.sql
-- Description: Hardens publish_strategy_version_atomic to handle JSONB null vs SQL NULL
-- for shock_override, preventing check constraint violations on strategy_versions_shock_override_check.

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_strategy_version_atomic(
    p_new_version JSONB,
    p_expected_current_strategy_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_published RECORD;
    v_inserted RECORD;
    v_new_strategy_id TEXT;
BEGIN
    IF p_new_version IS NULL OR jsonb_typeof(p_new_version) != 'object' THEN
        RAISE EXCEPTION 'publish_strategy_version_atomic: p_new_version must be a valid JSON object';
    END IF;

    v_new_strategy_id := p_new_version->>'strategy_id';
    IF v_new_strategy_id IS NULL OR length(trim(v_new_strategy_id)) = 0 THEN
        RAISE EXCEPTION 'publish_strategy_version_atomic: strategy_id is required';
    END IF;

    -- 1. Lock and inspect current published strategy (if any)
    SELECT strategy_id, status
      INTO v_current_published
      FROM public.strategy_versions
     WHERE status = 'published'
       FOR UPDATE;

    -- 2. Verify expected current strategy
    IF p_expected_current_strategy_id IS NOT NULL THEN
        IF v_current_published.strategy_id IS NULL THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Expected published strategy % but none was found', p_expected_current_strategy_id
                USING ERRCODE = 'P0001';
        ELSIF v_current_published.strategy_id != p_expected_current_strategy_id THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Expected published strategy % but found %', p_expected_current_strategy_id, v_current_published.strategy_id
                USING ERRCODE = 'P0001';
        END IF;
    ELSE
        -- Cold start bootstrap: if expected is NULL, but a published strategy already exists:
        IF v_current_published.strategy_id IS NOT NULL THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Cold-start bootstrap conflict; published strategy % already exists', v_current_published.strategy_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Supersede expected current strategy
    IF v_current_published.strategy_id IS NOT NULL THEN
        UPDATE public.strategy_versions
           SET status = 'superseded'
         WHERE strategy_id = v_current_published.strategy_id;
    END IF;

    -- 4. Insert new published strategy version
    INSERT INTO public.strategy_versions (
        strategy_id,
        previous_strategy_id,
        generated_at,
        published_at,
        data_as_of,
        evidence_fingerprint,
        decision_fingerprint,
        trigger_reason,
        material_changes,
        confidence,
        regime,
        executive_decision,
        asset_strategy,
        preferred_themes,
        avoid_or_underweight,
        risk_overlay,
        horizon,
        invalidation_conditions,
        status,
        lifecycle_state,
        data_quality_state,
        watch_reasons,
        shock_override,
        policy_version,
        run_manifest_id,
        next_review_due_at,
        limitations,
        created_at
    ) VALUES (
        v_new_strategy_id,
        p_new_version->>'previous_strategy_id',
        (p_new_version->>'generated_at')::TIMESTAMPTZ,
        (p_new_version->>'published_at')::TIMESTAMPTZ,
        (p_new_version->>'data_as_of')::TIMESTAMPTZ,
        p_new_version->>'evidence_fingerprint',
        p_new_version->>'decision_fingerprint',
        COALESCE(p_new_version->'trigger_reason', '{}'::jsonb),
        COALESCE(p_new_version->'material_changes', '[]'::jsonb),
        p_new_version->>'confidence',
        COALESCE(p_new_version->'regime', '{}'::jsonb),
        COALESCE(p_new_version->'executive_decision', '{}'::jsonb),
        COALESCE(p_new_version->'asset_strategy', '[]'::jsonb),
        COALESCE(p_new_version->'preferred_themes', '[]'::jsonb),
        COALESCE(p_new_version->'avoid_or_underweight', '[]'::jsonb),
        COALESCE(p_new_version->'risk_overlay', '{}'::jsonb),
        COALESCE(p_new_version->>'horizon', 'medium'),
        COALESCE(p_new_version->'invalidation_conditions', '[]'::jsonb),
        'published',
        COALESCE(p_new_version->>'lifecycle_state', 'STABLE'),
        COALESCE(p_new_version->>'data_quality_state', 'HEALTHY'),
        COALESCE(p_new_version->'watch_reasons', '[]'::jsonb),
        CASE
            WHEN p_new_version->'shock_override' IS NULL
              OR p_new_version->'shock_override' = 'null'::jsonb
            THEN NULL
            ELSE p_new_version->'shock_override'
        END,
        p_new_version->>'policy_version',
        p_new_version->>'run_manifest_id',
        (p_new_version->>'next_review_due_at')::TIMESTAMPTZ,
        p_new_version->>'limitations',
        COALESCE((p_new_version->>'created_at')::TIMESTAMPTZ, NOW())
    )
    RETURNING * INTO v_inserted;

    RETURN to_jsonb(v_inserted);
END;
$$;

-- Security hardening: Server-only execution
REVOKE EXECUTE ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) IS
    'Atomically supersedes current published strategy and inserts new strategy version within a single transaction with hardened shock_override null handling. Strictly non-private.';

COMMIT;


-- ============================================================================
-- Schema Migration: 20260906050000_create_confidence_framework_v2.sql
-- Immutable, public confidence assessments and calibration-manifest foundation.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.calibration_manifests (
    manifest_id TEXT PRIMARY KEY,
    cohort TEXT,
    target_type TEXT NOT NULL CHECK (target_type IN ('MARKET_STRATEGY', 'CLAIM', 'PILLAR')),
    claim_type TEXT,
    scope TEXT NOT NULL,
    horizon TEXT,
    policy_version TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    model_version TEXT,
    dataset_start_at TIMESTAMPTZ,
    dataset_end_at TIMESTAMPTZ,
    evaluation_method JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evaluation_method) = 'object'),
    applicability JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(applicability) = 'object'),
    release_criteria JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(release_criteria) = 'object'),
    status TEXT NOT NULL DEFAULT 'UNVALIDATED' CHECK (status IN ('UNVALIDATED', 'PARTIAL', 'VALIDATED', 'SUSPENDED')),
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.confidence_assessments (
    assessment_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('MARKET_STRATEGY', 'CLAIM', 'PILLAR')),
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    horizon TEXT,
    cutoff TIMESTAMPTZ NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    input_fingerprint TEXT NOT NULL,
    profile_version TEXT,
    policy_version TEXT NOT NULL,
    evidence_support TEXT NOT NULL CHECK (evidence_support IN ('STRONG', 'ADEQUATE', 'FRAGILE', 'INSUFFICIENT')),
    candidate_grade TEXT CHECK (candidate_grade IS NULL OR candidate_grade IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    public_grade TEXT CHECK (public_grade IS NULL OR public_grade IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE')),
    assessment_status TEXT NOT NULL CHECK (assessment_status IN ('ASSESSED', 'NOT_ASSESSED')),
    calibration_status TEXT NOT NULL DEFAULT 'UNVALIDATED' CHECK (calibration_status IN ('UNVALIDATED', 'PARTIAL', 'VALIDATED', 'SUSPENDED')),
    calibration_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    calibration_manifest_id TEXT REFERENCES public.calibration_manifests(manifest_id) ON DELETE RESTRICT,
    calibration_knowable_at TIMESTAMPTZ,
    gate_results JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gate_results) = 'array'),
    caps JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(caps) = 'array'),
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
    upgrade_requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(upgrade_requirements) = 'array'),
    strategy_assessment_id TEXT REFERENCES public.strategy_assessments(assessment_id) ON DELETE RESTRICT,
    strategy_id TEXT REFERENCES public.strategy_versions(strategy_id) ON DELETE RESTRICT,
    strategy_version TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (
        (assessment_status = 'NOT_ASSESSED' AND candidate_grade IS NULL AND public_grade IS NULL)
        OR
        (assessment_status = 'ASSESSED' AND candidate_grade IS NOT NULL AND public_grade IS NOT NULL)
    ),
    CHECK (candidate_grade <> 'INSUFFICIENT_EVIDENCE' OR public_grade = 'INSUFFICIENT_EVIDENCE'),
    CHECK (
        public_grade <> 'HIGH'
        OR (
            assessment_status = 'ASSESSED'
            AND candidate_grade = 'HIGH'
            AND calibration_status = 'VALIDATED'
            AND calibration_applicable = TRUE
            AND calibration_manifest_id IS NOT NULL
            AND calibration_knowable_at IS NOT NULL
            AND calibration_knowable_at <= cutoff
            AND jsonb_array_length(caps) = 0
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_confidence_assessments_target_as_of
    ON public.confidence_assessments (target_type, target_id, scope, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_confidence_assessments_input_policy
    ON public.confidence_assessments (input_fingerprint, profile_version, policy_version);
CREATE INDEX IF NOT EXISTS idx_calibration_manifests_applicability
    ON public.calibration_manifests (target_type, scope, profile_version, policy_version, effective_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_confidence_framework_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Confidence framework records are append-only: UPDATE and DELETE are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_confidence_assessments_mutation ON public.confidence_assessments;
CREATE TRIGGER trg_prevent_confidence_assessments_mutation
    BEFORE UPDATE OR DELETE ON public.confidence_assessments
    FOR EACH ROW EXECUTE FUNCTION public.prevent_confidence_framework_mutation();

DROP TRIGGER IF EXISTS trg_prevent_calibration_manifests_mutation ON public.calibration_manifests;
CREATE TRIGGER trg_prevent_calibration_manifests_mutation
    BEFORE UPDATE OR DELETE ON public.calibration_manifests
    FOR EACH ROW EXECUTE FUNCTION public.prevent_confidence_framework_mutation();

ALTER TABLE public.confidence_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY confidence_assessments_public_read ON public.confidence_assessments FOR SELECT USING (true);
CREATE POLICY calibration_manifests_public_read ON public.calibration_manifests FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.confidence_assessments FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.confidence_assessments FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.calibration_manifests FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.calibration_manifests FROM service_role;

GRANT SELECT ON public.confidence_assessments TO anon, authenticated;
GRANT SELECT, INSERT ON public.confidence_assessments TO service_role;
GRANT SELECT ON public.calibration_manifests TO anon, authenticated;
GRANT SELECT, INSERT ON public.calibration_manifests TO service_role;

-- Manually imported, validated official monetary evidence vintages.
CREATE TABLE IF NOT EXISTS public.official_monetary_evidence_vintages (
    vintage_id TEXT PRIMARY KEY,
    supersedes TEXT REFERENCES public.official_monetary_evidence_vintages(vintage_id) ON DELETE RESTRICT,
    fact_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    value NUMERIC NOT NULL CHECK (value NOT IN ('Infinity'::numeric, '-Infinity'::numeric, 'NaN'::numeric)),
    unit TEXT NOT NULL,
    reference_period TEXT NOT NULL,
    observation_date DATE NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ NOT NULL CHECK (effective_to >= effective_from),
    origin_issuer TEXT NOT NULL CHECK (origin_issuer = 'SBV'),
    publisher TEXT NOT NULL CHECK (publisher = 'SBV'),
    delivery_provider TEXT NOT NULL,
    provenance_family TEXT NOT NULL CHECK (provenance_family = 'OFFICIAL_SBV'),
    dependency_group TEXT NOT NULL CHECK (dependency_group = 'OFFICIAL_SBV'),
    support_scope TEXT NOT NULL,
    support_path_id TEXT NOT NULL CHECK (support_path_id IN ('PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT')),
    authority_level TEXT NOT NULL CHECK (authority_level = 'REGULATORY_OFFICIAL'),
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://([a-z0-9-]+\.)*sbv\.gov\.vn/'),
    attachment_url TEXT CHECK (attachment_url IS NULL OR attachment_url ~ '^https://([a-z0-9-]+\.)*sbv\.gov\.vn/'),
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    source_available_at TIMESTAMPTZ NOT NULL,
    system_first_seen_at TIMESTAMPTZ NOT NULL,
    system_knowable_at TIMESTAMPTZ NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL,
    validated_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL,
    parser_profile_version TEXT NOT NULL,
    methodology_version TEXT NOT NULL,
    replay_mode TEXT NOT NULL DEFAULT 'AS_OPERATED' CHECK (replay_mode IN ('AS_OPERATED', 'RECONSTRUCTED')),
    artifact_text TEXT NOT NULL,
    CHECK (system_knowable_at = GREATEST(source_available_at, system_first_seen_at)),
    UNIQUE (observation_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_official_monetary_evidence_fact_knowable
    ON public.official_monetary_evidence_vintages (fact_id, system_knowable_at DESC, observation_date DESC);
CREATE INDEX IF NOT EXISTS idx_official_monetary_evidence_document
    ON public.official_monetary_evidence_vintages (document_id, accepted_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_official_monetary_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Official monetary evidence vintages are immutable: UPDATE and DELETE are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_official_monetary_evidence_mutation ON public.official_monetary_evidence_vintages;
CREATE TRIGGER trg_prevent_official_monetary_evidence_mutation
    BEFORE UPDATE OR DELETE ON public.official_monetary_evidence_vintages
    FOR EACH ROW EXECUTE FUNCTION public.prevent_official_monetary_evidence_mutation();

ALTER TABLE public.official_monetary_evidence_vintages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.official_monetary_evidence_vintages FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.official_monetary_evidence_vintages FROM service_role;
GRANT SELECT, INSERT ON public.official_monetary_evidence_vintages TO service_role;

COMMIT;

-- Portfolio V1 P0.1: accounting-time and asset-eligibility trust boundaries.
-- Forward-only: no historical financial rows are rewritten.

BEGIN;

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS portfolio_eligibility VARCHAR(32);

UPDATE public.assets
SET portfolio_eligibility = CASE
    WHEN asset_type = 'fx' THEN 'REFERENCE_ONLY'
    ELSE 'PORTFOLIO_ELIGIBLE'
END
WHERE portfolio_eligibility IS NULL;

ALTER TABLE public.assets
    ALTER COLUMN portfolio_eligibility SET NOT NULL,
    DROP CONSTRAINT IF EXISTS assets_portfolio_eligibility_check,
    ADD CONSTRAINT assets_portfolio_eligibility_check
        CHECK (portfolio_eligibility IN ('PORTFOLIO_ELIGIBLE', 'REFERENCE_ONLY'));

COMMENT ON COLUMN public.assets.portfolio_eligibility IS
    'Canonical Portfolio capability. REFERENCE_ONLY assets may provide market context but cannot create holdings, opening positions, or trades.';

CREATE OR REPLACE FUNCTION public.enforce_portfolio_transaction_asset_eligibility()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset public.assets%ROWTYPE;
BEGIN
    SELECT * INTO v_asset FROM public.assets WHERE id = NEW.asset_id;
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'portfolio asset is unavailable';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE
        OR v_asset.portfolio_eligibility IS DISTINCT FROM 'PORTFOLIO_ELIGIBLE' THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'asset is not portfolio eligible';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portfolio_transaction_asset_eligibility ON public.portfolio_transactions;
CREATE TRIGGER trg_portfolio_transaction_asset_eligibility
    BEFORE INSERT OR UPDATE OF asset_id ON public.portfolio_transactions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_portfolio_transaction_asset_eligibility();

CREATE OR REPLACE FUNCTION public.enforce_opening_position_asset_eligibility()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset public.assets%ROWTYPE;
BEGIN
    SELECT * INTO v_asset FROM public.assets WHERE id = NEW.asset_id;
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'portfolio asset is unavailable';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE
        OR v_asset.portfolio_eligibility IS DISTINCT FROM 'PORTFOLIO_ELIGIBLE' THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'asset is not portfolio eligible';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opening_position_asset_eligibility ON public.position_opening_baselines;
CREATE TRIGGER trg_opening_position_asset_eligibility
    BEFORE INSERT OR UPDATE OF asset_id ON public.position_opening_baselines
    FOR EACH ROW EXECUTE FUNCTION public.enforce_opening_position_asset_eligibility();

CREATE OR REPLACE FUNCTION public.align_trade_cash_economic_time()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_transaction public.portfolio_transactions%ROWTYPE;
BEGIN
    IF NEW.entry_type IN ('BUY', 'SELL') THEN
        IF NEW.portfolio_transaction_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement requires a linked portfolio transaction';
        END IF;
        SELECT * INTO v_transaction
        FROM public.portfolio_transactions
        WHERE id = NEW.portfolio_transaction_id AND profile_id = NEW.profile_id;
        IF v_transaction.id IS NULL
            OR v_transaction.transaction_type IS DISTINCT FROM NEW.entry_type
            OR v_transaction.settlement_mode IS DISTINCT FROM 'INTERNAL_VND_CASH' THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement conflicts with its linked portfolio transaction';
        END IF;
        NEW.effective_at := v_transaction.executed_at;
        NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
            'economicTimeAuthority', 'portfolio_transaction.executed_at'
        );
    ELSIF NEW.portfolio_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'only BUY or SELL cash movements may link a portfolio transaction';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_align_trade_cash_economic_time ON public.cash_ledger_entries;
CREATE TRIGGER trg_align_trade_cash_economic_time
    BEFORE INSERT ON public.cash_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.align_trade_cash_economic_time();

REVOKE ALL ON FUNCTION public.enforce_portfolio_transaction_asset_eligibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_opening_position_asset_eligibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.align_trade_cash_economic_time() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_portfolio_transaction_asset_eligibility() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_opening_position_asset_eligibility() TO service_role;
GRANT EXECUTE ON FUNCTION public.align_trade_cash_economic_time() TO service_role;

COMMIT;

-- Migration: 20260909000000_portfolio_native_opening_cost.sql
-- Portfolio V1 P0.2.1: native-currency opening cost without fabricated VND basis.
-- Existing execution_unit_price / price_currency fields are the canonical native
-- cost pair. Existing rows are preserved; no historical FX conversion is run.

BEGIN;

ALTER TABLE public.position_opening_baselines
    ALTER COLUMN opening_average_cost DROP NOT NULL;

ALTER TABLE public.holdings
    ALTER COLUMN average_cost DROP NOT NULL;

COMMENT ON COLUMN public.position_opening_baselines.opening_average_cost IS
    'Optional authoritative historical VND average cost. NULL means the VND acquisition basis is unknown.';
COMMENT ON COLUMN public.position_opening_baselines.execution_unit_price IS
    'Average acquisition price in price_currency for the cash-neutral opening position; never converted to VND using current FX.';
COMMENT ON COLUMN public.holdings.average_cost IS
    'Optional authoritative VND average cost projection. NULL means VND cost basis and VND P/L are unavailable.';

DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_asset_currency TEXT;
    v_execution_unit_price NUMERIC := p_execution_unit_price;
    v_usdt_supported BOOLEAN := FALSE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.id INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
       OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NOT NULL AND (
        p_average_cost < 0 OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be null or a non-negative finite VND number';
    END IF;
    IF p_fx_rate_to_vnd IS NOT NULL AND (
        p_fx_rate_to_vnd <= 0 OR p_fx_rate_to_vnd::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'fxRateToVnd must be null or a positive finite number';
    END IF;

    SELECT assets.* INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    v_asset_currency := UPPER(BTRIM(v_asset.quote_currency));
    SELECT EXISTS (
        SELECT 1
        FROM public.asset_provider_mappings AS mappings
        WHERE mappings.asset_id = v_asset.id
          AND LOWER(mappings.provider) = 'binance'
          AND UPPER(COALESCE(mappings.provider_market, '')) = 'SPOT'
          AND UPPER(mappings.provider_symbol) LIKE '%USDT'
    ) INTO v_usdt_supported;

    IF v_asset_currency = 'VND' THEN
        IF v_price_currency <> 'VND' OR p_average_cost IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening position requires an authoritative VND average cost';
        END IF;
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
        IF v_execution_unit_price IS DISTINCT FROM p_average_cost THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND native average cost must equal VND average cost';
        END IF;
    ELSE
        IF v_price_currency <> v_asset_currency
           AND NOT (v_price_currency = 'USDT' AND v_usdt_supported) THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'purchase currency is not supported by the canonical asset/provider capability';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0
           OR p_execution_unit_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'non-VND opening position requires a non-negative finite native average cost';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1 FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    ) VALUES (
        v_profile_id, v_asset.id, p_quantity, p_average_cost,
        v_accounted_at, 'USER_RECORDED', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    ) RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost, created_at, updated_at
    ) VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, p_average_cost, v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', to_jsonb(v_baseline),
        'holding', to_jsonb(v_holding)
    );
END;
$$;

DROP FUNCTION IF EXISTS public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_asset_currency TEXT;
    v_execution_unit_price NUMERIC := p_execution_unit_price;
    v_usdt_supported BOOLEAN := FALSE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
       OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NOT NULL AND (
        p_average_cost < 0 OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be null or a non-negative finite VND number';
    END IF;

    SELECT profiles.id INTO v_profile_id
    FROM public.investor_profile AS profiles WHERE profiles.id = p_profile_id;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.* INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;
    IF v_baseline.id IS NULL OR v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct locked opening position';
    END IF;

    SELECT assets.* INTO v_asset FROM public.assets AS assets WHERE assets.id = v_baseline.asset_id;
    v_asset_currency := UPPER(BTRIM(v_asset.quote_currency));
    SELECT EXISTS (
        SELECT 1 FROM public.asset_provider_mappings AS mappings
        WHERE mappings.asset_id = v_asset.id
          AND LOWER(mappings.provider) = 'binance'
          AND UPPER(COALESCE(mappings.provider_market, '')) = 'SPOT'
          AND UPPER(mappings.provider_symbol) LIKE '%USDT'
    ) INTO v_usdt_supported;

    IF v_asset_currency = 'VND' THEN
        IF v_price_currency <> 'VND' OR p_average_cost IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening position requires an authoritative VND average cost';
        END IF;
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
        IF v_execution_unit_price IS DISTINCT FROM p_average_cost THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND native average cost must equal VND average cost';
        END IF;
    ELSE
        IF v_price_currency <> v_asset_currency
           AND NOT (v_price_currency = 'USDT' AND v_usdt_supported) THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'purchase currency is not supported by the canonical asset/provider capability';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0
           OR p_execution_unit_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'non-VND opening position requires a non-negative finite native average cost';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id AND transactions.asset_id = v_baseline.asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        execution_unit_price = v_execution_unit_price,
        price_currency = v_price_currency,
        fx_rate_to_vnd = p_fx_rate_to_vnd,
        fx_provenance = p_fx_provenance,
        fx_observed_at = p_fx_observed_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile_id
      AND asset_id = v_baseline.asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', to_jsonb(v_baseline),
        'holding', to_jsonb(v_holding)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;

-- Portfolio P1A: Idempotent Financial Writes
-- Prevents duplicate mutations from network retries, timeouts, or double-clicks
-- across portfolio transactions (BUY/SELL), cash movements, and opening positions.

BEGIN;

-- 1. Dedicated Idempotency Table
CREATE TABLE IF NOT EXISTS public.portfolio_idempotency_records (
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    operation_type VARCHAR(32) NOT NULL CHECK (
        operation_type IN ('TRANSACTION', 'CASH_MOVEMENT', 'OPENING_POSITION')
    ),
    request_hash VARCHAR(64) NOT NULL,
    response_payload JSONB NOT NULL,
    resource_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (profile_id, idempotency_key)
);

COMMENT ON TABLE public.portfolio_idempotency_records IS
    'Portfolio P1A: Idempotency log for financial mutations. Replays cached response and blocks duplicate state mutations.';

CREATE INDEX IF NOT EXISTS idx_portfolio_idempotency_created
    ON public.portfolio_idempotency_records (created_at DESC);

ALTER TABLE public.portfolio_idempotency_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portfolio_idempotency_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.portfolio_idempotency_records TO service_role;

-- 2. Idempotent create_portfolio_transaction RPC
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_profile_id UUID,
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_settlement_mode TEXT DEFAULT 'INTERNAL_VND_CASH',
    p_settlement_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_transaction public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_realized_pnl NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_unit_price NUMERIC;
    v_idempotency_key TEXT := NULL;
    v_request_hash TEXT := NULL;
    v_idempotency_record public.portfolio_idempotency_records%ROWTYPE;
    v_result JSONB;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    -- Idempotency pre-check
    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_idempotency_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_idempotency_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key));

        v_request_hash := md5(concat_ws(':',
            'TRANSACTION',
            COALESCE(UPPER(BTRIM(p_symbol)), ''),
            COALESCE(BTRIM(p_asset_id), ''),
            UPPER(COALESCE(BTRIM(p_transaction_type), '')),
            COALESCE(p_quantity::TEXT, ''),
            COALESCE(p_price::TEXT, ''),
            COALESCE(p_executed_at::TEXT, ''),
            COALESCE(p_execution_unit_price::TEXT, ''),
            COALESCE(UPPER(BTRIM(p_price_currency)), 'VND'),
            COALESCE(UPPER(BTRIM(p_settlement_mode)), 'INTERNAL_VND_CASH'),
            COALESCE(UPPER(BTRIM(p_settlement_currency)), ''),
            COALESCE(p_fx_rate_to_vnd::TEXT, ''),
            COALESCE(BTRIM(p_fx_provenance), ''),
            COALESCE(p_fx_observed_at::TEXT, '')
        ));

        SELECT * INTO v_idempotency_record
        FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_idempotency_key;

        IF FOUND THEN
            IF v_idempotency_record.operation_type <> 'TRANSACTION' OR v_idempotency_record.request_hash <> v_request_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency_record.response_payload || jsonb_build_object('replayed', true);
        END IF;
    END IF;

    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL
        OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL
        OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0';
    END IF;
    IF (
        (p_symbol IS NULL OR BTRIM(p_symbol) = '')
        AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = '')
    ) OR (
        p_symbol IS NOT NULL AND BTRIM(p_symbol) <> ''
        AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> ''
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;

    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        v_settlement_currency := 'VND';
    ELSE
        IF p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> '' THEN
            v_settlement_currency := UPPER(BTRIM(p_settlement_currency));
        ELSE
            v_settlement_currency := NULL;
        END IF;
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '' THEN
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset
        FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_unit_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price ELSE NULL END);

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));

    UPDATE public.position_opening_baselines
    SET locked_at = COALESCE(locked_at, v_accounted_at),
        updated_at = v_accounted_at
    WHERE profile_id = v_profile.id
      AND asset_id = v_asset.id
      AND cancelled_at IS NULL
      AND locked_at IS NULL;

    SELECT holdings.*
    INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id
      AND holdings.asset_id = v_asset.id
    FOR UPDATE;

    IF v_existing_holding.id IS NOT NULL THEN
        v_has_holding := TRUE;
    END IF;

    IF p_transaction_type = 'BUY' THEN
        v_cash_amount := p_quantity * p_price;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'buy amount exceeds current cash';
        END IF;

        IF v_has_holding THEN
            v_new_quantity := v_existing_holding.quantity + p_quantity;
            v_new_average_cost := (
                (v_existing_holding.quantity * v_existing_holding.average_cost) + (p_quantity * p_price)
            ) / v_new_quantity;
        ELSE
            v_new_quantity := p_quantity;
            v_new_average_cost := p_price;
        END IF;

        v_realized_pnl := NULL;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
    ELSE
        IF NOT v_has_holding OR v_existing_holding.quantity < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot sell more than held quantity';
        END IF;

        v_cash_amount := p_quantity * p_price;
        v_new_quantity := v_existing_holding.quantity - p_quantity;
        v_new_average_cost := v_existing_holding.average_cost;
        v_realized_pnl := (p_price - v_existing_holding.average_cost) * p_quantity;
        IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;
        IF v_new_quantity = 0 THEN
            v_holding_removed := TRUE;
        END IF;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at
    )
    VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized_pnl,
        COALESCE(p_executed_at, v_accounted_at),
        v_execution_unit_price, v_price_currency, v_settlement_mode, v_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    )
    RETURNING * INTO v_transaction;

    IF v_has_holding AND NOT v_holding_removed THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity,
            average_cost = v_new_average_cost,
            updated_at = v_accounted_at
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id
          AND profile_id = v_profile.id;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            effective_at, created_at, metadata
        )
        VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
            v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'accountingSemantics', 'recorded_now_affects_current_cash',
                'historicalCashReconstruction', FALSE
            )
        )
        RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    v_result := jsonb_build_object(
        'transaction', jsonb_build_object(
            'id', v_transaction.id,
            'profile_id', v_transaction.profile_id,
            'asset_id', v_transaction.asset_id,
            'transaction_type', v_transaction.transaction_type,
            'quantity', v_transaction.quantity,
            'price', v_transaction.price,
            'realized_pnl', v_transaction.realized_pnl,
            'execution_unit_price', v_transaction.execution_unit_price,
            'price_currency', v_transaction.price_currency,
            'settlement_mode', v_transaction.settlement_mode,
            'settlement_currency', v_transaction.settlement_currency,
            'fx_rate_to_vnd', v_transaction.fx_rate_to_vnd,
            'fx_provenance', v_transaction.fx_provenance,
            'fx_observed_at', v_transaction.fx_observed_at,
            'executed_at', v_transaction.executed_at,
            'created_at', v_transaction.created_at,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'opening_position_id', v_result_holding.opening_position_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
                'effective_at', v_cash_entry.effective_at,
                'created_at', v_cash_entry.created_at,
                'metadata', v_cash_entry.metadata,
                'symbol', v_asset.symbol
            )
            ELSE NULL
        END,
        'currentCash', v_new_cash
    );

    IF v_idempotency_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id,
            idempotency_key,
            operation_type,
            request_hash,
            response_payload,
            resource_id,
            created_at
        ) VALUES (
            p_profile_id,
            v_idempotency_key,
            'TRANSACTION',
            v_request_hash,
            v_result,
            v_transaction.id,
            v_accounted_at
        );
    END IF;

    RETURN v_result || jsonb_build_object('replayed', false);
END;
$$;

-- 3. Idempotent create_cash_movement RPC
DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.create_cash_movement(TEXT, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.create_cash_movement(UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.create_cash_movement(
    p_profile_id UUID,
    p_entry_type TEXT,
    p_amount NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_entry public.cash_ledger_entries%ROWTYPE;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_idempotency_key TEXT := NULL;
    v_request_hash TEXT := NULL;
    v_idempotency_record public.portfolio_idempotency_records%ROWTYPE;
    v_result JSONB;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    -- Idempotency pre-check
    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_idempotency_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_idempotency_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key));

        v_request_hash := md5(concat_ws(':',
            'CASH_MOVEMENT',
            UPPER(COALESCE(BTRIM(p_entry_type), '')),
            COALESCE(p_amount::TEXT, '')
        ));

        SELECT * INTO v_idempotency_record
        FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_idempotency_key;

        IF FOUND THEN
            IF v_idempotency_record.operation_type <> 'CASH_MOVEMENT' OR v_idempotency_record.request_hash <> v_request_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency_record.response_payload || jsonb_build_object('replayed', true);
        END IF;
    END IF;

    IF p_entry_type IS NULL OR p_entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'entryType must be DEPOSIT or WITHDRAWAL';
    END IF;
    IF p_amount IS NULL
        OR p_amount <= 0
        OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'CL002', MESSAGE = 'amount must be a finite number greater than 0';
    END IF;

    SELECT ip.*
    INTO v_profile
    FROM public.investor_profile AS ip
    WHERE ip.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    IF p_entry_type = 'WITHDRAWAL' AND p_amount > v_ledger_cash THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
    END IF;

    v_new_cash := CASE
        WHEN p_entry_type = 'DEPOSIT' THEN v_ledger_cash + p_amount
        ELSE v_ledger_cash - p_amount
    END;

    INSERT INTO public.cash_ledger_entries (
        profile_id,
        entry_type,
        amount,
        effective_at,
        created_at
    )
    VALUES (
        v_profile.id,
        p_entry_type,
        p_amount,
        v_accounted_at,
        v_accounted_at
    )
    RETURNING * INTO v_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    v_result := jsonb_build_object(
        'entry', jsonb_build_object(
            'id', v_entry.id,
            'profile_id', v_entry.profile_id,
            'entry_type', v_entry.entry_type,
            'amount', v_entry.amount,
            'portfolio_transaction_id', v_entry.portfolio_transaction_id,
            'effective_at', v_entry.effective_at,
            'created_at', v_entry.created_at,
            'metadata', v_entry.metadata
        ),
        'currentCash', v_new_cash
    );

    IF v_idempotency_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id,
            idempotency_key,
            operation_type,
            request_hash,
            response_payload,
            resource_id,
            created_at
        ) VALUES (
            p_profile_id,
            v_idempotency_key,
            'CASH_MOVEMENT',
            v_request_hash,
            v_result,
            v_entry.id,
            v_accounted_at
        );
    END IF;

    RETURN v_result || jsonb_build_object('replayed', false);
END;
$$;

-- 4. Idempotent create_opening_position RPC
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_asset_currency TEXT;
    v_execution_unit_price NUMERIC := p_execution_unit_price;
    v_usdt_supported BOOLEAN := FALSE;
    v_idempotency_key TEXT := NULL;
    v_request_hash TEXT := NULL;
    v_idempotency_record public.portfolio_idempotency_records%ROWTYPE;
    v_result JSONB;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    -- Idempotency pre-check
    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_idempotency_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_idempotency_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key));

        v_request_hash := md5(concat_ws(':',
            'OPENING_POSITION',
            COALESCE(BTRIM(p_asset_id), ''),
            COALESCE(p_quantity::TEXT, ''),
            COALESCE(p_average_cost::TEXT, ''),
            COALESCE(p_execution_unit_price::TEXT, ''),
            COALESCE(UPPER(BTRIM(p_price_currency)), 'VND'),
            COALESCE(p_fx_rate_to_vnd::TEXT, ''),
            COALESCE(BTRIM(p_fx_provenance), ''),
            COALESCE(p_fx_observed_at::TEXT, '')
        ));

        SELECT * INTO v_idempotency_record
        FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_idempotency_key;

        IF FOUND THEN
            IF v_idempotency_record.operation_type <> 'OPENING_POSITION' OR v_idempotency_record.request_hash <> v_request_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency_record.response_payload || jsonb_build_object('replayed', true);
        END IF;
    END IF;

    SELECT profiles.id INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
       OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NOT NULL AND (
        p_average_cost < 0 OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be null or a non-negative finite VND number';
    END IF;
    IF p_fx_rate_to_vnd IS NOT NULL AND (
        p_fx_rate_to_vnd <= 0 OR p_fx_rate_to_vnd::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'fxRateToVnd must be null or a positive finite number';
    END IF;

    SELECT assets.* INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    v_asset_currency := UPPER(BTRIM(v_asset.quote_currency));
    SELECT EXISTS (
        SELECT 1
        FROM public.asset_provider_mappings AS mappings
        WHERE mappings.asset_id = v_asset.id
          AND LOWER(mappings.provider) = 'binance'
          AND UPPER(COALESCE(mappings.provider_market, '')) = 'SPOT'
          AND UPPER(mappings.provider_symbol) LIKE '%USDT'
    ) INTO v_usdt_supported;

    IF v_asset_currency = 'VND' THEN
        IF v_price_currency <> 'VND' OR p_average_cost IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening position requires an authoritative VND average cost';
        END IF;
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
        IF v_execution_unit_price IS DISTINCT FROM p_average_cost THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND native average cost must equal VND average cost';
        END IF;
    ELSE
        IF v_price_currency <> v_asset_currency
           AND NOT (v_price_currency = 'USDT' AND v_usdt_supported) THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'purchase currency is not supported by the canonical asset/provider capability';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0
           OR p_execution_unit_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'non-VND opening position requires a non-negative finite native average cost';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1 FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    ) VALUES (
        v_profile_id, v_asset.id, p_quantity, p_average_cost,
        v_accounted_at, 'USER_RECORDED', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    ) RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost, created_at, updated_at
    ) VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, p_average_cost, v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    v_result := jsonb_build_object(
        'openingPosition', to_jsonb(v_baseline),
        'holding', to_jsonb(v_holding)
    );

    IF v_idempotency_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id,
            idempotency_key,
            operation_type,
            request_hash,
            response_payload,
            resource_id,
            created_at
        ) VALUES (
            p_profile_id,
            v_idempotency_key,
            'OPENING_POSITION',
            v_request_hash,
            v_result,
            v_baseline.id,
            v_accounted_at
        );
    END IF;

    RETURN v_result || jsonb_build_object('replayed', false);
END;
$$;

-- 5. Backward-Compatible Signature Wrapper for P0.1 verification contract
CREATE OR REPLACE FUNCTION public.create_portfolio_transaction(
    p_profile_id UUID,
    p_symbol TEXT,
    p_asset_id TEXT,
    p_transaction_type TEXT,
    p_quantity NUMERIC,
    p_price NUMERIC,
    p_executed_at TIMESTAMPTZ,
    p_execution_unit_price NUMERIC,
    p_price_currency TEXT,
    p_settlement_mode TEXT,
    p_settlement_currency TEXT,
    p_fx_rate_to_vnd NUMERIC,
    p_fx_provenance TEXT,
    p_fx_observed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public.create_portfolio_transaction(
        p_profile_id,
        p_symbol,
        p_asset_id,
        p_transaction_type,
        p_quantity,
        p_price,
        p_executed_at,
        p_execution_unit_price,
        p_price_currency,
        p_settlement_mode,
        p_settlement_currency,
        p_fx_rate_to_vnd,
        p_fx_provenance,
        p_fx_observed_at,
        NULL::TEXT
    );
END;
$$;

-- 6. Revoke & Grant Execution Rights
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(UUID, TEXT, NUMERIC, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

COMMIT;

-- ==========================================================
-- Schema Migration: 20260912000000_portfolio_auditable_reversals.sql
-- Purpose: Portfolio P1B Auditable Correction and Reversal Foundation
-- ==========================================================

BEGIN;

-- 1. Dedicated Reversals Audit Table
CREATE TABLE IF NOT EXISTS public.portfolio_reversals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    original_event_type VARCHAR(32) NOT NULL CHECK (
        original_event_type IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'OPENING_POSITION')
    ),
    original_event_id UUID NOT NULL,
    reversal_transaction_id UUID NULL REFERENCES public.portfolio_transactions(id) ON DELETE RESTRICT,
    reversal_cash_entry_id UUID NULL REFERENCES public.cash_ledger_entries(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    idempotency_key VARCHAR(128) NULL,
    replacement_event_id UUID NULL,
    effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_portfolio_reversals_original UNIQUE (profile_id, original_event_type, original_event_id)
);

COMMENT ON TABLE public.portfolio_reversals IS
    'Portfolio P1B: Immutable audit ledger of transaction, cash movement, and baseline reversals.';

CREATE INDEX IF NOT EXISTS idx_portfolio_reversals_profile_created
    ON public.portfolio_reversals (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_reversals_original
    ON public.portfolio_reversals (original_event_id);

ALTER TABLE public.portfolio_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portfolio_reversals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.portfolio_reversals TO service_role;

-- 2. Extend portfolio_transactions with reversal capabilities
ALTER TABLE public.portfolio_transactions
    ALTER COLUMN transaction_type TYPE VARCHAR(20);

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS portfolio_transactions_transaction_type_check;

ALTER TABLE public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_transaction_type_check
    CHECK (transaction_type IN ('BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL'));

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS portfolio_transactions_realized_pnl_semantics_check;

ALTER TABLE public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_realized_pnl_semantics_check CHECK (
        (transaction_type IN ('BUY', 'BUY_REVERSAL') AND realized_pnl IS NULL)
        OR (transaction_type IN ('SELL', 'SELL_REVERSAL') AND realized_pnl IS NOT NULL)
    );

ALTER TABLE public.portfolio_transactions
    ADD COLUMN IF NOT EXISTS reversal_of_id UUID NULL REFERENCES public.portfolio_transactions(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_reversal_of
    ON public.portfolio_transactions (reversal_of_id)
    WHERE reversal_of_id IS NOT NULL;

-- 3. Extend cash_ledger_entries with reversal capabilities
ALTER TABLE public.cash_ledger_entries
    DROP CONSTRAINT IF EXISTS cash_ledger_entries_entry_type_check;

ALTER TABLE public.cash_ledger_entries
    ADD CONSTRAINT cash_ledger_entries_entry_type_check
    CHECK (entry_type IN ('OPENING_BALANCE', 'DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL'));

ALTER TABLE public.cash_ledger_entries
    DROP CONSTRAINT IF EXISTS cash_ledger_transaction_link_semantics_check;

ALTER TABLE public.cash_ledger_entries
    ADD CONSTRAINT cash_ledger_transaction_link_semantics_check CHECK (
        (entry_type IN ('BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL') AND portfolio_transaction_id IS NOT NULL)
        OR
        (entry_type IN ('OPENING_BALANCE', 'DEPOSIT', 'WITHDRAWAL') AND portfolio_transaction_id IS NULL)
    );

ALTER TABLE public.cash_ledger_entries
    ADD COLUMN IF NOT EXISTS reversal_of_id UUID NULL REFERENCES public.cash_ledger_entries(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_reversal_of
    ON public.cash_ledger_entries (reversal_of_id)
    WHERE reversal_of_id IS NOT NULL;

-- 3b. Update trigger align_trade_cash_economic_time to support BUY_REVERSAL and SELL_REVERSAL
CREATE OR REPLACE FUNCTION public.align_trade_cash_economic_time()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_transaction public.portfolio_transactions%ROWTYPE;
BEGIN
    IF NEW.entry_type IN ('BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL') THEN
        IF NEW.portfolio_transaction_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement requires a linked portfolio transaction';
        END IF;
        SELECT * INTO v_transaction
        FROM public.portfolio_transactions
        WHERE id = NEW.portfolio_transaction_id AND profile_id = NEW.profile_id;
        IF v_transaction.id IS NULL
            OR v_transaction.transaction_type IS DISTINCT FROM NEW.entry_type
            OR v_transaction.settlement_mode IS DISTINCT FROM 'INTERNAL_VND_CASH' THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement conflicts with its linked portfolio transaction';
        END IF;
        NEW.effective_at := v_transaction.executed_at;
        NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
            'economicTimeAuthority', 'portfolio_transaction.executed_at'
        );
    ELSIF NEW.portfolio_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'only BUY or SELL cash movements may link a portfolio transaction';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_align_trade_cash_economic_time ON public.cash_ledger_entries;
CREATE TRIGGER trg_align_trade_cash_economic_time
    BEFORE INSERT ON public.cash_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.align_trade_cash_economic_time();

REVOKE ALL ON FUNCTION public.align_trade_cash_economic_time() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.align_trade_cash_economic_time() TO service_role;

-- 4. Extend portfolio_idempotency_records with reversal operation types
ALTER TABLE public.portfolio_idempotency_records
    DROP CONSTRAINT IF EXISTS portfolio_idempotency_records_operation_type_check;

ALTER TABLE public.portfolio_idempotency_records
    ADD CONSTRAINT portfolio_idempotency_records_operation_type_check
    CHECK (operation_type IN ('TRANSACTION', 'CASH_MOVEMENT', 'OPENING_POSITION', 'TRANSACTION_REVERSAL', 'CASH_REVERSAL', 'OPENING_POSITION_REVERSAL'));

-- 5. Update calculate_cash_ledger_balance to handle BUY_REVERSAL and SELL_REVERSAL
CREATE OR REPLACE FUNCTION public.calculate_cash_ledger_balance(p_profile_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        activation.opening_balance_amount
        + COALESCE(SUM(
            CASE entries.entry_type
                WHEN 'DEPOSIT' THEN entries.amount
                WHEN 'WITHDRAWAL' THEN -entries.amount
                WHEN 'BUY' THEN -entries.amount
                WHEN 'SELL' THEN entries.amount
                WHEN 'BUY_REVERSAL' THEN entries.amount
                WHEN 'SELL_REVERSAL' THEN -entries.amount
                ELSE 0
            END
        ), 0)
    FROM public.cash_ledger_activation AS activation
    LEFT JOIN public.cash_ledger_entries AS entries
      ON entries.profile_id = activation.profile_id
    WHERE activation.profile_id = p_profile_id
    GROUP BY activation.profile_id, activation.opening_balance_amount;
$$;

-- 6. Update get_cash_overview to net BUY_REVERSAL and SELL_REVERSAL
CREATE OR REPLACE FUNCTION public.get_cash_overview(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_activation public.cash_ledger_activation%ROWTYPE;
    v_total_deposits NUMERIC := 0;
    v_total_withdrawals NUMERIC := 0;
    v_buy_outflows NUMERIC := 0;
    v_sell_inflows NUMERIC := 0;
    v_entry_count INTEGER := 0;
    v_current_cash NUMERIC;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT activation.*
    INTO v_activation
    FROM public.cash_ledger_activation AS activation
    WHERE activation.profile_id = v_profile.id;

    IF v_activation.profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;

    SELECT
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'DEPOSIT'), 0),
        COALESCE(SUM(entries.amount) FILTER (WHERE entries.entry_type = 'WITHDRAWAL'), 0),
        COALESCE(SUM(CASE WHEN entries.entry_type = 'BUY' THEN entries.amount WHEN entries.entry_type = 'BUY_REVERSAL' THEN -entries.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN entries.entry_type = 'SELL' THEN entries.amount WHEN entries.entry_type = 'SELL_REVERSAL' THEN -entries.amount ELSE 0 END), 0),
        COUNT(*)
    INTO
        v_total_deposits,
        v_total_withdrawals,
        v_buy_outflows,
        v_sell_inflows,
        v_entry_count
    FROM public.cash_ledger_entries AS entries
    WHERE entries.profile_id = v_profile.id;

    v_current_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_current_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    RETURN jsonb_build_object(
        'current_cash', v_current_cash,
        'opening_balance', v_activation.opening_balance_amount,
        'total_deposits', v_total_deposits,
        'total_withdrawals', v_total_withdrawals,
        'buy_outflows', v_buy_outflows,
        'sell_inflows', v_sell_inflows,
        'entry_count', v_entry_count,
        'ledger_start_at', v_activation.activated_at
    );
END;
$$;

-- 7. Update list_portfolio_transactions to expose reversal metadata
DROP FUNCTION IF EXISTS public.list_portfolio_transactions(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(
    p_profile_id UUID,
    p_symbol TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    asset_id UUID,
    transaction_type TEXT,
    quantity NUMERIC,
    price NUMERIC,
    realized_pnl NUMERIC,
    execution_unit_price NUMERIC,
    price_currency TEXT,
    settlement_mode TEXT,
    settlement_currency TEXT,
    fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT,
    fx_observed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    symbol TEXT,
    asset_name TEXT,
    asset_type TEXT,
    reversal_of_id UUID,
    is_reversal BOOLEAN,
    is_reversed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.profile_id,
        t.asset_id,
        t.transaction_type::TEXT,
        t.quantity,
        t.price,
        t.realized_pnl,
        t.execution_unit_price,
        t.price_currency::TEXT,
        t.settlement_mode::TEXT,
        t.settlement_currency::TEXT,
        t.fx_rate_to_vnd,
        t.fx_provenance::TEXT,
        t.fx_observed_at,
        t.executed_at,
        t.created_at,
        a.symbol::TEXT,
        a.name::TEXT,
        a.asset_type::TEXT,
        t.reversal_of_id,
        t.is_reversal,
        (rev.id IS NOT NULL) AS is_reversed
    FROM public.portfolio_transactions AS t
    INNER JOIN public.assets AS a ON a.id = t.asset_id
    LEFT JOIN public.portfolio_reversals AS rev
      ON rev.profile_id = t.profile_id
     AND rev.original_event_id = t.id
     AND rev.original_event_type IN ('BUY', 'SELL')
    WHERE t.profile_id = p_profile_id
      AND (
          p_symbol IS NULL
          OR BTRIM(p_symbol) = ''
          OR a.symbol = UPPER(BTRIM(p_symbol))
      )
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
END;
$$;

-- 8. Update list_cash_ledger_entries to expose reversal metadata
DROP FUNCTION IF EXISTS public.list_cash_ledger_entries(UUID);

CREATE OR REPLACE FUNCTION public.list_cash_ledger_entries(p_profile_id UUID)
RETURNS TABLE (
    id UUID,
    profile_id UUID,
    entry_type TEXT,
    amount NUMERIC,
    portfolio_transaction_id UUID,
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    metadata JSONB,
    symbol TEXT,
    transaction_executed_at TIMESTAMPTZ,
    reversal_of_id UUID,
    is_reversal BOOLEAN,
    is_reversed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    RETURN QUERY
    SELECT
        entries.id,
        entries.profile_id,
        entries.entry_type::TEXT,
        entries.amount,
        entries.portfolio_transaction_id,
        entries.effective_at,
        entries.created_at,
        entries.metadata,
        assets.symbol::TEXT,
        transactions.executed_at AS transaction_executed_at,
        entries.reversal_of_id,
        entries.is_reversal,
        (rev.id IS NOT NULL) AS is_reversed
    FROM public.cash_ledger_entries AS entries
    LEFT JOIN public.portfolio_transactions AS transactions
      ON transactions.id = entries.portfolio_transaction_id
    LEFT JOIN public.assets AS assets
      ON assets.id = transactions.asset_id
    LEFT JOIN public.portfolio_reversals AS rev
      ON rev.profile_id = entries.profile_id
     AND rev.original_event_id = entries.id
     AND rev.original_event_type IN ('DEPOSIT', 'WITHDRAWAL')
    WHERE entries.profile_id = p_profile_id
    ORDER BY entries.effective_at DESC, entries.created_at DESC, entries.id DESC;
END;
$$;

-- 9. RPC: reverse_portfolio_transaction
CREATE OR REPLACE FUNCTION public.reverse_portfolio_transaction(
    p_profile_id UUID,
    p_transaction_id UUID,
    p_reason TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_orig_tx public.portfolio_transactions%ROWTYPE;
    v_orig_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_existing_holding public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_reversal_tx public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_reversal_audit public.portfolio_reversals%ROWTYPE;
    v_idempotency_record public.portfolio_idempotency_records%ROWTYPE;
    v_idempotency_key TEXT := NULL;
    v_request_hash TEXT := NULL;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_cash_amount NUMERIC;
    v_new_quantity NUMERIC;
    v_new_average_cost NUMERIC;
    v_pre_sell_avg_cost NUMERIC;
    v_reversal_tx_type VARCHAR(20);
    v_reversal_realized_pnl NUMERIC;
    v_holding_removed BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    -- Input validation
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_transaction_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transaction ID is required';
    END IF;
    IF p_reason IS NULL OR BTRIM(p_reason) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'RC004', MESSAGE = 'reversal reason is required';
    END IF;

    -- Idempotency pre-check
    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_idempotency_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_idempotency_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key));

        v_request_hash := md5(concat_ws(':',
            'TRANSACTION_REVERSAL',
            p_transaction_id::TEXT,
            BTRIM(p_reason)
        ));

        SELECT * INTO v_idempotency_record
        FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_idempotency_key;

        IF FOUND THEN
            IF v_idempotency_record.operation_type <> 'TRANSACTION_REVERSAL' OR v_idempotency_record.request_hash <> v_request_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency_record.response_payload || jsonb_build_object('replayed', true);
        END IF;
    END IF;

    -- Profile lock
    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable';
    END IF;

    -- Cash balance validation
    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    -- Fetch original transaction
    SELECT * INTO v_orig_tx
    FROM public.portfolio_transactions
    WHERE id = p_transaction_id;

    IF v_orig_tx.id IS NULL OR v_orig_tx.profile_id <> v_profile.id THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'transaction not found';
    END IF;

    IF v_orig_tx.is_reversal THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'cannot reverse a reversal transaction';
    END IF;

    IF v_orig_tx.transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'only BUY and SELL transactions can be reversed';
    END IF;

    -- Asset lock
    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_orig_tx.asset_id::TEXT));

    SELECT * INTO v_asset
    FROM public.assets
    WHERE id = v_orig_tx.asset_id;

    -- Double-reversal check
    IF EXISTS (
        SELECT 1
        FROM public.portfolio_reversals
        WHERE profile_id = v_profile.id
          AND original_event_type IN ('BUY', 'SELL')
          AND original_event_id = v_orig_tx.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'transaction has already been reversed';
    END IF;

    -- Fail-closed later-dependent transaction safeguard
    IF EXISTS (
        SELECT 1
        FROM public.portfolio_transactions AS t
        WHERE t.profile_id = v_profile.id
          AND t.asset_id = v_orig_tx.asset_id
          AND (
              t.executed_at > v_orig_tx.executed_at
              OR (t.executed_at = v_orig_tx.executed_at AND (t.created_at > v_orig_tx.created_at OR t.id > v_orig_tx.id))
          )
          AND t.id <> v_orig_tx.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'RC002', MESSAGE = 'cannot reverse transaction when subsequent transactions depend on it';
    END IF;

    -- Holding inspection
    SELECT * INTO v_existing_holding
    FROM public.holdings
    WHERE profile_id = v_profile.id
      AND asset_id = v_orig_tx.asset_id
    FOR UPDATE;

    -- Fetch linked original cash entry if internal VND settlement
    IF v_orig_tx.settlement_mode = 'INTERNAL_VND_CASH' THEN
        SELECT * INTO v_orig_cash_entry
        FROM public.cash_ledger_entries
        WHERE portfolio_transaction_id = v_orig_tx.id
          AND profile_id = v_profile.id;
    END IF;

    -- Execute reversal based on transaction type
    IF v_orig_tx.transaction_type = 'BUY' THEN
        v_reversal_tx_type := 'BUY_REVERSAL';
        v_reversal_realized_pnl := NULL;

        IF v_existing_holding.id IS NULL OR v_existing_holding.quantity < v_orig_tx.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'RC002', MESSAGE = 'cannot reverse BUY when current holding quantity is less than bought quantity';
        END IF;

        v_new_quantity := v_existing_holding.quantity - v_orig_tx.quantity;

        IF v_new_quantity = 0 THEN
            v_holding_removed := TRUE;
            v_new_average_cost := NULL;
            DELETE FROM public.holdings
            WHERE id = v_existing_holding.id
              AND profile_id = v_profile.id;
        ELSE
            -- Check if position matches opening baseline
            SELECT * INTO v_baseline
            FROM public.position_opening_baselines
            WHERE profile_id = v_profile.id
              AND asset_id = v_orig_tx.asset_id
              AND cancelled_at IS NULL;

            IF v_baseline.id IS NOT NULL AND v_new_quantity = v_baseline.opening_quantity THEN
                v_new_average_cost := v_baseline.opening_average_cost;
            ELSE
                IF v_existing_holding.average_cost IS NULL THEN
                    v_new_average_cost := NULL;
                ELSE
                    v_new_average_cost := (
                        (v_existing_holding.quantity * v_existing_holding.average_cost) - (v_orig_tx.quantity * v_orig_tx.price)
                    ) / v_new_quantity;
                END IF;
            END IF;

            UPDATE public.holdings
            SET quantity = v_new_quantity,
                average_cost = v_new_average_cost,
                updated_at = v_accounted_at
            WHERE id = v_existing_holding.id
              AND profile_id = v_profile.id
            RETURNING * INTO v_result_holding;
        END IF;

        -- Cash refund
        IF v_orig_tx.settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_cash_amount := v_orig_tx.quantity * v_orig_tx.price;
            v_new_cash := v_ledger_cash + v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;

    ELSE -- SELL reversal
        v_reversal_tx_type := 'SELL_REVERSAL';
        v_reversal_realized_pnl := -v_orig_tx.realized_pnl;

        -- Overdraft check: reversing SELL debits proceeds from cash
        IF v_orig_tx.settlement_mode = 'INTERNAL_VND_CASH' THEN
            v_cash_amount := v_orig_tx.quantity * v_orig_tx.price;
            IF v_cash_amount > v_ledger_cash THEN
                RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'reversal cash debit exceeds available cash';
            END IF;
            v_new_cash := v_ledger_cash - v_cash_amount;
        ELSE
            v_new_cash := v_ledger_cash;
        END IF;

        -- Reconstruct pre-sale average cost
        IF v_orig_tx.realized_pnl IS NOT NULL AND v_orig_tx.quantity > 0 THEN
            v_pre_sell_avg_cost := v_orig_tx.price - (v_orig_tx.realized_pnl / v_orig_tx.quantity);
        ELSE
            v_pre_sell_avg_cost := NULL;
        END IF;

        IF v_existing_holding.id IS NOT NULL THEN
            v_new_quantity := v_existing_holding.quantity + v_orig_tx.quantity;
            v_new_average_cost := v_existing_holding.average_cost;

            UPDATE public.holdings
            SET quantity = v_new_quantity,
                average_cost = v_new_average_cost,
                updated_at = v_accounted_at
            WHERE id = v_existing_holding.id
              AND profile_id = v_profile.id
            RETURNING * INTO v_result_holding;
        ELSE
            v_new_quantity := v_orig_tx.quantity;
            v_new_average_cost := v_pre_sell_avg_cost;

            INSERT INTO public.holdings (
                profile_id, asset_id, quantity, average_cost, created_at, updated_at
            )
            VALUES (
                v_profile.id, v_orig_tx.asset_id, v_new_quantity, v_new_average_cost,
                v_accounted_at, v_accounted_at
            )
            RETURNING * INTO v_result_holding;
        END IF;
    END IF;

    -- Insert compensating reversal transaction row
    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl,
        executed_at, created_at, execution_unit_price, price_currency,
        settlement_mode, settlement_currency, fx_rate_to_vnd, fx_provenance,
        fx_observed_at, reversal_of_id, is_reversal
    )
    VALUES (
        v_profile.id, v_orig_tx.asset_id, v_reversal_tx_type, v_orig_tx.quantity, v_orig_tx.price,
        v_reversal_realized_pnl, v_accounted_at, v_accounted_at, v_orig_tx.execution_unit_price,
        v_orig_tx.price_currency, v_orig_tx.settlement_mode, v_orig_tx.settlement_currency,
        v_orig_tx.fx_rate_to_vnd, v_orig_tx.fx_provenance, v_orig_tx.fx_observed_at,
        v_orig_tx.id, TRUE
    )
    RETURNING * INTO v_reversal_tx;

    -- Insert compensating cash ledger entry if internal settlement
    IF v_orig_tx.settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            reversal_of_id, is_reversal, effective_at, created_at, metadata
        )
        VALUES (
            v_profile.id, v_reversal_tx_type, v_cash_amount, v_reversal_tx.id,
            v_orig_cash_entry.id, TRUE, v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'reversalReason', BTRIM(p_reason),
                'isReversal', TRUE,
                'reversalOfTransactionId', v_orig_tx.id
            )
        )
        RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash,
            updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    -- Insert reversal audit record
    INSERT INTO public.portfolio_reversals (
        profile_id, original_event_type, original_event_id,
        reversal_transaction_id, reversal_cash_entry_id, reason,
        idempotency_key, effective_at, created_at, metadata
    )
    VALUES (
        v_profile.id, v_orig_tx.transaction_type, v_orig_tx.id,
        v_reversal_tx.id, v_cash_entry.id, BTRIM(p_reason),
        v_idempotency_key, v_accounted_at, v_accounted_at,
        jsonb_build_object(
            'originalQuantity', v_orig_tx.quantity,
            'originalPrice', v_orig_tx.price,
            'symbol', v_asset.symbol
        )
    )
    RETURNING * INTO v_reversal_audit;

    -- Build result payload
    v_result := jsonb_build_object(
        'reversal', jsonb_build_object(
            'id', v_reversal_audit.id,
            'profileId', v_reversal_audit.profile_id,
            'originalEventType', v_reversal_audit.original_event_type,
            'originalEventId', v_reversal_audit.original_event_id,
            'reason', v_reversal_audit.reason,
            'effectiveAt', v_reversal_audit.effective_at,
            'createdAt', v_reversal_audit.created_at
        ),
        'reversalTransaction', jsonb_build_object(
            'id', v_reversal_tx.id,
            'profile_id', v_reversal_tx.profile_id,
            'asset_id', v_reversal_tx.asset_id,
            'transaction_type', v_reversal_tx.transaction_type,
            'quantity', v_reversal_tx.quantity,
            'price', v_reversal_tx.price,
            'realized_pnl', v_reversal_tx.realized_pnl,
            'execution_unit_price', v_reversal_tx.execution_unit_price,
            'price_currency', v_reversal_tx.price_currency,
            'settlement_mode', v_reversal_tx.settlement_mode,
            'settlement_currency', v_reversal_tx.settlement_currency,
            'fx_rate_to_vnd', v_reversal_tx.fx_rate_to_vnd,
            'fx_provenance', v_reversal_tx.fx_provenance,
            'fx_observed_at', v_reversal_tx.fx_observed_at,
            'executed_at', v_reversal_tx.executed_at,
            'created_at', v_reversal_tx.created_at,
            'reversal_of_id', v_reversal_tx.reversal_of_id,
            'is_reversal', v_reversal_tx.is_reversal,
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol,
                'name', v_asset.name,
                'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE
            WHEN v_holding_removed THEN NULL
            ELSE jsonb_build_object(
                'id', v_result_holding.id,
                'profile_id', v_result_holding.profile_id,
                'asset_id', v_result_holding.asset_id,
                'quantity', v_result_holding.quantity,
                'average_cost', v_result_holding.average_cost,
                'created_at', v_result_holding.created_at,
                'updated_at', v_result_holding.updated_at
            )
        END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE
            WHEN v_orig_tx.settlement_mode = 'INTERNAL_VND_CASH' THEN jsonb_build_object(
                'id', v_cash_entry.id,
                'profile_id', v_cash_entry.profile_id,
                'entry_type', v_cash_entry.entry_type,
                'amount', v_cash_entry.amount,
                'portfolio_transaction_id', v_cash_entry.portfolio_transaction_id,
                'reversal_of_id', v_cash_entry.reversal_of_id,
                'is_reversal', v_cash_entry.is_reversal,
                'effective_at', v_cash_entry.effective_at,
                'created_at', v_cash_entry.created_at,
                'metadata', v_cash_entry.metadata,
                'symbol', v_asset.symbol
            )
            ELSE NULL
        END,
        'currentCash', v_new_cash
    );

    -- Store idempotency record if requested
    IF v_idempotency_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id, idempotency_key, operation_type,
            request_hash, response_payload, resource_id, created_at
        ) VALUES (
            p_profile_id, v_idempotency_key, 'TRANSACTION_REVERSAL',
            v_request_hash, v_result, v_reversal_audit.id, v_accounted_at
        );
    END IF;

    RETURN v_result || jsonb_build_object('replayed', false);
END;
$$;

-- 10. RPC: reverse_cash_movement
CREATE OR REPLACE FUNCTION public.reverse_cash_movement(
    p_profile_id UUID,
    p_cash_entry_id UUID,
    p_reason TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_orig_entry public.cash_ledger_entries%ROWTYPE;
    v_reversal_entry public.cash_ledger_entries%ROWTYPE;
    v_reversal_audit public.portfolio_reversals%ROWTYPE;
    v_idempotency_record public.portfolio_idempotency_records%ROWTYPE;
    v_idempotency_key TEXT := NULL;
    v_request_hash TEXT := NULL;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_compensating_type VARCHAR(20);
    v_result JSONB;
BEGIN
    -- Input validation
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_cash_entry_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'cash entry ID is required';
    END IF;
    IF p_reason IS NULL OR BTRIM(p_reason) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'RC004', MESSAGE = 'reversal reason is required';
    END IF;

    -- Idempotency pre-check
    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_idempotency_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_idempotency_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key));

        v_request_hash := md5(concat_ws(':',
            'CASH_REVERSAL',
            p_cash_entry_id::TEXT,
            BTRIM(p_reason)
        ));

        SELECT * INTO v_idempotency_record
        FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_idempotency_key;

        IF FOUND THEN
            IF v_idempotency_record.operation_type <> 'CASH_REVERSAL' OR v_idempotency_record.request_hash <> v_request_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency_record.response_payload || jsonb_build_object('replayed', true);
        END IF;
    END IF;

    -- Profile lock
    SELECT profiles.*
    INTO v_profile
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'investor profile is unavailable';
    END IF;

    -- Cash balance validation
    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated';
    END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN
        RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated';
    END IF;

    -- Fetch original cash entry
    SELECT * INTO v_orig_entry
    FROM public.cash_ledger_entries
    WHERE id = p_cash_entry_id;

    IF v_orig_entry.id IS NULL OR v_orig_entry.profile_id <> v_profile.id THEN
        RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'cash entry not found';
    END IF;

    IF v_orig_entry.is_reversal THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'cannot reverse a reversal entry';
    END IF;

    IF v_orig_entry.portfolio_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'RC003', MESSAGE = 'cannot reverse trade-linked cash entry directly; reverse the portfolio transaction instead';
    END IF;

    IF v_orig_entry.entry_type NOT IN ('DEPOSIT', 'WITHDRAWAL') THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'only DEPOSIT and WITHDRAWAL cash movements can be reversed';
    END IF;

    -- Double-reversal check
    IF EXISTS (
        SELECT 1
        FROM public.portfolio_reversals
        WHERE profile_id = v_profile.id
          AND original_event_type IN ('DEPOSIT', 'WITHDRAWAL')
          AND original_event_id = v_orig_entry.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'cash entry has already been reversed';
    END IF;

    -- Compute compensating entry
    IF v_orig_entry.entry_type = 'DEPOSIT' THEN
        -- Overdraft check: reversing deposit debits cash
        IF v_orig_entry.amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'withdrawal amount exceeds current cash';
        END IF;
        v_compensating_type := 'WITHDRAWAL';
        v_new_cash := v_ledger_cash - v_orig_entry.amount;
    ELSE -- WITHDRAWAL
        v_compensating_type := 'DEPOSIT';
        v_new_cash := v_ledger_cash + v_orig_entry.amount;
    END IF;

    -- Insert compensating cash entry
    INSERT INTO public.cash_ledger_entries (
        profile_id, entry_type, amount, reversal_of_id, is_reversal,
        effective_at, created_at, metadata
    )
    VALUES (
        v_profile.id, v_compensating_type, v_orig_entry.amount, v_orig_entry.id, TRUE,
        v_accounted_at, v_accounted_at,
        jsonb_build_object(
            'reversalReason', BTRIM(p_reason),
            'isReversal', TRUE,
            'reversalOfEntryId', v_orig_entry.id
        )
    )
    RETURNING * INTO v_reversal_entry;

    UPDATE public.investor_profile
    SET cash_available = v_new_cash,
        updated_at = v_accounted_at
    WHERE id = v_profile.id;

    -- Insert reversal audit record
    INSERT INTO public.portfolio_reversals (
        profile_id, original_event_type, original_event_id,
        reversal_cash_entry_id, reason, idempotency_key,
        effective_at, created_at, metadata
    )
    VALUES (
        v_profile.id, v_orig_entry.entry_type, v_orig_entry.id,
        v_reversal_entry.id, BTRIM(p_reason), v_idempotency_key,
        v_accounted_at, v_accounted_at,
        jsonb_build_object(
            'originalAmount', v_orig_entry.amount,
            'compensatingType', v_compensating_type
        )
    )
    RETURNING * INTO v_reversal_audit;

    -- Build result payload
    v_result := jsonb_build_object(
        'reversal', jsonb_build_object(
            'id', v_reversal_audit.id,
            'profileId', v_reversal_audit.profile_id,
            'originalEventType', v_reversal_audit.original_event_type,
            'originalEventId', v_reversal_audit.original_event_id,
            'reason', v_reversal_audit.reason,
            'effectiveAt', v_reversal_audit.effective_at,
            'createdAt', v_reversal_audit.created_at
        ),
        'reversalCashEntry', jsonb_build_object(
            'id', v_reversal_entry.id,
            'profile_id', v_reversal_entry.profile_id,
            'entry_type', v_reversal_entry.entry_type,
            'amount', v_reversal_entry.amount,
            'reversal_of_id', v_reversal_entry.reversal_of_id,
            'is_reversal', v_reversal_entry.is_reversal,
            'effective_at', v_reversal_entry.effective_at,
            'created_at', v_reversal_entry.created_at,
            'metadata', v_reversal_entry.metadata
        ),
        'currentCash', v_new_cash
    );

    -- Store idempotency record if requested
    IF v_idempotency_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id, idempotency_key, operation_type,
            request_hash, response_payload, resource_id, created_at
        ) VALUES (
            p_profile_id, v_idempotency_key, 'CASH_REVERSAL',
            v_request_hash, v_result, v_reversal_audit.id, v_accounted_at
        );
    END IF;

    RETURN v_result || jsonb_build_object('replayed', false);
END;
$$;

-- 11. Grant permissions to service_role
REVOKE ALL ON FUNCTION public.reverse_portfolio_transaction(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_portfolio_transaction(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_cash_movement(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_cash_movement(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.list_cash_ledger_entries(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries(UUID) TO service_role;

COMMIT;
