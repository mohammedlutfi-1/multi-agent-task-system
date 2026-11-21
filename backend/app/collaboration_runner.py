
import logging
from typing import Awaitable, Callable
from uuid import UUID, uuid4


from app.database import (
    claim_collaboration_task,
    get_collaboration_turns,
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
) -> dict:
    """
    Claim a task, execute collaboration with checkpoints,
    and stop the heartbeat during cleanup.

    Final synthesis and task release are not handled here yet.
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

        result = await execute_collaboration(

            saved_turns=saved_turns,
            task=task,
            model_ids=model_ids,
            ai_caller=ai_caller,
            max_rounds=max_rounds,
            checkpoint_callback=guarded_checkpoint,
        )


        heartbeat.ensure_active()

        synthesis = await synthesize_collaboration(
            task=task,
            discussion=result["discussion"],
            ai_caller=ai_caller,
            provider=(
                "gemini" if "gemini" in model_ids
                else model_ids[0]
            ),
        )

        heartbeat.ensure_active()

        released = await release_collaboration_task(
            task_id=str(task_id),
            worker_id=str(worker_id),
            new_status="completed",
            final_answer=synthesis["final_answer"],
        )

        if released is not True:
            raise RuntimeError(
                "Cannot complete collaboration: "
                "worker lease is invalid or task was not released"
            )

        result.update(synthesis)

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
