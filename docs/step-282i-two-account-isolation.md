# Two-account isolation, corrected in Step 282K

Use two distinct, designated test accounts A and B. Use unique synthetic task, chat, and message text. Keep the accounts quiet for the duration of the test. Record pass/fail, response status, and numerical quota deltas. Keep tokens, key values, and raw response dumps out of the evidence.

## 1. Database isolation in a rollback transaction

1. Open [the rollback-only database script](step-282i-two-account-isolation-rollback.sql) in an approved SQL Editor session. Fill in the two account UUIDs. Review the three read-scope constants against the intended access contract. Use `owner` when browser-role owner reads are required. Select `backend_only` only when FastAPI is the intended read path and document the reason before running. A failed owner control is a test failure. Run the entire script in one session and confirm the final rollback.
2. Look for all three PASS notices. The script tests database enforcement using synthetic claim context. It requires A to read and delete its own task, B to have no cross-account task or response visibility or deletion, and direct collaboration INSERT and UPDATE to be denied. B attempts to create a task as B, so an owner policy alone cannot make this probe pass.
3. Confirm the Tutor and quota notices. Each table in owner mode requires A and B to see their own synthetic chat or message and neither to see the other's. Backend-only mode requires that authenticated SELECT access is absent and relies on the API owner-positive tests. B cannot delete A's chat or attach a message to it. A's provisional Collaboration and Student AI debits leave B's counters unchanged. The key probe projects the constant `1` with `WHERE false`, which reads no key rows or columns. All fixtures and provisional debits roll back. Issue `ROLLBACK` in the same session if execution stops early.

SQL Editor claim settings simulate the database role. The API stage separately tests HTTP authentication. Uncommitted SQL fixtures are invisible to independent API sessions.

## 2. Authenticated API isolation with existing local tooling

Run the new [local API tests](../tests/test_authenticated_isolation.py) from the repository root. They use the existing FastAPI app, virtual environment, and HTTPX ASGI test harness. The production bearer validator verifies two locally signed ES256 JWTs and rejects an invalid signature. JWKS lookup and PostgREST are simulated in memory. Application routes and database query helpers run unchanged, and the PostgREST stub applies the filters supplied by those helpers. Providers are mocked and any unexpected inference fails the test. The test key material exists only in memory.

```powershell
$env:PYTHONPATH = 'backend'
& .\.venv\Scripts\python.exe -B -c "import dotenv, unittest; dotenv.load_dotenv=lambda *a, **k: False; r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('tests', pattern='test_authenticated_isolation.py')); raise SystemExit(not r.wasSuccessful())"
```

This local run verifies JWT validation and application ownership. The rollback script verifies actual database policies and privileges. Deployed Supabase token issuance and the hosted API are outside the offline results.

| Check | Action and expected result |
| --- | --- |
| Identity controls | Two signed test identities are accepted. A missing bearer token and an invalid signature return 401 before database access. |
| Collaboration history and responses | The in-memory fixtures give A and B distinct completed tasks. Each sees its own task and response in history and detail. Each gets 404 for the other's task ID. Existing mocked route regressions cover successful creation and the one-request debit. |
| Collaboration writes | FastAPI history exposes no PATCH or DELETE methods. Require 405 or the deployment's 404 for those methods and confirm the target is unchanged. Use the rollback SQL to test database enforcement of direct update, deletion, and quota-bypassing creation. |
| Tutor chats and messages | Both owners must see their own synthetic chat and message. The other account gets 404 for detail, delete, and consented message submission. No provider or quota RPC runs on those rejected writes. A separate positive test confirms an owner can delete their own chat without deleting the other account's chat. |
| User-specific quotas | Distinct synthetic counters must appear only in the matching account's `GET /ai/usage` and `GET /student/ai/usage`. The rollback SQL checks the deployed quota mutations separately. |
| Personal key metadata | Only metadata fixtures exist. Each caller sees its own provider entry, and the database projection is limited to `provider`, `is_active`, `created_at`, and `updated_at`. A cross-account deletion attempt leaves the owner's fixture intact. |

Record database notices and observed quota deltas, and keep the local test summary with the release evidence. If any response unexpectedly contains key material, report only the endpoint and unexpected field names.
