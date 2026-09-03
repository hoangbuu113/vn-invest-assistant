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
