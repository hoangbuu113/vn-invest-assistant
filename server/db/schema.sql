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
