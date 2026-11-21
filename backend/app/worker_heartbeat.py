
import asyncio
import logging

from backend.app.database import renew_collaboration_lease


logger = logging.getLogger(__name__)


class WorkerLeaseLost(Exception):
    """Raised when a worker loses its task lease."""


class WorkerHeartbeat:
    def __init__(
        self,
        task_id: str,
        worker_id: str,
        lease_seconds: int = 120,
        renewal_interval: int = 30,
    ):
        if not 30 <= lease_seconds <= 600:
            raise ValueError("Invalid lease duration")

        if not 0 < renewal_interval < lease_seconds:
            raise ValueError("Invalid renewal interval")

        self.task_id = task_id
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds
        self.renewal_interval = renewal_interval

        self._task = None
        self._lost = False
        self._stop_event = asyncio.Event()

    @property
    def lease_lost(self) -> bool:
        return self._lost

    async def _run(self):
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.renewal_interval,
                )
                break
            except asyncio.TimeoutError:
                pass

            try:
                renewed = await renew_collaboration_lease(
                    task_id=self.task_id,
                    worker_id=self.worker_id,
                    lease_seconds=self.lease_seconds,
                )

                if not renewed:
                    self._lost = True
                    logger.error(
                        "Worker lease lost for task %s",
                        self.task_id,
                    )
                    return

            except Exception:
                self._lost = True
                logger.exception(
                    "Worker lease renewal failed for task %s",
                    self.task_id,
                )
                return

    async def start(self):
        if self._task is not None:
            raise RuntimeError("Heartbeat already started")

        self._task = asyncio.create_task(self._run())

    def ensure_active(self):
        if self._lost:
            raise WorkerLeaseLost(
                f"Worker lease lost for task {self.task_id}"
            )

    async def stop(self):
        self._stop_event.set()

        if self._task is not None:
            await self._task
            self._task = None
