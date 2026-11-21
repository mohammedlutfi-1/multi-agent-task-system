
import os
from pathlib import Path
from xmlrpc import client

import httpx
from dotenv import load_dotenv


# Load the backend environment file.
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_PATH)


def get_supabase_config():
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not url or not key:
        raise RuntimeError(
            "Supabase backend configuration is missing"
        )

    if not url.startswith("https://"):
        raise RuntimeError(
            "Supabase URL must use HTTPS"
        )

    return url, key


def create_supabase_client():
    url, key = get_supabase_config()

    return httpx.AsyncClient(
        base_url=f"{url}/rest/v1/",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        timeout=20.0,
    )


async def create_collaboration_task(
    user_id: str,
    task: str,
    selected_models: list[str],
    max_rounds: int = 2,
    credential_mode: str = "unknown",
) -> dict:
    """Create a new collaboration task in Supabase."""

    if not user_id or not task.strip():
        raise ValueError("User ID and task are required")

    if not 1 <= max_rounds <= 3:
        raise ValueError("max_rounds must be between 1 and 3")

    if not 1 <= len(selected_models) <= 4:
        raise ValueError("Select between 1 and 4 models")

    if credential_mode not in ("unknown", "platform", "personal"):
        raise ValueError("Invalid credential mode")

    payload = {
        "user_id": user_id,
        "task": task,
        "status": "pending",
        "selected_models": selected_models,
        "max_rounds": max_rounds,
        "current_turn": 0,
        "credential_mode": credential_mode,
        "auto_resume_enabled": credential_mode == "platform",
        "retry_count": 0,
        "next_retry_at": None,
    }

    async with create_supabase_client() as client:
        response = await client.post(
            "collaboration_tasks",
            json=payload,
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()

        records = response.json()

        if not records:
            raise RuntimeError(
                "Supabase did not return the created task"
            )

        return records[0]


async def get_user_collaboration_tasks(
    user_id: str,
    limit: int = 20,
) -> list[dict]:
    """Retrieve saved collaboration tasks for a user."""

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    if not 1 <= limit <= 100:
        raise ValueError("Limit must be between 1 and 100")

    async with create_supabase_client() as client:
        response = await client.get(
        "collaboration_tasks",
        params={
            "select": (
                "id,task,status,selected_models,"
                "max_rounds,current_turn,final_answer,"
                "created_at,updated_at,completed_at,"
                "credential_mode,auto_resume_enabled,"
                "retry_count,next_retry_at"
            ),
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
        },
    )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError(
                "Unexpected Supabase response format"
            )

        return records


async def get_collaboration_turns(
    task_id: str,
) -> list[dict]:
    """Retrieve saved AI turns for a collaboration task."""

    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("Task ID is required")

    async with create_supabase_client() as client:
        response = await client.get(
            "collaboration_turns",
            params={
                "select": (
                    "id,task_id,turn_number,round_number,"
                    "requested_provider,actual_provider,"
                    "model_id,response,created_at"
                ),
                "task_id": f"eq.{task_id}",
                "order": "turn_number.asc",
            },
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError(
                "Unexpected Supabase response format"
            )

        return records


async def save_collaboration_turn(
    task_id: str,
    turn_number: int,
    round_number: int,
    requested_provider: str,
    actual_provider: str,
    model_id: str,
    response: str,
) -> dict:
    """Save one completed AI collaboration turn."""

    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("Task ID is required")

    if turn_number < 1:
        raise ValueError("Turn number must be positive")

    if round_number < 1:
        raise ValueError("Round number must be positive")

    if not requested_provider or not actual_provider:
        raise ValueError("Provider names are required")

    if not model_id or not response.strip():
        raise ValueError("Model ID and response are required")

    payload = {
        "task_id": task_id,
        "turn_number": turn_number,
        "round_number": round_number,
        "requested_provider": requested_provider,
        "actual_provider": actual_provider,
        "model_id": model_id,
        "response": response,
    }

    async with create_supabase_client() as client:
        result = await client.post(
            "collaboration_turns",
            json=payload,
            headers={
                "Prefer": "return=representation",
            },
        )

        result.raise_for_status()

        records = result.json()

        if not isinstance(records, list) or not records:
            raise RuntimeError(
                "Supabase did not return the saved turn"
            )

        return records[0]


async def update_collaboration_task(
    task_id: str,
    status: str,
    current_turn: int,
    final_answer: str | None = None,
    error_message: str | None = None,
) -> dict:
    """Update a collaboration task's execution progress."""

    allowed_statuses = {
        "pending",
        "running",
        "paused",
        "completed",
        "failed",
    }

    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("Task ID is required")

    if status not in allowed_statuses:
        raise ValueError("Invalid task status")

    if not isinstance(current_turn, int) or current_turn < 0:
        raise ValueError("Current turn must be non-negative")

    payload = {
        "status": status,
        "current_turn": current_turn,
        "updated_at": (
            __import__("datetime")
            .datetime.now(
                __import__("datetime").timezone.utc
            )
            .isoformat()
        ),
    }

    if final_answer is not None:
        payload["final_answer"] = final_answer

    if error_message is not None:
        payload["error_message"] = error_message

    if status == "completed":
        from datetime import datetime, timezone
        payload["completed_at"] = (
            datetime.now(timezone.utc).isoformat()
        )

    async with create_supabase_client() as client:
        response = await client.patch(
            "collaboration_tasks",
            params={"id": f"eq.{task_id}"},
            json=payload,
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list) or not records:
            raise RuntimeError(
                "Task not found or update was unsuccessful"
            )

        return records[0]


async def save_collaboration_checkpoint(
    task_id: str,
    worker_id: str,
    turn_number: int,
    round_number: int,
    requested_provider: str,
    actual_provider: str,
    model_id: str,
    response: str,
) -> None:
    """
    Atomically save one collaboration turn.

    PostgreSQL verifies:
    - The task is running.
    - The worker owns an active lease.
    - The turn number is sequential.
    - The checkpoint data is valid.
    """

    payload = {
        "p_task_id": task_id,
        "p_worker_id": worker_id,
        "p_turn_number": turn_number,
        "p_round_number": round_number,
        "p_requested_provider": requested_provider,
        "p_actual_provider": actual_provider,
        "p_model_id": model_id,
        "p_response": response,
    }

    async with create_supabase_client() as client:
        result = await client.post(
            "rpc/save_collaboration_checkpoint",
            json=payload,
        )
        result.raise_for_status()


async def claim_collaboration_task(
    task_id: str,
    worker_id: str,
    lease_seconds: int = 120,
) -> bool:
    """
    Atomically claim a collaboration task.

    Returns:
        True: This worker successfully claimed the task.
        False: The task is not currently claimable.
    """

    if not 30 <= lease_seconds <= 600:
        raise ValueError(
            "Lease duration must be between 30 and 600 seconds"
        )

    payload = {
        "p_task_id": task_id,
        "p_worker_id": worker_id,
        "p_lease_seconds": lease_seconds,
    }

    async with create_supabase_client() as client:
        result = await client.post(
            "rpc/claim_collaboration_task",
            json=payload,
        )
        result.raise_for_status()

        claimed = result.json()

        if not isinstance(claimed, bool):
            raise ValueError(
                "Unexpected response from task-claiming RPC"
            )

        return claimed


async def renew_collaboration_lease(
    task_id: str,
    worker_id: str,
    lease_seconds: int = 120,
) -> bool:
    """
    Renew an active collaboration worker lease.

    Returns:
        True: The worker's lease was renewed.
        False: The worker no longer owns an active lease.
    """

    if not 30 <= lease_seconds <= 600:
        raise ValueError(
            "Lease duration must be between 30 and 600 seconds"
        )

    payload = {
        "p_task_id": task_id,
        "p_worker_id": worker_id,
        "p_lease_seconds": lease_seconds,
    }

    async with create_supabase_client() as client:
        result = await client.post(
            "rpc/renew_collaboration_lease",
            json=payload,
        )
        result.raise_for_status()

        renewed = result.json()

        if not isinstance(renewed, bool):
            raise ValueError(
                "Unexpected response from lease-renewal RPC"
            )

        return renewed


async def release_collaboration_task(
    task_id: str,
    worker_id: str,
    new_status: str,
    final_answer: str | None = None,
    error_message: str | None = None,
) -> bool:
    """
    Release a collaboration task owned by this worker.

    Returns:
        True: The task was successfully released.
        False: The worker does not own an active lease.
    """

    allowed_statuses = {"paused", "completed", "failed"}

    if new_status not in allowed_statuses:
        raise ValueError(
            "Task status must be paused, completed, or failed"
        )

    if new_status == "completed":
        if not isinstance(final_answer, str) or not final_answer.strip():
            raise ValueError(
                "Completed task requires a final answer"
            )

    payload = {
        "p_task_id": task_id,
        "p_worker_id": worker_id,
        "p_new_status": new_status,
        "p_final_answer": final_answer,
        "p_error_message": error_message,
    }

    async with create_supabase_client() as client:
        result = await client.post(
            "rpc/release_collaboration_task",
            json=payload,
        )
        result.raise_for_status()

        released = result.json()

        if not isinstance(released, bool):
            raise ValueError(
                "Unexpected response from task-release RPC"
            )

        return released

async def reserve_user_ai_request(
    user_id: str,
    daily_limit: int = 10,
) -> dict:
    """Atomically reserve one daily AI request in Supabase."""

    async with create_supabase_client() as client:
        response = await client.post(
            "rpc/reserve_ai_request",
            json={
                "p_user_id": user_id,
                "p_daily_limit": daily_limit,
            },
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError("Invalid quota response from Supabase")

        return records[0]


async def get_user_collaboration_task(
    user_id: str,
    task_id: str,
) -> dict | None:
    """Retrieve a collaboration task owned by the user."""

    async with create_supabase_client() as client:
        response = await client.get(
        "collaboration_tasks",
        params={
            "select": (
                "id,task,status,selected_models,"
                "max_rounds,current_turn,final_answer,"
                "created_at,updated_at,completed_at,"
                "credential_mode,auto_resume_enabled,"
                "retry_count,next_retry_at"
            ),
            "id": f"eq.{task_id}",
            "user_id": f"eq.{user_id}",
            "limit": "1",
        },
    )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError(
                "Unexpected Supabase response format"
            )

        return records[0] if records else None


async def get_user_ai_usage(
    user_id: str,
    daily_limit: int = 10,
) -> dict:
    from datetime import datetime, timezone

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    today = datetime.now(timezone.utc).date().isoformat()

    async with create_supabase_client() as client:
        response = await client.get(
            "ai_daily_usage",
            params={
                "select": "requests_used",
                "user_id": f"eq.{user_id}",
                "usage_date": f"eq.{today}",
                "limit": "1",
            },
        )

        response.raise_for_status()
        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError("Invalid usage response")

        requests_used = (
            int(records[0]["requests_used"])
            if records else 0
        )

        return {
            "daily_limit": daily_limit,
            "requests_used": requests_used,
            "requests_remaining": max(
                0, daily_limit - requests_used
            ),
            "usage_date": today,
            "reset_timezone": "UTC",
        }


async def save_user_api_key(
    user_id: str,
    provider: str,
    api_key: str,
) -> dict:
    from datetime import datetime, timezone
    from app.key_encryption import encrypt_api_key

    provider = provider.strip().lower()

    if provider not in ("gemini", "groq", "openrouter"):
        raise ValueError("Unsupported AI provider")

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    encrypted_key = encrypt_api_key(api_key)

    payload = {
        "user_id": user_id,
        "provider": provider,
        "encrypted_key": encrypted_key,
        "is_active": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    async with create_supabase_client() as client:
        response = await client.post(
            "user_api_keys",
            params={
                "on_conflict": "user_id,provider",
            },
            json=payload,
            headers={
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )

        response.raise_for_status()

    return {
        "provider": provider,
        "is_active": True,
        "saved": True,
    }


async def get_user_api_keys(user_id: str) -> list:
    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    async with create_supabase_client() as client:
        response = await client.get(
            "user_api_keys",
            params={
                "select": (
                    "provider,is_active,"
                    "created_at,updated_at"
                ),
                "user_id": f"eq.{user_id}",
                "order": "provider.asc",
            },
        )

        response.raise_for_status()
        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError("Invalid API keys response")

        return records


async def delete_user_api_key(
    user_id: str,
    provider: str,
) -> dict:
    provider = provider.strip().lower()

    if provider not in ("gemini", "groq", "openrouter"):
        raise ValueError("Unsupported AI provider")

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    async with create_supabase_client() as client:
        response = await client.delete(
            "user_api_keys",
            params={
                "user_id": f"eq.{user_id}",
                "provider": f"eq.{provider}",
            },
            headers={
                "Prefer": "return=minimal",
            },
        )

        response.raise_for_status()

    return {
        "provider": provider,
        "is_active": False,
        "removed": True,
    }


async def get_user_provider_key(
    user_id: str,
    provider: str,
) -> str | None:
    from app.key_encryption import decrypt_api_key

    provider = provider.strip().lower()

    if provider not in ("gemini", "groq", "openrouter"):
        raise ValueError("Unsupported AI provider")

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required")

    async with create_supabase_client() as client:
        response = await client.get(
            "user_api_keys",
            params={
                "select": "encrypted_key",
                "user_id": f"eq.{user_id}",
                "provider": f"eq.{provider}",
                "is_active": "eq.true",
                "limit": "1",
            },
        )

        response.raise_for_status()
        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError("Invalid API key response")

        if not records:
            return None

        return decrypt_api_key(
            records[0]["encrypted_key"]
        )

async def schedule_collaboration_retry(
    task_id: str,
    worker_id: str,
) -> bool:
    """Schedule a retry for an eligible platform collaboration."""

    async with create_supabase_client() as client:
        response = await client.post(
            "rpc/schedule_collaboration_retry",
            json={
                "p_task_id": task_id,
                "p_worker_id": worker_id,
            },
        )

        response.raise_for_status()

        scheduled = response.json()

        if not isinstance(scheduled, bool):
            raise RuntimeError(
                "Invalid retry scheduling response"
            )

        return scheduled

async def get_due_collaboration_tasks() -> list[dict]:
    """Retrieve platform collaborations ready for retry."""

    async with create_supabase_client() as client:
        response = await client.post(
            "rpc/get_due_collaboration_tasks",
            json={},
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError(
                "Invalid due collaboration tasks response"
            )

        return records

async def recover_expired_collaboration_tasks() -> int:
    """Recover collaboration tasks with expired worker leases."""

    async with create_supabase_client() as client:
        response = await client.post(
            "rpc/recover_expired_collaboration_tasks",
            json={},
        )

        response.raise_for_status()

        recovered = response.json()

        if type(recovered) is not int or recovered < 0:
            raise RuntimeError(
                "Invalid task recovery response"
            )

        return recovered


async def reserve_student_ai_calls(
    user_id: str,
    requested_calls: int,
) -> dict:
    """Atomically reserve daily Student AI calls."""

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required.")

    if requested_calls <= 0 or requested_calls > 30:
        raise ValueError("Invalid requested AI call count.")

    async with create_supabase_client() as client:
        response = await client.post(
            "rpc/reserve_student_ai_calls",
            json={
                "p_user_id": user_id,
                "p_requested_calls": requested_calls,
            },
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError(
                "Invalid Student AI quota response."
            )

        return records[0]

async def get_student_ai_usage(
    user_id: str,
) -> dict:
    """Retrieve the user's current daily Student AI usage."""

    from datetime import datetime, timezone

    if not user_id or not user_id.strip():
        raise ValueError("User ID is required.")

    daily_limit = 30
    today = datetime.now(timezone.utc).date().isoformat()

    async with create_supabase_client() as client:
        response = await client.get(
            "student_ai_daily_usage",
            params={
                "select": "calls_used",
                "user_id": f"eq.{user_id}",
                "usage_date": f"eq.{today}",
                "limit": "1",
            },
        )

        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list):
            raise RuntimeError(
                "Invalid Student AI usage response."
            )

        calls_used = (
            int(records[0]["calls_used"])
            if records else 0
        )

        return {
            "daily_limit": daily_limit,
            "calls_used": calls_used,
            "calls_remaining": max(
                0, daily_limit - calls_used
            ),
            "usage_date": today,
        }



# ============================================================
# STUDENT AI TUTOR DATABASE FUNCTIONS
# ============================================================


async def create_student_ai_chat(
    user_id: str,
    title: str = "New conversation",
    subject_id: str | None = None,
) -> dict:
    """Create a new student AI conversation."""

    if not user_id:
        raise ValueError("User ID is required.")

    payload = {
        "user_id": user_id,
        "title": title.strip()[:250] or "New conversation",
        "subject_id": subject_id,
    }

    async with create_supabase_client() as client:
        response = await client.post(
            "student_ai_chats",
            json=payload,
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()
        records = response.json()

        if not records:
            raise RuntimeError("Unable to create AI conversation.")

        return records[0]


async def get_student_ai_chats(
    user_id: str,
    limit: int = 50,
) -> list[dict]:
    """Retrieve conversations belonging to the current user."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_ai_chats",
            params={
                "user_id": f"eq.{user_id}",
                "select": "*",
                "order": "updated_at.desc,id.desc",
                "limit": min(max(limit, 1), 100),
            },
        )

        response.raise_for_status()
        return response.json()


async def get_student_ai_chat(
    user_id: str,
    chat_id: str,
) -> dict | None:
    """Retrieve an owned conversation."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_ai_chats",
            params={
                "id": f"eq.{chat_id}",
                "user_id": f"eq.{user_id}",
                "select": "*",
                "limit": 1,
            },
        )

        response.raise_for_status()
        records = response.json()

        return records[0] if records else None


async def get_student_ai_messages(
    user_id: str,
    chat_id: str,
    limit: int = 100,
) -> list[dict]:
    """Retrieve recent messages in chronological order."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_ai_messages",
            params={
                "user_id": f"eq.{user_id}",
                "chat_id": f"eq.{chat_id}",
                "select": "*",
                "order": "created_at.desc,id.desc",
                "limit": min(max(limit, 1), 200),
            },
        )

        response.raise_for_status()
        records = response.json()

        return list(reversed(records))


async def save_student_ai_exchange(
    user_id: str,
    chat_id: str,
    question: str,
    answer: str,
    provider: str | None = None,
    model_id: str | None = None,
) -> list[dict]:
    """Save the user question and AI answer in one insert."""

    from datetime import datetime, timezone, timedelta

    question = question.strip()
    answer = answer.strip()

    if not question or not answer:
        raise ValueError("Question and answer are required.")

    now = datetime.now(timezone.utc)

    payload = [
        {
            "user_id": user_id,
            "chat_id": chat_id,
            "role": "user",
            "content": question,
            "provider": None,
            "model_id": None,
            "created_at": now.isoformat(),
        },
        {
            "user_id": user_id,
            "chat_id": chat_id,
            "role": "assistant",
            "content": answer,
            "provider": provider,
            "model_id": model_id,
            "created_at": (
                now + timedelta(microseconds=1)
            ).isoformat(),
        },
    ]

    async with create_supabase_client() as client:
        response = await client.post(
            "student_ai_messages",
            json=payload,
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()
        records = response.json()

        if len(records) != 2:
            raise RuntimeError("Unable to verify saved exchange.")

        return records


async def update_student_ai_chat(
    user_id: str,
    chat_id: str,
    title: str | None = None,
) -> dict | None:
    """Update an owned conversation."""

    from datetime import datetime, timezone

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if title is not None:
        payload["title"] = (
            title.strip()[:250] or "New conversation"
        )

    async with create_supabase_client() as client:
        response = await client.patch(
            "student_ai_chats",
            params={
                "id": f"eq.{chat_id}",
                "user_id": f"eq.{user_id}",
            },
            json=payload,
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()
        records = response.json()

        return records[0] if records else None


async def delete_student_ai_chat(
    user_id: str,
    chat_id: str,
) -> bool:
    """Delete an owned conversation and its messages."""

    async with create_supabase_client() as client:
        response = await client.delete(
            "student_ai_chats",
            params={
                "id": f"eq.{chat_id}",
                "user_id": f"eq.{user_id}",
            },
            headers={"Prefer": "return=representation"},
        )

        response.raise_for_status()
        return bool(response.json())


# -------------------------------------------------
# Student AI Mock Tests
# All operations require an authenticated user_id.
# Service-role access must never be exposed to clients.
# -------------------------------------------------

async def create_student_mock_test(
    user_id: str,
    exam_id: str,
    subject_id: str | None,
    topic: str,
    questions: list[dict],
) -> dict:
    """Save a generated mock test with server-only answer keys."""

    if not user_id or not exam_id or not topic.strip():
        raise ValueError("Invalid mock-test details.")

    if not questions:
        raise ValueError("Mock test requires questions.")

    async with create_supabase_client() as client:
        exam_response = await client.get(
            "student_exams",
            params={
                "id": f"eq.{exam_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,subject_id,syllabus",
                "limit": 1,
            },
        )
        exam_response.raise_for_status()
        exams = exam_response.json()

        if len(exams) != 1:
            raise ValueError("Examination not found.")

        exam = exams[0]

        if subject_id != exam.get("subject_id"):
            raise ValueError("Subject does not match examination.")

        topics = [
            value.strip()
            for value in (exam.get("syllabus") or "").splitlines()
            if value.strip()
        ]

        if topic.strip() not in topics:
            raise ValueError("Topic is not in the examination syllabus.")

        response = await client.post(
            "student_mock_tests",
            json={
                "user_id": user_id,
                "exam_id": exam_id,
                "subject_id": subject_id,
                "topic": topic.strip(),
                "questions": questions,
            },
            headers={"Prefer": "return=representation"},
        )
        response.raise_for_status()
        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError("Unable to save mock test.")

        return records[0]


async def get_student_mock_test(
    user_id: str,
    test_id: str,
) -> dict | None:
    """Fetch a mock test only when owned by the current user."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_mock_tests",
            params={
                "id": f"eq.{test_id}",
                "user_id": f"eq.{user_id}",
                "select": "*",
                "limit": 1,
            },
        )
        response.raise_for_status()
        records = response.json()

        return records[0] if records else None


async def save_student_mock_attempt(
    user_id: str,
    test_id: str,
    submitted_answers: dict,
    correct_count: int,
    total_questions: int,
    score_percentage: float,
    passed: bool,
) -> dict:
    """Save a server-graded mock-test attempt."""

    if (
        not user_id
        or not test_id
        or total_questions <= 0
        or correct_count < 0
        or correct_count > total_questions
        or not 0 <= score_percentage <= 100
    ):
        raise ValueError("Invalid mock-test attempt.")

    async with create_supabase_client() as client:
        # Check ownership again before inserting the attempt.
        test_response = await client.get(
            "student_mock_tests",
            params={
                "id": f"eq.{test_id}",
                "user_id": f"eq.{user_id}",
                "select": "id",
                "limit": 1,
            },
        )
        test_response.raise_for_status()

        if len(test_response.json()) != 1:
            raise ValueError("Mock test not found.")

        response = await client.post(
            "student_mock_attempts",
            json={
                "user_id": user_id,
                "test_id": test_id,
                "submitted_answers": submitted_answers,
                "correct_count": correct_count,
                "total_questions": total_questions,
                "score_percentage": score_percentage,
                "passed": passed,
            },
            headers={"Prefer": "return=representation"},
        )
        response.raise_for_status()
        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError("Unable to save mock-test attempt.")

        return records[0]

async def get_student_mock_exam(
    user_id: str,
    exam_id: str,
) -> dict | None:
    """Retrieve an owned examination before AI generation."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_exams",
            params={
                "id": f"eq.{exam_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,subject_id,title,syllabus",
                "limit": 1,
            },
        )

        response.raise_for_status()
        records = response.json()

        return records[0] if records else None


# === Step 635B.5: Aptitude database helpers ===

async def create_student_aptitude_test(
    user_id: str,
    category: str,
    topic: str,
    difficulty: str,
    duration_seconds: int,
    questions: list[dict],
) -> dict:
    """Store aptitude questions and server-only answer keys."""

    if not user_id or not questions:
        raise ValueError("Invalid aptitude test.")

    from app.student_aptitude import (
        validate_aptitude_request,
    )

    validate_aptitude_request(
        category, topic, difficulty, len(questions)
    )

    async with create_supabase_client() as client:
        response = await client.post(
            "student_aptitude_tests",
            json={
                "user_id": user_id,
                "category": category,
                "topic": topic,
                "difficulty": difficulty,
                "duration_seconds": duration_seconds,
                "questions": questions,
            },
            headers={"Prefer": "return=representation"},
        )
        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError("Unable to save aptitude test.")

        return records[0]


async def get_student_aptitude_test(
    user_id: str,
    test_id: str,
) -> dict | None:
    """Retrieve a test only if owned by the authenticated user."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_aptitude_tests",
            params={
                "id": f"eq.{test_id}",
                "user_id": f"eq.{user_id}",
                "select": "*",
                "limit": 1,
            },
        )
        response.raise_for_status()

        records = response.json()
        return records[0] if records else None


async def save_student_aptitude_attempt(
    user_id: str,
    test_id: str,
    submitted_answers: dict,
    correct_count: int,
    total_questions: int,
    score_percentage: float,
    time_taken_seconds: int,
) -> dict:
    """Persist a backend-graded aptitude attempt."""

    if (
        not user_id
        or not test_id
        or total_questions <= 0
        or not 0 <= correct_count <= total_questions
        or not 0 <= score_percentage <= 100
        or time_taken_seconds < 0
    ):
        raise ValueError("Invalid aptitude attempt.")

    async with create_supabase_client() as client:
        response = await client.post(
            "student_aptitude_attempts",
            json={
                "user_id": user_id,
                "test_id": test_id,
                "submitted_answers": submitted_answers,
                "correct_count": correct_count,
                "total_questions": total_questions,
                "score_percentage": score_percentage,
                "time_taken_seconds": time_taken_seconds,
            },
            headers={"Prefer": "return=representation"},
        )
        response.raise_for_status()

        records = response.json()

        if not isinstance(records, list) or len(records) != 1:
            raise RuntimeError("Unable to save aptitude attempt.")

        return records[0]


async def get_student_aptitude_history(
    user_id: str,
    limit: int = 20,
) -> list[dict]:
    """Return recent attempts for the authenticated student."""

    limit = max(1, min(limit, 50))

    async with create_supabase_client() as client:
        response = await client.get(
            "student_aptitude_attempts",
            params={
                "user_id": f"eq.{user_id}",
                "select": (
                    "id,test_id,correct_count,total_questions,"
                    "score_percentage,time_taken_seconds,created_at,"
                    "student_aptitude_tests(category,topic,difficulty)"
                ),
                "order": "created_at.desc",
                "limit": limit,
            },
        )
        response.raise_for_status()
        return response.json()

# === End Step 635B.5 ===
