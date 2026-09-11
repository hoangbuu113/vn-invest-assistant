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
            IF v_idempotency_record.request_hash <> v_request_hash THEN
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
            IF v_idempotency_record.request_hash <> v_request_hash THEN
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
            IF v_idempotency_record.request_hash <> v_request_hash THEN
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
