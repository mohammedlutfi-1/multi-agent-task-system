"""Reservation lifecycle for Student AI operations that persist a result."""

import asyncio
import logging
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import httpx
from fastapi import HTTPException

from app.database import (
    StudentAIWriteRejected,
    reserve_student_ai_request,
    settle_student_ai_request,
)


logger = logging.getLogger(__name__)


def _database_rejected_write(error: httpx.HTTPStatusError) -> bool:
    # A gateway or proxy status alone cannot establish rollback.
    if error.response.status_code not in (400, 403, 404, 409, 422):
        return False
    try:
        body = error.response.json()
    except ValueError:
        return False
    code = body.get("code") if isinstance(body, dict) else None
    return isinstance(code, str) and (
        code in {"42501", "42P01", "PGRST204", "PGRST205"}
        or (len(code) == 5 and code[:2] in {"22", "23"})
    )


class StudentAIReservation:
    def __init__(self, user_id: str, operation: str, request_id: UUID | None):
        self.user_id = user_id
        self.operation = operation
        self.request_id = str(
            uuid5(NAMESPACE_URL, f"student-ai:{user_id}:{operation}:{request_id}")
            if request_id is not None else uuid4()
        )
        self.quota: dict = {}
        self._charge: int | None = 0

    async def __aenter__(self):
        try:
            self.quota = await reserve_student_ai_request(
                user_id=self.user_id, request_id=self.request_id, requested_calls=1
            )
        except (httpx.HTTPError, RuntimeError, asyncio.CancelledError):
            logger.warning("Student AI reservation outcome unavailable: operation=%s request=%s",
                           self.operation, self.request_id)
            raise
        allowed = self.quota.get("allowed")
        reservation_id = self.quota.get("reservation_id")
        if allowed is False:
            if reservation_id is not None:
                raise HTTPException(409, "This AI request has already been processed or is in progress.")
            raise HTTPException(429, "Daily Student AI allowance exhausted.")
        if allowed is not True or not isinstance(reservation_id, str):
            raise RuntimeError("Invalid Student AI reservation response.")
        try:
            UUID(reservation_id)
        except ValueError as exc:
            raise RuntimeError("Invalid Student AI reservation ID.") from exc
        if any(
            type(self.quota.get(key)) is not int or self.quota[key] < 0
            for key in ("calls_used", "calls_remaining", "daily_limit")
        ):
            # Context entry failed after an accepted reservation. No provider
            # or persistence action has run, so a refund is safe.
            await self._settle(reservation_id, calls_charged=0)
            raise RuntimeError("Invalid Student AI quota counters.")
        return self

    async def persist(self, write):
        # Hold the debit until the write is confirmed or known to have failed.
        self._charge = None
        try:
            result = await write
        except StudentAIWriteRejected:
            self._charge = 0
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            self._charge = 0
            raise
        except httpx.HTTPStatusError as exc:
            if _database_rejected_write(exc):
                self._charge = 0
            raise
        self._charge = 1
        return result

    async def __aexit__(self, exc_type, exc, traceback):
        reservation_id = self.quota["reservation_id"]
        if self._charge is None:
            logger.warning("Student AI write outcome unresolved: operation=%s reservation=%s",
                           self.operation, reservation_id)
            return

        await self._settle(reservation_id, self._charge)

    async def _settle(self, reservation_id: str, calls_charged: int):
        expected_status = "settled" if calls_charged else "refunded"
        for _ in range(2):
            try:
                result = await settle_student_ai_request(
                    reservation_id=reservation_id, calls_charged=calls_charged
                )
                actual_status = result.get("reservation_status")
                if actual_status in ("settled", "refunded") and actual_status != expected_status:
                    break
                if actual_status != expected_status or any(
                    type(result.get(key)) is not int or result[key] < 0
                    for key in ("calls_used", "calls_remaining")
                ):
                    raise RuntimeError("Invalid Student AI settlement response.")
                self.quota.update(
                    calls_used=result["calls_used"],
                    calls_remaining=result["calls_remaining"],
                )
                return
            except httpx.HTTPStatusError as error:
                status = error.response.status_code
                if status < 500 and status not in (408, 429):
                    break
            except (httpx.HTTPError, RuntimeError):
                pass
            except asyncio.CancelledError:
                logger.warning("Student AI settlement interrupted: operation=%s reservation=%s charge=%s",
                               self.operation, reservation_id, calls_charged)
                raise
        # The reservation already holds the debit. Keep the saved result
        # deliverable and leave unresolved refunds for operational review.
        logger.error("Student AI settlement unresolved: operation=%s reservation=%s charge=%s",
                     self.operation, reservation_id, calls_charged)
