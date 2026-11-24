-- Manual validation only, after approval. Run this entire file in one SQL
-- Editor session. Replace the NULL in test_user_id with the UUID of an
-- explicitly designated test account with quota available. Use a quiet account.
-- Read the PASS notices. If execution stops before ROLLBACK, issue ROLLBACK
-- in that session. No application client, queue worker or AI provider is called.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $validation$
DECLARE
    test_user_id constant uuid := NULL::uuid;
    test_task constant text := 'Step 282E synthetic validation task ' || gen_random_uuid()::text;
    test_answer constant text := 'Step 282E synthetic Ollama answer';
    model_id constant text := 'qwen2.5:1.5b';
    usage_day constant date := (now() AT TIME ZONE 'UTC')::date;
    first_worker uuid := gen_random_uuid();
    recovery_worker uuid := gen_random_uuid();
    model_arg_type oid;
    model_literal text;
    created jsonb;
    test_task_id uuid;
    task_row public.collaboration_tasks%ROWTYPE;
    saved_turn public.collaboration_turns%ROWTYPE;
    due_row jsonb;
    usage_before integer;
    usage_after integer;
    turn_count integer;
    accepted boolean;
BEGIN
    IF test_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM auth.users AS u WHERE u.id = test_user_id
    ) THEN
        RAISE EXCEPTION 'Set test_user_id to the existing designated test account UUID';
    END IF;

    SELECT coalesce((
        SELECT u.requests_used FROM public.ai_daily_usage AS u
        WHERE u.user_id = test_user_id AND u.usage_date = usage_day
    ), 0) INTO usage_before;
    IF usage_before >= 10 THEN
        RAISE EXCEPTION 'Designated test account has no remaining collaboration quota';
    END IF;

    SELECT a.arg_type INTO STRICT model_arg_type
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proargtypes) WITH ORDINALITY AS a(arg_type, ordinal)
    WHERE n.nspname = 'public' AND p.proname = 'create_collaboration_with_quota'
      AND p.pronargs = 6 AND p.proargnames[a.ordinal::integer] = 'p_selected_models';

    SELECT CASE
        WHEN t.typcategory = 'A' THEN '{ollama}'
        WHEN t.oid IN ('json'::regtype, 'jsonb'::regtype) THEN '["ollama"]'
    END INTO model_literal
    FROM pg_catalog.pg_type AS t WHERE t.oid = model_arg_type;
    IF model_literal IS NULL THEN
        RAISE EXCEPTION 'Review unexpected selected_models argument type: %', model_arg_type::regtype;
    END IF;

    EXECUTE format(
        'SELECT to_jsonb(r) FROM public.create_collaboration_with_quota(
            p_user_id => %L, p_task => %L, p_selected_models => %L::%s,
            p_max_rounds => 1, p_credential_mode => %L, p_daily_limit => 10
        ) AS r',
        test_user_id, test_task, model_literal, model_arg_type::regtype, 'platform'
    ) INTO STRICT created;

    IF (created->>'allowed')::boolean IS DISTINCT FROM true OR created->>'task_id' IS NULL THEN
        RAISE EXCEPTION 'Creation RPC rejected the one-model, one-round test task';
    END IF;
    test_task_id := (created->>'task_id')::uuid;

    SELECT * INTO STRICT task_row FROM public.collaboration_tasks AS t
    WHERE t.id = test_task_id AND t.user_id = test_user_id;
    IF task_row.task IS DISTINCT FROM test_task
       OR to_jsonb(task_row.selected_models) IS DISTINCT FROM '["ollama"]'::jsonb
       OR task_row.max_rounds IS DISTINCT FROM 1
       OR task_row.credential_mode IS DISTINCT FROM 'platform'
       OR task_row.auto_resume_enabled IS DISTINCT FROM true
       OR task_row.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Persisted task does not match the individual platform configuration';
    END IF;
    SELECT u.requests_used INTO STRICT usage_after FROM public.ai_daily_usage AS u
    WHERE u.user_id = test_user_id AND u.usage_date = usage_day;
    IF usage_after IS DISTINCT FROM usage_before + 1
       OR (created->>'requests_remaining')::integer IS DISTINCT FROM 10 - usage_after THEN
        RAISE EXCEPTION 'Creation did not charge exactly one request';
    END IF;
    RAISE NOTICE 'PASS: one-model, one-round creation and exactly one quota debit';

    EXECUTE format(
        'SELECT public.claim_collaboration_task(p_task_id => %L, p_worker_id => %L, p_lease_seconds => 120)',
        test_task_id, first_worker
    ) INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Initial lease claim failed';
    END IF;
    EXECUTE format(
        'SELECT public.save_collaboration_checkpoint(
            p_task_id => %L, p_worker_id => %L, p_turn_number => 1, p_round_number => 1,
            p_requested_provider => %L, p_actual_provider => %L, p_model_id => %L, p_response => %L
        )',
        test_task_id, first_worker, 'ollama', 'ollama', model_id, test_answer
    );

    SELECT * INTO STRICT saved_turn FROM public.collaboration_turns AS t
    WHERE t.task_id = test_task_id AND t.turn_number = 1;
    IF saved_turn.round_number IS DISTINCT FROM 1
       OR saved_turn.requested_provider IS DISTINCT FROM 'ollama'
       OR saved_turn.actual_provider IS DISTINCT FROM 'ollama'
       OR saved_turn.model_id IS DISTINCT FROM model_id
       OR saved_turn.response IS DISTINCT FROM test_answer THEN
        RAISE EXCEPTION 'Checkpoint content or provider metadata did not persist';
    END IF;
    RAISE NOTICE 'PASS: checkpoint and Ollama model metadata persisted';

    -- Simulate lost completion before the finish RPC by scheduling a retry.
    EXECUTE format(
        'SELECT public.schedule_collaboration_retry(p_task_id => %L, p_worker_id => %L)',
        test_task_id, first_worker
    ) INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Retry scheduling rejected the checkpointed test task';
    END IF;

    -- Advance only this transaction's synthetic task to its due time.
    UPDATE public.collaboration_tasks
    SET next_retry_at = now() - interval '1 second'
    WHERE id = test_task_id AND user_id = test_user_id AND status = 'paused';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Retry scheduling did not leave the synthetic task paused';
    END IF;

    SELECT to_jsonb(d) INTO STRICT due_row
    FROM public.get_due_collaboration_tasks_with_owner() AS d
    WHERE d.id = test_task_id AND d.user_id = test_user_id;
    IF due_row - ARRAY['id','task','selected_models','max_rounds','user_id'] <> '{}'::jsonb
       OR NOT (due_row ?& ARRAY['id','task','selected_models','max_rounds','user_id'])
       OR due_row->'selected_models' IS DISTINCT FROM '["ollama"]'::jsonb
       OR (due_row->>'max_rounds')::integer IS DISTINCT FROM 1
       OR due_row->>'task' IS DISTINCT FROM test_task THEN
        RAISE EXCEPTION 'Due recovery did not return the expected five-field task';
    END IF;

    EXECUTE format(
        'SELECT public.claim_collaboration_task(p_task_id => %L, p_worker_id => %L, p_lease_seconds => 120)',
        test_task_id, recovery_worker
    ) INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Recovery lease claim failed';
    END IF;
    SELECT * INTO STRICT saved_turn FROM public.collaboration_turns AS t
    WHERE t.task_id = test_task_id AND t.turn_number = 1;
    IF saved_turn.response IS DISTINCT FROM test_answer THEN
        RAISE EXCEPTION 'The checkpoint was lost during recovery';
    END IF;

    EXECUTE format(
        'SELECT public.release_collaboration_task(
            p_task_id => %L, p_worker_id => %L, p_new_status => %L,
            p_final_answer => %L, p_error_message => NULL
        )',
        test_task_id, recovery_worker, 'completed', saved_turn.response
    ) INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Completion RPC rejected the recovered single checkpoint';
    END IF;

    SELECT * INTO STRICT task_row FROM public.collaboration_tasks AS t
    WHERE t.id = test_task_id AND t.user_id = test_user_id;
    SELECT count(*) INTO turn_count FROM public.collaboration_turns AS t
    WHERE t.task_id = test_task_id;
    SELECT u.requests_used INTO STRICT usage_after FROM public.ai_daily_usage AS u
    WHERE u.user_id = test_user_id AND u.usage_date = usage_day;
    IF task_row.status IS DISTINCT FROM 'completed'
       OR task_row.final_answer IS DISTINCT FROM test_answer
       OR task_row.current_turn IS DISTINCT FROM 1
       OR turn_count IS DISTINCT FROM 1
       OR usage_after IS DISTINCT FROM usage_before + 1 THEN
        RAISE EXCEPTION 'Recovery did not preserve the saved answer and single quota debit';
    END IF;
    RAISE NOTICE 'PASS: five-field due recovery, saved answer completion, and no extra quota debit';
END;
$validation$;

-- The global expired-lease recovery RPC is deliberately excluded because it
-- may update unrelated tasks. The script verifies the targeted retry path.
ROLLBACK;
