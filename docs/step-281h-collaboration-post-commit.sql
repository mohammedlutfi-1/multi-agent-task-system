-- Read-only. Run after the separately approved remediation commits.
-- Expected: anon has no table/column privileges; authenticated has only
-- table SELECT and DELETE (table SELECT also implies column SELECT);
-- service_role retains required access. The quota RPC is service-role only.
-- RLS must be enabled, with owner-scoped SELECT and DELETE policies.
WITH target AS (
    SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.collaboration_tasks'::regclass
),
review_roles AS (
    SELECT oid, rolname, rolbypassrls, rolsuper
    FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
),
quota_rpcs AS (
    SELECT p.oid
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_collaboration_with_quota'
      AND p.prokind = 'f'
)
SELECT '01_effective_access' AS section, r.rolname::text AS subject,
       jsonb_build_object(
           'public_schema_usage', has_schema_privilege(r.oid, 'public', 'USAGE'),
           'rls_bypass', r.rolbypassrls OR r.rolsuper,
           'table_privileges', ARRAY(
               SELECT privilege
               FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(privilege)
               WHERE has_table_privilege(r.oid, t.oid, privilege)
           ),
           'column_privileges', ARRAY(
               SELECT privilege
               FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilege)
               WHERE has_any_column_privilege(r.oid, t.oid, privilege)
           ),
           'quota_rpc_execute', coalesce((
               SELECT jsonb_object_agg(q.oid::regprocedure::text, has_function_privilege(r.oid, q.oid, 'EXECUTE'))
               FROM quota_rpcs AS q
           ), '{}'::jsonb)
       ) AS details
FROM target AS t CROSS JOIN review_roles AS r
UNION ALL
SELECT '02_rls', 'public.collaboration_tasks',
       jsonb_build_object('enabled', t.relrowsecurity, 'forced', t.relforcerowsecurity)
FROM target AS t
UNION ALL
SELECT '03_policy', policyname,
       jsonb_build_object('roles', roles, 'command', cmd, 'mode', permissive,
                          'using', qual, 'with_check', with_check)
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'collaboration_tasks'
ORDER BY section, subject;
