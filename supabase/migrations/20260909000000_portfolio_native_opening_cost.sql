-- Portfolio V1 P0.2.1: native-currency opening cost without fabricated VND basis.
-- Existing execution_unit_price / price_currency fields are the canonical native
-- cost pair. Existing rows are preserved; no historical FX conversion is run.

BEGIN;

ALTER TABLE public.position_opening_baselines
    ALTER COLUMN opening_average_cost DROP NOT NULL;

ALTER TABLE public.holdings
    ALTER COLUMN average_cost DROP NOT NULL;

COMMENT ON COLUMN public.position_opening_baselines.opening_average_cost IS
    'Optional authoritative historical VND average cost. NULL means the VND acquisition basis is unknown.';
COMMENT ON COLUMN public.position_opening_baselines.execution_unit_price IS
    'Average acquisition price in price_currency for the cash-neutral opening position; never converted to VND using current FX.';
COMMENT ON COLUMN public.holdings.average_cost IS
    'Optional authoritative VND average cost projection. NULL means VND cost basis and VND P/L are unavailable.';

DROP FUNCTION IF EXISTS public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_opening_position(
    p_profile_id UUID,
    p_asset_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_asset_currency TEXT;
    v_execution_unit_price NUMERIC := p_execution_unit_price;
    v_usdt_supported BOOLEAN := FALSE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;

    SELECT profiles.id INTO v_profile_id
    FROM public.investor_profile AS profiles
    WHERE profiles.id = p_profile_id;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    IF p_asset_id IS NULL OR BTRIM(p_asset_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'assetId is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
       OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NOT NULL AND (
        p_average_cost < 0 OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be null or a non-negative finite VND number';
    END IF;
    IF p_fx_rate_to_vnd IS NOT NULL AND (
        p_fx_rate_to_vnd <= 0 OR p_fx_rate_to_vnd::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'fxRateToVnd must be null or a positive finite number';
    END IF;

    SELECT assets.* INTO v_asset
    FROM public.assets AS assets
    WHERE assets.id::TEXT = BTRIM(p_asset_id);
    IF v_asset.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP001', MESSAGE = 'asset not found';
    END IF;
    IF v_asset.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'OP002', MESSAGE = 'asset is inactive';
    END IF;

    v_asset_currency := UPPER(BTRIM(v_asset.quote_currency));
    SELECT EXISTS (
        SELECT 1
        FROM public.asset_provider_mappings AS mappings
        WHERE mappings.asset_id = v_asset.id
          AND LOWER(mappings.provider) = 'binance'
          AND UPPER(COALESCE(mappings.provider_market, '')) = 'SPOT'
          AND UPPER(mappings.provider_symbol) LIKE '%USDT'
    ) INTO v_usdt_supported;

    IF v_asset_currency = 'VND' THEN
        IF v_price_currency <> 'VND' OR p_average_cost IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening position requires an authoritative VND average cost';
        END IF;
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
        IF v_execution_unit_price IS DISTINCT FROM p_average_cost THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND native average cost must equal VND average cost';
        END IF;
    ELSE
        IF v_price_currency <> v_asset_currency
           AND NOT (v_price_currency = 'USDT' AND v_usdt_supported) THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'purchase currency is not supported by the canonical asset/provider capability';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0
           OR p_execution_unit_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'non-VND opening position requires a non-negative finite native average cost';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::TEXT), hashtext(v_asset.id::TEXT));

    IF EXISTS (
        SELECT 1 FROM public.position_opening_baselines AS baselines
        WHERE baselines.profile_id = v_profile_id
          AND baselines.asset_id = v_asset.id
          AND baselines.cancelled_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP003', MESSAGE = 'active opening position already exists for asset';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id AND transactions.asset_id = v_asset.id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot create opening position after recording transactions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.holdings AS holdings
        WHERE holdings.profile_id = v_profile_id
          AND holdings.asset_id = v_asset.id
          AND holdings.opening_position_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'unmanaged holding already exists for asset';
    END IF;

    INSERT INTO public.position_opening_baselines (
        profile_id, asset_id, opening_quantity, opening_average_cost,
        accounting_cutoff_at, provenance_type, created_at, updated_at,
        execution_unit_price, price_currency, fx_rate_to_vnd, fx_provenance, fx_observed_at
    ) VALUES (
        v_profile_id, v_asset.id, p_quantity, p_average_cost,
        v_accounted_at, 'USER_RECORDED', v_accounted_at, v_accounted_at,
        v_execution_unit_price, v_price_currency, p_fx_rate_to_vnd, p_fx_provenance, p_fx_observed_at
    ) RETURNING * INTO v_baseline;

    INSERT INTO public.holdings (
        profile_id, asset_id, opening_position_id, quantity, average_cost, created_at, updated_at
    ) VALUES (
        v_profile_id, v_asset.id, v_baseline.id, p_quantity, p_average_cost, v_accounted_at, v_accounted_at
    )
    ON CONFLICT (profile_id, asset_id) DO UPDATE
    SET opening_position_id = EXCLUDED.opening_position_id,
        quantity = EXCLUDED.quantity,
        average_cost = EXCLUDED.average_cost,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', to_jsonb(v_baseline),
        'holding', to_jsonb(v_holding)
    );
END;
$$;

DROP FUNCTION IF EXISTS public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.correct_opening_position(
    p_profile_id UUID,
    p_opening_position_id TEXT,
    p_quantity NUMERIC,
    p_average_cost NUMERIC DEFAULT NULL,
    p_execution_unit_price NUMERIC DEFAULT NULL,
    p_price_currency TEXT DEFAULT 'VND',
    p_fx_rate_to_vnd NUMERIC DEFAULT NULL,
    p_fx_provenance TEXT DEFAULT NULL,
    p_fx_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile_id UUID;
    v_asset public.assets%ROWTYPE;
    v_baseline public.position_opening_baselines%ROWTYPE;
    v_holding public.holdings%ROWTYPE;
    v_accounted_at TIMESTAMPTZ := NOW();
    v_price_currency TEXT := UPPER(COALESCE(BTRIM(p_price_currency), 'VND'));
    v_asset_currency TEXT;
    v_execution_unit_price NUMERIC := p_execution_unit_price;
    v_usdt_supported BOOLEAN := FALSE;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';
    END IF;
    IF p_opening_position_id IS NULL OR BTRIM(p_opening_position_id) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'opening position ID is required';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
       OR p_quantity::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'quantity must be a finite number greater than 0';
    END IF;
    IF p_average_cost IS NOT NULL AND (
        p_average_cost < 0 OR p_average_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'averageCost must be null or a non-negative finite VND number';
    END IF;

    SELECT profiles.id INTO v_profile_id
    FROM public.investor_profile AS profiles WHERE profiles.id = p_profile_id;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP500', MESSAGE = 'investor profile is unavailable';
    END IF;

    SELECT baselines.* INTO v_baseline
    FROM public.position_opening_baselines AS baselines
    WHERE baselines.id::TEXT = BTRIM(p_opening_position_id)
      AND baselines.profile_id = v_profile_id
    FOR UPDATE;
    IF v_baseline.id IS NULL OR v_baseline.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP006', MESSAGE = 'opening position not found';
    END IF;
    IF v_baseline.locked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct locked opening position';
    END IF;

    SELECT assets.* INTO v_asset FROM public.assets AS assets WHERE assets.id = v_baseline.asset_id;
    v_asset_currency := UPPER(BTRIM(v_asset.quote_currency));
    SELECT EXISTS (
        SELECT 1 FROM public.asset_provider_mappings AS mappings
        WHERE mappings.asset_id = v_asset.id
          AND LOWER(mappings.provider) = 'binance'
          AND UPPER(COALESCE(mappings.provider_market, '')) = 'SPOT'
          AND UPPER(mappings.provider_symbol) LIKE '%USDT'
    ) INTO v_usdt_supported;

    IF v_asset_currency = 'VND' THEN
        IF v_price_currency <> 'VND' OR p_average_cost IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND opening position requires an authoritative VND average cost';
        END IF;
        v_execution_unit_price := COALESCE(p_execution_unit_price, p_average_cost);
        IF v_execution_unit_price IS DISTINCT FROM p_average_cost THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'VND native average cost must equal VND average cost';
        END IF;
    ELSE
        IF v_price_currency <> v_asset_currency
           AND NOT (v_price_currency = 'USDT' AND v_usdt_supported) THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'purchase currency is not supported by the canonical asset/provider capability';
        END IF;
        IF p_execution_unit_price IS NULL OR p_execution_unit_price < 0
           OR p_execution_unit_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'OP004', MESSAGE = 'non-VND opening position requires a non-negative finite native average cost';
        END IF;
        v_execution_unit_price := p_execution_unit_price;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.portfolio_transactions AS transactions
        WHERE transactions.profile_id = v_profile_id AND transactions.asset_id = v_baseline.asset_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'OP005', MESSAGE = 'cannot correct opening position after recording transactions';
    END IF;

    UPDATE public.position_opening_baselines
    SET opening_quantity = p_quantity,
        opening_average_cost = p_average_cost,
        execution_unit_price = v_execution_unit_price,
        price_currency = v_price_currency,
        fx_rate_to_vnd = p_fx_rate_to_vnd,
        fx_provenance = p_fx_provenance,
        fx_observed_at = p_fx_observed_at,
        updated_at = v_accounted_at
    WHERE id = v_baseline.id
    RETURNING * INTO v_baseline;

    UPDATE public.holdings
    SET quantity = p_quantity,
        average_cost = p_average_cost,
        updated_at = v_accounted_at
    WHERE profile_id = v_profile_id
      AND asset_id = v_baseline.asset_id
      AND opening_position_id = v_baseline.id
    RETURNING * INTO v_holding;

    RETURN jsonb_build_object(
        'openingPosition', to_jsonb(v_baseline),
        'holding', to_jsonb(v_holding)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
