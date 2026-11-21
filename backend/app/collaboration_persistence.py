
from uuid import UUID

from app.database import save_collaboration_checkpoint


def create_checkpoint_callback(
    task_id: UUID,
    worker_id: UUID,
):
    """
    Create a callback that saves each AI discussion turn
    using the task's active worker lease.
    """

    async def checkpoint_callback(
        *,
        turn_number: int,
        round_number: int,
        requested_provider: str,
        actual_provider: str,
        model_id: str,
        response: str,
    ) -> None:
        await save_collaboration_checkpoint(
            task_id=str(task_id),
            worker_id=str(worker_id),
            turn_number=turn_number,
            round_number=round_number,
            requested_provider=requested_provider,
            actual_provider=actual_provider,
            model_id=model_id,
            response=response,
        )

    return checkpoint_callback
