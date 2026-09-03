-- Migration: 20260904010000_finalize_public_multi_user_auth.sql
-- Description: Final cutover to public multi-user authentication.
-- Purges disposable unowned legacy test profile and private child data,
-- drops legacy claim database function and partial index, and enforces
-- NOT NULL on investor_profile.user_id.

BEGIN;

-- ============================================================================
-- 1. DELETE DISPOSABLE UNOWNED LEGACY TEST DATA
-- ============================================================================

-- Delete child records belonging strictly to unowned legacy test profiles (user_id IS NULL)
DELETE FROM public.alert_notification_deliveries
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.push_subscriptions
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.price_alerts
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.watchlist_items
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.cash_ledger_entries
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.cash_ledger_activation
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.holdings
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.position_opening_baselines
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.position_ledger_activation
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

DELETE FROM public.portfolio_transactions
WHERE profile_id IN (SELECT id FROM public.investor_profile WHERE user_id IS NULL);

-- Delete the unowned legacy test profile itself
DELETE FROM public.investor_profile
WHERE user_id IS NULL;


-- ============================================================================
-- 2. DROP OBSOLETE LEGACY CLAIM OBJECTS & PARTIAL INDEX
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_legacy_profile(UUID);

DROP INDEX IF EXISTS public.uq_investor_profile_legacy_unowned;


-- ============================================================================
-- 3. ENFORCE MANDATORY NOT NULL ON investor_profile.user_id
-- ============================================================================

-- Every investor profile must now be strictly owned by an auth.users record.
ALTER TABLE public.investor_profile
    ALTER COLUMN user_id SET NOT NULL;

COMMENT ON COLUMN public.investor_profile.user_id IS
    'Authoritative 1:1 link to Supabase auth.users(id). Mandatory for all profiles.';

COMMIT;

