import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import ollama_queue_dispatcher as dispatcher


class OllamaQueueTests(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.messages = [
            {"role": "user", "content": "Explain AI briefly."}
        ]

    async def test_completed_job_returns_ollama_answer(self):
        with (
            patch.object(
                dispatcher,
                "create_ollama_inference_job",
                new_callable=AsyncMock,
                return_value="job-1",
            ),
            patch.object(
                dispatcher,
                "get_ollama_inference_job",
                new_callable=AsyncMock,
                return_value={
                    "status": "completed",
                    "result_text": "Ollama response",
                },
            ),
            patch.object(
                dispatcher,
                "_schedule_ollama_cancellation",
            ) as cancel,
            patch.object(dispatcher, "OLLAMA_POLL_SECONDS", 0.001),
        ):
            result = await dispatcher.call_ollama_via_queue(
                self.messages
            )
            self.assertEqual(result, "Ollama response")
            cancel.assert_not_called()

    async def test_failed_job_uses_fallback(self):
        with (
            patch.object(
                dispatcher,
                "create_ollama_inference_job",
                new_callable=AsyncMock,
                return_value="job-2",
            ),
            patch.object(
                dispatcher,
                "get_ollama_inference_job",
                new_callable=AsyncMock,
                return_value={"status": "failed"},
            ),
            patch.object(
                dispatcher,
                "_schedule_ollama_cancellation",
            ) as cancel,
            patch.object(dispatcher, "OLLAMA_POLL_SECONDS", 0.001),
        ):
            result = await dispatcher.call_ollama_via_queue(
                self.messages
            )
            self.assertIsNone(result)
            cancel.assert_called_once_with("job-2")

    async def test_pending_job_times_out_quickly(self):
        with (
            patch.object(
                dispatcher,
                "create_ollama_inference_job",
                new_callable=AsyncMock,
                return_value="job-3",
            ),
            patch.object(
                dispatcher,
                "get_ollama_inference_job",
                new_callable=AsyncMock,
                return_value={"status": "pending"},
            ),
            patch.object(
                dispatcher,
                "_schedule_ollama_cancellation",
            ) as cancel,
            patch.object(dispatcher, "OLLAMA_CLAIM_SECONDS", 0.03),
            patch.object(dispatcher, "OLLAMA_WAIT_SECONDS", 0.2),
            patch.object(dispatcher, "OLLAMA_POLL_SECONDS", 0.005),
        ):
            result = await dispatcher.call_ollama_via_queue(
                self.messages
            )
            self.assertIsNone(result)
            cancel.assert_called_once_with("job-3")

    async def test_processing_job_can_finish_after_claim_deadline(self):
        calls = 0

        async def job_status(_):
            nonlocal calls
            calls += 1
            if calls < 10:
                return {"status": "processing"}
            return {
                "status": "completed",
                "result_text": "Finished by Ollama",
            }

        with (
            patch.object(
                dispatcher,
                "create_ollama_inference_job",
                new_callable=AsyncMock,
                return_value="job-4",
            ),
            patch.object(
                dispatcher,
                "get_ollama_inference_job",
                side_effect=job_status,
            ),
            patch.object(
                dispatcher,
                "_schedule_ollama_cancellation",
            ) as cancel,
            patch.object(dispatcher, "OLLAMA_CLAIM_SECONDS", 0.01),
            patch.object(dispatcher, "OLLAMA_WAIT_SECONDS", 0.2),
            patch.object(dispatcher, "OLLAMA_POLL_SECONDS", 0.005),
        ):
            result = await dispatcher.call_ollama_via_queue(
                self.messages
            )
            self.assertEqual(result, "Finished by Ollama")
            cancel.assert_not_called()


if __name__ == "__main__":
    unittest.main()
