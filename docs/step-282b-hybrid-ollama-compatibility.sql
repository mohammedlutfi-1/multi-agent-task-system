-- Read-only. Reports metadata for the two collaboration tables and eight RPCs.
-- The main report reads no application rows or RPC bodies and invokes no RPCs. Review catalog
-- expressions locally before sharing. The optional source query below is private.
WITH
expected(rpc_name, stage, argument_names, check_locally) AS (
    VALUES
      ('create_collaboration_with_quota', 'creation',
       ARRAY['p_user_id','p_task','p_selected_models','p_max_rounds','p_credential_mode','p_daily_limit'],
       'Accepts and stores ["ollama"] and one round, charges once, enables platform auto-resume, and returns allowed, task_id and requests_remaining.'),
      ('claim_collaboration_task', 'claim',
       ARRAY['p_task_id','p_worker_id','p_lease_seconds'],
       'Claims a new or eligible paused task without requiring multiple models.'),
      ('renew_collaboration_lease', 'heartbeat',
       ARRAY['p_task_id','p_worker_id','p_lease_seconds'],
       'Renews the current owner lease without a minimum model or turn count.'),
      ('save_collaboration_checkpoint', 'checkpoint',
       ARRAY['p_task_id','p_worker_id','p_turn_number','p_round_number','p_requested_provider','p_actual_provider','p_model_id','p_response'],
       'Accepts turn 1, round 1, requested Ollama and the actual local or approved fallback provider/model. Saves one turn and advances progress atomically.'),
      ('release_collaboration_task', 'completion',
       ARRAY['p_task_id','p_worker_id','p_new_status','p_final_answer','p_error_message'],
       'The lease owner can complete with one checkpoint and store a nonblank final_answer. No minimum of two turns or synthesis marker.'),
      ('schedule_collaboration_retry', 'pause',
       ARRAY['p_task_id','p_worker_id'],
       'Schedules an eligible platform task, including one with zero saved turns, without rewriting its model selection or round count.'),
      ('recover_expired_collaboration_tasks', 'expired lease', ARRAY[]::text[],
       'Makes an eligible interrupted task recoverable without deleting its saved checkpoint or changing its selection or rounds.'),
      ('get_due_collaboration_tasks_with_owner', 'due recovery', ARRAY[]::text[],
       'Returns id, task, selected_models, max_rounds, credential_mode and auto_resume_enabled, including eligible one-model, one-round tasks.')
),
target_tables AS (
    SELECT c.oid, c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname IN ('collaboration_tasks', 'collaboration_turns')
),
columns AS (
    SELECT t.oid, t.relname, a.attname, a.attnum, a.atttypid, a.atttypmod, a.attnotnull
    FROM target_tables AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
    WHERE a.attnum > 0 AND NOT a.attisdropped
),
routines AS (
    SELECT p.*
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN (SELECT rpc_name FROM expected)
),
report(section, object_name, details) AS (
    SELECT '01_columns', relname::text,
           jsonb_agg(jsonb_build_object(
               'column', attname, 'type', pg_catalog.format_type(atttypid, atttypmod),
               'not_null', attnotnull
           ) ORDER BY attnum)
    FROM columns
    GROUP BY relname
    UNION ALL
    SELECT '02_constraints', t.relname::text,
           jsonb_agg(jsonb_build_object(
               'name', c.conname, 'validated', c.convalidated,
               'definition', pg_catalog.pg_get_constraintdef(c.oid)
           ) ORDER BY c.conname)
    FROM target_tables AS t JOIN pg_catalog.pg_constraint AS c ON c.conrelid = t.oid
    GROUP BY t.relname
    UNION ALL
    SELECT '03_domain_and_enum', c.relname::text || '.' || c.attname::text,
           jsonb_build_object(
               'domain_checks', ARRAY(
                   SELECT pg_catalog.pg_get_constraintdef(k.oid)
                   FROM pg_catalog.pg_constraint AS k WHERE k.contypid IN (t.oid, element.oid)
                   ORDER BY k.conname
               ),
               'enum_values', ARRAY(
                   SELECT e.enumlabel FROM pg_catalog.pg_enum AS e
                   WHERE e.enumtypid IN (t.oid, t.typbasetype, element.oid, element.typbasetype)
                   ORDER BY e.enumtypid, e.enumsortorder
               )
           )
    FROM columns AS c
    JOIN pg_catalog.pg_type AS t ON t.oid = c.atttypid
    LEFT JOIN pg_catalog.pg_type AS base ON base.oid = t.typbasetype
    LEFT JOIN pg_catalog.pg_type AS element ON element.oid = coalesce(nullif(t.typelem, 0), base.typelem)
    WHERE t.typtype IN ('d','e') OR element.typtype IN ('d','e')
    UNION ALL
    SELECT '04_unique_indexes', t.relname::text,
           jsonb_agg(jsonb_build_object(
               'definition', pg_catalog.pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid
           ) ORDER BY i.indexrelid)
    FROM target_tables AS t
    JOIN pg_catalog.pg_index AS i ON i.indrelid = t.oid AND i.indisunique
    GROUP BY t.relname
    UNION ALL
    SELECT '05_triggers', t.relname::text,
           coalesce(jsonb_agg(jsonb_build_object(
               'name', g.tgname, 'enabled', g.tgenabled, 'routine', g.tgfoid::regprocedure::text
           ) ORDER BY g.tgname) FILTER (WHERE g.oid IS NOT NULL), '[]'::jsonb)
    FROM target_tables AS t
    LEFT JOIN pg_catalog.pg_trigger AS g ON g.tgrelid = t.oid AND NOT g.tgisinternal
    GROUP BY t.relname
    UNION ALL
    SELECT '06_rpc_contract', e.rpc_name,
           jsonb_build_object(
               'stage', e.stage, 'expected_named_arguments', e.argument_names,
               'check_locally', e.check_locally,
               'oid', p.oid, 'signature', p.oid::regprocedure::text,
               'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
               'returns', pg_catalog.pg_get_function_result(p.oid),
               'named_argument_match', p.pronargs = cardinality(e.argument_names)
                   AND coalesce(p.proargnames[1:p.pronargs], ARRAY[]::text[]) @> e.argument_names,
               'sensitive_terms_detected', p.prosrc ~*
                   '(secret|password|credential|bearer|api[_ -]?key|authorization|vault|current_setting|https?://|postgres(ql)?://|dblink)',
               'source_review_required', true
           )
    FROM expected AS e LEFT JOIN routines AS p ON p.proname = e.rpc_name
)
SELECT section, object_name, details FROM report
ORDER BY section, object_name, details->>'signature';

-- Optional source inspection. Run separately, privately, after the metadata
-- report. Use only the signatures or catalog OIDs from rows under review.
-- A false sensitive-terms flag is not a safety guarantee. Share only sanitized
-- conditions, writes and projections for the checks listed in section 06.
--
-- SELECT p.oid::regprocedure::text AS signature,
--        pg_catalog.pg_get_functiondef(p.oid) AS definition
-- FROM pg_catalog.pg_proc AS p
-- WHERE p.oid IN (NULL::oid) -- replace NULL with the reviewed catalog OID
-- ORDER BY signature;
