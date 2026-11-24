import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth, database, main


def fixture_id(number):
    return f"00000000-0000-4000-8000-{number:012d}"


ACCOUNTS = [fixture_id(1), fixture_id(2)]
TASKS = [fixture_id(3), fixture_id(4)]
CHATS = [fixture_id(5), fixture_id(6)]
PROVIDERS = ["gemini", "groq"]
ISSUER = "https://supabase.example.invalid/auth/v1"


class AuthenticatedIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Ephemeral test signing material, used only in memory.
        signing_key = ec.generate_private_key(ec.SECP256R1())
        bad_key = ec.generate_private_key(ec.SECP256R1())
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        self.rows = {
            "collaboration_tasks": [
                {"id": task, "user_id": account, "task": f"Task {index}", "status": "completed",
                 "final_answer": f"Answer {index}"}
                for index, (account, task) in enumerate(zip(ACCOUNTS, TASKS))
            ],
            "collaboration_turns": [
                {"task_id": task, "turn_number": 1, "response": f"Answer {index}"}
                for index, task in enumerate(TASKS)
            ],
            "student_ai_chats": [
                {"id": chat, "user_id": account, "title": f"Chat {index}"}
                for index, (account, chat) in enumerate(zip(ACCOUNTS, CHATS))
            ],
            "student_ai_messages": [
                {"id": fixture_id(10 + index), "chat_id": chat, "user_id": account,
                 "content": f"Message {index}"}
                for index, (account, chat) in enumerate(zip(ACCOUNTS, CHATS))
            ],
            "student_ai_daily_usage": [
                {"user_id": account, "usage_date": today, "calls_used": index + 1}
                for index, account in enumerate(ACCOUNTS)
            ],
            "ai_daily_usage": [
                {"user_id": account, "usage_date": today, "requests_used": index + 3}
                for index, account in enumerate(ACCOUNTS)
            ],
            "user_api_keys": [
                {"user_id": account, "provider": provider, "is_active": True,
                 "created_at": today, "updated_at": today}
                for account, provider in zip(ACCOUNTS, PROVIDERS)
            ],
        }
        self.database_calls = []
        self.tokens = []
        for account in ACCOUNTS:
            self.tokens.append(jwt.encode(
                {"sub": account, "aud": "authenticated", "iss": ISSUER,
                 "iat": now, "exp": now + timedelta(minutes=5)},
                signing_key, algorithm="ES256",
            ))
        self.invalid_token = jwt.encode(
            {"sub": ACCOUNTS[0], "aud": "authenticated", "iss": ISSUER,
             "iat": now, "exp": now + timedelta(minutes=5)},
            bad_key, algorithm="ES256",
        )

        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(auth, "get_supabase_url", return_value=ISSUER.rsplit("/auth", 1)[0]))
        jwks = Mock()
        jwks.get_signing_key_from_jwt.return_value.key = signing_key.public_key()
        stack.enter_context(patch.object(auth, "PyJWKClient", return_value=jwks))
        stack.enter_context(patch.object(database, "create_supabase_client", side_effect=self.fake_database))
        self.provider = stack.enter_context(patch.object(
            main, "call_ai_with_fallback", new_callable=AsyncMock,
            side_effect=AssertionError("Isolation probes must never reach inference"),
        ))
        self.addCleanup(self.provider.assert_not_awaited)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://isolation.test"
        )
        self.addAsyncCleanup(self.client.aclose)

    def fake_database(self):
        return httpx.AsyncClient(
            transport=httpx.MockTransport(self.postgrest), base_url="https://database.example.invalid/"
        )

    def postgrest(self, request):
        table = request.url.path.lstrip("/")
        self.database_calls.append((request.method, table, dict(request.url.params)))
        rows = self.rows[table]
        filters = {
            key: value[3:] for key, value in request.url.params.multi_items()
            if value.startswith("eq.")
        }
        matched = [row for row in rows if all(str(row.get(key)) == v for key, v in filters.items())]
        if request.method == "DELETE":
            self.rows[table] = [row for row in rows if row not in matched]
            return (httpx.Response(200, json=matched) if request.headers["Prefer"] == "return=representation"
                    else httpx.Response(204))
        self.assertEqual(request.method, "GET")
        limit = int(request.url.params.get("limit", len(matched)))
        fields = request.url.params.get("select", "*")
        if table == "user_api_keys":
            self.assertEqual(fields, "provider,is_active,created_at,updated_at")
        if fields != "*":
            matched = [{key: row.get(key) for key in fields.split(",")} for row in matched]
        return httpx.Response(200, json=matched[:limit])

    async def as_user(self, index, method, path, **kwargs):
        return await self.client.request(
            method, path, headers={"Authorization": "Bearer " + self.tokens[index]}, **kwargs
        )

    async def test_missing_or_invalid_signature_is_rejected_before_database_access(self):
        self.assertEqual((await self.client.get("/ai/history")).status_code, 401)
        response = await self.client.get("/ai/history", headers={"Authorization": "Bearer " + self.invalid_token})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.database_calls, [])

    async def test_both_owners_read_only_their_collaboration_history_and_answers(self):
        for owner in (0, 1):
            other = 1 - owner
            history = await self.as_user(owner, "GET", "/ai/history")
            self.assertEqual(history.status_code, 200)
            self.assertEqual([row["id"] for row in history.json()["tasks"]], [TASKS[owner]])
            detail = await self.as_user(owner, "GET", f"/ai/history/{TASKS[owner]}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["turns"][0]["response"], f"Answer {owner}")
            denied = await self.as_user(other, "GET", f"/ai/history/{TASKS[owner]}")
            self.assertEqual(denied.status_code, 404)
            for method in ("PATCH", "DELETE"):
                denied = await self.as_user(other, method, f"/ai/history/{TASKS[owner]}")
                self.assertEqual(denied.status_code, 405)
        self.assertEqual(len(self.rows["collaboration_tasks"]), 2)

    async def test_both_tutor_owners_read_messages_and_cross_account_writes_are_denied(self):
        for owner in (0, 1):
            other = 1 - owner
            path = f"/student/ai/chats/{CHATS[owner]}"
            chats = await self.as_user(owner, "GET", "/student/ai/chats")
            self.assertEqual(chats.status_code, 200)
            self.assertEqual([row["id"] for row in chats.json()["chats"]], [CHATS[owner]])
            detail = await self.as_user(owner, "GET", path)
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["messages"][0]["content"], f"Message {owner}")
            self.assertEqual((await self.as_user(other, "GET", path)).status_code, 404)
            self.assertEqual((await self.as_user(other, "DELETE", path)).status_code, 404)
            denied = await self.as_user(other, "POST", f"{path}/messages", json={
                "question": "Synthetic forbidden message", "accept_ai_processing": True,
            })
            self.assertEqual(denied.status_code, 404)
            self.assertEqual((await self.as_user(owner, "GET", path)).status_code, 200)
        self.assertFalse(any(table.startswith("rpc/") for _, table, _ in self.database_calls))

    async def test_owner_can_delete_own_synthetic_tutor_chat(self):
        path = f"/student/ai/chats/{CHATS[0]}"
        self.assertEqual((await self.as_user(0, "GET", path)).status_code, 200)
        self.assertEqual((await self.as_user(0, "DELETE", path)).status_code, 200)
        self.assertEqual((await self.as_user(0, "GET", path)).status_code, 404)
        self.assertEqual((await self.as_user(1, "GET", f"/student/ai/chats/{CHATS[1]}")).status_code, 200)

    async def test_each_account_receives_only_its_quota_counters(self):
        for owner in (0, 1):
            for path, field, expected in (
                ("/ai/usage", "requests_used", owner + 3),
                ("/student/ai/usage", "calls_used", owner + 1),
            ):
                response = await self.as_user(owner, "GET", path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()[field], expected)

    async def test_key_metadata_is_scoped_and_wrong_account_delete_preserves_fixture(self):
        for owner in (0, 1):
            response = await self.as_user(owner, "GET", "/ai/api-keys")
            self.assertEqual(response.status_code, 200)
            keys = response.json()["keys"]
            self.assertEqual([row["provider"] for row in keys], [PROVIDERS[owner]])
            self.assertEqual(set(keys[0]), {"provider", "is_active", "created_at", "updated_at"})
            await self.as_user(1 - owner, "DELETE", f"/ai/api-keys/{PROVIDERS[owner]}")
            again = await self.as_user(owner, "GET", "/ai/api-keys")
            self.assertEqual(again.json()["keys"], keys)
