"""Authenticated placement aptitude test endpoints."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import (
    create_supabase_client,
    reserve_student_ai_calls,
    get_user_provider_key,
)
from app.student_aptitude import (
    APTITUDE_TOPICS,
    DIFFICULTIES,
    QUESTION_COUNTS,
    MockTestError,
    generate_aptitude_questions,
    grade_mock_test,
    public_questions,
    validate_aptitude_request,
)


class AptitudeGenerateRequest(BaseModel):
    category: str
    topic: str
    difficulty: str = "medium"
    question_count: int = 5
    accept_ai_processing: bool = False
    use_personal_keys: bool = False
    accept_provider_charges: bool = False


class AptitudeSubmitRequest(BaseModel):
    submitted_answers: dict[str, str] = Field(default_factory=dict)


def make_aptitude_router(verify_user, call_ai_with_fallback):
    router = APIRouter(prefix="/student/aptitude")

    async def load_test(user_id, test_id):
        async with create_supabase_client() as db:
            response = await db.get(
                "student_aptitude_tests",
                params={
                    "id": f"eq.{test_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "*",
                    "limit": 1,
                },
            )
            response.raise_for_status()
            rows = response.json()
            return rows[0] if rows else None

    @router.get("/topics")
    async def aptitude_topics(user: dict = Depends(verify_user)):
        return {
            "categories": APTITUDE_TOPICS,
            "difficulties": DIFFICULTIES,
            "question_counts": QUESTION_COUNTS,
        }

    @router.get("/history")
    async def aptitude_history(user: dict = Depends(verify_user)):
        user_id = str(UUID(user["sub"]))

        async with create_supabase_client() as db:
            response = await db.get(
                "student_aptitude_attempts",
                params={
                    "user_id": f"eq.{user_id}",
                    "select": (
                        "id,test_id,correct_count,total_questions,"
                        "score_percentage,time_taken_seconds,created_at,"
                        "student_aptitude_tests(category,topic,difficulty)"
                    ),
                    "order": "created_at.desc",
                    "limit": 30,
                },
            )
            response.raise_for_status()
            return {"attempts": response.json()}

    @router.post("/generate")
    async def generate_aptitude(
        request: AptitudeGenerateRequest,
        user: dict = Depends(verify_user),
    ):
        import os

        user_id = str(UUID(user["sub"]))

        try:
            validate_aptitude_request(
                request.category,
                request.topic,
                request.difficulty,
                request.question_count,
            )
        except MockTestError as exc:
            raise HTTPException(422, str(exc)) from exc

        if not request.accept_ai_processing:
            raise HTTPException(
                422, "AI processing consent is required."
            )

        if (
            request.use_personal_keys
            and not request.accept_provider_charges
        ):
            raise HTTPException(
                422, "Personal API key charge consent is required."
            )

        personal_keys = {}

        if request.use_personal_keys:
            for provider in ("groq", "gemini", "openrouter"):
                key = await get_user_provider_key(user_id, provider)
                if key:
                    personal_keys[provider] = key

            if not personal_keys:
                raise HTTPException(
                    422, "No personal AI provider keys configured."
                )
        elif not any(
            os.getenv(key, "").strip()
            for key in (
                "GROQ_API_KEY",
                "GEMINI_API_KEY",
                "OPENROUTER_API_KEY",
            )
        ):
            raise HTTPException(
                503, "No AI provider is configured."
            )

        quota = await reserve_student_ai_calls(user_id, 1)

        if not quota.get("allowed"):
            raise HTTPException(
                429, "Daily student AI quota reached."
            )

        stage = 'AI_GENERATION'
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:

                async def ai_caller(messages, max_tokens):
                    return await call_ai_with_fallback(
                        client=client,
                        messages=messages,
                        max_tokens=max_tokens,
                        provider_order=(
                            "groq", "gemini", "openrouter"
                        ),
                        personal_keys=(
                            personal_keys
                            if request.use_personal_keys
                            else None
                        ),
                    )

                generated = await generate_aptitude_questions(
                    category=request.category,
                    topic=request.topic,
                    difficulty=request.difficulty,
                    question_count=request.question_count,
                    ai_caller=ai_caller,
                )

            now = datetime.now(timezone.utc)
            expires = now + timedelta(
                seconds=generated["duration_seconds"]
            )

            stage = 'DATABASE_INSERT'
            async with create_supabase_client() as db:
                response = await db.post(
                    "student_aptitude_tests",
                    json={
                        "user_id": user_id,
                        "category": request.category,
                        "topic": request.topic,
                        "difficulty": request.difficulty,
                        "duration_seconds": generated[
                            "duration_seconds"
                        ],
                        "expires_at": expires.isoformat(),
                        "questions": generated["questions"],
                    },
                    headers={"Prefer": "return=representation"},
                )
                response.raise_for_status()
                rows = response.json()

            if not rows:
                raise RuntimeError("Test was not saved.")

            return {
                "test_id": rows[0]["id"],
                "category": request.category,
                "topic": request.topic,
                "difficulty": request.difficulty,
                "duration_seconds": generated[
                    "duration_seconds"
                ],
                "expires_at": expires.isoformat(),
                "questions": public_questions(
                    generated["questions"]
                ),
                "provider": generated.get("provider"),
                "model": generated.get("model"),
                "quota": quota,
            }

        except MockTestError as exc:
            raise HTTPException(422, str(exc)) from exc
        except (httpx.HTTPError, RuntimeError) as exc:
            import logging

            status = None
            error_code = None

            if isinstance(exc, httpx.HTTPStatusError):
                status = exc.response.status_code

                try:
                    body = exc.response.json()
                    if isinstance(body, dict):
                        code = body.get("code")
                        if isinstance(code, str) and len(code) <= 32:
                            error_code = code
                except (ValueError, UnicodeError):
                    pass

            logging.getLogger("app.student_aptitude").error(
                "Aptitude generation failed: type=%s stage=%s status=%s code=%s",
                type(exc).__name__,
                stage,
                status,
                error_code,
            )
            raise HTTPException(
                503,
                "Aptitude generation is temporarily unavailable.",
            ) from exc

    @router.get("/{test_id}")
    async def retrieve_aptitude(
        test_id: UUID,
        user: dict = Depends(verify_user),
    ):
        user_id = str(UUID(user["sub"]))
        saved = await load_test(user_id, str(test_id))

        if saved is None:
            raise HTTPException(404, "Aptitude test not found.")

        return {
            "test_id": saved["id"],
            "category": saved["category"],
            "topic": saved["topic"],
            "difficulty": saved["difficulty"],
            "duration_seconds": saved["duration_seconds"],
            "expires_at": saved["expires_at"],
            "questions": public_questions(saved["questions"]),
        }

    @router.post("/{test_id}/submit")
    async def submit_aptitude(
        test_id: UUID,
        request: AptitudeSubmitRequest,
        user: dict = Depends(verify_user),
    ):
        user_id = str(UUID(user["sub"]))
        saved = await load_test(user_id, str(test_id))

        if saved is None:
            raise HTTPException(404, "Aptitude test not found.")

        now = datetime.now(timezone.utc)
        expires = datetime.fromisoformat(
            saved["expires_at"].replace("Z", "+00:00")
        )

        # Allow a small network-transit margin.
        if now > expires + timedelta(seconds=5):
            raise HTTPException(
                409, "Test deadline has expired."
            )

        try:
            result = grade_mock_test(
                saved["questions"],
                request.submitted_answers,
            )
        except MockTestError as exc:
            raise HTTPException(422, str(exc)) from exc

        started = expires - timedelta(
            seconds=saved["duration_seconds"]
        )

        elapsed = max(
            0, int((now - started).total_seconds())
        )
        elapsed = min(elapsed, saved["duration_seconds"])

        async with create_supabase_client() as db:
            existing = await db.get(
                "student_aptitude_attempts",
                params={
                    "test_id": f"eq.{test_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "id",
                    "limit": 1,
                },
            )
            existing.raise_for_status()

            if existing.json():
                raise HTTPException(
                    409, "Test has already been submitted."
                )

            try:
                response = await db.post(
                    "student_aptitude_attempts",
                    json={
                        "user_id": user_id,
                        "test_id": str(test_id),
                        "submitted_answers": (
                            request.submitted_answers
                        ),
                        "correct_count": result["correct_count"],
                        "total_questions": result[
                            "total_questions"
                        ],
                        "score_percentage": result[
                            "score_percentage"
                        ],
                        "time_taken_seconds": elapsed,
                    },
                    headers={"Prefer": "return=representation"},
                )

                if response.status_code == 409:
                    raise HTTPException(
                        409, "Test has already been submitted."
                    )

                response.raise_for_status()

            except httpx.HTTPStatusError as exc:
                # PostgreSQL unique-constraint violation.
                if (
                    exc.response.status_code == 409
                    or "23505" in exc.response.text
                ):
                    raise HTTPException(
                        409, "Test has already been submitted."
                    ) from exc
                raise

            rows = response.json()

        if not rows:
            raise HTTPException(
                503, "Unable to save aptitude result."
            )

        return {
            "attempt_id": rows[0]["id"],
            "test_id": str(test_id),
            "time_taken_seconds": elapsed,
            **result,
        }

    return router
