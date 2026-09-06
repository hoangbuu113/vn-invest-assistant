-- Migration: 20260906040000_fix_market_strategist_publication_null.sql
-- Description: Hardens publish_strategy_version_atomic to handle JSONB null vs SQL NULL
-- for shock_override, preventing check constraint violations on strategy_versions_shock_override_check.

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_strategy_version_atomic(
    p_new_version JSONB,
    p_expected_current_strategy_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_published RECORD;
    v_inserted RECORD;
    v_new_strategy_id TEXT;
BEGIN
    IF p_new_version IS NULL OR jsonb_typeof(p_new_version) != 'object' THEN
        RAISE EXCEPTION 'publish_strategy_version_atomic: p_new_version must be a valid JSON object';
    END IF;

    v_new_strategy_id := p_new_version->>'strategy_id';
    IF v_new_strategy_id IS NULL OR length(trim(v_new_strategy_id)) = 0 THEN
        RAISE EXCEPTION 'publish_strategy_version_atomic: strategy_id is required';
    END IF;

    -- 1. Lock and inspect current published strategy (if any)
    SELECT strategy_id, status
      INTO v_current_published
      FROM public.strategy_versions
     WHERE status = 'published'
       FOR UPDATE;

    -- 2. Verify expected current strategy
    IF p_expected_current_strategy_id IS NOT NULL THEN
        IF v_current_published.strategy_id IS NULL THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Expected published strategy % but none was found', p_expected_current_strategy_id
                USING ERRCODE = 'P0001';
        ELSIF v_current_published.strategy_id != p_expected_current_strategy_id THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Expected published strategy % but found %', p_expected_current_strategy_id, v_current_published.strategy_id
                USING ERRCODE = 'P0001';
        END IF;
    ELSE
        -- Cold start bootstrap: if expected is NULL, but a published strategy already exists:
        IF v_current_published.strategy_id IS NOT NULL THEN
            RAISE EXCEPTION 'STRATEGY_VERSION_CONFLICT: Cold-start bootstrap conflict; published strategy % already exists', v_current_published.strategy_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Supersede expected current strategy
    IF v_current_published.strategy_id IS NOT NULL THEN
        UPDATE public.strategy_versions
           SET status = 'superseded'
         WHERE strategy_id = v_current_published.strategy_id;
    END IF;

    -- 4. Insert new published strategy version
    INSERT INTO public.strategy_versions (
        strategy_id,
        previous_strategy_id,
        generated_at,
        published_at,
        data_as_of,
        evidence_fingerprint,
        decision_fingerprint,
        trigger_reason,
        material_changes,
        confidence,
        regime,
        executive_decision,
        asset_strategy,
        preferred_themes,
        avoid_or_underweight,
        risk_overlay,
        horizon,
        invalidation_conditions,
        status,
        lifecycle_state,
        data_quality_state,
        watch_reasons,
        shock_override,
        policy_version,
        run_manifest_id,
        next_review_due_at,
        limitations,
        created_at
    ) VALUES (
        v_new_strategy_id,
        p_new_version->>'previous_strategy_id',
        (p_new_version->>'generated_at')::TIMESTAMPTZ,
        (p_new_version->>'published_at')::TIMESTAMPTZ,
        (p_new_version->>'data_as_of')::TIMESTAMPTZ,
        p_new_version->>'evidence_fingerprint',
        p_new_version->>'decision_fingerprint',
        COALESCE(p_new_version->'trigger_reason', '{}'::jsonb),
        COALESCE(p_new_version->'material_changes', '[]'::jsonb),
        p_new_version->>'confidence',
        COALESCE(p_new_version->'regime', '{}'::jsonb),
        COALESCE(p_new_version->'executive_decision', '{}'::jsonb),
        COALESCE(p_new_version->'asset_strategy', '[]'::jsonb),
        COALESCE(p_new_version->'preferred_themes', '[]'::jsonb),
        COALESCE(p_new_version->'avoid_or_underweight', '[]'::jsonb),
        COALESCE(p_new_version->'risk_overlay', '{}'::jsonb),
        COALESCE(p_new_version->>'horizon', 'medium'),
        COALESCE(p_new_version->'invalidation_conditions', '[]'::jsonb),
        'published',
        COALESCE(p_new_version->>'lifecycle_state', 'STABLE'),
        COALESCE(p_new_version->>'data_quality_state', 'HEALTHY'),
        COALESCE(p_new_version->'watch_reasons', '[]'::jsonb),
        CASE
            WHEN p_new_version->'shock_override' IS NULL
              OR p_new_version->'shock_override' = 'null'::jsonb
            THEN NULL
            ELSE p_new_version->'shock_override'
        END,
        p_new_version->>'policy_version',
        p_new_version->>'run_manifest_id',
        (p_new_version->>'next_review_due_at')::TIMESTAMPTZ,
        p_new_version->>'limitations',
        COALESCE((p_new_version->>'created_at')::TIMESTAMPTZ, NOW())
    )
    RETURNING * INTO v_inserted;

    RETURN to_jsonb(v_inserted);
END;
$$;

-- Security hardening: Server-only execution
REVOKE EXECUTE ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.publish_strategy_version_atomic(JSONB, TEXT) IS
    'Atomically supersedes current published strategy and inserts new strategy version within a single transaction with hardened shock_override null handling. Strictly non-private.';

COMMIT;
