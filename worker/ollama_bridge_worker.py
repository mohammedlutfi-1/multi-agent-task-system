"""Outbound-only Ollama inference worker."""

import asyncio
import logging
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

logger = logging.getLogger("ollama_bridge")

WORKER_ID = "college-ollama-worker"
MODEL = "qwen2.5:1.5b"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
INFERENCE_TIMEOUT = 120.0
POLL_INTERVAL = 3.0


def get_config():
    backend_url = os.getenv(
        "OLLAMA_BRIDGE_BACKEND_URL", ""
    ).strip().rstrip("/")

    secret = os.getenv(
        "OLLAMA_WORKER_SECRET", ""
    )

    parsed = urlparse(backend_url)

    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise RuntimeError(
            "OLLAMA_BRIDGE_BACKEND_URL must be an HTTPS origin."
        )

    if len(secret) < 32:
        raise RuntimeError(
            "OLLAMA_WORKER_SECRET must contain at least 32 characters."
        )

    return backend_url, secret


async def run_inference(client, job):
    if job.get("job_model") != MODEL:
        raise ValueError("Unsupported Ollama model.")

    messages = job.get("job_messages")

    if (
        not isinstance(messages, list)
        or not 1 <= len(messages) <= 30
    ):
        raise ValueError("Invalid job messages.")

    total_chars = 0
    allowed_roles = {"system", "user", "assistant"}

    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("Invalid message structure.")

        role = message.get("role")
        content = message.get("content")

        if role not in allowed_roles:
            raise ValueError("Unsupported message role.")

        if (
            not isinstance(content, str)
            or not content.strip()
            or len(content) > 12000
        ):
            raise ValueError("Invalid message content.")

        total_chars += len(content)

        if total_chars > 40000:
            raise ValueError("Job message content exceeds limit.")

    max_tokens = job.get("job_max_tokens", 800)

    if (
        type(max_tokens) is not int
        or not 1 <= max_tokens <= 800
    ):
        raise ValueError("Invalid max_tokens.")

    response = await client.post(
        OLLAMA_URL,
        json={
            "model": MODEL,
            "messages": messages,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
            },
        },
        timeout=httpx.Timeout(
            connect=5.0,
            read=INFERENCE_TIMEOUT,
            write=10.0,
            pool=5.0,
        ),
    )

    response.raise_for_status()

    result = response.json()
    answer = result.get("message", {}).get("content", "")

    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("Ollama returned an empty response.")

    return answer.strip()[:20000]


async def process_job(client, backend_url, headers, job):
    job_id = job.get("job_id")
    lease_token = job.get("job_lease_token")

    if not job_id or not lease_token:
        logger.error("Claimed job is missing lease metadata.")
        return

    try:
        deadlines = []

        for field in ("job_expires_at", "job_leased_until"):
            raw = job.get(field)

            if not isinstance(raw, str) or not raw:
                raise ValueError(
                    f"Missing or invalid {field}."
                )

            parsed = datetime.fromisoformat(
                raw.replace("Z", "+00:00")
            )

            if parsed.tzinfo is None:
                raise ValueError(
                    f"Timezone missing from {field}."
                )

            deadlines.append(parsed)

        deadline = min(deadlines)

        remaining = (
            deadline - datetime.now(timezone.utc)
        ).total_seconds()

        inference_budget = min(
            INFERENCE_TIMEOUT + 10,
            remaining - 10,
        )

        if inference_budget < 5:
            logger.warning(
                "Skipping job %s: insufficient lease time.",
                job_id,
            )
            return

        answer = await asyncio.wait_for(
            run_inference(client, job),
            timeout=inference_budget,
        )

        if (
            deadline - datetime.now(timezone.utc)
        ).total_seconds() <= 2:
            logger.warning(
                "Skipping completion for expired job %s.",
                job_id,
            )
            return

    except Exception as exc:
        logger.warning(
            "Local inference failed for job %s: %s",
            job_id,
            type(exc).__name__,
        )
        return

    try:
        response = await client.post(
            f"{backend_url}/internal/ollama/complete",
            headers=headers,
            json={
                "job_id": job_id,
                "lease_token": lease_token,
                "result_text": answer,
            },
            timeout=20.0,
        )

        if response.status_code == 409:
            logger.warning(
                "Job %s lease expired before completion.",
                job_id,
            )
            return

        response.raise_for_status()
        logger.info("Completed job %s", job_id)

    except httpx.HTTPError as exc:
        logger.warning(
            "Completion request failed for job %s: %s",
            job_id,
            type(exc).__name__,
        )


async def run_worker():
    backend_url, secret = get_config()

    headers = {
        "X-Ollama-Worker-Token": secret,
    }

    logger.info(
        "Starting outbound Ollama worker for %s",
        urlparse(backend_url).hostname,
    )

    async with httpx.AsyncClient(
        trust_env=False,
    ) as client:

        while True:
            try:
                response = await client.post(
                    f"{backend_url}/internal/ollama/claim",
                    headers=headers,
                    timeout=20.0,
                )

                response.raise_for_status()

                job = response.json().get("job")

                if job is not None:
                    await process_job(
                        client,
                        backend_url,
                        headers,
                        job,
                    )
                else:
                    await asyncio.sleep(POLL_INTERVAL)

            except httpx.HTTPStatusError as exc:
                logger.error(
                    "Worker claim failed with HTTP %s",
                    exc.response.status_code,
                )
                await asyncio.sleep(10)

            except httpx.HTTPError as exc:
                logger.warning(
                    "Worker connection error: %s",
                    type(exc).__name__,
                )
                await asyncio.sleep(10)

            except (KeyError, TypeError, ValueError):
                logger.error("Unexpected worker response.")
                await asyncio.sleep(10)


if __name__ == "__main__":
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Worker stopped.")
