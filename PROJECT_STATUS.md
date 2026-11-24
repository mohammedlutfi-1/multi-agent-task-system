# Project status

## Hybrid Ollama

Step 282A is implemented locally. The existing Collaboration workspace accepts Ollama alone and keeps the existing two-round workflow for multi-model selections. New individual tasks persist one checkpoint and a final answer with the actual provider and model. Platform recovery can reuse the saved answer when the task remains eligible and does not reserve a new collaboration request. Existing two-round records retain their original behavior.

Step 282E validation passed 40 backend tests and TypeScript. The Step 282A Turbopack build passed using offline font fixtures and placeholder public configuration. Deployment requires aligned Ollama feature flags, a working laptop bridge, and automatic platform recovery configuration. Local duplicate protection covers in-flight requests in one API process. The existing RPC has no durable submission idempotency key.

Updated 2026-11-24 after Step 282O release preparation. The owner confirmed Step 282N production two-account isolation passed without assertion errors and ended in rollback. The owner also confirmed production ACL remediation and Hybrid Ollama functional validation. The tested workflow requires no database migration. See the [release manifest and rollout order](docs/step-282o-release.md).

Final checks passed for all 46 backend tests, frontend TypeScript, and the isolated Next.js production build. The 24-file staging allowlist passed whitespace and credential-pattern checks. The index remains empty.

## Collaboration ACL rollout package

- [Pre-change ACL snapshot](docs/step-281h-collaboration-acl-snapshot.sql)
- [Commit-ready remediation](docs/step-281h-collaboration-remediation.sql)
- [Read-only post-commit verification](docs/step-281h-collaboration-post-commit.sql)

The rollout closed direct browser task creation at the privilege layer, including excessive browser privileges, while preserving the owner-scoped SELECT and DELETE policies. The package is retained as a record of the approved change.

## Release blockers

- **GitHub base verification.** The cached checkout does not contain the owner-reported production merge. Confirm the intended GitHub base before publishing the release.

Production database isolation and the local signed-JWT API tests passed. An ambiguous Student AI write can still leave a held reservation for the original UTC day. The frontend sends no request ID, so manual retries can start another charged operation.

## Production inspection results

- The owner confirmed that all 29 inspected tables exist with RLS enabled, and all 17 inspected RPCs exist with execution denied to `anon` and `authenticated` and granted to `service_role`. Existing Student AI objects should be preserved. The Step 279 migration is a compatibility reference.
- Student AI daily usage has the composite key required by the candidate's upsert. The ledger keys and quota constraints align structurally with the candidate. Reserve and settle signatures match, and both use invoker rights with an empty search path. Source-level behavior and exact column/default/constraint parity remain unverified.
- The owner confirmed an owner-and-chat foreign key for Tutor messages, `auth.uid()` policies for Student CRUD, and no direct browser access to the key vault table, reservation ledger, or Ollama queue. Cross-account behavior remains an integration check.
- No pg_cron catalog, queue cleanup trigger, or partition-based retention was found. Manual or external cleanup remains unverified.

## Release and architecture

- Repository is `mohammedlutfi-1/multi-agent-task-system`. Local work continues on `release/ai-tutor-security` at `5405155`. The project owner confirmed production PR #3 merged at `28aad66`. Cached local refs still show PR #2 as the latest merge on `origin/main`.
- Production endpoints are [Vercel frontend](https://multi-agent-task-system.vercel.app) and [Render backend](https://multi-agent-task-system.onrender.com).
- Next.js, React, TypeScript, and Tailwind provide the dashboard and two independent modes. FastAPI verifies Supabase bearer tokens, handles AI orchestration, and uses service-role access for backend persistence. Browser-side student CRUD depends on Supabase RLS. Supabase also stores uploaded files.
- AI Collaboration supports model selection, discussion and review rounds, synthesis, history, encrypted BYOK, quota enforcement, cloud fallback, and persisted paused tasks. Gemini, Groq, and OpenRouter provide cloud inference. The optional Ollama worker uses a leased Supabase queue with an 8-second claim threshold and 60-second total queue deadline. The project owner reported successful live Gemini and Ollama collaboration.
- Student Mode includes Academic Overview, Academic Assistant in Notes, AI Tutor with owner-scoped chats and messages, Study Planner and timetable, Assignments, Notes and Files, Mock Tests, Attendance and Marks, Projects, and Placement Preparation with aptitude practice. Login, registration and password recovery are implemented.

## Database baseline inventory

These objects are referenced by the application and lack definitions in the tracked baseline, apart from the reservation candidate and the existing tracked Ollama queue and shared provider budget migrations. The production inspection confirms their presence for the inspected scope. Recover authoritative definitions as needed for disposable validation or database changes.

| Area | Tables and policies to recover or verify |
| --- | --- |
| Browser-side Student Mode | `student_profiles`, `student_subjects`, `student_assignments`, `student_attendance`, `student_marks`, `student_exams`, `student_study_plans`, `student_timetable`, `student_projects`, `student_notes`, `student_documents`, `student_placements`. Verify owner-scoped grants and RLS by operation, plus file bucket and object-access policies. |
| Backend Student AI | `student_ai_daily_usage`, `student_ai_chats`, `student_ai_messages`, `student_mock_tests`, `student_mock_attempts`, `student_aptitude_tests`, `student_aptitude_attempts`. Verify service-role grants, ownership constraints, and browser access boundaries for answer keys and other backend data. |
| Backend collaboration | `collaboration_tasks`, `collaboration_turns`, `ai_daily_usage`, `user_api_keys`. Verify grants and RLS for owner data and BYOK records, and constraints for task leases and sequential turns. |

Missing RPC definitions in the local baseline:

- Collaboration quota and creation: `reserve_ai_request`, `create_collaboration_with_quota`.
- Collaboration execution and recovery: `claim_collaboration_task`, `renew_collaboration_lease`, `release_collaboration_task`, `save_collaboration_checkpoint`, `schedule_collaboration_retry`, `get_due_collaboration_tasks_with_owner`, `recover_expired_collaboration_tasks`.
- Student AI and progress: `reserve_student_ai_calls`, `apply_mock_test_progress`. The Step 279 candidate adds local definitions for `reserve_student_ai_request` and `settle_student_ai_request`.

Inventory the live objects' actual types, constraints, policies, function owners, signatures, grants, security modes, and configuration before any approved rollout. See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for the candidate's dependency and verification details.
