-- Migration: 20260904040000_create_market_news_articles.sql
-- Description: Durable public store for validated normalized market-news metadata.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_news_articles (
    article_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT,
    canonical_url TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    language TEXT NOT NULL,
    category TEXT,
    topic TEXT,
    related_assets JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(related_assets) = 'array'),
    geography TEXT NOT NULL CHECK (geography IN ('vietnam', 'global')),
    source_authority TEXT NOT NULL,
    quality TEXT NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'stale')),
    freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (freshness IN ('fresh', 'stale')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_news_articles IS
    'Global normalized market-news metadata. Provider collection is backend-only; public clients have read-only access.';

CREATE INDEX IF NOT EXISTS idx_market_news_published_at
    ON public.market_news_articles (published_at DESC, article_id);

CREATE INDEX IF NOT EXISTS idx_market_news_geography_topic
    ON public.market_news_articles (geography, topic, published_at DESC);

ALTER TABLE public.market_news_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_news_articles_read ON public.market_news_articles;
CREATE POLICY market_news_articles_read
    ON public.market_news_articles
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_news_articles FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_news_articles FROM anon, authenticated;

GRANT SELECT ON public.market_news_articles TO anon, authenticated;
GRANT ALL ON public.market_news_articles TO service_role;

COMMIT;
