# Step 284 application release

The approved source baseline is production merge `d5eab3d`. This batch contains Step 283 application fixes and Step 284 release notes. It requires no database migration. The deferred Ollama quota and capacity package stays in local backups.

## Exact staging allowlist

```text
DEVELOPMENT_LOG.md
PROJECT_STATUS.md
TASKS.md
backend/app/main.py
docs/step-284-final-release.md
frontend/app/collaboration/api-settings/page.tsx
frontend/app/collaboration/page.tsx
frontend/app/layout.tsx
frontend/app/student/mock-tests/page.tsx
frontend/app/student/page.tsx
frontend/app/student/student-sidebar.tsx
tests/test_mock_test_progress.py
```

Leave the following six pre-existing files untracked:

```text
backend/test_openrouter.py
migrations/635B_35_58_student_ai_reservations.sql
migrations/635B_35_95_validation_rollback.sql
migrations/635B_35_97_quota_functional_test.sql
migrations/635B_35_98_isolated_quota_test.sql
step124-review.txt
```

Exclude backups, environment files, credentials, build outputs and the deferred database package. The status entry for `tests/test_hybrid_ollama.py` has no content diff against the baseline and is outside the allowlist.

## One manual browser pass

Use a designated test account and synthetic data in an approved authenticated environment. Use saved fixtures or provider stubs wherever generation would otherwise consume credits.

1. At desktop and mobile widths, sign in, verify recovery navigation, open both modes from Main Dashboard, and return to the dashboard. Check that sidebar controls work, content fits the viewport, and focus and loading indicators are visible.
2. In Collaboration, select Ollama alone and then a two-model combination. Check button labels, the API Settings models link, history detail and provider attribution. With a stub or saved fixture, check completed, paused and failed states, plus a temporary error.
3. In Student Mode, open Attendance & Marks, Mock Tests, Exam Preparation, Tutor, and Placement Aptitude from their normal links. Save and reread one synthetic record, check an approved document action, and verify that forms handle missing fields. Check a saved Tutor, mock-test or aptitude result. If mocked submit failure is available, verify a saved mock score stays visible when topic sync is unconfirmed.

## Git commands for the release owner

Run from the repository root after the browser pass and separate release approval. Use a fresh branch name if `release/final-application` is already in use. Do not stage the entire workspace.

```powershell
if (git diff --cached --name-only) { throw 'Index already has staged changes' }
git diff --quiet HEAD d5eab3d
if ($LASTEXITCODE -ne 0) { throw 'HEAD tree differs from the reviewed production baseline' }
git switch -c release/final-application d5eab3d
if ($LASTEXITCODE -ne 0) { throw 'Release branch creation failed' }

$releaseFiles = @(
  'DEVELOPMENT_LOG.md'
  'PROJECT_STATUS.md'
  'TASKS.md'
  'backend/app/main.py'
  'docs/step-284-final-release.md'
  'frontend/app/collaboration/api-settings/page.tsx'
  'frontend/app/collaboration/page.tsx'
  'frontend/app/layout.tsx'
  'frontend/app/student/mock-tests/page.tsx'
  'frontend/app/student/page.tsx'
  'frontend/app/student/student-sidebar.tsx'
  'tests/test_mock_test_progress.py'
)
git add -- @releaseFiles
if ($LASTEXITCODE -ne 0) { throw 'Staging failed' }
$staged = @(git diff --cached --name-only --diff-filter=ACDMRTUXB)
if ($staged.Count -ne $releaseFiles.Count -or (Compare-Object $releaseFiles $staged)) {
  throw 'Staged paths do not match the release allowlist'
}
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed' }
git diff --cached --stat
```

After reviewing the staged diff:

```powershell
git commit -m "fix: finalize collaboration and student application workflows"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed' }
git push -u origin release/final-application
```

Open the PR against the verified production branch. If the target advanced since `d5eab3d`, compare the updated base and rerun relevant checks before merging. Deploy the approved backend first, verify health and authenticated reads, then deploy the matching frontend. No database script belongs in this rollout.
