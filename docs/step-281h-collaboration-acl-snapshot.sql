-- Run before any approved ACL change. Export all rows for recovery.
-- A NULL raw_acl records an unset ACL. An empty ACL is represented as {}.
WITH target AS (
    SELECT oid, relowner, relacl
    FROM pg_catalog.pg_class
    WHERE oid = 'public.collaboration_tasks'::regclass
),
acl_objects AS (
    SELECT 'table' AS scope, NULL::name AS column_name, 0 AS ordinal,
           t.relowner, t.relacl AS raw_acl,
           coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner)) AS acl_to_expand
    FROM target AS t
    UNION ALL
    SELECT 'column', a.attname, a.attnum, t.relowner, a.attacl, a.attacl
    FROM target AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
    WHERE a.attnum > 0 AND NOT a.attisdropped
)
SELECT o.scope, o.column_name, pg_catalog.pg_get_userbyid(o.relowner) AS table_owner,
       o.raw_acl::text AS raw_acl,
       pg_catalog.pg_get_userbyid(g.grantor) AS grantor,
       CASE WHEN g.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee,
       g.privilege_type AS privilege, g.is_grantable AS with_grant_option
FROM acl_objects AS o
LEFT JOIN LATERAL pg_catalog.aclexplode(o.acl_to_expand) AS g ON true
ORDER BY o.ordinal, grantor, grantee, privilege;
