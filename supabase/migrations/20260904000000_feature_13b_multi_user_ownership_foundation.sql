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
