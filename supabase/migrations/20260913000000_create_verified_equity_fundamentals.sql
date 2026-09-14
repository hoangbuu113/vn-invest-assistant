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

-- Preserve any historical generic fundamental rows, but prohibit new writes.
-- V1A filing/fact evidence is the only authoritative fundamentals path.
ALTER TABLE IF EXISTS public.vn_equity_evidence_observations
    DROP CONSTRAINT IF EXISTS vn_equity_evidence_no_new_generic_fundamentals;
ALTER TABLE IF EXISTS public.vn_equity_evidence_observations
    ADD CONSTRAINT vn_equity_evidence_no_new_generic_fundamentals
    CHECK (evidence_type <> 'fundamental') NOT VALID;

CREATE TABLE IF NOT EXISTS public.vn_equity_fundamental_filings (
    id UUID PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    ticker VARCHAR(20) NOT NULL CHECK (ticker = UPPER(BTRIM(ticker)) AND BTRIM(ticker) <> ''),
    issuer_legal_name TEXT NOT NULL CHECK (BTRIM(issuer_legal_name) <> ''),
    exchange VARCHAR(20) NOT NULL CHECK (exchange = UPPER(BTRIM(exchange)) AND BTRIM(exchange) <> ''),
    company_type VARCHAR(16) NOT NULL CHECK (company_type = 'INDUSTRIAL'),
    source_authority VARCHAR(16) NOT NULL CHECK (source_authority IN ('SSC', 'HOSE', 'HNX')),
    source_url TEXT NOT NULL CHECK (
        source_url !~ '[[:space:]]'
        AND (
            (source_authority = 'SSC' AND source_url ~* '^https://([a-z0-9-]+\.)*ssc\.gov\.vn([/?#]|$)')
            OR (source_authority = 'HOSE' AND source_url ~* '^https://([a-z0-9-]+\.)*hsx\.vn([/?#]|$)')
            OR (source_authority = 'HNX' AND source_url ~* '^https://([a-z0-9-]+\.)*hnx\.vn([/?#]|$)')
        )
    ),
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
    period_start DATE,
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
    CHECK (source_disclosure_id IS NOT NULL OR document_hash IS NOT NULL),
    CHECK (
        (period_kind = 'INSTANT' AND period_start IS NULL)
        OR (period_kind <> 'INSTANT' AND period_start IS NOT NULL AND period_end >= period_start)
    ),
    CHECK (
        (period_kind = 'ANNUAL' AND fiscal_quarter IS NULL
            AND period_start = make_date(fiscal_year, 1, 1)
            AND period_end = make_date(fiscal_year, 12, 31))
        OR (period_kind = 'HALF_YEAR' AND fiscal_quarter = 2
            AND period_start = make_date(fiscal_year, 1, 1)
            AND period_end = make_date(fiscal_year, 6, 30))
        OR (period_kind = 'QUARTER' AND fiscal_quarter IS NOT NULL
            AND period_start = make_date(fiscal_year, ((fiscal_quarter - 1) * 3) + 1, 1)
            AND period_end = (make_date(fiscal_year, fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE)
        OR (period_kind = 'YTD' AND fiscal_quarter IS NOT NULL
            AND period_start = make_date(fiscal_year, 1, 1)
            AND period_end = (make_date(fiscal_year, fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE)
        OR (period_kind = 'INSTANT'
            AND period_end = CASE
                WHEN fiscal_quarter IS NULL THEN make_date(fiscal_year, 12, 31)
                ELSE (make_date(fiscal_year, fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE
            END)
    )
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
    fact_period_kind VARCHAR(16) NOT NULL CHECK (fact_period_kind IN ('QUARTER', 'YTD', 'HALF_YEAR', 'ANNUAL', 'INSTANT')),
    fact_period_start DATE,
    fact_period_end DATE NOT NULL,
    fact_fiscal_year INTEGER NOT NULL CHECK (fact_fiscal_year BETWEEN 1900 AND 2200),
    fact_fiscal_quarter SMALLINT CHECK (fact_fiscal_quarter BETWEEN 1 AND 4),
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
    CHECK (
        (numeric_value IS NULL AND missing_reason IS NOT NULL)
        OR (numeric_value IS NOT NULL AND missing_reason IS NULL)
    ),
    CHECK (
        (value_kind = 'DERIVED' AND derivation_formula IS NOT NULL)
        OR (value_kind = 'REPORTED' AND derivation_formula IS NULL)
    ),
    CHECK (
        (metric_code IN ('totalAssets', 'totalLiabilities', 'equity', 'cashAndCashEquivalents')
            AND fact_period_kind = 'INSTANT')
        OR (metric_code IN (
            'netRevenue', 'grossProfit', 'profitBeforeTax', 'netIncome',
            'parentShareholdersProfit', 'operatingCashFlow', 'investingCashFlow',
            'financingCashFlow'
        ) AND fact_period_kind <> 'INSTANT')
    ),
    CHECK (
        (fact_period_kind = 'INSTANT' AND fact_period_start IS NULL)
        OR (fact_period_kind <> 'INSTANT' AND fact_period_start IS NOT NULL AND fact_period_end >= fact_period_start)
    ),
    CHECK (
        (fact_period_kind = 'ANNUAL' AND fact_fiscal_quarter IS NULL
            AND fact_period_start = make_date(fact_fiscal_year, 1, 1)
            AND fact_period_end = make_date(fact_fiscal_year, 12, 31))
        OR (fact_period_kind = 'HALF_YEAR' AND fact_fiscal_quarter = 2
            AND fact_period_start = make_date(fact_fiscal_year, 1, 1)
            AND fact_period_end = make_date(fact_fiscal_year, 6, 30))
        OR (fact_period_kind = 'QUARTER' AND fact_fiscal_quarter IS NOT NULL
            AND fact_period_start = make_date(fact_fiscal_year, ((fact_fiscal_quarter - 1) * 3) + 1, 1)
            AND fact_period_end = (make_date(fact_fiscal_year, fact_fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE)
        OR (fact_period_kind = 'YTD' AND fact_fiscal_quarter IS NOT NULL
            AND fact_period_start = make_date(fact_fiscal_year, 1, 1)
            AND fact_period_end = (make_date(fact_fiscal_year, fact_fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE)
        OR (fact_period_kind = 'INSTANT'
            AND fact_period_end = CASE
                WHEN fact_fiscal_quarter IS NULL THEN make_date(fact_fiscal_year, 12, 31)
                ELSE (make_date(fact_fiscal_year, fact_fiscal_quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE
            END)
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_vn_equity_fundamental_filings_logical_revision
    ON public.vn_equity_fundamental_filings (
        asset_id, statement_scope, fiscal_year, COALESCE(fiscal_quarter, 0),
        COALESCE(period_start, DATE '0001-01-01'), period_end, period_kind, revision_number
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_vn_equity_fundamental_filings_disclosure_revision
    ON public.vn_equity_fundamental_filings (
        asset_id, source_authority, source_disclosure_id, statement_scope,
        fiscal_year, COALESCE(fiscal_quarter, 0), period_kind, revision_number
    )
    WHERE source_disclosure_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vn_equity_fundamental_filings_document_revision
    ON public.vn_equity_fundamental_filings (
        asset_id, source_authority, document_hash, statement_scope,
        fiscal_year, COALESCE(fiscal_quarter, 0), period_kind, revision_number
    )
    WHERE source_disclosure_id IS NULL AND document_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vn_equity_fundamental_facts_temporal_identity
    ON public.vn_equity_fundamental_facts (
        filing_id, metric_code, fact_period_kind,
        COALESCE(fact_period_start, DATE '0001-01-01'), fact_period_end
    );

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
    v_asset public.assets%ROWTYPE;
    v_previous public.vn_equity_fundamental_filings%ROWTYPE;
    v_fact JSONB;
BEGIN
    IF jsonb_typeof(p_filing) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_facts) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_facts) = 0 THEN
        RAISE EXCEPTION 'Filing and a non-empty facts array are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_asset
    FROM public.assets
    WHERE id = (p_filing ->> 'asset_id')::UUID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Canonical asset does not exist' USING ERRCODE = 'VF003';
    END IF;

    IF v_asset.asset_type IS DISTINCT FROM 'stock'
       OR v_asset.market_policy IS DISTINCT FROM 'VN_EXCHANGE'
       OR v_asset.fundamentals_company_type IS DISTINCT FROM 'INDUSTRIAL' THEN
        RAISE EXCEPTION 'Canonical asset is not eligible for Fundamentals V1A'
            USING ERRCODE = 'VF003';
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
        id, asset_id, ticker, issuer_legal_name, exchange,
        company_type, source_authority, source_url, source_disclosure_id, source_title,
        published_at, source_available_at, fetched_at, recorded_at, first_seen_at,
        system_knowable_at, statement_scope, audit_status, accounting_regime,
        fiscal_year, fiscal_quarter, period_start, period_end, period_kind,
        revision_number, supersedes_filing_id, document_hash, verification_status,
        methodology_version
    ) VALUES (
        v_id,
        (p_filing ->> 'asset_id')::UUID,
        v_asset.symbol,
        v_asset.name,
        COALESCE(v_asset.market_code, v_asset.exchange),
        v_asset.fundamentals_company_type,
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
        IF (v_fact ->> 'fact_fiscal_year')::INTEGER IS DISTINCT FROM (p_filing ->> 'fiscal_year')::INTEGER
           OR NULLIF(v_fact ->> 'fact_fiscal_quarter', '')::SMALLINT IS DISTINCT FROM NULLIF(p_filing ->> 'fiscal_quarter', '')::SMALLINT
           OR (v_fact ->> 'fact_period_end')::DATE IS DISTINCT FROM (p_filing ->> 'period_end')::DATE
           OR NOT (
                (p_filing ->> 'period_kind' = 'ANNUAL'
                    AND (v_fact ->> 'fact_period_kind') IN ('ANNUAL', 'INSTANT'))
                OR (p_filing ->> 'period_kind' IN ('QUARTER', 'YTD')
                    AND (v_fact ->> 'fact_period_kind') IN ('QUARTER', 'YTD', 'INSTANT'))
                OR (p_filing ->> 'period_kind' = 'HALF_YEAR'
                    AND (v_fact ->> 'fact_period_kind') IN ('QUARTER', 'YTD', 'HALF_YEAR', 'INSTANT'))
                OR (p_filing ->> 'period_kind' = 'INSTANT'
                    AND v_fact ->> 'fact_period_kind' = 'INSTANT')
           ) THEN
            RAISE EXCEPTION 'Fact temporal context does not match its filing'
                USING ERRCODE = 'VF004';
        END IF;

        INSERT INTO public.vn_equity_fundamental_facts (
            id, filing_id, metric_code, fact_period_kind, fact_period_start,
            fact_period_end, fact_fiscal_year, fact_fiscal_quarter,
            source_line_code, source_label, numeric_value,
            currency_code, unit_scale, source_page, source_sheet, source_cell,
            value_kind, derivation_formula, confidence, validation_status, missing_reason
        ) VALUES (
            (v_fact ->> 'id')::UUID,
            v_id,
            v_fact ->> 'metric_code',
            v_fact ->> 'fact_period_kind',
            NULLIF(v_fact ->> 'fact_period_start', '')::DATE,
            (v_fact ->> 'fact_period_end')::DATE,
            (v_fact ->> 'fact_fiscal_year')::INTEGER,
            NULLIF(v_fact ->> 'fact_fiscal_quarter', '')::SMALLINT,
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
                            'fact_period_kind', fact.fact_period_kind,
                            'fact_period_start', fact.fact_period_start,
                            'fact_period_end', fact.fact_period_end,
                            'fact_fiscal_year', fact.fact_fiscal_year,
                            'fact_fiscal_quarter', fact.fact_fiscal_quarter,
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
