import asyncio
import logging

from typing import Awaitable, Callable

from app.database import (
    get_due_collaboration_tasks,
    recover_expired_collaboration_tasks,
)

logger = logging.getLogger(__name__)

POLL_INTERVAL = 60


async def resume_worker(
    resume_task: Callable[..., Awaitable[dict]],
):
    """Check and resume eligible platform collaborations."""

    logger.info("Collaboration resume worker started")

    while True:
        try:
            recovered = await recover_expired_collaboration_tasks()

            if recovered:
                logger.info(
                    "Recovered %s interrupted tasks",
                    recovered,
                )

            tasks = await get_due_collaboration_tasks()

            for task in tasks:
                try:
                    await resume_task(task)

                except asyncio.CancelledError:
                    raise

                except Exception:
                    logger.warning(
                        "Could not resume task %s",
                        task["id"],
                    )

        except asyncio.CancelledError:
            raise

        except Exception:
            logger.warning(
                "Resume worker polling failed"
            )

        await asyncio.sleep(POLL_INTERVAL)