-- Feature 14: immutable BUY/SELL transaction ledger with atomic holdings updates.
-- Existing holdings are preserved as valid opening positions; no historical
-- transactions are fabricated for positions that predate this ledger.

-- Holdings must retain the full precision produced by weighted-average cost.
ALTER TABLE public.holdings
    ALTER COLUMN quantity TYPE NUMERIC USING quantity::NUMERIC,
    ALTER COLUMN average_cost TYPE NUMERIC USING average_cost::NUMERIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'holdings_quantity_finite_positive_check'
    ) THEN
        ALTER TABLE public.holdings
            ADD CONSTRAINT holdings_quantity_finite_positive_check
            CHECK (quantity > 0 AND quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'holdings_average_cost_finite_nonnegative_check'
    ) THEN
        ALTER TABLE public.holdings
            ADD CONSTRAINT holdings_average_cost_finite_nonnegative_check
            CHECK (average_cost >= 0 AND average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'));
    END IF;
END $$;

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

-- No INSERT/UPDATE/DELETE policies are created. Writes are intentionally
-- restricted to the atomic SECURITY DEFINER function below.

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
        SELECT a.*
        INTO v_asset
        FROM public.assets AS a
        WHERE a.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT a.*
        INTO v_asset
        FROM public.assets AS a
        WHERE a.symbol = UPPER(BTRIM(p_symbol));
    END IF;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    -- Serialize all transactions for the same singleton profile and asset.
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
        profile_id,
        asset_id,
        transaction_type,
        quantity,
        price,
        realized_pnl,
        executed_at
    )
    VALUES (
        v_profile_id,
        v_asset.id,
        p_transaction_type,
        p_quantity,
        p_price,
        v_realized_pnl,
        COALESCE(p_executed_at, NOW())
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

COMMENT ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ) IS
    'Atomically inserts an immutable BUY/SELL ledger row and mutates the singleton profile holding using weighted-average cost.';

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
