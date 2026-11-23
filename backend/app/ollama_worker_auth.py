"""Authentication for the private Ollama laptop worker."""

import hmac
import os

from fastapi import Header, HTTPException


async def verify_ollama_worker(
    x_ollama_worker_token: str | None = Header(default=None),
) -> None:
    """Require a dedicated worker token for bridge endpoints."""

    expected = os.getenv("OLLAMA_WORKER_SECRET", "")

    if len(expected) < 32:
        raise HTTPException(
            status_code=503,
            detail="Ollama worker authentication is unavailable.",
        )

    if (
        not x_ollama_worker_token
        or not hmac.compare_digest(
            x_ollama_worker_token,
            expected,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid worker credentials.",
        )
