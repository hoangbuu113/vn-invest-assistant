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
