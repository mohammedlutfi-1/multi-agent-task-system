import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
from fastapi import HTTPException

from app import database, main


USER = "00000000-0000-4000-8000-000000000001"
TEST = UUID("00000000-0000-4000-8000-000000000002")
ATTEMPT = "00000000-0000-4000-8000-000000000003"


class MockTestProgressTests(unittest.IsolatedAsyncioTestCase):
    async def submit_with_progress(self, response):
        def respond(request):
            self.assertEqual(request.url.path, "/rpc/apply_mock_test_progress")
            return response

        with (
            patch.object(main, "get_student_mock_test", AsyncMock(return_value={"questions": []})) as lookup,
            patch.object(main, "grade_mock_test", return_value={
                "correct_count": 4, "total_questions": 5,
                "score_percentage": 80, "passed": True,
            }),
            patch.object(main, "save_student_mock_attempt", AsyncMock(return_value={"id": ATTEMPT})) as save,
            patch.object(database, "create_supabase_client", return_value=httpx.AsyncClient(
                base_url="https://database.example.invalid", transport=httpx.MockTransport(respond)
            )),
        ):
            result = await main.submit_student_mock_test(
                TEST, main.MockTestSubmitRequest(submitted_answers={"1": "A"}), {"sub": USER}
            )
        lookup.assert_awaited_once_with(USER, str(TEST))
        save.assert_awaited_once()
        self.assertEqual(result["attempt_id"], ATTEMPT)
        self.assertEqual(result["score_percentage"], 80)
        return result["exam_progress"]

    async def test_saved_grade_survives_progress_rpc_failure(self):
        with self.assertLogs(main.__name__, level="WARNING"):
            progress = await self.submit_with_progress(httpx.Response(503))
        self.assertEqual(progress, {"updated": False, "reason": "progress_update_unconfirmed"})

    async def test_saved_grade_survives_invalid_progress_response(self):
        with self.assertLogs(main.__name__, level="WARNING"):
            progress = await self.submit_with_progress(httpx.Response(200, content=b"not JSON"))
        self.assertEqual(progress["reason"], "progress_update_unconfirmed")

    async def test_accepts_single_row_progress_response(self):
        progress = await self.submit_with_progress(httpx.Response(200, json=[{"updated": True}]))
        self.assertTrue(progress["updated"])

    async def test_non_owner_cannot_save_attempt_or_update_progress(self):
        with (
            patch.object(main, "get_student_mock_test", AsyncMock(return_value=None)) as lookup,
            patch.object(main, "save_student_mock_attempt", AsyncMock()) as save,
            patch.object(database, "create_supabase_client") as client,
        ):
            with self.assertRaises(HTTPException) as error:
                await main.submit_student_mock_test(
                    TEST, main.MockTestSubmitRequest(submitted_answers={"1": "A"}), {"sub": USER}
                )
        self.assertEqual(error.exception.status_code, 404)
        lookup.assert_awaited_once_with(USER, str(TEST))
        save.assert_not_awaited()
        client.assert_not_called()
