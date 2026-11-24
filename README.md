# Multi-Agent Task System

A final-year engineering project with two independent workspaces. Sign in and use the Main Dashboard to open AI Collaboration or Student Mode. The project owner reports production release `e4391a1` (PR #5) deployed on [Vercel](https://multi-agent-task-system.vercel.app) and [Render](https://multi-agent-task-system.onrender.com). See [PROJECT_STATUS.md](PROJECT_STATUS.md) for verification and known limitations.

## Implemented features

| Workspace | Features |
| --- | --- |
| AI Collaboration | Model selection, multi-model discussion and review rounds, final synthesis, independent Ollama answers, actual provider attribution, owned task history, personal API keys, usage limits, and eligible paused-task recovery. |
| Student Mode | Academic Overview, subjects, study plans and timetable, assignments, notes and files, Academic Assistant, AI Tutor, exams and mock tests, attendance and marks, AI Student Progress Tracker, projects, placement tracking and aptitude practice, and student profile settings. |
| Account | Registration, sign-in, password recovery, and authenticated workspace navigation. |

## Architecture and production configuration

| Component | Implementation |
| --- | --- |
| Vercel | Next.js App Router, React, TypeScript, and Tailwind CSS, with `frontend/` as the app root. The frontend uses Supabase Auth and direct RLS-scoped access for student records. AI and backend document actions go through FastAPI. |
| Render | FastAPI in `backend/app/`. The [Render blueprint](render.yaml) installs requirements, starts Uvicorn, and checks `/health`. The API validates Supabase bearer tokens, orchestrates providers, and uses service-role access for controlled database operations. The [scheduled wake workflow](.github/workflows/wake-render.yml) pings Render, while the backend performs eligible automatic recovery. |
| Supabase | Auth, PostgreSQL, and document Storage. Task creation and quota accounting use database RPCs. Collaboration checkpoints, leases, history, and the optional Ollama queue use PostgreSQL. |
| Optional laptop worker | [Python bridge](worker/ollama_bridge_worker.py) claims queued jobs through outbound HTTPS, calls Ollama on laptop loopback, and returns results through a lease-bound completion endpoint. |

Set the deployed `NEXT_PUBLIC_API_URL` to the Render origin through the existing Vercel configuration. The client defaults to `http://localhost:8000` for local development, so a missing production setting breaks AI and backend document calls. Keep Render CORS and Supabase Auth redirect URLs aligned with the deployed frontend. Supabase service-role credentials, encryption keys, worker tokens, and platform provider keys belong in approved backend configuration. The frontend uses only its Supabase URL and publishable key.

## Provider routing and usage

- Student AI routes **Groq → Gemini → OpenRouter** for Tutor, Academic Assistant, Mock Tests, Aptitude, and Progress Tracker. Available providers depend on configuration and budgets. Tutor and Academic Assistant expose personal-key selection in the workspace. Mock Tests, Aptitude, and Progress Tracker use platform keys in their current screens.
- Collaboration defaults to Gemini and Groq in platform mode. Multi-model turns prefer the requested provider and use the approved fallback order. Ollama can run independently or participate in Collaboration when `ENABLE_LOCAL_OLLAMA` and `NEXT_PUBLIC_ENABLE_LOCAL_OLLAMA` are enabled. Independent Ollama attempts local inference first, then eligible **Gemini → Groq → OpenRouter** fallback. Personal-key flows use configured personal keys with charge consent.
- The queue has an **8-second unclaimed threshold** and a **60-second total wait**. Worker absence, retryable provider errors, transport errors, and capacity limits can trigger fallback. A non-retryable provider error can stop the chain. When capacity is exhausted, eligible platform tasks pause and can resume from saved checkpoints with `ENABLE_AUTO_RESUME`. Personal-key tasks do not automatically resume.
- **Collaboration has 10 requests per user per UTC day.** Creation charges one request, including solo Ollama under this release. Recovery does not create another charged task. **Student AI has a separate 30-call UTC allowance.** Tutor, Mock Tests, Aptitude and Progress reserve one logical call per operation. Academic Assistant reserves section summaries plus final synthesis. Platform-funded provider attempts also consume provider budgets. The checked-in defaults are 50 per day each for Gemini and Groq and 20 for OpenRouter.

Cloud inference, the student records workspace, and saved history operate without the laptop. Actual local Ollama inference is the only path that requires it.

## Optional Ollama worker

1. On the laptop, confirm Ollama is installed and the `qwen2.5:1.5b` model is available. If needed, use `ollama pull qwen2.5:1.5b` during setup. Start `ollama serve` in a separate terminal only if Ollama is not already running. Keep port 11434 on loopback.
2. In the approved worker shell, use the existing `OLLAMA_BRIDGE_BACKEND_URL` HTTPS origin and `OLLAMA_WORKER_SECRET` configuration. The worker reads its process configuration and does not load dotenv. Use the same worker secret configured on Render without displaying it.
3. From the repository root with the existing virtual environment, start the outbound worker:

```powershell
& .\.venv\Scripts\python.exe .\worker\ollama_bridge_worker.py
```

4. Press `Ctrl+C` in the worker terminal to stop claiming jobs. If you started Ollama for this session, stop that process separately with `Ctrl+C`. Pending requests can fall back to cloud capacity.

## Deployment, maintenance, and rollback

1. Use the approved revision and the [release and browser checklist](docs/step-284-final-release.md). Deploy the matching Render backend first. Verify `/health`, then authenticated history and usage. Deploy the Vercel frontend after backend checks. This release uses the existing Supabase schema.
2. For maintenance, review Render logs, provider budgets, paused task status, optional worker connectivity, and Supabase schema and ACL changes. Investigate quota or persistence ambiguity before retrying writes. Review and back up schema changes separately, and validate migrations in an isolated database.
3. To roll back, restore the previously approved Vercel build first, then the compatible Render revision. Verify health, Auth, and read-only owned history. Keep the existing database ACLs and RPCs in place for application rollback. A database rollback needs its own reviewed procedure and approval.

## Security and validation

FastAPI validates Supabase JWT signatures, issuer, audience, and expiry. RLS, owner-scoped reads and writes, and service-role-only RPCs enforce data access. Collaboration direct browser creation is denied, while owner history and deletion remain scoped. Personal provider keys are encrypted and the settings endpoint exposes metadata. The bridge uses a shared worker token and lease-bound job completion.

[PROJECT_STATUS.md](PROJECT_STATUS.md) records offline, production, and pending evidence. [TASKS.md](TASKS.md) is the closure checklist. [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) retains the chronological handover record.
