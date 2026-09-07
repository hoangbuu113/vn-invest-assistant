-- Forward-only foundation for manually imported, validated official monetary evidence.
-- This migration does not mutate financial records or the prior confidence migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.official_monetary_evidence_vintages (
    vintage_id TEXT PRIMARY KEY,
    supersedes TEXT REFERENCES public.official_monetary_evidence_vintages(vintage_id) ON DELETE RESTRICT,
    fact_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    value NUMERIC NOT NULL CHECK (value NOT IN ('Infinity'::numeric, '-Infinity'::numeric, 'NaN'::numeric)),
    unit TEXT NOT NULL,
    reference_period TEXT NOT NULL,
    observation_date DATE NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ NOT NULL CHECK (effective_to >= effective_from),
    origin_issuer TEXT NOT NULL CHECK (origin_issuer = 'SBV'),
    publisher TEXT NOT NULL CHECK (publisher = 'SBV'),
    delivery_provider TEXT NOT NULL,
    provenance_family TEXT NOT NULL CHECK (provenance_family = 'OFFICIAL_SBV'),
    dependency_group TEXT NOT NULL CHECK (dependency_group = 'OFFICIAL_SBV'),
    support_scope TEXT NOT NULL,
    support_path_id TEXT NOT NULL CHECK (support_path_id IN ('PATH_SBV_DIRECT', 'PATH_SBV_VERIFIED_ATTACHMENT')),
    authority_level TEXT NOT NULL CHECK (authority_level = 'REGULATORY_OFFICIAL'),
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://([a-z0-9-]+\.)*sbv\.gov\.vn/'),
    attachment_url TEXT CHECK (attachment_url IS NULL OR attachment_url ~ '^https://([a-z0-9-]+\.)*sbv\.gov\.vn/'),
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    source_available_at TIMESTAMPTZ NOT NULL,
    system_first_seen_at TIMESTAMPTZ NOT NULL,
    system_knowable_at TIMESTAMPTZ NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL,
    validated_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL,
    parser_profile_version TEXT NOT NULL,
    methodology_version TEXT NOT NULL,
    replay_mode TEXT NOT NULL DEFAULT 'AS_OPERATED' CHECK (replay_mode IN ('AS_OPERATED', 'RECONSTRUCTED')),
    artifact_text TEXT NOT NULL,
    CHECK (system_knowable_at = GREATEST(source_available_at, system_first_seen_at)),
    UNIQUE (observation_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_official_monetary_evidence_fact_knowable
    ON public.official_monetary_evidence_vintages (fact_id, system_knowable_at DESC, observation_date DESC);
CREATE INDEX IF NOT EXISTS idx_official_monetary_evidence_document
    ON public.official_monetary_evidence_vintages (document_id, accepted_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_official_monetary_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Official monetary evidence vintages are immutable: UPDATE and DELETE are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_official_monetary_evidence_mutation ON public.official_monetary_evidence_vintages;
CREATE TRIGGER trg_prevent_official_monetary_evidence_mutation
    BEFORE UPDATE OR DELETE ON public.official_monetary_evidence_vintages
    FOR EACH ROW EXECUTE FUNCTION public.prevent_official_monetary_evidence_mutation();

ALTER TABLE public.official_monetary_evidence_vintages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.official_monetary_evidence_vintages FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.official_monetary_evidence_vintages FROM service_role;
GRANT SELECT, INSERT ON public.official_monetary_evidence_vintages TO service_role;

COMMIT;
