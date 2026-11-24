import asyncio
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx

from app import main, student_ai_quota, student_aptitude_api
from app.auth import verify_user


USER_ID = "00000000-0000-4000-8000-000000000001"
CHAT_ID = "00000000-0000-4000-8000-000000000002"
RESERVATION_ID = "00000000-0000-4000-8000-000000000003"
REQUEST_ID = "00000000-0000-4000-8000-000000000004"
TEST_ID = "00000000-0000-4000-8000-000000000005"


def quota(allowed=True, reservation_id=RESERVATION_ID):
    return {
        "allowed": allowed,
        "reservation_id": reservation_id,
        "calls_used": 1 if reservation_id else 30,
        "calls_remaining": 29 if reservation_id else 0,
        "daily_limit": 30,
    }


class StudentAIQuotaRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.events = []

        def mock(module, name, **kwargs):
            return stack.enter_context(patch.object(module, name, new_callable=AsyncMock, **kwargs))

        self.reserve = mock(student_ai_quota, "reserve_student_ai_request", return_value=quota())
        self.settle = mock(student_ai_quota, "settle_student_ai_request", side_effect=self.settlement)
        mock(main, "get_user_provider_key", return_value="mock-provider-key")
        mock(student_aptitude_api, "get_user_provider_key", return_value="mock-provider-key")
        mock(main, "get_student_ai_chat", return_value={"id": CHAT_ID, "title": "Existing chat"})
        mock(main, "get_student_ai_messages", return_value=[])
        mock(main, "update_student_ai_chat", return_value=None)
        self.aptitude_generate = mock(
            student_aptitude_api, "generate_aptitude_questions",
            return_value={
                "duration_seconds": 120,
                "questions": [{
                    "id": "q1", "question": "Question?",
                    "options": {"A": "One", "B": "Two", "C": "Three", "D": "Four"},
                    "correct_answer": "A", "explanation": "Explanation",
                }],
                "provider": "groq",
            },
        )
        self.tutor_generate = mock(main, "generate_tutor_response", return_value={"answer": "Answer"})
        self.aptitude_save = mock(student_aptitude_api, "save_generated_aptitude_test",
                                  side_effect=self.saved_aptitude)
        self.tutor_save = mock(main, "save_student_ai_exchange", side_effect=self.saved_tutor)

        stack.enter_context(patch.dict(main.app.dependency_overrides, {
            verify_user: lambda: {"sub": USER_ID},
        }))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def settlement(self, *, reservation_id, calls_charged):
        self.events.append(("settle", calls_charged))
        return {
            "reservation_status": "settled" if calls_charged else "refunded",
            "calls_used": calls_charged,
            "calls_remaining": 30 - calls_charged,
        }

    async def saved_aptitude(self, payload):
        self.events.append("persist")
        return TEST_ID

    async def saved_tutor(self, **payload):
        self.events.append("persist")
        return [{"id": "first"}, {"id": "second"}]

    async def post_aptitude(self, **extra):
        return await self.client.post("/student/aptitude/generate", json={
            "category": "quantitative", "topic": "Percentages", "accept_ai_processing": True,
            "use_personal_keys": True, "accept_provider_charges": True, **extra,
        })

    async def post_tutor(self, **extra):
        return await self.client.post(f"/student/ai/chats/{CHAT_ID}/messages", json={
            "question": "Explain this", "accept_ai_processing": True,
            "use_personal_keys": True, "accept_provider_charges": True, **extra,
        })

    async def test_aptitude_success_saves_then_charges_and_hides_answers(self):
        response = await self.post_aptitude()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["test_id"], TEST_ID)
        self.assertEqual(response.json()["quota"]["calls_remaining"], 29)
        self.assertNotIn("correct_answer", response.json()["questions"][0])
        self.assertEqual(self.events, ["persist", ("settle", 1)])

    async def test_tutor_success_saves_before_charging(self):
        response = await self.post_tutor()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["calls_remaining"], 29)
        self.assertEqual(self.events, ["persist", ("settle", 1)])

    async def test_aptitude_provider_failure_refunds_without_writing(self):
        self.aptitude_generate.side_effect = main.ProviderCapacityError()
        response = await self.post_aptitude()
        self.assertEqual(response.status_code, 503)
        self.aptitude_save.assert_not_awaited()
        self.assertEqual(self.events, [("settle", 0)])

    async def test_tutor_provider_failure_refunds_without_writing(self):
        self.tutor_generate.side_effect = main.ProviderCapacityError()
        response = await self.post_tutor()
        self.assertEqual(response.status_code, 503)
        self.tutor_save.assert_not_awaited()
        self.assertEqual(self.events, [("settle", 0)])

    async def test_confirmed_aptitude_write_rollback_refunds(self):
        request = httpx.Request("POST", "https://database.invalid")
        self.aptitude_save.side_effect = httpx.HTTPStatusError(
            "constraint violation", request=request,
            response=httpx.Response(409, request=request, json={"code": "23514"}),
        )
        response = await self.post_aptitude()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.events, [("settle", 0)])

    async def test_tutor_lost_ownership_refunds_and_returns_404(self):
        self.tutor_save.side_effect = main.StudentAIChatNotFound()
        response = await self.post_tutor()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.events, [("settle", 0)])

    async def test_ambiguous_write_keeps_reservation_held(self):
        self.aptitude_save.side_effect = httpx.ReadTimeout("write outcome unknown")
        self.tutor_save.side_effect = RuntimeError("malformed write receipt")
        with self.assertLogs(student_ai_quota.logger, level="WARNING") as logs:
            self.assertEqual((await self.post_aptitude()).status_code, 503)
            self.assertEqual((await self.post_tutor()).status_code, 503)
        self.settle.assert_not_awaited()
        self.assertEqual(len(logs.output), 2)

    async def test_accepted_reservation_with_malformed_counters_is_refunded(self):
        self.reserve.return_value = {**quota(), "calls_remaining": None}
        self.assertEqual((await self.post_aptitude()).status_code, 503)
        self.assertEqual(self.events, [("settle", 0)])
        self.aptitude_generate.assert_not_awaited()
        self.aptitude_save.assert_not_awaited()

    async def test_conflicting_terminal_settlement_stops_retries(self):
        rejection = httpx.Response(400, json={"code": "P0001"},
                                   request=httpx.Request("POST", "https://database.invalid"))
        self.settle.side_effect = httpx.HTTPStatusError(
            "Reservation already settled differently", request=rejection.request, response=rejection
        )
        with self.assertLogs(student_ai_quota.logger, level="ERROR"):
            response = await self.post_tutor()
        self.assertEqual(response.status_code, 200)
        self.settle.assert_awaited_once_with(reservation_id=RESERVATION_ID, calls_charged=1)

    async def test_unavailable_settlement_returns_already_saved_result(self):
        self.settle.side_effect = httpx.ReadTimeout("settlement outcome unknown")
        with self.assertLogs(student_ai_quota.logger, level="ERROR"):
            response = await self.post_tutor()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["calls_remaining"], 29)
        self.tutor_save.assert_awaited_once()
        self.assertEqual(self.settle.await_count, 2)
        self.assertEqual(self.settle.await_args_list[0], self.settle.await_args_list[1])
        self.assertEqual(self.settle.await_args.kwargs["calls_charged"], 1)

    async def test_duplicate_settlement_after_lost_reply_retries_only_original_refund(self):
        refunded = set()

        async def lost_first_reply(*, reservation_id, calls_charged):
            self.assertEqual(calls_charged, 0)
            if reservation_id not in refunded:
                refunded.add(reservation_id)
                raise httpx.ReadTimeout("refund applied; reply lost")
            return {
                "reservation_status": "refunded", "calls_refunded": 0,
                "calls_used": 0, "calls_remaining": 30,
            }

        self.settle.side_effect = lost_first_reply
        self.aptitude_generate.side_effect = main.ProviderCapacityError()
        self.assertEqual((await self.post_aptitude()).status_code, 503)
        self.assertEqual(refunded, {RESERVATION_ID})
        self.assertEqual(self.settle.await_count, 2)
        self.assertEqual(self.settle.await_args_list[0], self.settle.await_args_list[1])

    async def test_duplicate_request_is_denied_before_second_generation(self):
        self.reserve.side_effect = [quota(), quota(allowed=False)]
        self.assertEqual((await self.post_aptitude(request_id=REQUEST_ID)).status_code, 200)
        self.assertEqual((await self.post_aptitude(request_id=REQUEST_ID)).status_code, 409)
        self.assertEqual(self.reserve.await_args_list[0], self.reserve.await_args_list[1])
        self.aptitude_generate.assert_awaited_once()
        self.aptitude_save.assert_awaited_once()
        self.settle.assert_awaited_once()

    async def test_concurrent_duplicate_request_never_generates_twice(self):
        entered = asyncio.Event()
        finish = asyncio.Event()
        generated = self.aptitude_generate.return_value
        self.reserve.side_effect = [quota(), quota(allowed=False)]

        async def generate(**kwargs):
            entered.set()
            await finish.wait()
            return generated

        self.aptitude_generate.side_effect = generate
        first = asyncio.create_task(self.post_aptitude(request_id=REQUEST_ID))
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            duplicate = await asyncio.wait_for(self.post_aptitude(request_id=REQUEST_ID), timeout=5)
            self.assertEqual(duplicate.status_code, 409)
        finally:
            finish.set()
            response = await asyncio.wait_for(first, timeout=5)
        self.assertEqual(response.status_code, 200)
        self.aptitude_generate.assert_awaited_once()
        self.aptitude_save.assert_awaited_once()
        self.settle.assert_awaited_once()

    async def test_request_ids_are_scoped_to_user_operation_and_chat(self):
        request_id = UUID(REQUEST_ID)
        other_user = "00000000-0000-4000-8000-000000000006"
        make = student_ai_quota.StudentAIReservation
        expected = make(USER_ID, "aptitude", request_id).request_id
        self.assertEqual(make(USER_ID, "aptitude", request_id).request_id, expected)
        self.assertEqual(len({
            expected,
            make(other_user, "aptitude", request_id).request_id,
            make(USER_ID, f"tutor:{CHAT_ID}", request_id).request_id,
            make(USER_ID, f"tutor:{TEST_ID}", request_id).request_id,
        }), 4)
        self.assertNotEqual(make(USER_ID, "aptitude", None).request_id,
                            make(USER_ID, "aptitude", None).request_id)

    async def test_quota_exhaustion_prevents_provider_and_persistence(self):
        self.reserve.return_value = quota(allowed=False, reservation_id=None)
        self.assertEqual((await self.post_aptitude()).status_code, 429)
        self.assertEqual((await self.post_tutor()).status_code, 429)
        self.aptitude_generate.assert_not_awaited()
        self.tutor_generate.assert_not_awaited()
        self.settle.assert_not_awaited()

    async def test_uncertain_reservation_never_starts_generation(self):
        self.reserve.side_effect = [
            httpx.ReadTimeout("reservation outcome unknown"), quota(allowed=False),
        ]
        self.assertEqual((await self.post_aptitude(request_id=REQUEST_ID)).status_code, 503)
        self.reserve.assert_awaited_once()
        self.assertEqual((await self.post_aptitude(request_id=REQUEST_ID)).status_code, 409)
        self.assertEqual(self.reserve.await_args_list[0], self.reserve.await_args_list[1])
        self.aptitude_generate.assert_not_awaited()
        self.settle.assert_not_awaited()
