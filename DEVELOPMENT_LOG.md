# Development log

## 2026-11-24 — Steps 282N and 282O

- The owner confirmed that the production two-account isolation SQL finished without assertion errors and ended in rollback.
- Prepared the [consolidated release package](docs/step-282o-release.md) for the Student AI quota fixes, Hybrid Ollama, checkpoint recovery and automatic resume, and authenticated isolation coverage. The package lists the exact staging allowlist and the backend-first deployment sequence.
- The cached release branch remains at `5405155`. Verify the intended GitHub base against the owner-reported production merge before publishing. The Step 279 SQL drafts and unrelated local scratch files remain outside the release.
- Final validation passed all 46 backend tests, frontend TypeScript, and the Next.js Turbopack build with placeholder public configuration and local font fixtures. Tracked diff whitespace and untracked release-file whitespace checks passed. No credential-shaped literals were detected in the 24 allowlisted files. The index is empty.

## 2026-11-24 — Step 282K

- Corrected the rollback script to give both Tutor accounts a chat with a message. Owner-readable tables now require positive reads and reciprocal cross-account denial. Backend-only mode must be selected explicitly and requires absence of browser SELECT access. Collaboration includes owner-positive read and deletion checks. The key probe remains a constant projection with a false predicate.
- Added six local signed-JWT isolation tests using the existing ASGI harness. The real bearer verifier, routes, and database query helpers run with ephemeral signing material, mocked JWKS and PostgREST transport, and a provider stub that fails if reached. Tests cover collaboration and Tutor reads, denied writes, legitimate owner deletion, quota counter isolation, and key metadata projection.
- All 46 backend tests passed. SQL and PL/pgSQL parsed offline and the final rollback was verified. Database execution and hosted Auth and API checks remain outside these results. No new staging infrastructure, live credentials, or provider calls were used.

## 2026-11-24 — Step 282I preparation

- The owner confirmed that the production rollback validation passed one-model, one-round creation, quota charging, checkpoint persistence, retry scheduling, and completion from the saved answer. Rollback verification returned `remaining_test_tasks = 0`. The tested workflow requires no database migration.
- Prepared the [two-account procedure](docs/step-282i-two-account-isolation.md) and [rollback SQL](docs/step-282i-two-account-isolation-rollback.sql). The database stage checks synthetic Collaboration and Tutor isolation, direct write enforcement, and per-user quota changes. The API stage uses separate authenticated staging sessions with provider stubs and verifies only provider key metadata.
- The SQL and PL/pgSQL parsed offline. No production SQL, authenticated API tests, or live provider calls were executed during preparation.

## 2026-11-24 — Step 282E

- The owner reported the two collaboration tables, matching named arguments for all eight RPCs, the one-round and first-turn ranges, the valid task/turn unique constraint, expected storage and statuses, the enabled initialization trigger, and the model validator. The due RPC returns only id, task, selected_models, max_rounds, and user_id.
- Recovery now uses the due row's owner and task ID to load authoritative task state and verify platform auto-resume eligibility. A transient or ambiguous completion failure after the individual checkpoint checks for a committed completion first. Otherwise it schedules a retry when possible or preserves the task for lease recovery. Recovery reuses the saved answer without another inference or quota deduction. The frontend polls deferred running and paused results.
- All 40 backend tests passed, including four new tests for confirmed and uncertain persistence outcomes, the five-field due row, and owner/platform authorization. Frontend TypeScript passed.
- Prepared [rollback-only functional validation](docs/step-282e-hybrid-ollama-functional-rollback.sql). It requires an explicit test account, uses a uniquely named synthetic task, and checks targeted retry/reclaim, final storage, and exactly one provisional quota debit. It skips the global expired-lease RPC, which may touch unrelated work. The SQL and PL/pgSQL parsed offline and were never executed.

## 2026-11-24 — Step 282B

- The owner confirmed the production collaboration ACL change committed. Post-commit verification passed, including MAINTAIN removal for browser roles. Production creation, fallback, and final-answer generation succeeded. Two-account isolation remains pending.
- Traced the task lifecycle through creation with quota, claim, lease renewal, checkpoint, release, retry scheduling, expired lease recovery, and due-task projection. The [read-only report](docs/step-282b-hybrid-ollama-compatibility.sql) checks the relevant table structures and RPC contracts without re-inspecting ACLs or Student AI quotas. Catalog inspection does not prove branch behavior. Review only the relevant sanitized source checks, then use an approved smoke test.
- Hybrid Ollama inference is checkpointed before completion. A transient completion-write exception can currently fall into the generic failure path and mark an already checkpointed task failed, which blocks automatic retry. This is a release gate. The existing RPC takes no durable submission ID. The browser and API guards cover concurrent submissions in their current session or process, so a later replay or submission to another process can still create another charged task.
- No runtime code or migrations changed. No production SQL, credentials, or live provider calls were used.

## 2026-11-24 — Step 282A

- Backed up each existing file before modifying it in `backups/step-282a-20261124-160135-516`. The workspace and model cards remain in place. Ollama alone switches the submission to Generate Answer and displays the saved result as AI response.
- The collaboration runner treats the saved one-model, one-round configuration as individual. It sends one answer request through the existing queue/fallback caller and records the actual provider and model in one checkpoint. Recovery reuses a durable checkpoint without another model call or quota reservation. Two-round tasks retain their existing behavior.
- The existing atomic creation RPC is called once per accepted task. A synchronous browser guard prevents duplicate clicks, and the API rejects overlapping identical submissions in one process. The deployed creation RPC's local call contract does not expose a durable client request ID. Replays across processes or after completion can create another quota-charged task.
- All 36 backend tests passed, including 25 regressions and 11 Hybrid Ollama cases. Frontend TypeScript and the Turbopack production build passed. The build ran in an isolated copy with placeholder public configuration and local font fixtures. No live provider, SQL execution, or deployment was used.

## 2026-11-24 — Step 281I

- The owner saved and verified the recovery snapshot with 30 table privilege entries and 18 column entries. It shows MAINTAIN granted to anon, authenticated, postgres, and service_role.
- Both remediation variants now explicitly revoke authenticated MAINTAIN. Their existing anon revoke covers MAINTAIN, and their effective and role-switch checks now include it. The post-commit report also lists MAINTAIN. Authenticated SELECT and DELETE and direct postgres and service_role privileges remain intact in the proposed SQL.
- The revised SQL parsed offline. No production SQL ran and the existing recovery snapshot was retained.

## 2026-11-24 — Steps 281G and 281H

- The project owner confirmed the production validation reached the final policy inspection and retained rollback. Authenticated INSERT, DELETE, and SELECT policies were owner-scoped. Production grants remain unchanged by that validation.
- Prepared a raw and expanded table/column ACL snapshot, a commit-ready copy of the validated transaction, and a read-only access report. The executable remediation matches the validated transaction except for the final COMMIT. The rollback reference remains available.
- Added the approved-rollout smoke checklist to TASKS.md. Offline parsing verified both read-only statements and equivalence of the remediation statements before the transaction terminator. No production SQL was executed during preparation. Backend code was unchanged, so the 25-test result is carried forward from Step 281E.

## 2026-11-24 — Steps 281D and 281E

- The owner confirmed the deployed 30-call UTC limit, transaction advisory lock on request ID, daily-usage row locking, and original-day settlement. The backend treats `allowed=false` with an existing reservation ID as HTTP 409 and `allowed=false` with no ID as HTTP 429. No runtime change was required. Route mocks now model a duplicate with allowance remaining and a database rejection for conflicting terminal settlement.
- Finalized the [collaboration ACL script](docs/step-281-collaboration-privileges-proposal.sql) with transaction-local lock and statement timeouts, direct and inherited ACL checks, transitive role-switch checks, ownership policy verification, and service-role RPC access checks. The default remains rollback. SQL and procedural blocks parsed offline. The 25 backend tests passed. No production SQL ran.
- Ambiguous writes require evidence-based reconciliation. The original UTC day's debit remains while the outcome is unknown, and there is no automatic reconciliation. Existing browser requests omit the optional request ID, so manual retries start distinct operations.

## 2026-11-24 — Step 281A validation review

- Prepared the [targeted quota RPC inspection](docs/step-281a-quota-rpc-inspection.sql) for manual use. It screens the exact two signatures before optional local source review. Return only sanitized replay branches and the related locks, counter writes, and return fields.
- Fixed an accepted reservation that could remain debited when the RPC returned invalid counters before generation. The known reservation now follows zero-charge settlement. A conflicting terminal receipt stops settlement retries and is logged. Unknown write outcomes keep the debit held and require evidence before reconciliation.
- Concurrent duplicate requests with the same supplied ID are rejected before a second generation under the modeled database replay contract. IDs are scoped per user, operation, and Tutor chat. Existing browser forms do not send request IDs or automatically retry. A manual retry is a distinct submission that can consume another allowance after an ambiguous response.
- Reviewed the ACL proposal. It revokes direct and column grants for both browser roles where applicable, verifies effective grants, preserves owner-scoped SELECT and DELETE, and verifies the service-role quota entry point. The transaction defaults to rollback. Review SET ROLE reachability and verify two-account behavior in a disposable environment before approval.
- **25/25 backend tests passed**, including all 21 from Step 281 and four new cases covering malformed reservation counters, conflicting settlement, concurrent duplicates, and request-ID scope. Both inspection SELECTs, the ACL proposal, and its column revocation templates parsed offline. No local PostgreSQL server or container tooling was found. No production SQL was executed.

## 2026-11-24 — Step 281 local implementation

- Placement Aptitude uses the deployed reservation and settlement RPCs. Tutor saves the exchange before settling. Both return the saved result if charge settlement remains unconfirmed, with counters from the reservation snapshot. Generation failures and confirmed persistence rejections select a zero-call settlement. Uncertain writes leave the debit held and log the reservation ID.
- Settlement retries at most once with the same reservation and charge. Offline tests model the Step 279 candidate's replay behavior. Before rollout, confirm the deployed duplicate-reservation and already-finalized settlement branches, including locks and counter updates. Optional request UUIDs are scoped to the user and operation. Existing clients without one retain their request shape and each submission starts a distinct operation.
- The collaboration UI fetches history and task details through FastAPI, which uses service-role reads. The checkout shows no direct browser task creation or deletion dependency. The owner's metadata confirms the direct authenticated INSERT bypass and excessive grants for both browser roles. The proposal preserves owner-scoped SELECT and DELETE. Recovery eligibility for rows created outside the quota RPC remains unverified.
- The separate SQL proposal includes ACL checks, verification, and rollback instructions. Offline parsing covered all statements and both PL/pgSQL blocks. The SQL was never executed.
- Offline backend tests passed **21/21**, including the original nine and 12 new route tests, with dotenv disabled and external dependencies mocked. No production SQL, live AI calls, or deployment occurred.

## 2026-11-24 — Step 280 production findings

- Reviewed the project owner's inspection summary. The referenced CSV was unavailable in the workspace or connected document sessions. The reported daily usage key, ledger keys and constraints, RPC signatures, invoker rights, empty search path, and role boundaries are consistent with the candidate. Production objects already exist and there is no basis to reapply the Step 279 DDL.
- Metadata does not establish whether the deployed quota functions match UTC date, cap, request replay, locking, or settlement behavior. Sanitized excerpts of reserve and settle are sufficient for these comparisons. The legacy aptitude RPC's date and counter update logic matters if both accounting paths remain in use. Recovery function source is needed only if the collaboration policy review identifies a direct write path and worker eligibility is unclear.
- The supported collaboration route uses `create_collaboration_with_quota`. The report summary did not include effective collaboration task INSERT privileges or the applicable `WITH CHECK` expressions. Direct creation would require sufficient table or column grants and an applicable RLS policy accepting the row. An owner-only condition alone would not enforce atomic quota reservation. Whether a direct write could lead to platform-funded execution also depends on the fields clients may set and recovery eligibility.
- The audit established no production authorization bypass. Local code does establish quota reliability defects in aptitude generation and Tutor persistence. The absence of identified in-database queue cleanup leaves retention unverified because an external mechanism could exist.
- Recommend proceeding with Step 281 backend-only work after approval, while the focused collaboration access review stays open. No production changes or new inspection queries were executed.

## 2026-11-24 — Step 280 inspection preparation

- Prepared [step-280-schema-inspection.sql](docs/step-280-schema-inspection.sql) for manual execution in Supabase. The main statement reads PostgreSQL catalogs and information_schema. It reports table structures and constraints, effective grants, RLS, RPC signatures and dependency clues, and Ollama retention metadata.
- Function source stays in the database. The report emits a sensitive-term flag and requires local review before any source is shared. Catalog dependencies and name matches cannot establish every PL/pgSQL or dynamic SQL dependency. The optional pg_cron report reads scheduler metadata and omits command text.
- Parsed the main report and optional cron query offline with `pglast`. Each is a single SELECT, with no mutation, SELECT INTO, or row-lock nodes in its syntax tree.
- No database connection or query execution occurred during preparation. Await the main report and optional scheduler results, review any flagged expressions locally, and request sanitized function excerpts only where necessary. Effective account isolation still requires a separately authorized two-account check.

## 2026-11-24 — Step 279

The project owner confirmed production PR #3 at `28aad66` and prior direct SQL Editor changes. Local cached Git refs were used only as checkout evidence. The Ollama implementation and backend route code were outside this step's changes.

### Migration review

- The local canonical candidate is `migrations/635B_35_58_student_ai_reservations.sql`. It uses one transaction, creates the ledger and index if absent, and replaces RPCs in place with matching signatures. It contains no top-level data rewrites or object drops. An incompatible existing function contract or ledger shape still requires reconciliation. `IF NOT EXISTS` does not verify an existing object's definition.
- The three untracked scripts contained identical migration DDL before the candidate update. The `35_95` script wraps the DDL in a rollback. The `35_97` script temporarily resets today's quota for the newest Auth user. The `35_98` script inserts a temporary Auth user. The functional scripts both assert a two-call reservation and full refund before rollback. All three remain preserved as historical validation scripts and contain the original DDL.
- The candidate now rejects a missing, null, or negative locked usage counter and compares existing usage with the remaining allowable amount to avoid addition overflow. The UTC daily cap remains 30.
- Prerequisites include `auth.users(id)` as a UUID FK target, a PostgreSQL build with `gen_random_uuid()`, Supabase roles and appropriate schema usage, and `public.student_ai_daily_usage` with `user_id`, `usage_date`, `calls_used`, and `updated_at`. The usage table needs a non-null counter, a unique key on `(user_id, usage_date)` for the upsert, and effective service-role read, insert, and update access. Check that the legacy usage RPC obeys the same UTC date and counter semantics.
- `reserve_student_ai_request(uuid, uuid, integer)` accepts `p_user_id`, `p_request_id`, `p_requested_calls`, and returns `allowed`, `reservation_id`, `calls_used`, `calls_remaining`, and `daily_limit`. `settle_student_ai_request(uuid, integer)` accepts `p_reservation_id` and `p_calls_charged`, and returns `reservation_status`, `calls_refunded`, `calls_used`, and `calls_remaining`. Both match the backend's one-row PostgREST contract. Document summarization, Tutor, progress analysis, and mock-test generation use these RPCs. Aptitude still uses the legacy quota RPC.
- Both functions use invoker rights and an empty search path. The migration enables ledger RLS, removes public, anonymous and authenticated grants, and grants the service role the table access and RPC execution it needs. The backend derives the quota user from authenticated identity and obtains settlement IDs internally. Reservation replay checks the original user and requested count. Settlement trusts the service-role caller and uses the stored owner and UTC date to find the counter. Verify effective privileges and ownership against the deployed catalog.
- A transaction advisory lock serializes duplicate request IDs. The daily usage row lock serializes distinct requests for the same owner and day. Settlement locks usage before locking and re-reading the reservation. A repeated identical settlement refunds zero additional calls, while a changed charge is rejected. The routes generate new request UUIDs per invocation, so database replay protection does not deduplicate HTTP retries. A process exit between reserve and settle can leave a reservation outstanding.

### Offline verification

- `pglast` parsed all four SQL files, including all eight function bodies and both anonymous test bodies. Local PostgreSQL tooling was unavailable. Database execution, lock behavior, and effective privileges remain integration checks.
- Existing backend tests passed **9/9**. The four Ollama tests exercise mocked queue behavior. The five quota tests validate Python inputs and mocked RPC request and response shapes. The test command disables dotenv loading before application imports and bytecode writing for the run.

```powershell
$env:PYTHONPATH = 'backend'
& .\.venv\Scripts\python.exe -B -c "import dotenv, unittest; dotenv.load_dotenv = lambda *args, **kwargs: False; suite = unittest.defaultTestLoader.discover('tests'); result = unittest.TextTestRunner(verbosity=2).run(suite); raise SystemExit(not result.wasSuccessful())"
```
