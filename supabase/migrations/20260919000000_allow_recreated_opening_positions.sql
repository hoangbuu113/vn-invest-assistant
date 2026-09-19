-- Allow a cancelled opening-position declaration to be replaced without
-- rewriting its immutable historical baseline. Only one active declaration
-- may exist for a profile/asset pair.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_opening_baseline_profile_asset_active
    ON public.position_opening_baselines (profile_id, asset_id)
    WHERE cancelled_at IS NULL;

ALTER TABLE public.position_opening_baselines
    DROP CONSTRAINT IF EXISTS uq_position_opening_baseline_profile_asset;

COMMENT ON INDEX public.uq_position_opening_baseline_profile_asset_active IS
    'Allows immutable cancelled opening-position history while enforcing one active baseline per profile and asset.';

COMMIT;
