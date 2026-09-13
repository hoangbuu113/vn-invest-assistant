-- Migration: 20260913000000_create_verified_equity_fundamentals.sql
-- Description: Immutable, manually verified official-filing fundamentals for VN industrial equities.

BEGIN;

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS fundamentals_company_type VARCHAR(16) CHECK (
        fundamentals_company_type IS NULL OR fundamentals_company_type IN (
            'INDUSTRIAL', 'BANK', 'SECURITIES', 'INSURANCE'
        )
    );

COMMENT ON COLUMN public.assets.fundamentals_company_type IS
    'Governed issuer classification for Fundamentals V1A eligibility; null means not classified.';

UPDATE public.assets
SET fundamentals_company_type = CASE symbol
    WHEN 'VCB' THEN 'BANK'
    WHEN 'FPT' THEN 'INDUSTRIAL'
    WHEN 'HPG' THEN 'INDUSTRIAL'
    WHEN 'VNM' THEN 'INDUSTRIAL'
END
WHERE fundamentals_company_type IS NULL
  AND symbol IN ('VCB', 'FPT', 'HPG', 'VNM');

CREATE TABLE IF NOT EXISTS public.vn_equity_fundamental_filings (
    id UUID PRIMARY KEY,
    filing_identity_hash TEXT NOT NULL UNIQUE CHECK (filing_identity_hash ~ '^[0-9a-f]{64}$'),
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    ticker VARCHAR(20) NOT NULL CHECK (ticker = UPPER(BTRIM(ticker)) AND BTRIM(ticker) <> ''),
    issuer_legal_name TEXT NOT NULL CHECK (BTRIM(issuer_legal_name) <> ''),
    exchange VARCHAR(20) NOT NULL CHECK (exchange = UPPER(BTRIM(exchange)) AND BTRIM(exchange) <> ''),
    company_type VARCHAR(16) NOT NULL CHECK (company_type = 'INDUSTRIAL'),
    source_authority VARCHAR(16) NOT NULL CHECK (source_authority IN ('SSC', 'HOSE', 'HNX', 'ISSUER')),
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://[^[:space:]]+$'),
    source_disclosure_id TEXT CHECK (source_disclosure_id IS NULL OR BTRIM(source_disclosure_id) <> ''),
    source_title TEXT NOT NULL CHECK (BTRIM(source_title) <> ''),
    published_at TIMESTAMPTZ NOT NULL,
    source_available_at TIMESTAMPTZ NOT NULL CHECK (source_available_at >= published_at),
    fetched_at TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    system_knowable_at TIMESTAMPTZ NOT NULL CHECK (
        system_knowable_at = GREATEST(first_seen_at, source_available_at)
    ),
    statement_scope VARCHAR(16) NOT NULL CHECK (statement_scope IN ('CONSOLIDATED', 'SEPARATE')),
    audit_status VARCHAR(16) NOT NULL CHECK (audit_status IN ('UNAUDITED', 'REVIEWED', 'AUDITED')),
    accounting_regime TEXT CHECK (accounting_regime IS NULL OR BTRIM(accounting_regime) <> ''),
    fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 2200),
    fiscal_quarter SMALLINT CHECK (fiscal_quarter BETWEEN 1 AND 4),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL CHECK (period_end >= period_start),
    period_kind VARCHAR(16) NOT NULL CHECK (period_kind IN ('QUARTER', 'YTD', 'HALF_YEAR', 'ANNUAL', 'INSTANT')),
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    supersedes_filing_id UUID REFERENCES public.vn_equity_fundamental_filings(id) ON DELETE RESTRICT,
    document_hash TEXT CHECK (document_hash IS NULL OR document_hash ~ '^[0-9a-f]{64}$'),
    verification_status VARCHAR(16) NOT NULL CHECK (verification_status IN ('VERIFIED', 'PENDING', 'REJECTED')),
    methodology_version TEXT NOT NULL CHECK (methodology_version = 'vn-equity-fundamentals-v1a'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (recorded_at = first_seen_at),
    CHECK (fetched_at IS NULL OR (fetched_at >= source_available_at AND fetched_at <= recorded_at)),
    CHECK (
        (supersedes_filing_id IS NULL AND revision_number = 1)
        OR (supersedes_filing_id IS NOT NULL AND revision_number > 1)
    ),
    CHECK (period_kind NOT IN ('QUARTER', 'YTD') OR fiscal_quarter IS NOT NULL)
);

COMMENT ON TABLE public.vn_equity_fundamental_filings IS
    'Immutable official-filing identities and revisions. Inserts are service-only through a validating RPC.';

CREATE TABLE IF NOT EXISTS public.vn_equity_fundamental_facts (
    id UUID PRIMARY KEY,
    filing_id UUID NOT NULL REFERENCES public.vn_equity_fundamental_filings(id) ON DELETE RESTRICT,
    metric_code VARCHAR(64) NOT NULL CHECK (metric_code IN (
        'totalAssets', 'totalLiabilities', 'equity', 'cashAndCashEquivalents',
        'netRevenue', 'grossProfit', 'profitBeforeTax', 'netIncome',
        'parentShareholdersProfit', 'operatingCashFlow', 'investingCashFlow',
        'financingCashFlow'
    )),
    source_line_code TEXT CHECK (source_line_code IS NULL OR BTRIM(source_line_code) <> ''),
    source_label TEXT NOT NULL CHECK (BTRIM(source_label) <> ''),
    numeric_value NUMERIC(52, 12) CHECK (
        numeric_value IS NULL OR numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    currency_code VARCHAR(12) NOT NULL CHECK (currency_code ~ '^[A-Z][A-Z0-9]{2,11}$'),
    unit_scale BIGINT NOT NULL CHECK (unit_scale IN (1, 1000, 1000000, 1000000000)),
    source_page INTEGER CHECK (source_page IS NULL OR source_page >= 1),
    source_sheet TEXT CHECK (source_sheet IS NULL OR BTRIM(source_sheet) <> ''),
    source_cell VARCHAR(32) CHECK (source_cell IS NULL OR source_cell ~ '^[A-Z]{1,4}[1-9][0-9]{0,6}$'),
    value_kind VARCHAR(16) NOT NULL CHECK (value_kind IN ('REPORTED', 'DERIVED')),
    derivation_formula TEXT CHECK (derivation_formula IS NULL OR BTRIM(derivation_formula) <> ''),
    confidence NUMERIC NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    validation_status VARCHAR(16) NOT NULL CHECK (validation_status IN ('VERIFIED', 'PENDING', 'REJECTED')),
    missing_reason TEXT CHECK (missing_reason IS NULL OR BTRIM(missing_reason) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (filing_id, metric_code),
    CHECK (
        (numeric_value IS NULL AND missing_reason IS NOT NULL)
        OR (numeric_value IS NOT NULL AND missing_reason IS NULL)
    ),
    CHECK (
        (value_kind = 'DERIVED' AND derivation_formula IS NOT NULL)
        OR (value_kind = 'REPORTED' AND derivation_formula IS NULL)
    )
);

COMMENT ON TABLE public.vn_equity_fundamental_facts IS
    'Decimal-safe, source-located facts. Null is explicit missing evidence; zero remains a numeric value.';

CREATE INDEX IF NOT EXISTS idx_vn_equity_fundamental_filings_asset_period
    ON public.vn_equity_fundamental_filings (asset_id, period_end DESC, revision_number DESC);

CREATE INDEX IF NOT EXISTS idx_vn_equity_fundamental_filings_asset_knowable
    ON public.vn_equity_fundamental_filings (asset_id, system_knowable_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vn_equity_fundamental_filings_superseded_once
    ON public.vn_equity_fundamental_filings (supersedes_filing_id)
    WHERE supersedes_filing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vn_equity_fundamental_facts_filing
    ON public.vn_equity_fundamental_facts (filing_id, metric_code);

ALTER TABLE public.vn_equity_fundamental_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vn_equity_fundamental_facts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vn_equity_fundamental_filings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.vn_equity_fundamental_facts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.insert_vn_equity_fundamental_filing(
    p_filing JSONB,
    p_facts JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID := (p_filing ->> 'id')::UUID;
    v_supersedes_id UUID := NULLIF(p_filing ->> 'supersedes_filing_id', '')::UUID;
    v_previous public.vn_equity_fundamental_filings%ROWTYPE;
    v_fact JSONB;
BEGIN
    IF jsonb_typeof(p_filing) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_facts) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_facts) = 0 THEN
        RAISE EXCEPTION 'Filing and a non-empty facts array are required'
            USING ERRCODE = '22023';
    END IF;

    IF v_supersedes_id IS NOT NULL THEN
        SELECT *
        INTO v_previous
        FROM public.vn_equity_fundamental_filings
        WHERE id = v_supersedes_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Superseded filing does not exist' USING ERRCODE = 'VF001';
        END IF;

        IF v_previous.asset_id IS DISTINCT FROM (p_filing ->> 'asset_id')::UUID
           OR v_previous.statement_scope IS DISTINCT FROM p_filing ->> 'statement_scope'
           OR v_previous.period_kind IS DISTINCT FROM p_filing ->> 'period_kind'
           OR v_previous.period_start IS DISTINCT FROM (p_filing ->> 'period_start')::DATE
           OR v_previous.period_end IS DISTINCT FROM (p_filing ->> 'period_end')::DATE
           OR v_previous.fiscal_year IS DISTINCT FROM (p_filing ->> 'fiscal_year')::INTEGER
           OR v_previous.fiscal_quarter IS DISTINCT FROM NULLIF(p_filing ->> 'fiscal_quarter', '')::SMALLINT
           OR (p_filing ->> 'revision_number')::INTEGER <> v_previous.revision_number + 1
           OR EXISTS (
               SELECT 1
               FROM public.vn_equity_fundamental_filings
               WHERE supersedes_filing_id = v_supersedes_id
           ) THEN
            RAISE EXCEPTION 'Invalid or conflicting filing revision chain' USING ERRCODE = 'VF002';
        END IF;
    ELSIF (p_filing ->> 'revision_number')::INTEGER <> 1 THEN
        RAISE EXCEPTION 'Original filing revision must be 1' USING ERRCODE = 'VF002';
    END IF;

    INSERT INTO public.vn_equity_fundamental_filings (
        id, filing_identity_hash, asset_id, ticker, issuer_legal_name, exchange,
        company_type, source_authority, source_url, source_disclosure_id, source_title,
        published_at, source_available_at, fetched_at, recorded_at, first_seen_at,
        system_knowable_at, statement_scope, audit_status, accounting_regime,
        fiscal_year, fiscal_quarter, period_start, period_end, period_kind,
        revision_number, supersedes_filing_id, document_hash, verification_status,
        methodology_version
    ) VALUES (
        v_id,
        p_filing ->> 'filing_identity_hash',
        (p_filing ->> 'asset_id')::UUID,
        p_filing ->> 'ticker',
        p_filing ->> 'issuer_legal_name',
        p_filing ->> 'exchange',
        p_filing ->> 'company_type',
        p_filing ->> 'source_authority',
        p_filing ->> 'source_url',
        NULLIF(p_filing ->> 'source_disclosure_id', ''),
        p_filing ->> 'source_title',
        (p_filing ->> 'published_at')::TIMESTAMPTZ,
        (p_filing ->> 'source_available_at')::TIMESTAMPTZ,
        NULLIF(p_filing ->> 'fetched_at', '')::TIMESTAMPTZ,
        (p_filing ->> 'recorded_at')::TIMESTAMPTZ,
        (p_filing ->> 'first_seen_at')::TIMESTAMPTZ,
        (p_filing ->> 'system_knowable_at')::TIMESTAMPTZ,
        p_filing ->> 'statement_scope',
        p_filing ->> 'audit_status',
        NULLIF(p_filing ->> 'accounting_regime', ''),
        (p_filing ->> 'fiscal_year')::INTEGER,
        NULLIF(p_filing ->> 'fiscal_quarter', '')::SMALLINT,
        (p_filing ->> 'period_start')::DATE,
        (p_filing ->> 'period_end')::DATE,
        p_filing ->> 'period_kind',
        (p_filing ->> 'revision_number')::INTEGER,
        v_supersedes_id,
        NULLIF(p_filing ->> 'document_hash', ''),
        p_filing ->> 'verification_status',
        p_filing ->> 'methodology_version'
    );

    FOR v_fact IN SELECT value FROM jsonb_array_elements(p_facts)
    LOOP
        INSERT INTO public.vn_equity_fundamental_facts (
            id, filing_id, metric_code, source_line_code, source_label, numeric_value,
            currency_code, unit_scale, source_page, source_sheet, source_cell,
            value_kind, derivation_formula, confidence, validation_status, missing_reason
        ) VALUES (
            (v_fact ->> 'id')::UUID,
            v_id,
            v_fact ->> 'metric_code',
            NULLIF(v_fact ->> 'source_line_code', ''),
            v_fact ->> 'source_label',
            NULLIF(v_fact ->> 'numeric_value', '')::NUMERIC,
            v_fact ->> 'currency_code',
            (v_fact ->> 'unit_scale')::BIGINT,
            NULLIF(v_fact ->> 'source_page', '')::INTEGER,
            NULLIF(v_fact ->> 'source_sheet', ''),
            NULLIF(v_fact ->> 'source_cell', ''),
            v_fact ->> 'value_kind',
            NULLIF(v_fact ->> 'derivation_formula', ''),
            (v_fact ->> 'confidence')::NUMERIC,
            v_fact ->> 'validation_status',
            NULLIF(v_fact ->> 'missing_reason', '')
        );
    END LOOP;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_vn_equity_fundamental_filings(p_asset_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        jsonb_agg(
            to_jsonb(filing) || jsonb_build_object(
                'facts', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', fact.id,
                            'filing_id', fact.filing_id,
                            'metric_code', fact.metric_code,
                            'source_line_code', fact.source_line_code,
                            'source_label', fact.source_label,
                            'numeric_value', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM fact.numeric_value::TEXT)),
                            'currency_code', fact.currency_code,
                            'unit_scale', fact.unit_scale,
                            'source_page', fact.source_page,
                            'source_sheet', fact.source_sheet,
                            'source_cell', fact.source_cell,
                            'value_kind', fact.value_kind,
                            'derivation_formula', fact.derivation_formula,
                            'confidence', fact.confidence,
                            'validation_status', fact.validation_status,
                            'missing_reason', fact.missing_reason
                        ) ORDER BY fact.metric_code
                    )
                    FROM public.vn_equity_fundamental_facts AS fact
                    WHERE fact.filing_id = filing.id
                ), '[]'::JSONB)
            ) ORDER BY filing.period_end DESC, filing.revision_number DESC, filing.system_knowable_at DESC
        ),
        '[]'::JSONB
    )
    FROM public.vn_equity_fundamental_filings AS filing
    WHERE filing.asset_id = p_asset_id;
$$;

REVOKE ALL ON FUNCTION public.insert_vn_equity_fundamental_filing(JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_vn_equity_fundamental_filing(JSONB, JSONB)
    TO service_role;

REVOKE ALL ON FUNCTION public.read_vn_equity_fundamental_filings(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_vn_equity_fundamental_filings(UUID)
    TO service_role;

COMMIT;
