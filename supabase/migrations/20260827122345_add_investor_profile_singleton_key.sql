-- Migration: Add singleton_key to investor_profile to enforce max-one-row invariant

-- 1. Abort if more than one profile row exists
DO $$
DECLARE
    profile_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO profile_count FROM public.investor_profile;
    IF profile_count > 1 THEN
        RAISE EXCEPTION 'Migration aborted: investor_profile table contains % rows (expected at most 1)', profile_count;
    END IF;
END $$;

-- 2. Add column singleton_key with DEFAULT 1
ALTER TABLE public.investor_profile
ADD COLUMN IF NOT EXISTS singleton_key SMALLINT NOT NULL DEFAULT 1;

-- 3. Add CHECK constraint (singleton_key = 1)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'investor_profile_singleton_check'
    ) THEN
        ALTER TABLE public.investor_profile
        ADD CONSTRAINT investor_profile_singleton_check CHECK (singleton_key = 1);
    END IF;
END $$;

-- 4. Add UNIQUE constraint on singleton_key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'investor_profile_singleton_unique'
    ) THEN
        ALTER TABLE public.investor_profile
        ADD CONSTRAINT investor_profile_singleton_unique UNIQUE (singleton_key);
    END IF;
END $$;
