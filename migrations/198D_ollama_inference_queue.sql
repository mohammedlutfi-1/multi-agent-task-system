BEGIN;

CREATE TABLE IF NOT EXISTS public.ollama_inference_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collaboration_task_id uuid,
    status text NOT NULL DEFAULT 'pending',
    model text NOT NULL DEFAULT 'qwen2.5:1.5b',
    messages jsonb NOT NULL,
    max_tokens integer NOT NULL DEFAULT 800,
    result_text text,
    worker_id text,
    lease_token uuid,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 minutes'),
    leased_until timestamptz,
    completed_at timestamptz,
    CONSTRAINT ollama_inference_jobs_status_check
        CHECK (status IN (
            'pending','processing','completed','failed','expired'
        )),
    CONSTRAINT ollama_inference_jobs_messages_check
        CHECK (jsonb_typeof(messages) = 'array'),
    CONSTRAINT ollama_inference_jobs_max_tokens_check
        CHECK (max_tokens BETWEEN 1 AND 800),
    CONSTRAINT ollama_inference_jobs_attempts_check
        CHECK (attempts >= 0),
    CONSTRAINT ollama_job_result_check
        CHECK (
            status <> 'completed'
            OR (
                result_text IS NOT NULL
                AND length(trim(result_text)) > 0
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_ollama_jobs_pending
ON public.ollama_inference_jobs (created_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ollama_jobs_expiry
ON public.ollama_inference_jobs (expires_at)
WHERE status IN ('pending', 'processing');

ALTER TABLE public.ollama_inference_jobs
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ollama_inference_jobs
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.ollama_inference_jobs
TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_ollama_inference_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_cancelled boolean := false;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'Job ID is required';
    END IF;

    UPDATE public.ollama_inference_jobs
    SET status = 'failed',
        lease_token = NULL,
        leased_until = NULL,
        updated_at = now()
    WHERE id = p_job_id
      AND status IN ('pending', 'processing')
    RETURNING true INTO v_cancelled;

    RETURN COALESCE(v_cancelled, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_ollama_inference_job(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 90
)
RETURNS TABLE(
    job_id uuid,
    job_model text,
    job_messages jsonb,
    job_max_tokens integer,
    job_lease_token uuid,
    job_expires_at timestamptz,
    job_leased_until timestamptz
)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF p_worker_id IS NULL
       OR length(btrim(p_worker_id)) = 0
       OR length(p_worker_id) > 128 THEN
        RAISE EXCEPTION 'Invalid worker ID';
    END IF;

    IF p_lease_seconds IS NULL
       OR p_lease_seconds < 10
       OR p_lease_seconds > 180 THEN
        RAISE EXCEPTION 'Invalid lease duration';
    END IF;

    UPDATE public.ollama_inference_jobs
    SET status = 'expired',
        updated_at = now()
    WHERE status IN ('pending', 'processing')
      AND expires_at <= now();

    RETURN QUERY
    WITH candidate AS (
        SELECT id
        FROM public.ollama_inference_jobs
        WHERE status = 'pending'
          AND expires_at > now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE public.ollama_inference_jobs AS j
    SET status = 'processing',
        worker_id = p_worker_id,
        lease_token = gen_random_uuid(),
        leased_until = LEAST(
            j.expires_at,
            now() + make_interval(secs => p_lease_seconds)
        ),
        attempts = j.attempts + 1,
        updated_at = now()
    FROM candidate
    WHERE j.id = candidate.id
    RETURNING
        j.id,
        j.model,
        j.messages,
        j.max_tokens,
        j.lease_token,
        j.expires_at,
        j.leased_until;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_ollama_inference_job(
    p_job_id uuid,
    p_worker_id text,
    p_lease_token uuid,
    p_result_text text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_updated integer;
BEGIN
    IF p_job_id IS NULL
       OR p_worker_id IS NULL
       OR p_lease_token IS NULL
       OR p_result_text IS NULL
       OR length(trim(p_result_text)) = 0
       OR length(p_result_text) > 20000
    THEN
        RETURN false;
    END IF;

    UPDATE public.ollama_inference_jobs
    SET status = 'completed',
        result_text = p_result_text,
        completed_at = now(),
        updated_at = now(),
        leased_until = NULL
    WHERE id = p_job_id
      AND status = 'processing'
      AND worker_id = p_worker_id
      AND lease_token = p_lease_token
      AND leased_until > now()
      AND expires_at > now();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION
public.cancel_ollama_inference_job(uuid)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
public.claim_ollama_inference_job(text, integer)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
public.complete_ollama_inference_job(uuid, text, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.cancel_ollama_inference_job(uuid)
TO service_role;

GRANT EXECUTE ON FUNCTION
public.claim_ollama_inference_job(text, integer)
TO service_role;

GRANT EXECUTE ON FUNCTION
public.complete_ollama_inference_job(uuid, text, uuid, text)
TO service_role;

COMMIT;