-- Migration: 20260905020000_create_market_claims_and_evidence_links.sql
-- Description: Creates public.market_claims and public.claim_evidence_links for deterministic claim, corroboration, and contradiction tracking.
-- Public read-only via RLS; writes strictly restricted to service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id TEXT NOT NULL UNIQUE,
    claim_type TEXT NOT NULL CHECK (
        claim_type IN (
            'MACRO_NUMERIC',
            'MONETARY_NUMERIC',
            'TRADE_NUMERIC',
            'MARKET_EVENT',
            'POLICY_EVENT',
            'CORPORATE_EVENT',
            'NEWS_ASSERTION'
        )
    ),
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    numeric_value NUMERIC CHECK (
        numeric_value IS NULL OR numeric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    value_text TEXT,
    unit TEXT,
    reference_period TEXT,
    scope TEXT,
    methodology TEXT,
    revision_marker TEXT,
    authority_level TEXT NOT NULL CHECK (
        authority_level IN (
            'PRIMARY_OFFICIAL',
            'REGULATORY_OFFICIAL',
            'MARKET_REFERENCE',
            'FINANCIAL_MEDIA',
            'NEWS_AGGREGATOR',
            'UNVERIFIED_MEDIA'
        )
    ),
    support_status TEXT NOT NULL CHECK (
        support_status IN (
            'SUPPORTED',
            'CORROBORATED',
            'SINGLE_SOURCE',
            'CONTRADICTED',
            'SUPERSEDED',
            'INSUFFICIENT_EVIDENCE',
            'UNRESOLVED'
        )
    ),
    source_count INTEGER NOT NULL DEFAULT 1 CHECK (source_count >= 0),
    independent_source_count INTEGER NOT NULL DEFAULT 1 CHECK (independent_source_count >= 0),
    contradiction_count INTEGER NOT NULL DEFAULT 0 CHECK (contradiction_count >= 0),
    revision_of TEXT,
    confidence_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
    limitations TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_claims IS
    'Deterministic market claims extracted from verified observations and structured news. Public read, service_role write only.';

CREATE TABLE IF NOT EXISTS public.claim_evidence_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id TEXT NOT NULL REFERENCES public.market_claims(claim_id) ON DELETE CASCADE,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('observation', 'article')),
    evidence_id TEXT NOT NULL,
    source_family TEXT NOT NULL,
    is_independent BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_claim_evidence_link UNIQUE (claim_id, evidence_type, evidence_id)
);

COMMENT ON TABLE public.claim_evidence_links IS
    'Links linking claims to underlying observation or news evidence records with source family classification.';

-- Indices
CREATE INDEX IF NOT EXISTS idx_market_claims_subject_period
    ON public.market_claims (subject, reference_period, support_status);

CREATE INDEX IF NOT EXISTS idx_market_claims_status
    ON public.market_claims (support_status);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_links_claim
    ON public.claim_evidence_links (claim_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_links_evidence
    ON public.claim_evidence_links (evidence_type, evidence_id);

-- Row Level Security (RLS)
ALTER TABLE public.market_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_evidence_links ENABLE ROW LEVEL SECURITY;

-- Read policy: Public global data readable by all (anon, authenticated, service_role)
DROP POLICY IF EXISTS market_claims_read ON public.market_claims;
CREATE POLICY market_claims_read
    ON public.market_claims
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS claim_evidence_links_read ON public.claim_evidence_links;
CREATE POLICY claim_evidence_links_read
    ON public.claim_evidence_links
    FOR SELECT
    USING (true);

-- Revoke modifications from public, anon, authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_claims FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_claims FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_links FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_links FROM anon, authenticated;

-- Grant select to anon and authenticated
GRANT SELECT ON public.market_claims TO anon, authenticated;
GRANT SELECT ON public.claim_evidence_links TO anon, authenticated;

-- Grant all privileges to service_role
GRANT ALL ON public.market_claims TO service_role;
GRANT ALL ON public.claim_evidence_links TO service_role;

COMMIT;
