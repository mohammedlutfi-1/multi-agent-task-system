import unittest
from unittest.mock import patch

from app.database import (
    reserve_student_ai_request,
    settle_student_ai_request,
)


class StudentAIQuotaTests(unittest.IsolatedAsyncioTestCase):

    async def test_reservation_rejects_zero_calls(self):
        with patch(
            "app.database.create_supabase_client"
        ) as client:
            with self.assertRaises(ValueError):
                await reserve_student_ai_request(
                    user_id="00000000-0000-4000-8000-000000000001",
                    request_id="00000000-0000-4000-8000-000000000002",
                    requested_calls=0,
                )
            client.assert_not_called()

    async def test_reservation_rejects_over_limit(self):
        with patch(
            "app.database.create_supabase_client"
        ) as client:
            with self.assertRaises(ValueError):
                await reserve_student_ai_request(
                    user_id="00000000-0000-4000-8000-000000000001",
                    request_id="00000000-0000-4000-8000-000000000002",
                    requested_calls=31,
                )
            client.assert_not_called()

    async def test_settlement_rejects_negative_charge(self):
        with patch(
            "app.database.create_supabase_client"
        ) as client:
            with self.assertRaises(ValueError):
                await settle_student_ai_request(
                    reservation_id="00000000-0000-4000-8000-000000000003",
                    calls_charged=-1,
                )
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class StudentAIQuotaRPCTests(unittest.IsolatedAsyncioTestCase):

    async def test_reservation_rpc(self):
        from unittest.mock import AsyncMock, MagicMock

        response = MagicMock()
        response.json.return_value = [{
            "allowed": True,
            "reservation_id": "00000000-0000-4000-8000-000000000003",
            "calls_used": 2,
            "calls_remaining": 28,
            "daily_limit": 30,
        }]

        client = AsyncMock()
        client.post.return_value = response

        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "app.database.create_supabase_client",
            return_value=context,
        ):
            result = await reserve_student_ai_request(
                user_id="00000000-0000-4000-8000-000000000001",
                request_id="00000000-0000-4000-8000-000000000002",
                requested_calls=2,
            )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["calls_remaining"], 28)
        client.post.assert_awaited_once_with(
            "rpc/reserve_student_ai_request",
            json={
                "p_user_id": "00000000-0000-4000-8000-000000000001",
                "p_request_id": "00000000-0000-4000-8000-000000000002",
                "p_requested_calls": 2,
            },
        )

    async def test_settlement_rpc(self):
        from unittest.mock import AsyncMock, MagicMock

        response = MagicMock()
        response.json.return_value = [{
            "reservation_status": "settled",
            "calls_refunded": 2,
            "calls_used": 1,
            "calls_remaining": 29,
        }]

        client = AsyncMock()
        client.post.return_value = response

        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "app.database.create_supabase_client",
            return_value=context,
        ):
            result = await settle_student_ai_request(
                reservation_id="00000000-0000-4000-8000-000000000003",
                calls_charged=1,
            )

        self.assertEqual(result["calls_refunded"], 2)
        self.assertEqual(result["calls_remaining"], 29)

        client.post.assert_awaited_once_with(
            "rpc/settle_student_ai_request",
            json={
                "p_reservation_id": "00000000-0000-4000-8000-000000000003",
                "p_calls_charged": 1,
            },
        )
