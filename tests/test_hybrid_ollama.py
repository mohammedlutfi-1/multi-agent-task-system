import asyncio
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID

import httpx

from app import collaboration_runner as runner, main
from app.auth import verify_user


USER_ID = "00000000-0000-4000-8000-000000000001"
TASK_ID = UUID("00000000-0000-4000-8000-000000000002")
WORKER_ID = UUID("00000000-0000-4000-8000-000000000003")


class HybridOllamaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.saved = None
        self.turns = []
        self.settings = {
            "ENABLE_LOCAL_OLLAMA": "true",
            "ENABLE_AUTO_RESUME": "true",
            "GEMINI_API_KEY": "mock",
            "GROQ_API_KEY": "mock",
        }
        stack.enter_context(patch.object(main.os, "getenv", side_effect=self.settings.get))
        stack.enter_context(patch.dict(main.app.dependency_overrides, {
            verify_user: lambda: {"sub": USER_ID},
        }))

        def mock(module, name, **kwargs):
            return stack.enter_context(patch.object(module, name, new_callable=AsyncMock, **kwargs))

        self.quota = mock(main, "create_collaboration_with_quota", side_effect=self.create_task)
        self.budget = mock(main, "reserve_platform_provider_call", return_value={"allowed": True})
        self.ollama = mock(main, "call_ollama_via_queue", return_value="Local answer")
        self.gemini = mock(main, "call_gemini_model", return_value="Gemini answer")
        self.groq = mock(main, "call_groq_model", return_value="Groq answer")
        mock(main, "call_ai_model", side_effect=AssertionError("Unexpected OpenRouter call"))
        self.history = mock(main, "get_user_collaboration_task", side_effect=self.load_owned_task)
        self.recovery_lookup = mock(runner, "get_user_collaboration_task", side_effect=self.load_owned_task)
        mock(main, "get_collaboration_turns", side_effect=lambda **_: list(self.turns))
        mock(runner, "get_collaboration_turns", side_effect=lambda **_: list(self.turns))
        self.claim = mock(runner, "start_collaboration_worker", side_effect=self.claim_task)
        self.release = mock(runner, "release_collaboration_task", side_effect=self.release_task)
        self.retry = mock(runner, "schedule_collaboration_retry", side_effect=self.schedule_retry)
        stack.enter_context(patch.object(runner, "create_checkpoint_callback", return_value=self.checkpoint))

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def create_task(self, **task):
        self.saved = {**task, "id": str(TASK_ID), "status": "pending", "auto_resume_enabled": True}
        return {"allowed": True, "task_id": str(TASK_ID), "requests_remaining": 9}

    async def load_owned_task(self, user_id, task_id):
        if self.saved and self.saved["user_id"] == user_id and self.saved["id"] == task_id:
            return dict(self.saved)
        return None

    async def claim_task(self, **kwargs):
        if self.saved["status"] not in ("pending", "paused"):
            raise runner.CollaborationClaimError("Task already claimed")
        self.saved["status"] = "running"
        return WORKER_ID, Mock(lease_lost=False, stop=AsyncMock())

    async def checkpoint(self, **turn):
        self.turns.append(turn)

    async def release_task(self, *, new_status, final_answer=None, **kwargs):
        self.saved.update(status=new_status, final_answer=final_answer)
        return True

    async def schedule_retry(self, **kwargs):
        self.saved.update(status="paused", next_retry_at="scheduled")
        return True

    async def submit(self, models):
        return await self.client.post("/ai/collaborate", json={
            "task": "Explain rate limits", "selected_models": models,
        })

    def due_projection(self):
        return {
            key: self.saved[key]
            for key in ("id", "task", "selected_models", "max_rounds", "user_id")
        }

    async def test_single_ollama_saves_one_answer_and_provider_in_owned_history(self):
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["final_answer"], "Local answer")
        self.assertEqual(result["selected_models"], ["ollama"])
        self.assertEqual(result["max_rounds"], 1)
        self.assertEqual(result["requests_remaining"], 9)
        self.assertEqual(result["total_turns"], 1)
        self.assertNotIn("synthesis_provider", result)
        self.ollama.assert_awaited_once()
        self.assertEqual(self.ollama.await_args.kwargs["messages"], [
            {"role": "user", "content": "Explain rate limits"},
        ])
        self.budget.assert_not_awaited()
        self.quota.assert_awaited_once_with(
            user_id=USER_ID, task="Explain rate limits", selected_models=["ollama"],
            max_rounds=1, credential_mode="platform", daily_limit=10,
        )
        history = await self.client.get(f"/ai/history/{TASK_ID}")
        self.assertEqual(history.status_code, 200, history.text)
        self.history.assert_awaited_once_with(user_id=USER_ID, task_id=str(TASK_ID))
        self.assertEqual(history.json()["task"]["final_answer"], "Local answer")
        self.assertEqual(history.json()["turns"][0]["model_id"], "qwen2.5:1.5b")

    async def assert_discussion(self, models, expected_provider, cloud):
        response = await self.submit(models)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["total_turns"], 4)
        self.assertEqual([turn["requested_provider"] for turn in self.turns], models * 2)
        self.assertEqual(result["synthesis_provider"], expected_provider)
        self.assertEqual(sum(provider.await_count for provider in (self.ollama, self.gemini, self.groq)), 5)
        self.assertEqual(self.ollama.await_count, 2 if "ollama" in models else 0)
        self.assertEqual(cloud.await_count, 3)
        self.quota.assert_awaited_once()
        self.assertEqual(self.quota.await_args.kwargs["max_rounds"], 2)

    async def test_ollama_and_gemini_keep_discussion_and_synthesis(self):
        await self.assert_discussion(["ollama", "gemini"], "gemini", self.gemini)

    async def test_ollama_and_groq_keep_discussion_and_synthesis(self):
        await self.assert_discussion(["groq", "ollama"], "groq", self.groq)

    async def test_cloud_only_keeps_discussion_and_synthesis(self):
        await self.assert_discussion(["gemini", "groq"], "gemini", self.gemini)

    async def test_single_cloud_models_are_rejected_before_quota(self):
        for provider in ("gemini", "groq", "openrouter"):
            with self.subTest(provider=provider):
                self.assertEqual((await self.submit([provider])).status_code, 400)
        self.quota.assert_not_awaited()

    async def test_unavailable_local_model_falls_back_and_records_actual_provider(self):
        self.ollama.return_value = None
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["final_answer"], "Gemini answer")
        self.ollama.assert_awaited_once()
        self.gemini.assert_awaited_once()
        self.groq.assert_not_awaited()
        self.assertEqual(self.turns[0]["requested_provider"], "ollama")
        self.assertEqual(self.turns[0]["actual_provider"], "gemini")
        self.assertEqual(self.turns[0]["model_id"], main.GEMINI_MODEL)

    async def test_exhausted_providers_pause_then_resume_as_individual_without_new_quota(self):
        self.ollama.return_value = None
        self.budget.return_value = {"allowed": False}
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "paused")
        self.retry.assert_awaited_once()
        self.assertEqual(self.turns, [])
        self.gemini.assert_not_awaited()
        self.ollama.return_value = "Recovered answer"

        recovered = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(recovered["final_answer"], "Recovered answer")
        self.assertEqual(len(self.turns), 1)
        self.assertEqual(self.ollama.await_count, 2)
        self.quota.assert_awaited_once()

    async def test_recovery_reuses_individual_checkpoint_without_inference(self):
        await self.create_task(
            user_id=USER_ID, task="Explain rate limits", selected_models=["ollama"],
            max_rounds=1, credential_mode="platform",
        )
        self.saved["status"] = "paused"
        await self.checkpoint(
            turn_number=1, round_number=1, requested_provider="ollama",
            actual_provider="groq", model_id=main.GROQ_MODEL, response="Saved answer",
        )
        result = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(result["final_answer"], "Saved answer")
        self.assertEqual(result["model_usage"][0]["provider"], "groq")
        self.assertEqual(len(self.turns), 1)
        self.ollama.assert_not_awaited()
        self.groq.assert_not_awaited()
        self.quota.assert_not_awaited()

    async def test_legacy_ollama_task_keeps_its_existing_round_configuration(self):
        await self.create_task(
            user_id=USER_ID, task="Explain rate limits", selected_models=["ollama"],
            max_rounds=2, credential_mode="platform",
        )
        self.saved["status"] = "paused"
        result = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(result["total_turns"], 2)
        self.assertEqual(result["synthesis_provider"], "ollama")
        self.assertEqual(self.ollama.await_count, 3)
        self.quota.assert_not_awaited()

    async def test_transient_completion_failure_schedules_recovery_of_checkpoint(self):
        async def fail_once(**kwargs):
            if self.release.await_count == 1:
                raise httpx.ReadTimeout("completion did not commit")
            return await self.release_task(**kwargs)

        self.release.side_effect = fail_once
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "paused")
        self.assertEqual(self.saved["status"], "paused")
        self.assertEqual(len(self.turns), 1)
        self.retry.assert_awaited_once()

        recovered = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(recovered["final_answer"], "Local answer")
        self.assertEqual(self.saved["status"], "completed")
        self.assertEqual(len(self.turns), 1)
        self.ollama.assert_awaited_once()
        self.quota.assert_awaited_once()
        self.assertEqual([call.kwargs["new_status"] for call in self.release.await_args_list],
                         ["completed", "completed"])

    async def test_ambiguous_completion_committed_before_response_was_lost(self):
        async def commit_then_lose_response(**kwargs):
            await self.release_task(**kwargs)
            raise ValueError("malformed completion response")

        self.release.side_effect = commit_then_lose_response
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["final_answer"], "Local answer")
        self.retry.assert_not_awaited()
        self.release.assert_awaited_once()
        stale_due = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(stale_due["status"], "completed")
        self.claim.assert_awaited_once()
        self.ollama.assert_awaited_once()
        self.quota.assert_awaited_once()

    async def test_unconfirmed_completion_and_scheduling_leave_lease_recoverable(self):
        async def fail_once(**kwargs):
            if self.release.await_count == 1:
                raise httpx.ReadTimeout("completion status unavailable")
            return await self.release_task(**kwargs)

        self.release.side_effect = fail_once
        self.retry.side_effect = httpx.ReadTimeout("retry schedule status unavailable")
        response = await self.submit(["ollama"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "running")
        self.assertEqual(self.saved["status"], "running")
        self.release.assert_awaited_once()

        # The expired-lease worker makes the saved task due again.
        self.saved["status"] = "paused"
        recovered = await main.resume_saved_collaboration(self.due_projection())
        self.assertEqual(recovered["final_answer"], "Local answer")
        self.assertEqual(len(self.turns), 1)
        self.ollama.assert_awaited_once()
        self.quota.assert_awaited_once()

    async def test_due_projection_does_not_authorize_personal_or_unowned_task(self):
        await self.create_task(
            user_id=USER_ID, task="Explain rate limits", selected_models=["ollama"],
            max_rounds=1, credential_mode="personal",
        )
        with self.assertRaises(ValueError):
            await main.resume_saved_collaboration(self.due_projection())
        self.saved["credential_mode"] = "platform"
        with self.assertRaises(ValueError):
            await main.resume_saved_collaboration({**self.due_projection(), "user_id": str(WORKER_ID)})
        self.claim.assert_not_awaited()

    async def test_quota_denial_prevents_claim_and_generation(self):
        self.quota.side_effect = None
        self.quota.return_value = {"allowed": False}
        self.assertEqual((await self.submit(["ollama"])).status_code, 429)
        self.claim.assert_not_awaited()
        self.ollama.assert_not_awaited()

    async def test_concurrent_identical_submission_cannot_charge_twice(self):
        entered = asyncio.Event()
        finish = asyncio.Event()

        async def local_answer(**kwargs):
            entered.set()
            await finish.wait()
            return "Local answer"

        self.ollama.side_effect = local_answer
        task = asyncio.create_task(self.submit(["ollama"]))
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            duplicate = await asyncio.wait_for(self.submit(["ollama"]), timeout=5)
            self.assertEqual(duplicate.status_code, 409)
        finally:
            finish.set()
            first = await asyncio.wait_for(task, timeout=5)
        self.assertEqual(first.status_code, 200, first.text)
        self.quota.assert_awaited_once()
        self.claim.assert_awaited_once()
