-- ==============================================================================
-- Migration: 20260903000000_feature_12b_alert_notification_deliveries.sql
-- Description: Feature 12B Web Push Alert Notification Outbox Foundation
--
-- Authoritative Model: BOUNDED_RETRY_BEST_EFFORT (Multi-Device Web Push)
--
-- 1. Table `push_subscriptions`: Stores device Web Push subscription capabilities
--    associated with the investor profile (service_role only, RLS enabled).
-- 2. Table `alert_notification_deliveries`: Per-subscription delivery outbox for
--    price-alert trigger events. One trigger event fans out to 0 or more subscriptions.
-- 3. RPC `trigger_price_alert_atomic`: Atomically transitions price alert to triggered
--    and inserts one pending delivery row per active push subscription of the profile.
-- 4. RPC `claim_pending_alert_deliveries`: Atomically claims pending or retryable
--    deliveries with 120s leases and terminalizes expired attempts (attempt_count >= 3).
-- ==============================================================================

-- 1. Web Push Subscriptions Table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
    ON public.push_subscriptions (profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

-- 2. Per-Device Alert Notification Deliveries Table
CREATE TABLE IF NOT EXISTS public.alert_notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES public.price_alerts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.investor_profile(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    trigger_event_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,

    -- Immutable trigger event snapshot
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('above', 'below')),
    target_price NUMERIC(15, 2) NOT NULL CHECK (target_price > 0),
    observed_price NUMERIC NOT NULL CHECK (
        observed_price > 0
        AND observed_price::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
    trigger_event_at TIMESTAMPTZ NOT NULL,

    -- Delivery lifecycle state machine
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'sending',
            'sent',
            'failed_retryable',
            'failed_permanent'
        )
    ),
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_alert_delivery_event_sub UNIQUE (trigger_event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_claim
    ON public.alert_notification_deliveries (status, next_attempt_at, lease_expires_at)
    WHERE status IN ('pending', 'sending', 'failed_retryable');

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_alert
    ON public.alert_notification_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_subscription
    ON public.alert_notification_deliveries (subscription_id);

ALTER TABLE public.alert_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.alert_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.alert_notification_deliveries TO service_role;

-- 3. Atomic Alert Trigger & Push Fanout RPC
CREATE OR REPLACE FUNCTION public.trigger_price_alert_atomic(
    p_alert_id UUID,
    p_profile_id UUID,
    p_observed_price NUMERIC,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alert RECORD;
    v_trigger_event_id UUID;
    v_delivery_count INT := 0;
BEGIN
    -- 1. Conditionally lock and transition alert from active -> triggered
    UPDATE public.price_alerts
    SET
        status = 'triggered',
        triggered_at = p_now,
        last_evaluated_price = p_observed_price,
        last_evaluated_at = p_now,
        updated_at = p_now
    WHERE id = p_alert_id
      AND profile_id = p_profile_id
      AND status = 'active'
    RETURNING * INTO v_alert;

    -- If alert was already triggered or does not exist, return idempotent non-triggered response
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'triggered', false,
            'trigger_event_id', null,
            'delivery_count', 0
        );
    END IF;

    -- 2. Generate unique trigger event ID
    v_trigger_event_id := gen_random_uuid();

    -- 3. Fan out pending delivery rows for all current push subscriptions of this profile
    INSERT INTO public.alert_notification_deliveries (
        alert_id,
        profile_id,
        subscription_id,
        trigger_event_id,
        asset_id,
        direction,
        target_price,
        observed_price,
        trigger_event_at,
        status,
        attempt_count,
        created_at,
        updated_at
    )
    SELECT
        v_alert.id,
        v_alert.profile_id,
        s.id,
        v_trigger_event_id,
        v_alert.asset_id,
        v_alert.direction,
        v_alert.target_price,
        p_observed_price,
        p_now,
        'pending',
        0,
        p_now,
        p_now
    FROM public.push_subscriptions s
    WHERE s.profile_id = p_profile_id;

    GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'triggered', true,
        'trigger_event_id', v_trigger_event_id,
        'delivery_count', v_delivery_count,
        'alert', to_jsonb(v_alert)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_price_alert_atomic(UUID, UUID, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_price_alert_atomic(UUID, UUID, NUMERIC, TIMESTAMPTZ) TO service_role;

-- 4. Atomic Delivery Claim & Zombie Recovery RPC
CREATE OR REPLACE FUNCTION public.claim_pending_alert_deliveries(
    p_batch_size INT DEFAULT 5,
    p_lease_seconds INT DEFAULT 120,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    id UUID,
    alert_id UUID,
    profile_id UUID,
    subscription_id UUID,
    trigger_event_id UUID,
    asset_id UUID,
    direction VARCHAR(10),
    target_price NUMERIC(15, 2),
    observed_price NUMERIC,
    trigger_event_at TIMESTAMPTZ,
    status VARCHAR(30),
    attempt_count INT,
    last_attempt_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch_size INT;
    v_lease_seconds INT;
BEGIN
    -- Strict sanity bounds: batch size [1, 25], lease seconds [30, 600]
    v_batch_size := LEAST(GREATEST(COALESCE(p_batch_size, 5), 1), 25);
    v_lease_seconds := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 600);

    -- 1. Terminalize expired sending jobs with attempt_count >= 3 (Third-attempt crash & zombie elimination)
    UPDATE public.alert_notification_deliveries
    SET
        status = 'failed_permanent',
        last_error = 'MAX_ATTEMPTS_EXHAUSTED',
        lease_expires_at = NULL,
        updated_at = p_now
    WHERE alert_notification_deliveries.status = 'sending'
      AND alert_notification_deliveries.lease_expires_at <= p_now
      AND alert_notification_deliveries.attempt_count >= 3;

    -- 2. Claim eligible rows with row-level locking (SKIP LOCKED)
    RETURN QUERY
    WITH eligible AS (
        SELECT d.id
        FROM public.alert_notification_deliveries d
        WHERE (
            -- Brand new pending deliveries
            d.status = 'pending'
            OR
            -- Expired leases for crashed attempts (< 3 attempts)
            (d.status = 'sending' AND d.lease_expires_at <= p_now AND d.attempt_count < 3)
            OR
            -- Retryable failures whose backoff timer has elapsed
            (d.status = 'failed_retryable' AND d.next_attempt_at <= p_now AND d.attempt_count < 3)
        )
        ORDER BY d.created_at ASC
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.alert_notification_deliveries d
    SET
        status = 'sending',
        attempt_count = d.attempt_count + 1,
        last_attempt_at = p_now,
        lease_expires_at = p_now + (v_lease_seconds || ' seconds')::INTERVAL,
        updated_at = p_now
    FROM eligible
    WHERE d.id = eligible.id
    RETURNING
        d.id,
        d.alert_id,
        d.profile_id,
        d.subscription_id,
        d.trigger_event_id,
        d.asset_id,
        d.direction,
        d.target_price,
        d.observed_price,
        d.trigger_event_at,
        d.status,
        d.attempt_count,
        d.last_attempt_at,
        d.lease_expires_at,
        d.next_attempt_at,
        d.delivered_at,
        d.last_error,
        d.created_at,
        d.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_alert_deliveries(INT, INT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_alert_deliveries(INT, INT, TIMESTAMPTZ) TO service_role;
