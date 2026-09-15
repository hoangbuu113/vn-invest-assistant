-- Portfolio native-first accounting for external non-VND transactions.
-- Native execution evidence is authoritative; VND accounting is optional enrichment.

BEGIN;

ALTER TABLE public.portfolio_transactions
    ALTER COLUMN price DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS pre_trade_holding_exists BOOLEAN NULL,
    ADD COLUMN IF NOT EXISTS pre_trade_quantity NUMERIC NULL,
    ADD COLUMN IF NOT EXISTS pre_trade_opening_position_id UUID NULL REFERENCES public.position_opening_baselines(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS pre_trade_average_cost NUMERIC NULL,
    ADD COLUMN IF NOT EXISTS pre_trade_native_average_cost NUMERIC NULL,
    ADD COLUMN IF NOT EXISTS pre_trade_native_cost_currency VARCHAR(12) NULL;

ALTER TABLE public.holdings
    ADD COLUMN IF NOT EXISTS native_average_cost NUMERIC NULL,
    ADD COLUMN IF NOT EXISTS native_cost_currency VARCHAR(12) NULL;

ALTER TABLE public.holdings
    DROP CONSTRAINT IF EXISTS holdings_native_cost_pair_check,
    ADD CONSTRAINT holdings_native_cost_pair_check CHECK (
        (native_average_cost IS NULL AND native_cost_currency IS NULL)
        OR (
            native_average_cost >= 0
            AND native_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
            AND native_cost_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
        )
    );

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS portfolio_transactions_pre_trade_snapshot_check,
    ADD CONSTRAINT portfolio_transactions_pre_trade_snapshot_check CHECK (
        (pre_trade_holding_exists IS NULL
            AND pre_trade_quantity IS NULL
            AND pre_trade_opening_position_id IS NULL
            AND pre_trade_average_cost IS NULL
            AND pre_trade_native_average_cost IS NULL
            AND pre_trade_native_cost_currency IS NULL)
        OR (pre_trade_holding_exists = FALSE
            AND pre_trade_quantity = 0
            AND pre_trade_opening_position_id IS NULL
            AND pre_trade_average_cost IS NULL
            AND pre_trade_native_average_cost IS NULL
            AND pre_trade_native_cost_currency IS NULL)
        OR (pre_trade_holding_exists = TRUE
            AND pre_trade_quantity > 0
            AND pre_trade_quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
            AND (
                pre_trade_average_cost IS NULL
                OR (
                    pre_trade_average_cost >= 0
                    AND pre_trade_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
                )
            )
            AND (
                (pre_trade_native_average_cost IS NULL AND pre_trade_native_cost_currency IS NULL)
                OR (
                    pre_trade_native_average_cost >= 0
                    AND pre_trade_native_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
                    AND pre_trade_native_cost_currency ~ '^[A-Z][A-Z0-9]{0,11}$'
                )
            )
        )
    );

ALTER TABLE public.portfolio_transactions
    DROP CONSTRAINT IF EXISTS portfolio_transactions_realized_pnl_semantics_check,
    ADD CONSTRAINT portfolio_transactions_realized_pnl_semantics_check CHECK (
        transaction_type IN ('BUY', 'BUY_REVERSAL') AND realized_pnl IS NULL
        OR transaction_type IN ('SELL', 'SELL_REVERSAL')
    );

COMMENT ON COLUMN public.portfolio_transactions.price IS
    'Optional VND accounting unit price. NULL is allowed only for external non-VND execution when no conversion evidence exists.';
COMMENT ON COLUMN public.holdings.native_average_cost IS
    'Weighted average acquisition cost in native_cost_currency; NULL when acquisition currencies are incompatible or unavailable.';
COMMENT ON COLUMN public.holdings.native_cost_currency IS
    'Exact acquisition currency for native_average_cost. USDT and USD are distinct.';

-- Deterministic compatibility only: preserve every historical VND value and
-- project native cost where the existing authority is unambiguous.
UPDATE public.holdings AS h
SET native_average_cost = h.average_cost,
    native_cost_currency = 'VND'
FROM public.assets AS a
WHERE a.id = h.asset_id
  AND a.quote_currency = 'VND'
  AND h.average_cost IS NOT NULL
  AND h.native_average_cost IS NULL
  AND h.native_cost_currency IS NULL;

UPDATE public.holdings AS h
SET native_average_cost = b.execution_unit_price,
    native_cost_currency = b.price_currency
FROM public.position_opening_baselines AS b
WHERE b.id = h.opening_position_id
  AND b.cancelled_at IS NULL
  AND b.locked_at IS NULL
  AND b.execution_unit_price IS NOT NULL
  AND b.price_currency IS NOT NULL
  AND h.native_average_cost IS NULL
  AND h.native_cost_currency IS NULL;

CREATE OR REPLACE FUNCTION public.populate_opening_holding_native_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_baseline public.position_opening_baselines%ROWTYPE;
BEGIN
    IF NEW.opening_position_id IS NOT NULL
       AND NEW.native_average_cost IS NULL
       AND NEW.native_cost_currency IS NULL THEN
        SELECT * INTO v_baseline
        FROM public.position_opening_baselines
        WHERE id = NEW.opening_position_id;

        IF v_baseline.id IS NOT NULL THEN
            NEW.native_average_cost := v_baseline.execution_unit_price;
            NEW.native_cost_currency := CASE
                WHEN v_baseline.execution_unit_price IS NULL THEN NULL
                ELSE v_baseline.price_currency
            END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_opening_holding_native_cost ON public.holdings;
CREATE TRIGGER trg_populate_opening_holding_native_cost
    BEFORE INSERT ON public.holdings
    FOR EACH ROW EXECUTE FUNCTION public.populate_opening_holding_native_cost();

CREATE OR REPLACE FUNCTION public.sync_corrected_opening_holding_native_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.cancelled_at IS NULL AND NEW.locked_at IS NULL THEN
        UPDATE public.holdings
        SET native_average_cost = NEW.execution_unit_price,
            native_cost_currency = CASE WHEN NEW.execution_unit_price IS NULL THEN NULL ELSE NEW.price_currency END
        WHERE opening_position_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_corrected_opening_holding_native_cost ON public.position_opening_baselines;
CREATE TRIGGER trg_sync_corrected_opening_holding_native_cost
    AFTER UPDATE OF execution_unit_price, price_currency ON public.position_opening_baselines
    FOR EACH ROW EXECUTE FUNCTION public.sync_corrected_opening_holding_native_cost();

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
    SELECT * INTO v_asset FROM public.assets WHERE id = NEW.asset_id;
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found for transaction validation';
    END IF;

    NEW.price_currency := UPPER(COALESCE(BTRIM(NEW.price_currency), 'VND'));
    NEW.settlement_mode := UPPER(COALESCE(BTRIM(NEW.settlement_mode), 'INTERNAL_VND_CASH'));

    IF NEW.settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;

    IF NEW.settlement_mode = 'INTERNAL_VND_CASH' THEN
        IF NEW.settlement_currency IS NOT NULL AND BTRIM(NEW.settlement_currency) <> ''
           AND UPPER(BTRIM(NEW.settlement_currency)) <> 'VND' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
        END IF;
        NEW.settlement_currency := 'VND';
    ELSE
        NEW.settlement_currency := NULLIF(UPPER(BTRIM(NEW.settlement_currency)), '');
    END IF;

    IF NEW.price_currency = 'VND' THEN
        IF NEW.price IS NULL OR NEW.price <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND transaction requires price greater than 0';
        END IF;
        NEW.execution_unit_price := COALESCE(NEW.execution_unit_price, NEW.price);
        IF NEW.execution_unit_price IS DISTINCT FROM NEW.price THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND transaction execution_unit_price must equal effective price';
        END IF;
    ELSE
        IF NEW.execution_unit_price IS NULL OR NEW.execution_unit_price <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'non-VND transaction requires execution_unit_price greater than 0';
        END IF;

        IF NEW.price IS NULL THEN
            IF NEW.settlement_mode <> 'EXTERNAL_SETTLEMENT' OR v_asset.quote_currency = 'VND' THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND assets and INTERNAL_VND_CASH transactions require price greater than 0';
            END IF;
            IF NEW.fx_rate_to_vnd IS NOT NULL OR NEW.fx_provenance IS NOT NULL OR NEW.fx_observed_at IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'native-only transaction cannot include partial VND conversion evidence';
            END IF;
        ELSIF NEW.price <= 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be greater than 0 when provided';
        ELSIF NEW.fx_provenance = 'USER_SUPPLIED_VND_BASIS' THEN
            IF NEW.fx_rate_to_vnd IS NOT NULL OR NEW.fx_observed_at IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'user-supplied VND basis cannot include partial FX evidence';
            END IF;
        ELSIF NEW.fx_rate_to_vnd IS NOT NULL AND NEW.fx_rate_to_vnd > 0 THEN
            IF NEW.fx_provenance IS NULL OR BTRIM(NEW.fx_provenance) = '' THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'verified FX conversion requires provenance';
            END IF;
            IF NEW.price_currency = 'USDT' AND NEW.fx_provenance IN ('TWELVE_DATA_USD_VND', 'USD_VND_DIRECT') THEN
                RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'USDT cannot use USD/VND provenance';
            END IF;
            v_expected_vnd_price := NEW.execution_unit_price * NEW.fx_rate_to_vnd;
            IF ABS(NEW.price - v_expected_vnd_price) > 0.05
               AND ABS(NEW.price - v_expected_vnd_price) / v_expected_vnd_price > 0.0001 THEN
                RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'VND price does not match execution_unit_price * fx_rate_to_vnd';
            END IF;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'PT005', MESSAGE = 'non-VND VND basis requires verified FX or USER_SUPPLIED_VND_BASIS';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

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
    v_existing public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_tx public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_idempotency public.portfolio_idempotency_records%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_settlement_mode TEXT := UPPER(COALESCE(BTRIM(p_settlement_mode), 'INTERNAL_VND_CASH'));
    v_settlement_currency TEXT;
    v_execution_price NUMERIC;
    v_key TEXT := NULL;
    v_hash TEXT := NULL;
    v_has_holding BOOLEAN := FALSE;
    v_holding_removed BOOLEAN := FALSE;
    v_new_quantity NUMERIC;
    v_new_average NUMERIC;
    v_new_native_average NUMERIC;
    v_new_native_currency TEXT;
    v_realized NUMERIC;
    v_cash_amount NUMERIC;
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_result JSONB;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_key) > 128 THEN
            RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_key));
        v_hash := md5(concat_ws(':', 'TRANSACTION',
            COALESCE(UPPER(BTRIM(p_symbol)), ''), COALESCE(BTRIM(p_asset_id), ''),
            UPPER(COALESCE(BTRIM(p_transaction_type), '')), COALESCE(p_quantity::TEXT, ''),
            COALESCE(p_price::TEXT, ''), COALESCE(p_executed_at::TEXT, ''),
            COALESCE(p_execution_unit_price::TEXT, ''), COALESCE(UPPER(BTRIM(p_price_currency)), 'VND'),
            COALESCE(UPPER(BTRIM(p_settlement_mode)), 'INTERNAL_VND_CASH'),
            COALESCE(UPPER(BTRIM(p_settlement_currency)), ''), COALESCE(p_fx_rate_to_vnd::TEXT, ''),
            COALESCE(BTRIM(p_fx_provenance), ''), COALESCE(p_fx_observed_at::TEXT, '')));
        SELECT * INTO v_idempotency FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_key;
        IF FOUND THEN
            IF v_idempotency.operation_type <> 'TRANSACTION' OR v_idempotency.request_hash <> v_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency.response_payload || jsonb_build_object('replayed', TRUE);
        END IF;
    END IF;

    IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transactionType must be BUY or SELL';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_price IS NOT NULL AND (p_price <= 0 OR p_price::TEXT IN ('NaN', 'Infinity', '-Infinity')) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price must be a finite number greater than 0 when provided';
    END IF;
    IF ((p_symbol IS NULL OR BTRIM(p_symbol) = '') AND (p_asset_id IS NULL OR BTRIM(p_asset_id) = ''))
       OR (p_symbol IS NOT NULL AND BTRIM(p_symbol) <> '' AND p_asset_id IS NOT NULL AND BTRIM(p_asset_id) <> '') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'exactly one of symbol or assetId is required';
    END IF;
    IF v_settlement_mode NOT IN ('INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT';
    END IF;
    IF p_price IS NULL AND (v_settlement_mode <> 'EXTERNAL_SETTLEMENT' OR v_price_currency = 'VND') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'price is required for VND and INTERNAL_VND_CASH transactions';
    END IF;

    v_settlement_currency := CASE WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN 'VND'
        ELSE NULLIF(UPPER(BTRIM(p_settlement_currency)), '') END;
    IF v_settlement_mode = 'INTERNAL_VND_CASH'
       AND p_settlement_currency IS NOT NULL AND BTRIM(p_settlement_currency) <> ''
       AND UPPER(BTRIM(p_settlement_currency)) <> 'VND' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'INTERNAL_VND_CASH settlement requires settlement_currency VND';
    END IF;

    SELECT * INTO v_profile FROM public.investor_profile WHERE id = p_profile_id FOR UPDATE;
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
        SELECT * INTO v_asset FROM public.assets WHERE id::TEXT = BTRIM(p_asset_id);
    ELSE
        SELECT * INTO v_asset FROM public.assets WHERE symbol = UPPER(BTRIM(p_symbol));
    END IF;
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'asset not found';
    END IF;

    v_execution_price := COALESCE(p_execution_unit_price, CASE WHEN v_price_currency = 'VND' THEN p_price END);
    IF v_execution_price IS NULL OR v_execution_price <= 0 OR v_execution_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'executionUnitPrice must be a finite number greater than 0';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_asset.id::TEXT));
    UPDATE public.position_opening_baselines
    SET locked_at = COALESCE(locked_at, v_now), updated_at = v_now
    WHERE profile_id = v_profile.id AND asset_id = v_asset.id AND cancelled_at IS NULL AND locked_at IS NULL;

    SELECT * INTO v_existing FROM public.holdings
    WHERE profile_id = v_profile.id AND asset_id = v_asset.id FOR UPDATE;
    v_has_holding := v_existing.id IS NOT NULL;

    IF p_transaction_type = 'BUY' THEN
        v_new_quantity := COALESCE(v_existing.quantity, 0) + p_quantity;
        IF v_has_holding THEN
            v_new_average := CASE WHEN v_existing.average_cost IS NOT NULL AND p_price IS NOT NULL
                THEN ((v_existing.quantity * v_existing.average_cost) + (p_quantity * p_price)) / v_new_quantity END;
            IF v_existing.native_average_cost IS NOT NULL
               AND v_existing.native_cost_currency = v_price_currency THEN
                v_new_native_average := ((v_existing.quantity * v_existing.native_average_cost)
                    + (p_quantity * v_execution_price)) / v_new_quantity;
                v_new_native_currency := v_price_currency;
            ELSE
                v_new_native_average := NULL;
                v_new_native_currency := NULL;
            END IF;
        ELSE
            v_new_average := p_price;
            v_new_native_average := v_execution_price;
            v_new_native_currency := v_price_currency;
        END IF;
        v_realized := NULL;
    ELSE
        IF NOT v_has_holding OR v_existing.quantity < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'PT002', MESSAGE = 'cannot sell more than held quantity';
        END IF;
        v_new_quantity := v_existing.quantity - p_quantity;
        v_new_average := v_existing.average_cost;
        v_new_native_average := v_existing.native_average_cost;
        v_new_native_currency := v_existing.native_cost_currency;
        v_realized := CASE WHEN p_price IS NOT NULL AND v_existing.average_cost IS NOT NULL
            THEN (p_price - v_existing.average_cost) * p_quantity END;
        v_holding_removed := v_new_quantity = 0;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        v_cash_amount := p_quantity * p_price;
        IF p_transaction_type = 'BUY' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'buy amount exceeds current cash';
        END IF;
        v_new_cash := CASE WHEN p_transaction_type = 'BUY' THEN v_ledger_cash - v_cash_amount
            ELSE v_ledger_cash + v_cash_amount END;
    ELSE
        v_new_cash := v_ledger_cash;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl, executed_at,
        execution_unit_price, price_currency, settlement_mode, settlement_currency,
        fx_rate_to_vnd, fx_provenance, fx_observed_at,
        pre_trade_holding_exists, pre_trade_quantity, pre_trade_opening_position_id,
        pre_trade_average_cost, pre_trade_native_average_cost, pre_trade_native_cost_currency
    ) VALUES (
        v_profile.id, v_asset.id, p_transaction_type, p_quantity, p_price, v_realized,
        COALESCE(p_executed_at, v_now), v_execution_price, v_price_currency,
        v_settlement_mode, v_settlement_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at,
        v_has_holding, CASE WHEN v_has_holding THEN v_existing.quantity ELSE 0 END,
        CASE WHEN v_has_holding THEN v_existing.opening_position_id END,
        CASE WHEN v_has_holding THEN v_existing.average_cost END,
        CASE WHEN v_has_holding THEN v_existing.native_average_cost END,
        CASE WHEN v_has_holding THEN v_existing.native_cost_currency END
    ) RETURNING * INTO v_tx;

    IF v_has_holding AND NOT v_holding_removed THEN
        UPDATE public.holdings SET quantity = v_new_quantity, average_cost = v_new_average,
            native_average_cost = v_new_native_average, native_cost_currency = v_new_native_currency,
            updated_at = v_now
        WHERE id = v_existing.id AND profile_id = v_profile.id RETURNING * INTO v_result_holding;
    ELSIF p_transaction_type = 'BUY' THEN
        INSERT INTO public.holdings (
            profile_id, asset_id, quantity, average_cost, native_average_cost, native_cost_currency,
            created_at, updated_at
        ) VALUES (
            v_profile.id, v_asset.id, v_new_quantity, v_new_average,
            v_new_native_average, v_new_native_currency, v_now, v_now
        ) RETURNING * INTO v_result_holding;
    ELSIF v_holding_removed THEN
        DELETE FROM public.holdings WHERE id = v_existing.id AND profile_id = v_profile.id;
    END IF;

    IF v_settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id, effective_at, created_at, metadata
        ) VALUES (
            v_profile.id, p_transaction_type, v_cash_amount, v_tx.id, v_now, v_now,
            jsonb_build_object('accountingSemantics', 'recorded_now_affects_current_cash', 'historicalCashReconstruction', FALSE)
        ) RETURNING * INTO v_cash_entry;
        UPDATE public.investor_profile SET cash_available = v_new_cash, updated_at = v_now WHERE id = v_profile.id;
    END IF;

    v_result := jsonb_build_object(
        'transaction', to_jsonb(v_tx) || jsonb_build_object(
            'asset', jsonb_build_object('symbol', v_asset.symbol, 'name', v_asset.name, 'asset_type', v_asset.asset_type),
            'accounting_status', CASE WHEN v_tx.price IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END
        ),
        'holding', CASE WHEN v_holding_removed THEN NULL ELSE to_jsonb(v_result_holding) END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE WHEN v_settlement_mode = 'INTERNAL_VND_CASH' THEN to_jsonb(v_cash_entry) ELSE NULL END,
        'currentCash', v_new_cash,
        'accountingStatus', CASE WHEN v_tx.price IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END
    );

    IF v_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id, idempotency_key, operation_type, request_hash, response_payload, resource_id, created_at
        ) VALUES (p_profile_id, v_key, 'TRANSACTION', v_hash, v_result, v_tx.id, v_now);
    END IF;
    RETURN v_result || jsonb_build_object('replayed', FALSE);
END;
$$;

DROP FUNCTION IF EXISTS public.list_portfolio_transactions(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.list_portfolio_transactions(p_profile_id UUID, p_symbol TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID, profile_id UUID, asset_id UUID, transaction_type TEXT, quantity NUMERIC,
    price NUMERIC, realized_pnl NUMERIC, execution_unit_price NUMERIC, price_currency TEXT,
    settlement_mode TEXT, settlement_currency TEXT, fx_rate_to_vnd NUMERIC,
    fx_provenance TEXT, fx_observed_at TIMESTAMPTZ, executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, symbol TEXT, asset_name TEXT, asset_type TEXT,
    reversal_of_id UUID, is_reversal BOOLEAN, is_reversed BOOLEAN,
    pre_trade_holding_exists BOOLEAN, pre_trade_quantity NUMERIC,
    pre_trade_opening_position_id UUID, pre_trade_average_cost NUMERIC,
    pre_trade_native_average_cost NUMERIC, pre_trade_native_cost_currency TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    RETURN QUERY SELECT
        t.id, t.profile_id, t.asset_id, t.transaction_type::TEXT, t.quantity,
        t.price, t.realized_pnl, t.execution_unit_price, t.price_currency::TEXT,
        t.settlement_mode::TEXT, t.settlement_currency::TEXT, t.fx_rate_to_vnd,
        t.fx_provenance::TEXT, t.fx_observed_at, t.executed_at, t.created_at,
        a.symbol::TEXT, a.name::TEXT, a.asset_type::TEXT,
        t.reversal_of_id, t.is_reversal, rev.id IS NOT NULL,
        t.pre_trade_holding_exists, t.pre_trade_quantity, t.pre_trade_opening_position_id,
        t.pre_trade_average_cost, t.pre_trade_native_average_cost,
        t.pre_trade_native_cost_currency::TEXT
    FROM public.portfolio_transactions t
    JOIN public.assets a ON a.id = t.asset_id
    LEFT JOIN public.portfolio_reversals rev ON rev.profile_id = t.profile_id
      AND rev.original_event_id = t.id AND rev.original_event_type IN ('BUY', 'SELL')
    WHERE t.profile_id = p_profile_id
      AND (p_symbol IS NULL OR BTRIM(p_symbol) = '' OR a.symbol = UPPER(BTRIM(p_symbol)))
    ORDER BY t.executed_at DESC, t.created_at DESC, t.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_portfolio_transaction(
    p_profile_id UUID, p_transaction_id UUID, p_reason TEXT, p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_profile public.investor_profile%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_orig public.portfolio_transactions%ROWTYPE;
    v_orig_cash public.cash_ledger_entries%ROWTYPE;
    v_existing public.holdings%ROWTYPE;
    v_result_holding public.holdings%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_reversal_tx public.portfolio_transactions%ROWTYPE;
    v_cash_entry public.cash_ledger_entries%ROWTYPE;
    v_audit public.portfolio_reversals%ROWTYPE;
    v_idempotency public.portfolio_idempotency_records%ROWTYPE;
    v_key TEXT := NULL;
    v_hash TEXT := NULL;
    v_now TIMESTAMPTZ := NOW();
    v_ledger_cash NUMERIC;
    v_new_cash NUMERIC;
    v_cash_amount NUMERIC;
    v_new_quantity NUMERIC;
    v_new_average NUMERIC;
    v_new_native_average NUMERIC;
    v_new_native_currency TEXT;
    v_type VARCHAR(20);
    v_reversal_realized NUMERIC;
    v_holding_removed BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    IF p_profile_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required'; END IF;
    IF p_transaction_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'PT004', MESSAGE = 'transaction ID is required'; END IF;
    IF p_reason IS NULL OR BTRIM(p_reason) = '' THEN RAISE EXCEPTION USING ERRCODE = 'RC004', MESSAGE = 'reversal reason is required'; END IF;

    IF p_idempotency_key IS NOT NULL AND BTRIM(p_idempotency_key) <> '' THEN
        v_key := BTRIM(p_idempotency_key);
        IF LENGTH(v_key) > 128 THEN RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'idempotencyKey must be 128 characters or fewer'; END IF;
        PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_key));
        v_hash := md5(concat_ws(':', 'TRANSACTION_REVERSAL', p_transaction_id::TEXT, BTRIM(p_reason)));
        SELECT * INTO v_idempotency FROM public.portfolio_idempotency_records
        WHERE profile_id = p_profile_id AND idempotency_key = v_key;
        IF FOUND THEN
            IF v_idempotency.operation_type <> 'TRANSACTION_REVERSAL' OR v_idempotency.request_hash <> v_hash THEN
                RAISE EXCEPTION USING ERRCODE = 'IC001', MESSAGE = 'idempotency key reused with different parameters';
            END IF;
            RETURN v_idempotency.response_payload || jsonb_build_object('replayed', TRUE);
        END IF;
    END IF;

    SELECT * INTO v_profile FROM public.investor_profile WHERE id = p_profile_id FOR UPDATE;
    IF v_profile.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'PT500', MESSAGE = 'investor profile is unavailable'; END IF;
    v_ledger_cash := public.calculate_cash_ledger_balance(v_profile.id);
    IF v_ledger_cash IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger is not activated'; END IF;
    IF v_ledger_cash IS DISTINCT FROM v_profile.cash_available THEN RAISE EXCEPTION USING ERRCODE = 'CL500', MESSAGE = 'cash ledger/cache invariant violated'; END IF;

    SELECT * INTO v_orig FROM public.portfolio_transactions WHERE id = p_transaction_id;
    IF v_orig.id IS NULL OR v_orig.profile_id <> v_profile.id THEN RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'transaction not found'; END IF;
    IF v_orig.is_reversal THEN RAISE EXCEPTION USING ERRCODE = 'RC004', MESSAGE = 'cannot reverse a reversal transaction'; END IF;
    IF v_orig.transaction_type NOT IN ('BUY', 'SELL') THEN RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'only BUY and SELL transactions can be reversed'; END IF;
    IF EXISTS (SELECT 1 FROM public.portfolio_reversals WHERE profile_id = v_profile.id
        AND original_event_type IN ('BUY', 'SELL') AND original_event_id = v_orig.id) THEN
        RAISE EXCEPTION USING ERRCODE = 'RC001', MESSAGE = 'transaction has already been reversed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.portfolio_transactions t WHERE t.profile_id = v_profile.id
        AND t.asset_id = v_orig.asset_id AND t.id <> v_orig.id
        AND (t.executed_at > v_orig.executed_at OR (t.executed_at = v_orig.executed_at
          AND (t.created_at > v_orig.created_at OR t.id > v_orig.id)))) THEN
        RAISE EXCEPTION USING ERRCODE = 'RC002', MESSAGE = 'cannot reverse transaction when subsequent transactions depend on it';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile.id::TEXT), hashtext(v_orig.asset_id::TEXT));
    SELECT * INTO v_asset FROM public.assets WHERE id = v_orig.asset_id;
    SELECT * INTO v_existing FROM public.holdings WHERE profile_id = v_profile.id AND asset_id = v_orig.asset_id FOR UPDATE;
    IF v_orig.settlement_mode = 'INTERNAL_VND_CASH' THEN
        SELECT * INTO v_orig_cash FROM public.cash_ledger_entries
        WHERE portfolio_transaction_id = v_orig.id AND profile_id = v_profile.id;
    END IF;

    v_type := CASE WHEN v_orig.transaction_type = 'BUY' THEN 'BUY_REVERSAL' ELSE 'SELL_REVERSAL' END;
    v_reversal_realized := CASE WHEN v_orig.realized_pnl IS NULL THEN NULL ELSE -v_orig.realized_pnl END;

    IF v_orig.pre_trade_holding_exists IS NOT NULL THEN
        IF v_orig.pre_trade_holding_exists = FALSE THEN
            IF v_existing.id IS NOT NULL THEN
                DELETE FROM public.holdings WHERE id = v_existing.id AND profile_id = v_profile.id;
            END IF;
            v_holding_removed := TRUE;
        ELSE
            INSERT INTO public.holdings (
                profile_id, asset_id, opening_position_id, quantity, average_cost,
                native_average_cost, native_cost_currency, created_at, updated_at
            ) VALUES (
                v_profile.id, v_orig.asset_id, v_orig.pre_trade_opening_position_id,
                v_orig.pre_trade_quantity, v_orig.pre_trade_average_cost,
                v_orig.pre_trade_native_average_cost, v_orig.pre_trade_native_cost_currency,
                COALESCE(v_existing.created_at, v_now), v_now
            ) ON CONFLICT (profile_id, asset_id) DO UPDATE SET
                opening_position_id = EXCLUDED.opening_position_id,
                quantity = EXCLUDED.quantity,
                average_cost = EXCLUDED.average_cost,
                native_average_cost = EXCLUDED.native_average_cost,
                native_cost_currency = EXCLUDED.native_cost_currency,
                updated_at = EXCLUDED.updated_at
            RETURNING * INTO v_result_holding;
        END IF;
    ELSIF v_orig.transaction_type = 'BUY' THEN
        IF v_existing.id IS NULL OR v_existing.quantity < v_orig.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'RC002', MESSAGE = 'cannot reverse BUY when current holding quantity is less than bought quantity';
        END IF;
        v_new_quantity := v_existing.quantity - v_orig.quantity;
        IF v_new_quantity = 0 THEN
            DELETE FROM public.holdings WHERE id = v_existing.id AND profile_id = v_profile.id;
            v_holding_removed := TRUE;
        ELSE
            SELECT * INTO v_baseline FROM public.position_opening_baselines
            WHERE profile_id = v_profile.id AND asset_id = v_orig.asset_id AND cancelled_at IS NULL;
            v_new_average := CASE
                WHEN v_baseline.id IS NOT NULL AND v_new_quantity = v_baseline.opening_quantity THEN v_baseline.opening_average_cost
                WHEN v_existing.average_cost IS NOT NULL AND v_orig.price IS NOT NULL
                    THEN ((v_existing.quantity * v_existing.average_cost) - (v_orig.quantity * v_orig.price)) / v_new_quantity
                ELSE NULL END;
            v_new_native_average := CASE
                WHEN v_baseline.id IS NOT NULL AND v_new_quantity = v_baseline.opening_quantity THEN v_baseline.execution_unit_price
                WHEN v_existing.native_average_cost IS NOT NULL AND v_existing.native_cost_currency = v_orig.price_currency
                    THEN ((v_existing.quantity * v_existing.native_average_cost) - (v_orig.quantity * v_orig.execution_unit_price)) / v_new_quantity
                ELSE NULL END;
            v_new_native_currency := CASE WHEN v_new_native_average IS NULL THEN NULL
                WHEN v_baseline.id IS NOT NULL AND v_new_quantity = v_baseline.opening_quantity THEN v_baseline.price_currency
                ELSE v_existing.native_cost_currency END;
            UPDATE public.holdings SET quantity = v_new_quantity, average_cost = v_new_average,
                native_average_cost = v_new_native_average, native_cost_currency = v_new_native_currency, updated_at = v_now
            WHERE id = v_existing.id RETURNING * INTO v_result_holding;
        END IF;
    ELSE
        v_new_quantity := COALESCE(v_existing.quantity, 0) + v_orig.quantity;
        v_new_average := CASE WHEN v_existing.id IS NOT NULL THEN v_existing.average_cost
            WHEN v_orig.realized_pnl IS NOT NULL AND v_orig.price IS NOT NULL
                THEN v_orig.price - (v_orig.realized_pnl / v_orig.quantity) END;
        v_new_native_average := CASE WHEN v_existing.id IS NOT NULL THEN v_existing.native_average_cost END;
        v_new_native_currency := CASE WHEN v_existing.id IS NOT NULL THEN v_existing.native_cost_currency END;
        INSERT INTO public.holdings (profile_id, asset_id, quantity, average_cost,
            native_average_cost, native_cost_currency, created_at, updated_at)
        VALUES (v_profile.id, v_orig.asset_id, v_new_quantity, v_new_average,
            v_new_native_average, v_new_native_currency, v_now, v_now)
        ON CONFLICT (profile_id, asset_id) DO UPDATE SET quantity = EXCLUDED.quantity,
            average_cost = EXCLUDED.average_cost, native_average_cost = EXCLUDED.native_average_cost,
            native_cost_currency = EXCLUDED.native_cost_currency, updated_at = EXCLUDED.updated_at
        RETURNING * INTO v_result_holding;
    END IF;

    IF v_orig.settlement_mode = 'INTERNAL_VND_CASH' THEN
        v_cash_amount := v_orig.quantity * v_orig.price;
        IF v_orig.transaction_type = 'SELL' AND v_cash_amount > v_ledger_cash THEN
            RAISE EXCEPTION USING ERRCODE = 'CL001', MESSAGE = 'reversal cash debit exceeds available cash';
        END IF;
        v_new_cash := CASE WHEN v_orig.transaction_type = 'BUY' THEN v_ledger_cash + v_cash_amount ELSE v_ledger_cash - v_cash_amount END;
    ELSE
        v_new_cash := v_ledger_cash;
    END IF;

    INSERT INTO public.portfolio_transactions (
        profile_id, asset_id, transaction_type, quantity, price, realized_pnl,
        executed_at, created_at, execution_unit_price, price_currency, settlement_mode,
        settlement_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at,
        reversal_of_id, is_reversal, pre_trade_holding_exists, pre_trade_quantity,
        pre_trade_opening_position_id, pre_trade_average_cost,
        pre_trade_native_average_cost, pre_trade_native_cost_currency
    ) VALUES (
        v_profile.id, v_orig.asset_id, v_type, v_orig.quantity, v_orig.price,
        v_reversal_realized, v_now, v_now, v_orig.execution_unit_price, v_orig.price_currency,
        v_orig.settlement_mode, v_orig.settlement_currency, v_orig.fx_rate_to_vnd,
        v_orig.fx_provenance, v_orig.fx_observed_at, v_orig.id, TRUE,
        v_existing.id IS NOT NULL, CASE WHEN v_existing.id IS NOT NULL THEN v_existing.quantity ELSE 0 END,
        CASE WHEN v_existing.id IS NOT NULL THEN v_existing.opening_position_id END,
        CASE WHEN v_existing.id IS NOT NULL THEN v_existing.average_cost END,
        CASE WHEN v_existing.id IS NOT NULL THEN v_existing.native_average_cost END,
        CASE WHEN v_existing.id IS NOT NULL THEN v_existing.native_cost_currency END
    ) RETURNING * INTO v_reversal_tx;

    IF v_orig.settlement_mode = 'INTERNAL_VND_CASH' THEN
        INSERT INTO public.cash_ledger_entries (
            profile_id, entry_type, amount, portfolio_transaction_id, reversal_of_id,
            is_reversal, effective_at, created_at, metadata
        ) VALUES (
            v_profile.id, v_type, v_cash_amount, v_reversal_tx.id, v_orig_cash.id,
            TRUE, v_now, v_now, jsonb_build_object('reversalReason', BTRIM(p_reason),
              'isReversal', TRUE, 'reversalOfTransactionId', v_orig.id)
        ) RETURNING * INTO v_cash_entry;
        UPDATE public.investor_profile SET cash_available = v_new_cash, updated_at = v_now WHERE id = v_profile.id;
    END IF;

    INSERT INTO public.portfolio_reversals (
        profile_id, original_event_type, original_event_id, reversal_transaction_id,
        reversal_cash_entry_id, reason, idempotency_key, effective_at, created_at, metadata
    ) VALUES (
        v_profile.id, v_orig.transaction_type, v_orig.id, v_reversal_tx.id,
        v_cash_entry.id, BTRIM(p_reason), v_key, v_now, v_now,
        jsonb_build_object('originalQuantity', v_orig.quantity, 'originalPrice', v_orig.price, 'symbol', v_asset.symbol)
    ) RETURNING * INTO v_audit;

    v_result := jsonb_build_object(
        'reversal', jsonb_build_object('id', v_audit.id, 'profileId', v_audit.profile_id,
          'originalEventType', v_audit.original_event_type, 'originalEventId', v_audit.original_event_id,
          'reason', v_audit.reason, 'effectiveAt', v_audit.effective_at, 'createdAt', v_audit.created_at),
        'reversalTransaction', to_jsonb(v_reversal_tx) || jsonb_build_object(
          'asset', jsonb_build_object('symbol', v_asset.symbol, 'name', v_asset.name, 'asset_type', v_asset.asset_type),
          'accounting_status', CASE WHEN v_reversal_tx.price IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END),
        'holding', CASE WHEN v_holding_removed THEN NULL ELSE to_jsonb(v_result_holding) END,
        'holdingRemoved', v_holding_removed,
        'cashEntry', CASE WHEN v_orig.settlement_mode = 'INTERNAL_VND_CASH' THEN to_jsonb(v_cash_entry) ELSE NULL END,
        'currentCash', v_new_cash
    );
    IF v_key IS NOT NULL THEN
        INSERT INTO public.portfolio_idempotency_records (
            profile_id, idempotency_key, operation_type, request_hash, response_payload, resource_id, created_at
        ) VALUES (p_profile_id, v_key, 'TRANSACTION_REVERSAL', v_hash, v_result, v_audit.id, v_now);
    END IF;
    RETURN v_result || jsonb_build_object('replayed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.populate_opening_holding_native_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_corrected_opening_holding_native_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_vnd_portfolio_transaction_asset() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_portfolio_transaction(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_portfolio_transaction(UUID, UUID, TEXT, TEXT) TO service_role;

COMMIT;
