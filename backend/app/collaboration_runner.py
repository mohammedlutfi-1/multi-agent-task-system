
import logging
from typing import Awaitable, Callable
from uuid import UUID, uuid4

import httpx

from app.database import (
    claim_collaboration_task,
    get_collaboration_turns,
    get_user_collaboration_task,
    release_collaboration_task,
    schedule_collaboration_retry,
)

from app.provider_errors import ProviderCapacityError

from app.worker_heartbeat import WorkerHeartbeat
from app.collaboration import (
    execute_collaboration,
    synthesize_collaboration,
)
from app.collaboration_persistence import create_checkpoint_callback

logger = logging.getLogger(__name__)

class CollaborationClaimError(Exception):
    """Raised when a collaboration task cannot be claimed."""


async def run_individual_ollama(task, saved_turns, ai_caller, checkpoint):
    """Reuse a durable answer if recovery starts after its checkpoint."""
    if saved_turns:
        if len(saved_turns) != 1:
            raise ValueError("Individual task has more than one saved response.")
        answer_turn = saved_turns[0]
        if (
            answer_turn.get("turn_number") != 1
            or answer_turn.get("round_number") != 1
            or answer_turn.get("requested_provider") != "ollama"
        ):
            raise ValueError("Invalid individual response checkpoint.")
        answer = answer_turn.get("response")
        provider = answer_turn.get("actual_provider")
        model = answer_turn.get("model_id")
    else:
        response = await ai_caller(
            messages=[{"role": "user", "content": task}],
            provider_order=("ollama",),
        )
        answer = response.get("answer")
        provider = response.get("provider")
        model = response.get("model")

    if any(not isinstance(value, str) or not value.strip() for value in (answer, provider, model)):
        raise ValueError("Individual response is missing its answer or model metadata.")

    if not saved_turns:
        await checkpoint(
            turn_number=1, round_number=1, requested_provider="ollama",
            actual_provider=provider, model_id=model, response=answer.strip(),
        )

    return {
        "status": "completed",
        "task": task,
        "total_turns": 1,
        "discussion": [{"turn": 1, "round": 1, "model": "ollama", "response": answer.strip()}],
        "model_usage": [{"turn": 1, "requested_provider": "ollama", "provider": provider, "model": model}],
        "final_answer": answer.strip(),
    }


async def claim_task_for_execution(
    task_id: UUID,
    lease_seconds: int = 120,
) -> UUID:
    """
    Claim a collaboration task before execution.

    Returns the worker ID if the database confirms
    that this worker owns the task.
    """

    worker_id = uuid4()

    claimed = await claim_collaboration_task(
        task_id=str(task_id),
        worker_id=str(worker_id),
        lease_seconds=lease_seconds,
    )

    if claimed is not True:
        raise CollaborationClaimError(
            "Task cannot be claimed. "
            "It may already be running or completed."
        )

    return worker_id


async def start_collaboration_worker(
    task_id: UUID,
    lease_seconds: int = 120,
) -> tuple[UUID, WorkerHeartbeat]:
    """
    Claim a collaboration task and start its lease heartbeat.

    Returns the worker ID and active heartbeat.
    The caller must stop the heartbeat in a finally block.
    """

    worker_id = await claim_task_for_execution(
        task_id=task_id,
        lease_seconds=lease_seconds,
    )

    heartbeat = WorkerHeartbeat(
        task_id=str(task_id),
        worker_id=str(worker_id),
        lease_seconds=lease_seconds,
        renewal_interval=30,
    )


    await heartbeat.start()


    return worker_id, heartbeat


async def run_claimed_collaboration(
    task_id: UUID,
    task: str,
    model_ids: list[str],
    ai_caller: Callable[..., Awaitable[dict]],
    max_rounds: int = 2,
    recovery_user_id: str | None = None,
) -> dict:
    """
    Claim and complete a task using its saved model selection and checkpoints.
    """

    worker_id, heartbeat = await start_collaboration_worker(
        task_id=task_id,
        lease_seconds=120,
    )

    try:
        checkpoint_callback = create_checkpoint_callback(
            task_id=task_id,
            worker_id=worker_id,
        )

        heartbeat.ensure_active()

        saved_turns = await get_collaboration_turns(
            task_id=str(task_id),
        )

        heartbeat.ensure_active()


        async def guarded_checkpoint(**kwargs):
            heartbeat.ensure_active()

            await checkpoint_callback(**kwargs)

            heartbeat.ensure_active()

        # Older single-model rows used two rounds before individual execution
        # was introduced. Recovery already has the original round count.
        individual = model_ids == ["ollama"] and max_rounds == 1
        if individual:
            result = await run_individual_ollama(task, saved_turns, ai_caller, guarded_checkpoint)
        else:
            result = await execute_collaboration(
                saved_turns=saved_turns,
                task=task,
                model_ids=model_ids,
                ai_caller=ai_caller,
                max_rounds=max_rounds,
                checkpoint_callback=guarded_checkpoint,
            )
            heartbeat.ensure_active()
            result.update(await synthesize_collaboration(
                task=task,
                discussion=result["discussion"],
                ai_caller=ai_caller,
                provider="gemini" if "gemini" in model_ids else model_ids[0],
            ))

        heartbeat.ensure_active()

        try:
            released = await release_collaboration_task(
                task_id=str(task_id),
                worker_id=str(worker_id),
                new_status="completed",
                final_answer=result["final_answer"],
            )
        except (httpx.HTTPError, RuntimeError, ValueError) as exc:
            if not (individual and recovery_user_id):
                raise
            if isinstance(exc, httpx.HTTPStatusError):
                status = exc.response.status_code
                if status < 500 and status not in (408, 429):
                    raise
            released = False

        if released is not True and individual and recovery_user_id:
            return await reconcile_individual_completion(
                task_id=str(task_id),
                worker_id=str(worker_id),
                user_id=recovery_user_id,
                result=result,
            )

        if released is not True:
            raise RuntimeError(
                "Cannot complete collaboration: "
                "worker lease is invalid or task was not released"
            )

        return result

    except Exception as exc:
        await heartbeat.stop()

        if not heartbeat.lease_lost:
            try:
                scheduled = False

                if isinstance(exc, ProviderCapacityError):
                    scheduled = await schedule_collaboration_retry(
                        task_id=str(task_id),
                        worker_id=str(worker_id),
                    )

                if scheduled:
                    return {
                        "status": "paused",
                        "task_id": str(task_id),
                        "message": "Task saved and waiting for capacity.",
                    }

                temporary = isinstance(
                    exc, ProviderCapacityError
                )

                released = await release_collaboration_task(
                    task_id=str(task_id),
                    worker_id=str(worker_id),
                    new_status="paused" if temporary else "failed",
                    error_message=(
                        None if temporary
                        else "Collaboration could not be completed."
                    ),
                )

                if not released:
                    logger.warning(
                        "Could not release collaboration task %s",
                        task_id,
                    )

                elif temporary:
                    return {
                        "status": "paused",
                        "task_id": str(task_id),
                        "message": (
                            "Task saved. No automatic retry is scheduled."
                        ),
                    }

            except Exception:
                logger.error(
                    "Failed to update collaboration task %s",
                    task_id,
                )

        raise

    finally:
        await heartbeat.stop()


async def reconcile_individual_completion(*, task_id, worker_id, user_id, result):
    """Preserve the durable checkpoint while resolving a failed release."""
    status = "running"
    try:
        saved = await get_user_collaboration_task(user_id=user_id, task_id=task_id)
        if saved is not None:
            status = saved.get("status") or "running"
            if status == "completed" and saved.get("final_answer"):
                return {**result, "final_answer": saved["final_answer"]}
            if (
                status == "running"
                and saved.get("credential_mode") == "platform"
                and saved.get("auto_resume_enabled") is True
                and await schedule_collaboration_retry(task_id=task_id, worker_id=worker_id)
            ):
                status = "paused"
    except (httpx.HTTPError, RuntimeError, ValueError):
        logger.warning("Could not reconcile completion for collaboration task %s", task_id)

    # If scheduling cannot be confirmed, leave the row for the lease recovery
    # worker. A failed status write here would make the checkpoint unreachable.
    return {**result, "status": status, "task_id": task_id}
