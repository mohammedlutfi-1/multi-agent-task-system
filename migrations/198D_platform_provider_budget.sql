BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_provider_daily_usage (
    provider text NOT NULL,
    usage_date date NOT NULL,
    calls_reserved integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT platform_provider_daily_usage_pkey
        PRIMARY KEY (provider, usage_date),
    CONSTRAINT platform_provider_daily_usage_calls_check
        CHECK (calls_reserved >= 0),
    CONSTRAINT platform_provider_daily_usage_provider_check
        CHECK (provider IN ('groq', 'gemini', 'openrouter'))
);

ALTER TABLE public.platform_provider_daily_usage
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_provider_daily_usage
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.platform_provider_daily_usage
TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_platform_provider_call(
    p_provider text,
    p_daily_limit integer
)
RETURNS TABLE(
    allowed boolean,
    calls_reserved integer,
    calls_remaining integer
)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_reserved integer;
BEGIN
    IF p_provider IS NULL
       OR p_provider NOT IN ('groq', 'gemini', 'openrouter')
    THEN
        RAISE EXCEPTION 'Invalid provider';
    END IF;

    IF p_daily_limit IS NULL
       OR p_daily_limit < 1
       OR p_daily_limit > 100000
    THEN
        RAISE EXCEPTION 'Invalid daily limit';
    END IF;

    INSERT INTO public.platform_provider_daily_usage (
        provider,
        usage_date,
        calls_reserved,
        updated_at
    )
    VALUES (
        p_provider,
        (now() AT TIME ZONE 'UTC')::date,
        1,
        now()
    )
    ON CONFLICT (provider, usage_date)
    DO UPDATE SET
        calls_reserved =
            public.platform_provider_daily_usage.calls_reserved + 1,
        updated_at = now()
    WHERE
        public.platform_provider_daily_usage.calls_reserved
            < p_daily_limit
    RETURNING
        public.platform_provider_daily_usage.calls_reserved
    INTO v_reserved;

    IF v_reserved IS NULL THEN
        SELECT u.calls_reserved
        INTO v_reserved
        FROM public.platform_provider_daily_usage AS u
        WHERE u.provider = p_provider
          AND u.usage_date = (now() AT TIME ZONE 'UTC')::date;

        RETURN QUERY SELECT
            false,
            COALESCE(v_reserved, 0),
            GREATEST(
                p_daily_limit - COALESCE(v_reserved, 0),
                0
            );
    ELSE
        RETURN QUERY SELECT
            true,
            v_reserved,
            GREATEST(p_daily_limit - v_reserved, 0);
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION
public.reserve_platform_provider_call(text, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.reserve_platform_provider_call(text, integer)
TO service_role;

COMMIT;