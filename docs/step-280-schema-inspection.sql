-- Step 280. Run the main statement in the Supabase SQL Editor.
-- It returns compact JSON sections using catalog metadata only.
-- Function bodies, default expressions, trigger arguments and scheduler
-- commands are omitted. Review policy expressions locally before sharing.

WITH
review_roles(role_name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
),
target_tables(schema_name, table_name) AS (
    VALUES
        ('auth', 'users'),
        ('storage', 'objects'),
        ('storage', 'buckets'),
        ('public', 'student_ai_daily_usage'),
        ('public', 'student_ai_reservations'),
        ('public', 'student_profiles'),
        ('public', 'student_subjects'),
        ('public', 'student_assignments'),
        ('public', 'student_attendance'),
        ('public', 'student_marks'),
        ('public', 'student_exams'),
        ('public', 'student_study_plans'),
        ('public', 'student_timetable'),
        ('public', 'student_projects'),
        ('public', 'student_notes'),
        ('public', 'student_documents'),
        ('public', 'student_placements'),
        ('public', 'student_ai_chats'),
        ('public', 'student_ai_messages'),
        ('public', 'student_mock_tests'),
        ('public', 'student_mock_attempts'),
        ('public', 'student_aptitude_tests'),
        ('public', 'student_aptitude_attempts'),
        ('public', 'ai_daily_usage'),
        ('public', 'user_api_keys'),
        ('public', 'collaboration_tasks'),
        ('public', 'collaboration_turns'),
        ('public', 'platform_provider_daily_usage'),
        ('public', 'ollama_inference_jobs')
),
target_rpcs(rpc_name) AS (
    VALUES
        ('reserve_student_ai_request'),
        ('settle_student_ai_request'),
        ('reserve_student_ai_calls'),
        ('apply_mock_test_progress'),
        ('reserve_ai_request'),
        ('create_collaboration_with_quota'),
        ('claim_collaboration_task'),
        ('renew_collaboration_lease'),
        ('release_collaboration_task'),
        ('save_collaboration_checkpoint'),
        ('schedule_collaboration_retry'),
        ('get_due_collaboration_tasks_with_owner'),
        ('recover_expired_collaboration_tasks'),
        ('reserve_platform_provider_call'),
        ('claim_ollama_inference_job'),
        ('complete_ollama_inference_job'),
        ('cancel_ollama_inference_job')
),
tables AS (
    SELECT t.*, c.oid, c.relkind, c.relowner, c.relrowsecurity,
           c.relforcerowsecurity, c.relacl, c.relispartition
    FROM target_tables AS t
    LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = t.schema_name
    LEFT JOIN pg_catalog.pg_class AS c
        ON c.relnamespace = n.oid AND c.relname = t.table_name
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
queue_triggers AS (
    SELECT g.oid, g.tgname, g.tgenabled, g.tgfoid
    FROM tables AS t
    JOIN pg_catalog.pg_trigger AS g ON g.tgrelid = t.oid
    WHERE t.schema_name = 'public' AND t.table_name = 'ollama_inference_jobs'
      AND NOT g.tgisinternal
),
routines AS (
    SELECT p.*, n.nspname AS schema_name, l.lanname AS language,
           p.oid::regprocedure::text AS catalog_identity,
           '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS arguments,
           p.prosrc ~* '(secret|password|credential|token|bearer|api[_ -]?key|authorization|service[_ -]?role|vault|current_setting|https?://|postgres(ql)?://|dblink|net[.])'
               AS sensitive_terms_detected
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.prokind IN ('f', 'p')
      AND (
          (n.nspname = 'public' AND p.proname IN (SELECT rpc_name FROM target_rpcs))
          OR p.oid IN (SELECT tgfoid FROM queue_triggers)
          OR (n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND p.prosrc ~* '(ollama_inference_jobs|cancel_ollama_inference_job)'
              AND p.prosrc ~* '(delete|truncate|retention|purge|cleanup|expir)')
      )
),
policy_text AS (
    SELECT p.*,
           pol.oid AS policy_oid,
           coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') AS expressions
    FROM pg_catalog.pg_policies AS p
    JOIN tables AS t ON t.schema_name = p.schemaname AND t.table_name = p.tablename
    JOIN pg_catalog.pg_policy AS pol ON pol.polrelid = t.oid AND pol.polname = p.policyname
),
report(section, object_name, details) AS (
    SELECT '01_role_flags', rr.role_name,
           jsonb_build_object('present', r.oid IS NOT NULL, 'bypass_rls', r.rolbypassrls,
                              'superuser', r.rolsuper)
    FROM review_roles AS rr
    LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = rr.role_name

    UNION ALL
    SELECT '02_tables_and_rls', format('%I.%I', t.schema_name, t.table_name),
           jsonb_build_object('present', t.oid IS NOT NULL, 'kind', t.relkind,
               'owner', pg_catalog.pg_get_userbyid(t.relowner), 'rls', t.relrowsecurity,
               'force_rls', t.relforcerowsecurity, 'partition', t.relispartition)
    FROM tables AS t

    UNION ALL
    SELECT '03_columns', format('%I.%I', t.schema_name, t.table_name),
           jsonb_agg(jsonb_build_object('column', c.column_name, 'type', c.data_type,
               'underlying_type', c.udt_name, 'nullable', c.is_nullable,
               'has_default', c.column_default IS NOT NULL, 'identity', c.is_identity)
               ORDER BY c.ordinal_position)
    FROM tables AS t
    JOIN information_schema.columns AS c
      ON c.table_schema = t.schema_name AND c.table_name = t.table_name
    WHERE t.schema_name = 'public'
    GROUP BY t.schema_name, t.table_name

    UNION ALL
    SELECT '04_constraints', format('%I.%I', t.schema_name, t.table_name),
           jsonb_agg(jsonb_build_object('name', c.conname, 'type', c.contype,
               'validated', c.convalidated, 'deferrable', c.condeferrable,
               'definition', CASE WHEN pg_catalog.pg_get_constraintdef(c.oid) !~*
                   '(password|credential|bearer|api[_ -]?key[[:space:]]*=|https?://|postgres(ql)?://|vault[.]|current_setting)'
                   THEN pg_catalog.pg_get_constraintdef(c.oid) ELSE '[review locally]' END)
               ORDER BY c.conname)
    FROM tables AS t
    JOIN pg_catalog.pg_constraint AS c ON c.conrelid = t.oid
    WHERE t.schema_name = 'public'
    GROUP BY t.schema_name, t.table_name

    UNION ALL
    SELECT '05_indexes', format('%I.%I', t.schema_name, t.table_name),
           jsonb_agg(jsonb_build_object('name', idx.relname, 'unique', i.indisunique,
               'valid', i.indisvalid, 'immediate', i.indimmediate,
               'partial', i.indpred IS NOT NULL, 'expression', i.indexprs IS NOT NULL,
               'key_columns', ARRAY(
                   SELECT a.attname
                   FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, pos)
                   LEFT JOIN pg_catalog.pg_attribute AS a
                       ON a.attrelid = t.oid AND a.attnum = k.attnum
                   WHERE k.pos <= i.indnkeyatts ORDER BY k.pos))
               ORDER BY idx.relname)
    FROM tables AS t
    JOIN pg_catalog.pg_index AS i ON i.indrelid = t.oid
    JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
    WHERE t.schema_name = 'public'
      AND t.table_name IN ('student_ai_daily_usage', 'student_ai_reservations', 'ollama_inference_jobs')
    GROUP BY t.schema_name, t.table_name

    UNION ALL
    SELECT '06_table_access', format('%I.%I', t.schema_name, t.table_name),
           jsonb_build_object(
               'acl', (SELECT jsonb_agg(jsonb_build_object('grantee',
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                   'privilege', a.privilege_type, 'grantable', a.is_grantable)
                   ORDER BY a.grantee, a.privilege_type)
                   FROM pg_catalog.aclexplode(coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) AS a),
               'effective', (SELECT jsonb_object_agg(r.rolname, jsonb_build_object(
                   'schema_usage', pg_catalog.has_schema_privilege(r.oid, t.schema_name, 'USAGE'),
                   'table', ARRAY(SELECT perm FROM unnest(
                       ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(perm)
                       WHERE pg_catalog.has_table_privilege(r.oid, t.oid, perm)),
                   'column_read_without_table_select',
                       NOT pg_catalog.has_table_privilege(r.oid, t.oid, 'SELECT')
                       AND pg_catalog.has_any_column_privilege(r.oid, t.oid, 'SELECT')))
                   FROM pg_catalog.pg_roles AS r JOIN review_roles AS rr ON rr.role_name = r.rolname))
    FROM tables AS t
    WHERE t.oid IS NOT NULL

    UNION ALL
    SELECT '07_rls_policies', format('%I.%I', t.schema_name, t.table_name),
           coalesce((SELECT jsonb_agg(jsonb_build_object('name', p.policyname,
               'command', p.cmd, 'roles', p.roles, 'mode', p.permissive,
               'catalog_routine_dependencies', ARRAY(
                   SELECT DISTINCT d.refobjid::regprocedure::text
                   FROM pg_catalog.pg_depend AS d
                   WHERE d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = p.policy_oid
                     AND d.refclassid = 'pg_catalog.pg_proc'::regclass ORDER BY 1),
               'using', CASE WHEN p.expressions ~* '(password|credential|bearer|api[_ -]?key|https?://|postgres(ql)?://|vault[.])'
                             THEN '[review locally]' ELSE p.qual END,
               'with_check', CASE WHEN p.expressions ~* '(password|credential|bearer|api[_ -]?key|https?://|postgres(ql)?://|vault[.])'
                                  THEN '[review locally]' ELSE p.with_check END)
               ORDER BY p.policyname)
               FROM policy_text AS p
               WHERE p.schemaname = t.schema_name AND p.tablename = t.table_name), '[]'::jsonb)
    FROM tables AS t
    WHERE t.oid IS NOT NULL

    UNION ALL
    SELECT '08_missing_public_rpcs', 'public.' || tr.rpc_name, '{"present":false}'::jsonb
    FROM target_rpcs AS tr
    WHERE NOT EXISTS (
        SELECT 1 FROM routines AS f WHERE f.schema_name = 'public' AND f.proname = tr.rpc_name)

    UNION ALL
    SELECT '09_routine_contract_and_source_review',
           format('%I.%I', f.schema_name, f.proname) || f.arguments,
           jsonb_build_object('oid', f.oid, 'kind', f.prokind, 'language', f.language,
               'returns', pg_catalog.pg_get_function_result(f.oid),
               'defaulted_argument_count', f.pronargdefaults,
               'owner', pg_catalog.pg_get_userbyid(f.proowner), 'security_definer', f.prosecdef,
               'volatility', f.provolatile,
               'search_path_empty', 'search_path=""' = ANY(coalesce(f.proconfig, ARRAY[]::text[])),
               'setting_names', ARRAY(
                   SELECT split_part(setting, '=', 1) FROM unnest(f.proconfig) AS s(setting)),
               'sensitive_terms_detected', f.sensitive_terms_detected,
               'source_review_required', true)
    FROM routines AS f

    UNION ALL
    SELECT '10_routine_execute',
           format('%I.%I', f.schema_name, f.proname) || f.arguments,
           jsonb_build_object(
               'acl', (SELECT jsonb_agg(jsonb_build_object('grantee',
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                   'grantable', a.is_grantable) ORDER BY a.grantee)
                   FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) AS a
                   WHERE a.privilege_type = 'EXECUTE'),
               'effective', (SELECT jsonb_object_agg(r.rolname, jsonb_build_object(
                   'schema_usage', pg_catalog.has_schema_privilege(r.oid, f.pronamespace, 'USAGE'),
                   'execute', pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')))
                   FROM pg_catalog.pg_roles AS r JOIN review_roles AS rr ON rr.role_name = r.rolname))
    FROM routines AS f

    UNION ALL
    SELECT '11_routine_dependencies',
           format('%I.%I', f.schema_name, f.proname) || f.arguments,
           jsonb_build_object(
               'catalog_dependencies', ARRAY(
                   SELECT DISTINCT pg_catalog.pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid)
                   FROM pg_catalog.pg_depend AS d
                   WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = f.oid
                     AND d.refclassid IN ('pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass)
                   ORDER BY 1),
               'table_name_mentions', ARRAY(
                   SELECT DISTINCT t.table_name FROM target_tables AS t
                   WHERE f.prosrc ~* ('\\m' || t.table_name || '\\M') ORDER BY 1),
               'rpc_name_mentions', ARRAY(
                   SELECT tr.rpc_name FROM target_rpcs AS tr
                   WHERE tr.rpc_name <> f.proname AND f.prosrc ~* ('\\m' || tr.rpc_name || '\\M')
                   ORDER BY 1))
    FROM routines AS f

    UNION ALL
    SELECT '12_ollama_queue_triggers', g.tgname,
           jsonb_build_object('enabled_mode', g.tgenabled, 'routine', f.catalog_identity)
    FROM queue_triggers AS g
    LEFT JOIN routines AS f ON f.oid = g.tgfoid

    UNION ALL
    SELECT '13_retention_discovery', 'scheduler_and_partition_metadata',
           jsonb_build_object('cron_job_catalog_present', pg_catalog.to_regclass('cron.job') IS NOT NULL,
               'extensions', coalesce((SELECT jsonb_object_agg(e.extname, e.extversion)
                   FROM pg_catalog.pg_extension AS e WHERE e.extname IN ('pg_cron','pg_partman')), '{}'::jsonb),
               'queue_child_relations', ARRAY(SELECT i.inhrelid::regclass::text
                   FROM pg_catalog.pg_inherits AS i JOIN tables AS t ON t.oid = i.inhparent
                   WHERE t.schema_name = 'public' AND t.table_name = 'ollama_inference_jobs' ORDER BY 1),
               'queue_expiry_default_kind', (SELECT CASE
                   WHEN a.attnum IS NULL THEN 'column absent'
                   WHEN d.oid IS NULL THEN 'no default'
                   WHEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~* '(now|current_timestamp).*interval'
                       THEN 'timestamp plus interval expression'
                   ELSE 'other default expression' END
                   FROM tables AS t
                   LEFT JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
                       AND a.attname = 'expires_at' AND NOT a.attisdropped
                   LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = t.oid AND d.adnum = a.attnum
                   WHERE t.schema_name = 'public' AND t.table_name = 'ollama_inference_jobs'))
)
SELECT section, object_name, details
FROM report
ORDER BY section, object_name;

-- Optional scheduler metadata. Run this second SELECT separately only when
-- section 13 reports cron_job_catalog_present=true. It emits no job commands.
-- A match can be a status/expiry task or a purge. Generic wrappers and external
-- schedulers may require separate local confirmation.
--
-- SELECT '14_matching_cron_jobs' AS section, jobid, schedule, active,
--        command ~* '(delete|truncate|purge|cleanup|retention)' AS cleanup_terms_detected
-- FROM cron.job
-- WHERE command ~* '(ollama_inference_jobs|cancel_ollama_inference_job|ollama.*(purge|cleanup|retention))'
-- ORDER BY jobid;
