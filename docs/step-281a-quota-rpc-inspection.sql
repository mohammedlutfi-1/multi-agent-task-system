-- Read-only. Run this first. A false flag does not establish safety.
WITH targets(signature) AS (
    VALUES ('public.reserve_student_ai_request(uuid, uuid, integer)'),
           ('public.settle_student_ai_request(uuid, integer)')
)
SELECT t.signature,
       p.oid IS NOT NULL AS present,
       p.prosrc ~* '(secret|password|credential|bearer|api[_ -]?key|authorization|vault|current_setting|https?://|postgres(ql)?://|dblink)'
           AS sensitive_terms_detected,
       true AS local_review_required
FROM targets AS t
LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(t.signature)
ORDER BY t.signature;

-- Run this second SELECT separately only in the SQL Editor for private review.
-- Do not export the whole result. Share only the duplicate-request branch in
-- reserve and the already-finalized branch in settle, with their surrounding
-- lock acquisition, quota counter writes, and relevant return columns.
-- Remove any sensitive literals, comments, credential lookups, URLs, and
-- unrelated lines. Preserve lock ordering and conditions in your excerpts.
--
-- SELECT p.oid::regprocedure::text AS signature,
--        pg_catalog.pg_get_functiondef(p.oid) AS definition
-- FROM pg_catalog.pg_proc AS p
-- WHERE p.oid IN (
--     pg_catalog.to_regprocedure('public.reserve_student_ai_request(uuid, uuid, integer)'),
--     pg_catalog.to_regprocedure('public.settle_student_ai_request(uuid, integer)')
-- )
-- ORDER BY signature;
