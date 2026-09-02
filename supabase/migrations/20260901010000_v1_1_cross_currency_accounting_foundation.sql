-- Feature 19 / V1.1 Improvement 07C: Cross-Currency Accounting Foundation
-- Reporting / accounting currency remains strictly VND.
-- Dual settlement model: INTERNAL_VND_CASH vs EXTERNAL_SETTLEMENT.
-- No foreign cash accounts, no fake historical FX fabrication, no USDT=USD assumption.

BEGIN;

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

COMMIT;
