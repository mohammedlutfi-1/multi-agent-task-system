# Multi-Agent Task System

Preserve the existing final-year engineering project and keep AI Collaboration and Student Mode independent, with mode switching through the Main Dashboard. Start with [PROJECT_STATUS.md](PROJECT_STATUS.md), [TASKS.md](TASKS.md), and [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).

- The frontend is a Next.js App Router app in `frontend/`. FastAPI lives in `backend/app/`, and Supabase provides PostgreSQL, Auth, and Storage. Follow [frontend/AGENTS.md](frontend/AGENTS.md) for frontend work.
- Preserve authentication, RLS, ownership checks, and per-user and platform quota controls. Treat all existing untracked files as user work and preserve them.
- Keep the secure-project permission profile active. Never read, display, modify, or transmit actual environment files or credentials, access external credential backups, or bypass sandbox restrictions.
- Obtain explicit approval before pushing, merging, deploying, or executing production database migrations. Keep offline validation offline. Use mocked providers for local checks and avoid paid services or unapproved provider calls.
- Keep the application cloud-first. The optional Ollama laptop worker must retain cloud-provider fallback. Leave cloud-hosted Ollama, additional models, and the older paused collaboration deferred.
- Use `.venv\Scripts\python.exe` from the repository root. The backend database module loads dotenv at import time, so intercept that loader before importing app modules during secret-free tests. See the exact command in [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).
