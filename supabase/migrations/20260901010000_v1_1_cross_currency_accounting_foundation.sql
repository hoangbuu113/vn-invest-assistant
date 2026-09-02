-- V1.1 Improvement 07C: cross-currency accounting foundation.
-- Accounting and reporting remain VND. Foreign execution metadata never creates
-- a foreign cash balance, and USDT is never treated as USD.

BEGIN;

ALTER TABLE public.portfolio_transactions
    ADD COLUMN IF NOT EXISTS execution_unit_price NUMERIC,
    ADD COLUMN IF NOT EXISTS price_currency VARCHAR(12) NOT NULL DEFAULT 'VND',
    ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(32) NOT NULL DEFAULT 'INTERNAL_VND_CASH',
    ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(12),
    ADD COLUMN IF NOT EXISTS fx_rate_to_vnd NUMERIC,
    ADD COLUMN IF NOT EXISTS fx_provenance JSONB,
    ADD COLUMN IF NOT EXISTS fx_observed_at TIMESTAMPTZ;

UPDATE public.portfolio_transactions
SET execution_unit_price = price,
    price_currency = 'VND',
    settlement_mode = 'INTERNAL_VND_CASH',
    settlement_currency = 'VND',
    fx_rate_to_vnd = NULL,
    fx_provenance = NULL,
    fx_observed_at = NULL
WHERE execution_unit_price IS NULL;

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS portfolio_transactions_execution_unit_price_check,
    ADD CONSTRAINT portfolio_transactions_execution_unit_price_check CHECK (
        execution_unit_price IS NULL OR (
            execution_unit_price > 0
            AND execution_unit_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_price_currency_check,
    ADD CONSTRAINT portfolio_transactions_price_currency_check CHECK (
        price_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_settlement_mode_check,
    ADD CONSTRAINT portfolio_transactions_settlement_mode_check CHECK (
        settlement_mode IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT')
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_settlement_currency_check,
    ADD CONSTRAINT portfolio_transactions_settlement_currency_check CHECK (
        settlement_currency IS NULL
        OR settlement_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_internal_cash_currency_check,
    ADD CONSTRAINT portfolio_transactions_internal_cash_currency_check CHECK (
        settlement_mode <> 'INTERNAL_VND_CASH' OR settlement_currency = 'VND'
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_fx_rate_check,
    ADD CONSTRAINT portfolio_transactions_fx_rate_check CHECK (
        fx_rate_to_vnd IS NULL OR (
            fx_rate_to_vnd > 0
            AND fx_rate_to_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )
    ),
    DROP CONSTRAINT IF EXISTS portfolio_transactions_fx_provenance_check,
    ADD CONSTRAINT portfolio_transactions_fx_provenance_check CHECK (
        fx_provenance IS NULL OR JSONB_TYPEOF(fx_provenance) = 'object'
    );

COMMENT ON COLUMN public.portfolio_transactions.price IS
    'Authoritative effective VND unit price used by holdings, cash, realized P/L, and performance flows.';
COMMENT ON COLUMN public.portfolio_transactions.execution_unit_price IS
    'Optional original execution quote; never an accounting value without explicit FX provenance.';
COMMENT ON COLUMN public.portfolio_transactions.settlement_mode IS
    'INTERNAL_VND_CASH mutates VND cash; EXTERNAL_SETTLEMENT leaves VND cash unchanged.';
COMMENT ON COLUMN public.portfolio_transactions.fx_provenance IS
    'Structured immutable conversion provenance required for non-VND execution prices.';

ALTER TABLE public.position_opening_baselines
    ADD COLUMN IF NOT EXISTS execution_unit_price NUMERIC,
    ADD COLUMN IF NOT EXISTS price_currency VARCHAR(12) NOT NULL DEFAULT 'VND',
    ADD COLUMN IF NOT EXISTS fx_rate_to_vnd NUMERIC,
    ADD COLUMN IF NOT EXISTS fx_provenance JSONB,
    ADD COLUMN IF NOT EXISTS fx_observed_at TIMESTAMPTZ;

UPDATE public.position_opening_baselines
SET execution_unit_price = opening_average_cost,
    price_currency = 'VND',
    fx_rate_to_vnd = NULL,
    fx_provenance = NULL,
    fx_observed_at = NULL
WHERE execution_unit_price IS NULL;

ALTER TABLE public.position_opening_baselines
    DROP CONSTRAINT IF EXISTS position_opening_execution_unit_price_check,
    ADD CONSTRAINT position_opening_execution_unit_price_check CHECK (
        execution_unit_price IS NULL OR (
            execution_unit_price >= 0
            AND execution_unit_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )
    ),
    DROP CONSTRAINT IF EXISTS position_opening_price_currency_check,
    ADD CONSTRAINT position_opening_price_currency_check CHECK (
        price_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
    ),
    DROP CONSTRAINT IF EXISTS position_opening_fx_rate_check,
    ADD CONSTRAINT position_opening_fx_rate_check CHECK (
        fx_rate_to_vnd IS NULL OR (
            fx_rate_to_vnd > 0
            AND fx_rate_to_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )
    ),
    DROP CONSTRAINT IF EXISTS position_opening_fx_provenance_check,
    ADD CONSTRAINT position_opening_fx_provenance_check CHECK (
        fx_provenance IS NULL OR JSONB_TYPEOF(fx_provenance) = 'object'
    );

COMMENT ON COLUMN public.position_opening_baselines.opening_average_cost IS
    'Authoritative VND unit cost for the cash-neutral opening position.';

DROP TRIGGER IF EXISTS enforce_vnd_portfolio_transaction_asset
    ON public.portfolio_transactions;
DROP TRIGGER IF EXISTS enforce_portfolio_transaction_accounting_contract
    ON public.portfolio_transactions;
DROP FUNCTION IF EXISTS public.enforce_vnd_portfolio_transaction_asset();

CREATE OR REPLACE FUNCTION public.enforce_portfolio_transaction_accounting_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asset public.assets%ROWTYPE;
    v_method TEXT;
    v_expected_vnd_price NUMERIC;
BEGIN
    SELECT assets.* INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id = NEW.asset_id;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset is inactive';
    END IF;
    IF v_asset.asset_type = 'fx' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'FX context assets are not investment positions';
    END IF;

    NEW.price_currency := UPPER(BTRIM(COALESCE(NEW.price_currency, 'VND')));
    NEW.settlement_mode := UPPER(BTRIM(COALESCE(NEW.settlement_mode, 'INTERNAL_VND_CASH')));
    NEW.settlement_currency := NULLIF(UPPER(BTRIM(NEW.settlement_currency)), '');

    IF NEW.settlement_mode = 'INTERNAL_VND_CASH' THEN
        NEW.settlement_currency := COALESCE(NEW.settlement_currency, 'VND');
        IF NEW.settlement_currency <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH requires VND settlement currency';
        END IF;
    END IF;

    IF v_asset.quote_currency = 'VND' AND NEW.price_currency <> 'VND' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'VND-listed assets require VND execution prices';
    END IF;
    IF v_asset.asset_type = 'gold' AND NEW.price_currency <> 'USD' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'XAU/USD execution prices must be USD';
    END IF;
    IF v_asset.asset_type = 'crypto' AND NEW.price_currency NOT IN ('USD', 'USDT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'Crypto execution prices must be USD or USDT';
    END IF;

    IF NEW.price_currency = 'VND' THEN
        NEW.execution_unit_price := COALESCE(NEW.execution_unit_price, NEW.price);
        IF NEW.execution_unit_price IS DISTINCT FROM NEW.price THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND execution price must equal effective VND price';
        END IF;
        IF NEW.fx_rate_to_vnd IS NOT NULL OR NEW.fx_provenance IS NOT NULL OR NEW.fx_observed_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND execution must not contain FX conversion metadata';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.fx_provenance IS NULL OR JSONB_TYPEOF(NEW.fx_provenance) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'non-VND execution requires structured FX provenance';
    END IF;
    v_method := UPPER(BTRIM(COALESCE(NEW.fx_provenance ->> 'method', '')));

    IF v_method = 'USER_SUPPLIED_VND_BASIS' THEN
        IF NEW.fx_rate_to_vnd IS NOT NULL OR NEW.fx_observed_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'user-supplied VND basis must not claim an FX observation';
        END IF;
        IF NEW.execution_unit_price IS NOT NULL AND NEW.execution_unit_price <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'executionUnitPrice must be greater than 0 when supplied';
        END IF;
        RETURN NEW;
    END IF;

    IF v_method NOT IN ('USER_SUPPLIED_FX_RATE', 'PROVIDER_CONFIRMED_FX_RATE') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'unsupported FX provenance method';
    END IF;
    IF NEW.execution_unit_price IS NULL OR NEW.execution_unit_price <= 0
        OR NEW.fx_rate_to_vnd IS NULL OR NEW.fx_rate_to_vnd <= 0
        OR NEW.fx_observed_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'FX conversion requires execution price, rate, and observation time';
    END IF;
    IF UPPER(BTRIM(COALESCE(NEW.fx_provenance ->> 'baseCurrency', ''))) <> NEW.price_currency
        OR UPPER(BTRIM(COALESCE(NEW.fx_provenance ->> 'quoteCurrency', ''))) <> 'VND' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'FX provenance pair must match price currency to VND';
    END IF;
    IF v_method = 'PROVIDER_CONFIRMED_FX_RATE'
        AND BTRIM(COALESCE(NEW.fx_provenance ->> 'provider', '')) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'provider-confirmed FX rate requires provider provenance';
    END IF;

    v_expected_vnd_price := NEW.execution_unit_price * NEW.fx_rate_to_vnd;
    IF NEW.price IS DISTINCT FROM v_expected_vnd_price THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'effective VND price must equal execution price multiplied by FX rate';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_portfolio_transaction_accounting_contract
    BEFORE INSERT ON public.portfolio_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_portfolio_transaction_accounting_contract();

DROP FUNCTION IF EXISTS public.create_portfolio_transaction(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ
);

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
    p_fx_provenance JSONB DEFAULT NULL,
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
    v_settlement_mode TEXT := UPPER(BTRIM(COALESCE(p_settlement_mode, 'INTERNAL_VND_CASH')));
BEGIN
    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NULL OR p_price <= 0
        OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite VND number greater than 0';
    END IF;
    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'invalid settlement mode';
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

    SELECT profiles.* INTO v_profile
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
        SELECT assets.* INTO v_asset FROM public.assets AS assets
        WHERE assets.id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT assets.* INTO v_asset FROM public.assets AS assets
        WHERE assets.symbol = UPPER(BTRIM(p_symbol));
    END IF;
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));
    UPDATE public.position_opening_baselines
    SET locked_at = v_accounted_at, updated_at = v_accounted_at
    WHERE profile_id = v_profile.id AND asset_id = v_asset.id
      AND locked_at IS NULL AND cancelled_at IS NULL;

    SELECT holdings.* INTO v_existing_holding
    FROM public.holdings AS holdings
    WHERE holdings.profile_id = v_profile.id AND holdings.asset_id = v_asset.id
    FOR UPDATE;
    v_has_holding := FOUND;
    v_cash_amount := p_quantity * p_price;

    IF p_transaction_type = 'BUY' THEN
        IF v_settlement_mode = 'INTERNAL_VND_CASH' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'insufficient current cash for BUY transaction';
        END IF;
        v_new_cash := CASE WHEN v_settlement_mode = 'INTERNAL_VND_CASH'
            THEN v_ledger_cash - v_cash_amount ELSE v_ledger_cash END;
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
        v_new_cash := CASE WHEN v_settlement_mode = 'INTERNAL_VND_CASH'
            THEN v_ledger_cash + v_cash_amount ELSE v_ledger_cash END;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at, executed_at
    ) VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized_pnl,
        p_execution_unit_price, UPPER(BTRIM(COALESCE(p_price_currency, 'VND'))),
        v_settlement_mode, p_settlement_currency,
        p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at,
        COALESCE(p_executed_at, v_accounted_at)
    ) RETURNING * INTO v_transaction;

    IF p_transaction_type = 'BUY' AND v_has_holding THEN
        UPDATE public.holdings
        SET quantity = v_new_quantity, average_cost = v_new_average_cost, updated_at = v_accounted_at
        WHERE id = v_existing_holding.id AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost)
        VALUES (v_profile.id, v_asset.id, v_new_quantity, v_new_average_cost)
        RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings
        WHERE id = v_existing_holding.id AND profile_id = v_profile.id;
    ELSE
        UPDATE public.holdings SET quantity = v_new_quantity, updated_at = v_accounted_at
        WHERE id = v_existing_holding.id AND profile_id = v_profile.id
        RETURNING * INTO v_result_holding;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id,
            effective_at, created_at, metadata
        ) VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_transaction.id,
            v_accounted_at, v_accounted_at,
            jsonb_build_object(
                'accountingSemantics', 'recorded_now_affects_current_vnd_cash',
                'historicalCashReconstruction', FALSE,
                'settlementMode', 'INTERNAL_VND_CASH'
            )
        ) RETURNING * INTO v_cash_entry;

        UPDATE public.investor_profile
        SET cash_available = v_new_cash, updated_at = v_accounted_at
        WHERE id = v_profile.id;
    END IF;

    RETURN jsonb_build_object(
        'transaction', to_jsonb(v_transaction) || jsonb_build_object(
            'asset', jsonb_build_object(
                'symbol', v_asset.symbol, 'name', v_asset.name, 'asset_type', v_asset.asset_type
            )
        ),
        'holding', CASE WHEN v_holding_removed THEN NULL ELSE to_jsonb(v_result_holding) END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE WHEN v_settlement_mode = 'EXTERNAL_SETTLEMENT' THEN NULL
            ELSE to_jsonb(v_cash_entry) || jsonb_build_object('symbol', v_asset.symbol) END,
        'currentCash', v_new_cash
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_portfolio_transactions(TEXT);

CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(p_symbol TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID, profile_id UUID, asset_id UUID, transaction_type TEXT,
    quantity NUMERIC, price NUMERIC, realized_pnl NUMERIC,
    execution_unit_price NUMERIC, price_currency TEXT, settlement_mode TEXT,
    settlement_currency TEXT, fx_rate_to_vnd NUMERIC, fx_provenance JSONB,
    fx_observed_at TIMESTAMPTZ, executed_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
    symbol TEXT, asset_name TEXT, asset_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        transactions.id, transactions.profile_id, transactions.asset_id,
        transactions.transaction_type::TEXT, transactions.quantity, transactions.price,
        transactions.realized_pnl, transactions.execution_unit_price,
        transactions.price_currency::TEXT, transactions.settlement_mode::TEXT,
        transactions.settlement_currency::TEXT, transactions.fx_rate_to_vnd,
        transactions.fx_provenance, transactions.fx_observed_at,
        transactions.executed_at, transactions.created_at,
        assets.symbol::TEXT, assets.name::TEXT, assets.asset_type::TEXT
    FROM public.portfolio_transactions AS transactions
    INNER JOIN public.assets AS assets ON assets.id = transactions.asset_id
    INNER JOIN public.investor_profile AS profiles ON profiles.id = transactions.profile_id
    WHERE profiles.singleton_key = 1
      AND (p_symbol IS NULL OR assets.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY transactions.executed_at DESC, transactions.created_at DESC, transactions.id DESC;
$$;

DROP FUNCTION IF EXISTS public.create_opening_position(TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT NULL,
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance JSONB DEFAULT NULL,
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
    v_average_cost NUMERIC := p_average_cost;
    v_price_currency TEXT;
    v_method TEXT;
    v_expected_cost NUMERIC;
BEGIN
    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;

    SELECT profiles.id INTO v_profile_id FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'singleton investor profile is unavailable';
    END IF;

    SELECT assets.* INTO v_asset FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;
    IF v_asset.asset_type = 'fx' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'FX context assets are not investment positions';
    END IF;

    v_price_currency := UPPER(BTRIM(COALESCE(p_price_currency, v_asset.quote_currency)));
    IF v_asset.quote_currency = 'VND' AND v_price_currency <> 'VND' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'VND-listed openings require VND cost input';
    END IF;
    IF v_asset.asset_type = 'gold' AND v_price_currency <> 'USD' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'XAU/USD opening price currency must be USD';
    END IF;
    IF v_asset.asset_type = 'crypto' AND v_price_currency NOT IN ('USD', 'USDT') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'Crypto opening price currency must be USD or USDT';
    END IF;

    IF v_price_currency = 'VND' THEN
        IF v_average_cost IS NULL OR v_average_cost < 0
            OR v_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite VND number';
        END IF;
        IF p_fx_rate_to_vnd IS NOT NULL OR p_fx_provenance IS NOT NULL OR p_fx_observed_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening must not contain FX conversion metadata';
        END IF;
    ELSE
        IF p_fx_provenance IS NULL OR JSONB_TYPEOF(p_fx_provenance) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'non-VND opening requires structured cost provenance';
        END IF;
        v_method := UPPER(BTRIM(COALESCE(p_fx_provenance ->> 'method', '')));
        IF v_method = 'USER_SUPPLIED_VND_BASIS' THEN
            IF v_average_cost IS NULL OR v_average_cost < 0
                OR v_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
                RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'user-supplied VND opening basis is required';
            END IF;
            IF p_fx_rate_to_vnd IS NOT NULL OR p_fx_observed_at IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'user-supplied VND opening basis must not claim an FX observation';
            END IF;
        ELSIF v_method IN ('USER_SUPPLIED_FX_RATE', 'PROVIDER_CONFIRMED_FX_RATE') THEN
            IF p_execution_unit_price IS NULL OR p_execution_unit_price <= 0
                OR p_fx_rate_to_vnd IS NULL OR p_fx_rate_to_vnd <= 0
                OR p_fx_observed_at IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening FX conversion requires execution price, rate, and observation time';
            END IF;
            IF UPPER(BTRIM(COALESCE(p_fx_provenance ->> 'baseCurrency', ''))) <> v_price_currency
                OR UPPER(BTRIM(COALESCE(p_fx_provenance ->> 'quoteCurrency', ''))) <> 'VND' THEN
                RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'opening FX provenance pair must match price currency to VND';
            END IF;
            IF v_method = 'PROVIDER_CONFIRMED_FX_RATE'
                AND BTRIM(COALESCE(p_fx_provenance ->> 'provider', '')) = '' THEN
                RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'provider-confirmed opening FX rate requires provider provenance';
            END IF;
            v_expected_cost := p_execution_unit_price * p_fx_rate_to_vnd;
            IF v_average_cost IS NULL THEN
                v_average_cost := v_expected_cost;
            ELSIF v_average_cost IS DISTINCT FROM v_expected_cost THEN
                RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening VND cost must equal execution price multiplied by FX rate';
            END IF;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'unsupported opening cost provenance method';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));
    IF EXISTS (
        SELECT 1 FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id AND baselines.asset_id = v_asset.id
    ) OR EXISTS (
        SELECT 1 FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id AND holdings.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'asset already has a holding or opening baseline';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance,
        fx_observed_at, accounting_cutoff_at, provenance_type, created_at, updated_at
    ) VALUES (
        v_profile_id, v_asset.id, p_quantity, v_average_cost,
        CASE WHEN v_price_currency = 'VND' THEN COALESCE(p_execution_unit_price, v_average_cost)
            ELSE p_execution_unit_price END,
        v_price_currency, p_fx_rate_to_vnd, p_fx_provenance,
        p_fx_observed_at, v_accounted_at, 'USER_RECORDED', v_accounted_at, v_accounted_at
    ) RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost, created_at, updated_at
    ) VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, v_average_cost, v_accounted_at, v_accounted_at
    ) RETURNING * INTO v_holding;

    RETURN jsonb_build_object('openingPosition', to_jsonb(v_baseline), 'holding', to_jsonb(v_holding));
END;
$$;

-- Corrected aggregate opening cost is a new user-attested VND basis. Clear
-- optional execution/FX fields so stale provenance cannot survive correction.
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
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
        OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NULL OR p_average_cost < 0
        OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be a non-negative finite VND number';
    END IF;

    SELECT profiles.id INTO v_profile_id FROM public.investor_profile AS profiles
    WHERE profiles.singleton_key = 1;
    SELECT baselines.asset_id INTO v_asset_id
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id;
    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset_id::TEXT));
    SELECT baselines.* INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;
    IF v_baseline.locked_at IS NOT NULL OR v_baseline.cancelled_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_baseline.profile_id
          AND transactions.asset_id = v_baseline.asset_id
          AND transactions.created_at > v_baseline.accounting_cutoff_at
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP007', MESSAGE = 'opening position is locked and cannot be corrected';
    END IF;

    SELECT assets.* INTO v_asset FROM public.assets AS assets WHERE assets.id = v_asset_id;
    SELECT holdings.* INTO v_holding FROM public.holdings AS holdings
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
        execution_unit_price = CASE WHEN v_asset.quote_currency = 'VND' THEN p_average_cost ELSE NULL END,
        fx_rate_to_vnd = NULL,
        fx_provenance = CASE WHEN v_asset.quote_currency = 'VND' THEN NULL
            ELSE jsonb_build_object('method', 'USER_SUPPLIED_VND_BASIS') END,
        fx_observed_at = NULL,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity, average_cost = p_average_cost, updated_at = v_accounted_at
    WHERE id = v_holding.id AND profile_id = v_profile_id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object('openingPosition', to_jsonb(v_baseline), 'holding', to_jsonb(v_holding));
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_portfolio_transaction_accounting_contract()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ,
    NUMERIC, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(
    TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ,
    NUMERIC, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(
    TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, JSONB, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
    TO service_role;

COMMIT;
