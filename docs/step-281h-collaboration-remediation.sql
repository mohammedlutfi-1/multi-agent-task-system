-- PRODUCTION CHANGE. This script commits. Run only after explicit approval.
-- First export step-281h-collaboration-acl-snapshot.sql for recovery.
-- In one SQL Editor session, run this entire script. On error, issue
-- ROLLBACK in that session if needed, and stop before taking further action.
-- After commit, run step-281h-collaboration-post-commit.sql.
-- Any approved reversal must restore only the captured ACL deltas and
-- grant options under the original grantors. Restoring INSERT reopens the bypass.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

REVOKE ALL PRIVILEGES ON TABLE public.collaboration_tasks FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
    ON TABLE public.collaboration_tasks FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.collaboration_tasks TO authenticated;

-- Table REVOKE does not remove independent column grants.
DO $acl$
DECLARE
    columns text;
BEGIN
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO STRICT columns
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.collaboration_tasks'::regclass
      AND attnum > 0 AND NOT attisdropped;

    EXECUTE format(
        'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s)
         ON TABLE public.collaboration_tasks FROM PUBLIC, anon', columns
    );
    EXECUTE format(
        'REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s)
         ON TABLE public.collaboration_tasks FROM authenticated', columns
    );
END;
$acl$;

-- Verification sees inherited grants as well as direct grants. Unexpected
-- privileges abort the proposal rather than changing other role memberships.
DO $verify$
DECLARE
    target regclass := 'public.collaboration_tasks'::regclass;
    quota_rpc oid;
    role_name text;
    privilege text;
    switched record;
    policy record;
    owner_select boolean := false;
    owner_delete boolean := false;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
            IF has_table_privilege(role_name::name, target::oid, privilege) THEN
                RAISE EXCEPTION 'Unexpected effective % privilege for %', privilege, role_name;
            END IF;
        END LOOP;
        IF has_any_column_privilege(role_name::name, target::oid, 'INSERT')
           OR has_any_column_privilege(role_name::name, target::oid, 'UPDATE')
           OR has_any_column_privilege(role_name::name, target::oid, 'REFERENCES') THEN
            RAISE EXCEPTION 'Unexpected effective column privileges for %', role_name;
        END IF;
    END LOOP;

    IF has_any_column_privilege('anon', target, 'SELECT')
       OR has_table_privilege('anon', target, 'DELETE')
       OR NOT has_table_privilege('authenticated', target, 'SELECT')
       OR NOT has_table_privilege('authenticated', target, 'DELETE')
       OR NOT has_table_privilege('service_role', target, 'SELECT')
       OR NOT has_table_privilege('service_role', target, 'INSERT')
       OR NOT has_table_privilege('service_role', target, 'UPDATE')
       OR NOT has_schema_privilege('service_role', 'public', 'USAGE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname IN ('anon', 'authenticated')
                    AND (rolsuper OR rolbypassrls))
       OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_class AS c
           WHERE c.oid = target
             AND (pg_has_role('anon', c.relowner, 'USAGE')
                  OR pg_has_role('authenticated', c.relowner, 'USAGE'))
       )
       OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = target) THEN
        RAISE EXCEPTION 'Collaboration table access does not match the expected post-change state';
    END IF;

    SELECT p.oid INTO STRICT quota_rpc
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_collaboration_with_quota'
      AND p.prokind = 'f'
      AND p.pronargs = 6
      AND p.proargnames @> ARRAY[
          'p_user_id', 'p_task', 'p_selected_models', 'p_max_rounds',
          'p_credential_mode', 'p_daily_limit'
      ];

    IF NOT has_function_privilege('service_role', quota_rpc, 'EXECUTE')
       OR has_function_privilege('anon', quota_rpc, 'EXECUTE')
       OR has_function_privilege('authenticated', quota_rpc, 'EXECUTE') THEN
        RAISE EXCEPTION 'Collaboration quota RPC access does not match the expected state';
    END IF;

    -- Check transitive SET ROLE paths separately from automatically inherited
    -- grants. Older servers allow role switches along all membership edges.
    FOR switched IN
        WITH RECURSIVE reachable(origin, role_oid) AS (
            SELECT r.oid, r.oid FROM pg_catalog.pg_roles AS r
            WHERE r.rolname IN ('anon', 'authenticated')
            UNION
            SELECT path.origin, m.roleid
            FROM reachable AS path
            JOIN pg_catalog.pg_auth_members AS m ON m.member = path.role_oid
            WHERE coalesce((to_jsonb(m) ->> 'set_option')::boolean, true)
        )
        SELECT path.origin, r.oid, r.rolname, r.rolsuper, r.rolbypassrls
        FROM reachable AS path
        JOIN pg_catalog.pg_roles AS r ON r.oid = path.role_oid
        WHERE path.origin <> path.role_oid
    LOOP
        IF switched.rolsuper OR switched.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = target
                      AND pg_has_role(switched.oid, c.relowner, 'USAGE'))
           OR has_table_privilege(switched.oid, target::oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN')
           OR has_any_column_privilege(switched.oid, target::oid, 'SELECT, INSERT, UPDATE, REFERENCES')
           OR has_function_privilege(switched.oid, quota_rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'Role % can switch to collaboration-capable role %',
                pg_get_userbyid(switched.origin), switched.rolname;
        END IF;
    END LOOP;

    -- Review applicable permissive SELECT/DELETE policies, including PUBLIC
    -- and inherited roles. Unexpected equivalent expressions require review
    -- instead of silently accepting a broader policy.
    FOR policy IN
        SELECT p.polname, p.polcmd,
               regexp_replace(pg_get_expr(p.polqual, p.polrelid),
                              '[[:space:]()]', '', 'g') AS predicate
        FROM pg_catalog.pg_policy AS p
        WHERE p.polrelid = target AND p.polpermissive AND p.polcmd IN ('r', 'd', '*')
          AND EXISTS (
              SELECT 1 FROM unnest(p.polroles) AS roles(role_oid)
              WHERE CASE WHEN role_oid = 0 THEN true
                         ELSE pg_has_role('authenticated', role_oid, 'USAGE') END
          )
    LOOP
        IF policy.predicate IS NULL OR policy.predicate NOT IN (
            'auth.uid=user_id', 'user_id=auth.uid',
            'selectauth.uidasuid=user_id', 'user_id=selectauth.uidasuid'
        ) THEN
            RAISE EXCEPTION 'Review unexpected authenticated history policy %', policy.polname;
        END IF;
        owner_select := owner_select OR policy.polcmd IN ('r', '*');
        owner_delete := owner_delete OR policy.polcmd IN ('d', '*');
    END LOOP;
    IF NOT owner_select OR NOT owner_delete THEN
        RAISE EXCEPTION 'Expected authenticated owner SELECT and DELETE policies were not found';
    END IF;
END;
$verify$;

SELECT policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'collaboration_tasks'
ORDER BY policyname;

-- In an authorized disposable environment, verify:
-- * anon cannot access tasks and authenticated cannot submit direct inserts;
-- * an authenticated account can list/delete its own task only;
-- * the FastAPI history endpoints and service-role quota RPC still work;
-- * a new task increments collaboration usage exactly once via the quota RPC.
-- COMMIT makes the above privilege changes permanent.
COMMIT;
