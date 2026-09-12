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

