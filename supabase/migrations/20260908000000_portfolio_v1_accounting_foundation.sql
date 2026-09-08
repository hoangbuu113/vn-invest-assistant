-- Portfolio V1 P0.1: accounting-time and asset-eligibility trust boundaries.
-- Forward-only: no historical financial rows are rewritten.

BEGIN;

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS portfolio_eligibility VARCHAR(32);

-- Current canonical FX pairs are context/reference series. Existing supported
-- long-only instruments remain eligible. New assets must declare this field.
UPDATE public.assets
SET portfolio_eligibility = CASE
    WHEN asset_type = 'fx' THEN 'REFERENCE_ONLY'
    ELSE 'PORTFOLIO_ELIGIBLE'
END
WHERE portfolio_eligibility IS NULL;

ALTER TABLE public.assets
    ALTER COLUMN portfolio_eligibility SET NOT NULL,
    DROP CONSTRAINT IF EXISTS assets_portfolio_eligibility_check,
    ADD CONSTRAINT assets_portfolio_eligibility_check
        CHECK (portfolio_eligibility IN ('PORTFOLIO_ELIGIBLE', 'REFERENCE_ONLY'));

COMMENT ON COLUMN public.assets.portfolio_eligibility IS
    'Canonical Portfolio capability. REFERENCE_ONLY assets may provide market context but cannot create holdings, opening positions, or trades.';

CREATE OR REPLACE FUNCTION public.enforce_portfolio_transaction_asset_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asset public.assets%ROWTYPE;
BEGIN
    SELECT * INTO v_asset
    FROM public.assets
    WHERE id = NEW.asset_id;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'portfolio asset is unavailable';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE
        OR v_asset.portfolio_eligibility IS DISTINCT FROM 'PORTFOLIO_ELIGIBLE' THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'asset is not portfolio eligible';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portfolio_transaction_asset_eligibility
    ON public.portfolio_transactions;
CREATE TRIGGER trg_portfolio_transaction_asset_eligibility
    BEFORE INSERT OR UPDATE OF asset_id ON public.portfolio_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_portfolio_transaction_asset_eligibility();

CREATE OR REPLACE FUNCTION public.enforce_opening_position_asset_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asset public.assets%ROWTYPE;
BEGIN
    SELECT * INTO v_asset
    FROM public.assets
    WHERE id = NEW.asset_id;

    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'portfolio asset is unavailable';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE
        OR v_asset.portfolio_eligibility IS DISTINCT FROM 'PORTFOLIO_ELIGIBLE' THEN
        RAISE EXCEPTION USING ERRCODE = 'PE001', MESSAGE = 'asset is not portfolio eligible';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opening_position_asset_eligibility
    ON public.position_opening_baselines;
CREATE TRIGGER trg_opening_position_asset_eligibility
    BEFORE INSERT OR UPDATE OF asset_id ON public.position_opening_baselines
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_opening_position_asset_eligibility();

CREATE OR REPLACE FUNCTION public.align_trade_cash_economic_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_transaction public.portfolio_transactions%ROWTYPE;
BEGIN
    IF NEW.entry_type IN ('BUY', 'SELL') THEN
        IF NEW.portfolio_transaction_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement requires a linked portfolio transaction';
        END IF;

        SELECT * INTO v_transaction
        FROM public.portfolio_transactions
        WHERE id = NEW.portfolio_transaction_id
          AND profile_id = NEW.profile_id;

        IF v_transaction.id IS NULL
            OR v_transaction.transaction_type IS DISTINCT FROM NEW.entry_type
            OR v_transaction.settlement_mode IS DISTINCT FROM 'INTERNAL_VND_CASH' THEN
            RAISE EXCEPTION USING ERRCODE = 'CL004', MESSAGE = 'trade cash movement conflicts with its linked portfolio transaction';
        END IF;

        -- Economic time follows the trade. created_at remains the actual audit
        -- timestamp supplied by the database/RPC and is never backdated here.
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

DROP TRIGGER IF EXISTS trg_align_trade_cash_economic_time
    ON public.cash_ledger_entries;
CREATE TRIGGER trg_align_trade_cash_economic_time
    BEFORE INSERT ON public.cash_ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.align_trade_cash_economic_time();

REVOKE ALL ON FUNCTION public.enforce_portfolio_transaction_asset_eligibility()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_opening_position_asset_eligibility()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.align_trade_cash_economic_time()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enforce_portfolio_transaction_asset_eligibility()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_opening_position_asset_eligibility()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.align_trade_cash_economic_time()
    TO service_role;

COMMIT;
