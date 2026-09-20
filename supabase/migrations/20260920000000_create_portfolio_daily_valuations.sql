-- Portfolio daily valuation history foundation.
-- Stores one immutable, evidence-bearing end-of-day observation per profile
-- and Asia/Ho_Chi_Minh valuation date. This migration creates no observations.

BEGIN;

CREATE TABLE IF NOT EXISTS public.portfolio_daily_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL
        REFERENCES public.investor_profile(id) ON DELETE RESTRICT,
    valuation_date DATE NOT NULL,
    valuation_timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    observed_at TIMESTAMPTZ NOT NULL,
    snapshot_id TEXT NOT NULL,
    ledger_revision TEXT NOT NULL,
    reporting_currency TEXT NOT NULL DEFAULT 'VND',
    status TEXT NOT NULL,
    cash_vnd NUMERIC NULL,
    invested_market_value_vnd NUMERIC NULL,
    total_portfolio_value_vnd NUMERIC NULL,
    unrealized_pnl_vnd NUMERIC NULL,
    total_holdings_count INTEGER NOT NULL,
    valued_holdings_count INTEGER NOT NULL,
    boundary_external_flow_vnd NUMERIC NULL,
    flow_status TEXT NOT NULL,
    flow_interval_start TIMESTAMPTZ NULL,
    flow_interval_end TIMESTAMPTZ NOT NULL,
    flow_interval_type TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    observation_evidence JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_portfolio_daily_valuation_profile_date
        UNIQUE (profile_id, valuation_date),
    CONSTRAINT portfolio_daily_valuation_timezone_check
        CHECK (valuation_timezone = 'Asia/Ho_Chi_Minh'),
    CONSTRAINT portfolio_daily_valuation_observed_date_check
        CHECK ((observed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE = valuation_date),
    CONSTRAINT portfolio_daily_valuation_reporting_currency_check
        CHECK (reporting_currency = 'VND'),
    CONSTRAINT portfolio_daily_valuation_status_check
        CHECK (status IN ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE')),
    CONSTRAINT portfolio_daily_valuation_cash_check
        CHECK (cash_vnd IS NULL OR (cash_vnd >= 0 AND cash_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'))),
    CONSTRAINT portfolio_daily_valuation_invested_check
        CHECK (invested_market_value_vnd IS NULL OR (
            invested_market_value_vnd >= 0
            AND invested_market_value_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )),
    CONSTRAINT portfolio_daily_valuation_total_check
        CHECK (total_portfolio_value_vnd IS NULL OR (
            total_portfolio_value_vnd >= 0
            AND total_portfolio_value_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        )),
    CONSTRAINT portfolio_daily_valuation_pnl_check
        CHECK (unrealized_pnl_vnd IS NULL OR unrealized_pnl_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')),
    CONSTRAINT portfolio_daily_valuation_count_check
        CHECK (
            total_holdings_count >= 0
            AND valued_holdings_count >= 0
            AND valued_holdings_count <= total_holdings_count
        ),
    CONSTRAINT portfolio_daily_valuation_flow_check
        CHECK (boundary_external_flow_vnd IS NULL OR boundary_external_flow_vnd::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')),
    CONSTRAINT portfolio_daily_valuation_flow_status_check
        CHECK (flow_status IN ('AVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE')),
    CONSTRAINT portfolio_daily_valuation_flow_interval_type_check
        CHECK (flow_interval_type IN ('FIRST_OBSERVATION', 'CONSECUTIVE_DAILY_BOUNDARY', 'MULTI_DAY_GAP')),
    CONSTRAINT portfolio_daily_valuation_flow_interval_check
        CHECK (
            (flow_interval_type = 'FIRST_OBSERVATION'
                AND flow_interval_start IS NULL
                AND flow_status = 'NOT_APPLICABLE'
                AND boundary_external_flow_vnd IS NULL)
            OR
            (flow_interval_type <> 'FIRST_OBSERVATION'
                AND flow_interval_start IS NOT NULL
                AND flow_interval_start < flow_interval_end
                AND flow_status <> 'NOT_APPLICABLE')
        ),
    CONSTRAINT portfolio_daily_valuation_hash_check
        CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT portfolio_daily_valuation_evidence_check
        CHECK (jsonb_typeof(observation_evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_portfolio_daily_valuations_profile_date
    ON public.portfolio_daily_valuations (profile_id, valuation_date DESC);

COMMENT ON TABLE public.portfolio_daily_valuations IS
    'Append-only private Portfolio valuation observations captured at the governed Asia/Ho_Chi_Minh daily boundary. No row is a historical acquisition-cost authority.';
COMMENT ON COLUMN public.portfolio_daily_valuations.boundary_external_flow_vnd IS
    'Actual VND external capital flow over (flow_interval_start, flow_interval_end]. NULL means unavailable or not applicable; it is never coerced to zero.';
COMMENT ON COLUMN public.portfolio_daily_valuations.observation_evidence IS
    'Sanitized immutable valuation, holding, price, FX, completeness, and external-flow evidence. Secrets and unnecessary personal data are forbidden.';

CREATE OR REPLACE FUNCTION public.prevent_portfolio_daily_valuation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'PDV01',
        MESSAGE = 'portfolio daily valuation observations are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_portfolio_daily_valuation_mutation
    ON public.portfolio_daily_valuations;
CREATE TRIGGER trg_prevent_portfolio_daily_valuation_mutation
    BEFORE UPDATE OR DELETE ON public.portfolio_daily_valuations
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_portfolio_daily_valuation_mutation();

ALTER TABLE public.portfolio_daily_valuations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portfolio_daily_valuations
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.portfolio_daily_valuations
    TO service_role;

REVOKE ALL ON FUNCTION public.prevent_portfolio_daily_valuation_mutation()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_portfolio_daily_valuation_mutation()
    TO service_role;

COMMIT;
