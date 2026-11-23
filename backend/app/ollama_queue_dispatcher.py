"""Bounded cloud-side dispatcher for the Ollama worker queue."""

import asyncio
import logging
from time import monotonic

import httpx

from app.database import (
    cancel_ollama_inference_job,
    create_ollama_inference_job,
    get_ollama_inference_job,
)

logger = logging.getLogger(__name__)

OLLAMA_WAIT_SECONDS = 12.0
OLLAMA_POLL_SECONDS = 0.75


async def call_ollama_via_queue(
    messages: list[dict[str, str]],
    max_tokens: int = 800,
) -> str | None:
    """Return a worker answer or None for cloud-provider fallback."""

    active_job = {"id": None, "completed": False}

    try:
        return await asyncio.wait_for(
            _poll_ollama_queue(messages, max_tokens, active_job),
            timeout=OLLAMA_WAIT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.info("Ollama total response deadline exceeded.")
        return None
    finally:
        if active_job["id"] and not active_job["completed"]:
            _schedule_ollama_cancellation(active_job["id"])


async def _poll_ollama_queue(
    messages: list[dict[str, str]],
    max_tokens: int,
    active_job: dict,
) -> str | None:
    """Submit a job and poll until completed or timed out."""

    try:
        job_id = await create_ollama_inference_job(
            messages=messages,
            max_tokens=min(max_tokens, 800),
        )
    except (httpx.HTTPError, ValueError, RuntimeError):
        logger.warning("Ollama job submission unavailable.")
        return None

    active_job["id"] = job_id
    deadline = monotonic() + OLLAMA_WAIT_SECONDS

    while monotonic() < deadline:
        await asyncio.sleep(
            min(
                OLLAMA_POLL_SECONDS,
                max(0.0, deadline - monotonic()),
            )
        )

        try:
            job = await get_ollama_inference_job(job_id)
        except (httpx.HTTPError, ValueError, RuntimeError):
            logger.warning("Ollama job polling unavailable.")
            return None

        if not isinstance(job, dict):
            return None

        status = job.get("status")

        if status == "completed":
            answer = job.get("result_text")

            if isinstance(answer, str) and answer.strip():
                active_job["completed"] = True
                return answer.strip()

            return None

        if status in ("failed", "expired"):
            return None

        if status not in ("pending", "processing"):
            return None

    logger.info("Ollama response window elapsed; using fallback.")
    return None


_CANCELLATION_TASKS: set[asyncio.Task] = set()


async def _cancel_ollama_job(job_id: str) -> None:
    """Attempt cancellation without blocking the user response."""
    try:
        await asyncio.wait_for(
            cancel_ollama_inference_job(job_id),
            timeout=5.0,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("Ollama job cancellation unavailable.")


def _schedule_ollama_cancellation(job_id: str) -> None:
    """Retain the task until cancellation finishes."""
    task = asyncio.create_task(_cancel_ollama_job(job_id))
    _CANCELLATION_TASKS.add(task)
    task.add_done_callback(_CANCELLATION_TASKS.discard)
