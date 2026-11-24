# Step 282O release package

Status: prepared locally for review. Step 282N production two-account SQL passed without assertion errors and ended in rollback, as confirmed by the project owner.

Final validation passed 46 backend tests, TypeScript, the isolated Next.js production build, and diff and whitespace checks. The production build used placeholders and a local font fixture. The allowlisted files contained no credential-shaped literals in the offline scan. The Git index remains empty.

## Exact staging manifest

Use this allowlist only after separate authorization. The SQL under `docs/` is historical or manual validation material. It is not part of the deployment sequence.

```text
AGENTS.md
DEVELOPMENT_LOG.md
PROJECT_STATUS.md
TASKS.md
backend/app/collaboration_runner.py
backend/app/database.py
backend/app/main.py
backend/app/student_ai_quota.py
backend/app/student_aptitude_api.py
docs/step-280-schema-inspection.sql
docs/step-281-collaboration-privileges-proposal.sql
docs/step-281a-quota-rpc-inspection.sql
docs/step-281h-collaboration-acl-snapshot.sql
docs/step-281h-collaboration-post-commit.sql
docs/step-281h-collaboration-remediation.sql
docs/step-282b-hybrid-ollama-compatibility.sql
docs/step-282e-hybrid-ollama-functional-rollback.sql
docs/step-282i-two-account-isolation-rollback.sql
docs/step-282i-two-account-isolation.md
docs/step-282o-release.md
frontend/app/collaboration/page.tsx
tests/test_authenticated_isolation.py
tests/test_hybrid_ollama.py
tests/test_student_ai_quota_routes.py
```

Keep these existing working files out of the release:

```text
backend/test_openrouter.py
migrations/635B_35_58_student_ai_reservations.sql
migrations/635B_35_95_validation_rollback.sql
migrations/635B_35_97_quota_functional_test.sql
migrations/635B_35_98_isolated_quota_test.sql
step124-review.txt
```

Keep backups, isolated build artifacts, environment files, credentials, and database result exports out of Git. The four SQL drafts are preserved locally. Production already has the Student AI RPCs, and the verified Hybrid Ollama workflow requires no migration.

## Authorized rollout order

1. Compare the approved GitHub base with local `release/ai-tutor-security` at `5405155`. The owner reported production PR #3 at `28aad66`, which is absent from the cached local object history. Confirm the intended base and preserve newer production work before publishing the allowlisted changes.
2. Deploy the reviewed backend revision to Render first. Check health, current CORS, authenticated read-only history and usage, and the approved settings for `ENABLE_LOCAL_OLLAMA` and `ENABLE_AUTO_RESUME`. Verify the existing bridge configuration and cloud fallback budgets through the authorized environment.
3. Deploy the matching frontend revision only after the backend is healthy and the expected Ollama path is confirmed. Verify `NEXT_PUBLIC_API_URL` points to the verified backend and build with `NEXT_PUBLIC_ENABLE_LOCAL_OLLAMA=true` when enabling the feature.
4. Perform approved release smoke tests with designated accounts. Check individual and multi-model results, paused-task recovery and quota accounting, and Tutor and Aptitude behavior. Use the approved no-charge provider configuration for any separately authorized generation.
5. If the frontend exposes incompatible behavior, disable the frontend flag or roll back the frontend first. If backend rollback is needed, restore the previous approved backend revision after the frontend no longer depends on the new behavior. The approved database ACLs and existing RPCs remain in place.

## Known limitations

- Request deduplication for Collaboration covers overlapping requests in a single API process and repeated browser clicks. Cross-process and post-completion replays can create another charged task.
- An ambiguous Student AI write can leave a held reservation on its original UTC day. The frontend currently omits request IDs, so a manual retry can start a separately charged operation.
