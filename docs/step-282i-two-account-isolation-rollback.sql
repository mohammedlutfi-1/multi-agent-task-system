-- Manual database isolation check. Use two explicitly designated disposable
-- test accounts with quota available. Replace the two NULL UUIDs. Set the
-- read scopes below from the intended access contract before running.
-- Run the whole script in one privileged SQL Editor session. If interrupted
-- before the final ROLLBACK, issue ROLLBACK in that session.
-- No provider, queue worker, or live authenticated API request is invoked.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $test$
DECLARE
    account_a constant uuid := NULL::uuid;
    account_b constant uuid := NULL::uuid;
    -- Use owner for direct authenticated reads. Set backend_only only when
    -- the intended design explicitly requires reads through FastAPI.
    tutor_chat_scope constant text := 'owner';
    tutor_message_scope constant text := 'owner';
    collaboration_turn_scope constant text := 'owner';
    usage_day constant date := (now() AT TIME ZONE 'UTC')::date;
    marker constant text := 'Step 282I synthetic isolation fixture ' || gen_random_uuid()::text;
    models jsonb := '["ollama"]';
    collaboration_id uuid;
    chat_a uuid;
    chat_b uuid;
    model_arg_type oid;
    model_literal text;
    created jsonb;
    student_reservation record;
    account_a_collab_before integer;
    account_b_collab_before integer;
    account_a_student_before integer;
    account_b_student_before integer;
    affected integer;
    actor uuid;
    own_chat uuid;
    other_chat uuid;
BEGIN
    IF account_a IS NULL OR account_b IS NULL OR account_a = account_b
       OR (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
        RAISE EXCEPTION 'Provide two distinct existing designated test account UUIDs';
    END IF;
    IF tutor_chat_scope NOT IN ('owner', 'backend_only')
       OR tutor_message_scope NOT IN ('owner', 'backend_only')
       OR collaboration_turn_scope NOT IN ('owner', 'backend_only') THEN
        RAISE EXCEPTION 'Each read scope must be owner or backend_only';
    END IF;

    SELECT coalesce(max(requests_used) FILTER (WHERE user_id = account_a), 0),
           coalesce(max(requests_used) FILTER (WHERE user_id = account_b), 0)
    INTO account_a_collab_before, account_b_collab_before
    FROM public.ai_daily_usage WHERE usage_date = usage_day AND user_id IN (account_a, account_b);
    SELECT coalesce(max(calls_used) FILTER (WHERE user_id = account_a), 0),
           coalesce(max(calls_used) FILTER (WHERE user_id = account_b), 0)
    INTO account_a_student_before, account_b_student_before
    FROM public.student_ai_daily_usage WHERE usage_date = usage_day AND user_id IN (account_a, account_b);

    SELECT a.arg_type INTO STRICT model_arg_type
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proargtypes) WITH ORDINALITY AS a(arg_type, ordinal)
    WHERE n.nspname = 'public' AND p.proname = 'create_collaboration_with_quota'
      AND p.pronargs = 6 AND p.proargnames[a.ordinal::integer] = 'p_selected_models';
    SELECT CASE WHEN typcategory = 'A' THEN '{ollama}'
                WHEN oid IN ('json'::regtype, 'jsonb'::regtype) THEN models::text END
    INTO model_literal FROM pg_catalog.pg_type WHERE oid = model_arg_type;
    IF model_literal IS NULL THEN
        RAISE EXCEPTION 'Unsupported selected_models argument type';
    END IF;
    EXECUTE format(
        'SELECT to_jsonb(r) FROM public.create_collaboration_with_quota(
            p_user_id => %L, p_task => %L, p_selected_models => %L::%s,
            p_max_rounds => 1, p_credential_mode => %L, p_daily_limit => 10
        ) AS r',
        account_a, marker, model_literal, model_arg_type::regtype, 'platform'
    ) INTO STRICT created;
    IF (created->>'allowed')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Designated account A could not create the quota test fixture';
    END IF;
    collaboration_id := (created->>'task_id')::uuid;
    IF NOT EXISTS (
        SELECT 1 FROM public.collaboration_tasks
        WHERE id = collaboration_id AND user_id = account_a AND task = marker
    ) THEN
        RAISE EXCEPTION 'Creation did not return the synthetic fixture';
    END IF;

    SELECT * INTO STRICT student_reservation
    FROM public.reserve_student_ai_request(account_a, gen_random_uuid(), 1);
    IF student_reservation.allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Designated account A needs one Student AI call available';
    END IF;

    IF (SELECT requests_used FROM public.ai_daily_usage WHERE user_id = account_a AND usage_date = usage_day)
           IS DISTINCT FROM account_a_collab_before + 1
       OR coalesce((SELECT requests_used FROM public.ai_daily_usage WHERE user_id = account_b AND usage_date = usage_day), 0)
           IS DISTINCT FROM account_b_collab_before
       OR (SELECT calls_used FROM public.student_ai_daily_usage WHERE user_id = account_a AND usage_date = usage_day)
           IS DISTINCT FROM account_a_student_before + 1
       OR coalesce((SELECT calls_used FROM public.student_ai_daily_usage WHERE user_id = account_b AND usage_date = usage_day), 0)
           IS DISTINCT FROM account_b_student_before THEN
        RAISE EXCEPTION 'Quota writes were not isolated to account A';
    END IF;
    RAISE NOTICE 'PASS: collaboration and Student AI quota debits affected account A only';

    INSERT INTO public.collaboration_turns (
        task_id, turn_number, round_number, requested_provider, actual_provider, model_id, response
    ) VALUES (collaboration_id, 1, 1, 'ollama', 'ollama', 'qwen2.5:1.5b', marker || ' response');
    INSERT INTO public.student_ai_chats (user_id, title)
    VALUES (account_a, marker || ' tutor A') RETURNING id INTO chat_a;
    INSERT INTO public.student_ai_chats (user_id, title)
    VALUES (account_b, marker || ' tutor B') RETURNING id INTO chat_b;
    INSERT INTO public.student_ai_messages (user_id, chat_id, role, content)
    VALUES (account_a, chat_a, 'user', marker || ' tutor message A'),
           (account_b, chat_b, 'user', marker || ' tutor message B');

    -- Emulate PostgREST's database role and claim context. These are synthetic
    -- settings, not tokens. API authentication is tested independently.
    PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account_a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM account_a
       OR NOT EXISTS (SELECT 1 FROM public.collaboration_tasks WHERE id = collaboration_id) THEN
        RAISE EXCEPTION 'Owner control failed under account A';
    END IF;
    IF collaboration_turn_scope = 'owner' THEN
        IF NOT EXISTS (SELECT 1 FROM public.collaboration_turns WHERE task_id = collaboration_id) THEN
            RAISE EXCEPTION 'Account A cannot read its own collaboration response';
        END IF;
    ELSIF has_any_column_privilege(current_user, 'public.collaboration_turns', 'SELECT') THEN
        RAISE EXCEPTION 'Expected backend-only collaboration responses but authenticated has SELECT access';
    END IF;

    FOREACH actor IN ARRAY ARRAY[account_a, account_b] LOOP
        PERFORM set_config('request.jwt.claim.sub', actor::text, true);
        PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
        IF auth.uid() IS DISTINCT FROM actor THEN
            RAISE EXCEPTION 'Tutor claim setup failed';
        END IF;
        own_chat := CASE WHEN actor = account_a THEN chat_a ELSE chat_b END;
        other_chat := CASE WHEN actor = account_a THEN chat_b ELSE chat_a END;

        IF tutor_chat_scope = 'owner' THEN
            IF NOT EXISTS (SELECT 1 FROM public.student_ai_chats WHERE id = own_chat)
               OR EXISTS (SELECT 1 FROM public.student_ai_chats WHERE id = other_chat) THEN
                RAISE EXCEPTION 'Tutor chat owner or cross-account read control failed';
            END IF;
        ELSIF has_any_column_privilege(current_user, 'public.student_ai_chats', 'SELECT') THEN
            RAISE EXCEPTION 'Expected backend-only Tutor chats but authenticated has SELECT access';
        END IF;

        IF tutor_message_scope = 'owner' THEN
            IF NOT EXISTS (SELECT 1 FROM public.student_ai_messages WHERE chat_id = own_chat)
               OR EXISTS (SELECT 1 FROM public.student_ai_messages WHERE chat_id = other_chat) THEN
                RAISE EXCEPTION 'Tutor message owner or cross-account read control failed';
            END IF;
        ELSIF has_any_column_privilege(current_user, 'public.student_ai_messages', 'SELECT') THEN
            RAISE EXCEPTION 'Expected backend-only Tutor messages but authenticated has SELECT access';
        END IF;
    END LOOP;

    PERFORM set_config('request.jwt.claim.sub', account_b::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account_b, 'role', 'authenticated')::text, true);
    IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM account_b THEN
        RAISE EXCEPTION 'Account B role and claim setup failed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.collaboration_tasks WHERE id = collaboration_id) THEN
        RAISE EXCEPTION 'Account B can read account A collaboration task';
    END IF;
    IF collaboration_turn_scope = 'owner' THEN
        IF EXISTS (SELECT 1 FROM public.collaboration_turns WHERE task_id = collaboration_id) THEN
            RAISE EXCEPTION 'Account B can read account A collaboration response';
        END IF;
    END IF;
    DELETE FROM public.collaboration_tasks WHERE id = collaboration_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
        RAISE EXCEPTION 'Account B deleted account A collaboration task';
    END IF;
    BEGIN
        UPDATE public.collaboration_tasks SET task = marker || ' forbidden update'
        WHERE id = collaboration_id;
        RAISE EXCEPTION 'Authenticated UPDATE was not denied by privileges';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.collaboration_tasks (user_id, task, selected_models, max_rounds, credential_mode)
        SELECT account_b, marker || ' forbidden direct create', t.selected_models, 1, 'platform'
        FROM jsonb_populate_record(NULL::public.collaboration_tasks,
                                   jsonb_build_object('selected_models', models)) AS t;
        RAISE EXCEPTION 'Authenticated direct INSERT was not denied by privileges';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.student_ai_chats WHERE id = chat_a;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN
            RAISE EXCEPTION 'Account B deleted account A Tutor chat';
        END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        -- Constant projection with a false predicate: zero rows and no key columns.
        PERFORM 1 FROM public.user_api_keys WHERE false;
        RAISE EXCEPTION 'Authenticated can query the API key table';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.student_ai_messages (user_id, chat_id, role, content)
        VALUES (account_b, chat_a, 'user', marker || ' forbidden attachment');
        RAISE EXCEPTION 'Account B attached a Tutor message to account A chat';
    EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL;
    END;
    RAISE NOTICE 'PASS: Tutor declared read scopes, cross-account write denial, and no authenticated key-table read privilege';

    EXECUTE 'RESET ROLE';
    IF NOT EXISTS (SELECT 1 FROM public.collaboration_tasks WHERE id = collaboration_id AND task = marker)
       OR NOT EXISTS (SELECT 1 FROM public.student_ai_chats WHERE id = chat_a)
       OR NOT EXISTS (SELECT 1 FROM public.student_ai_chats WHERE id = chat_b)
       OR NOT EXISTS (SELECT 1 FROM public.student_ai_messages WHERE chat_id = chat_a)
       OR NOT EXISTS (SELECT 1 FROM public.student_ai_messages WHERE chat_id = chat_b) THEN
        RAISE EXCEPTION 'Synthetic fixtures did not survive the negative tests';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account_a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM public.collaboration_tasks WHERE id = collaboration_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Account A could not delete its own synthetic collaboration task';
    END IF;
    EXECUTE 'RESET ROLE';
    RAISE NOTICE 'PASS: owner collaboration read/delete, cross-account denial, and direct write enforcement';
END;
$test$;

-- Rolls back all synthetic rows and provisional test-account usage.
ROLLBACK;
