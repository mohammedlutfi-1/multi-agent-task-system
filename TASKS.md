# Development tasks

## Completed

- [x] Audit the release checkout, architecture, feature coverage, and production verification gaps.
- [x] Step 279. Review the four quota SQL files, establish a canonical candidate, review the backend RPC contract, inventory missing database definitions, parse SQL offline, and rerun the nine existing tests.
- [x] Step 280 preparation. Prepare the read-only schema and security inspection script for manual execution in the Supabase SQL Editor.
- [x] Step 280 summary review. Compare the reported quota schema and RPC contract against Step 279 and record remaining access-control checks.
- [x] Step 281 local implementation. Update Aptitude and Tutor quota handling, test failures and retries, and draft collaboration privilege remediation.

## Focused verification

- [x] Step 281A local review. Prepare the targeted RPC inspection, review the ACL proposal, check available tooling, fix skipped refunds on malformed accepted reservations, and rerun the backend suite.
- [x] Step 281D/E. Compare confirmed deployed quota replay behavior with the backend and tests. Finalize the rollback-first collaboration ACL validation script.
- [x] Step 281G. Owner confirmed the production validation reached policy inspection and rolled back.
- [x] Step 281H. Prepare the recovery snapshot, commit-ready remediation, post-commit verification, and smoke tests.
- [x] Step 282A. Add individual Ollama execution in the Collaboration workspace, preserve multi-model execution and recovery, and validate the backend and frontend offline.
- [x] Step 281I. The owner saved and verified the recovery snapshot. Include MAINTAIN in both remediation variants and verification.
- [x] Production ACL rollout. Owner confirmed commit, post-commit verification including MAINTAIN removal, and successful creation, fallback, and final-answer generation.
- [x] Step 282B. Trace the Hybrid Ollama RPCs, prepare a focused read-only inspection, and review release risks.
- [x] Step 282E. Fix completion recovery, handle the deployed five-field due row, add regressions, and prepare rollback-only functional validation.
- [x] Production Hybrid Ollama functional validation. One-round execution, quota, checkpoint, retry and completion passed. Rollback left zero test tasks. No migration required for the tested workflow.
- [x] Step 282I preparation. Document two-account database and authenticated API probes and prepare rollback SQL.
- [x] Step 282K. Add owner-positive SQL controls and complete local authenticated API isolation checks with mocked infrastructure. All 46 backend tests passed.
- [x] Step 282N. Owner confirmed the production two-account SQL passed and ended in rollback.
- [x] Step 282O. Prepare the consolidated release, staging allowlist, verification results, and backend-first rollout sequence.

- [ ] Verify the intended GitHub base and obtain separate approval before staging or deploying the [release package](docs/step-282o-release.md).
- [ ] Before enabling Hybrid Ollama, validate the backend first and then enable the frontend flag with the updated backend in place. Confirm bridge connectivity, cloud budgets, and platform auto-resume.
- [ ] Confirm whether Ollama queue retention has an external owner or schedule when addressing the retention gap.

## Later work, pending approval

- [ ] Validate any proposed database changes in disposable PostgreSQL using verified baseline definitions.
- [ ] Verify document storage and backend-only test answer keys in a separately scoped check.
- [ ] Define an operational reconciliation process if logs show repeated settlement or persistence ambiguity.
- [ ] Validate worker-offline cloud fallback, budget exhaustion, fresh-task collaboration recovery, and queue payload retention. Run frontend build and production acceptance once authorized.

Keep the older paused collaboration, cloud-hosted Ollama, and additional optional models deferred. Production migration, push, merge, and deployment require explicit approval.

## Production smoke-test record

- [x] Owner confirmed production creation, fallback, final-answer generation, and the post-commit access report.
- [x] Owner confirmed the two-account database isolation check passed. The authenticated API checks passed locally with signed synthetic tokens.
