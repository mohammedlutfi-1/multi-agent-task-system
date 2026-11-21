
import re
from typing import Callable, Awaitable

from app.task_coordinator import TaskPlan, validate_task_plan


async def execute_task_plan(
    plan: TaskPlan,
    agent_runner: Callable[..., Awaitable[dict]],
) -> dict:
    validate_task_plan(plan)

    results = {}
    execution_log = []
    model_usage = {}
    review_status = "not_reviewed"

    for subtask in plan.subtasks:
        try:
            dependencies = {
                dep_id: results[dep_id]
                for dep_id in subtask.depends_on
            }

            execution_log.append({
                "task_id": subtask.id,
                "agent": subtask.agent,
                "status": "running",
            })

            response = await agent_runner(
                agent=subtask.agent,
                description=subtask.description,
                dependencies=dependencies,
            )

            if not isinstance(response, dict):
                raise ValueError(
                    "Agent returned an invalid response"
                )

            answer = response.get("answer")

            if not isinstance(answer, str) or not answer.strip():
                raise ValueError(
                    "AI agent returned an empty answer"
                )

            answer = answer.strip()
            results[subtask.id] = answer

            # Track the reviewer's verdict.
            if subtask.agent == "reviewer":
                verdict_match = re.search(
                    r"\bVerdict\b\*{0,2}\s*:\s*\*{0,2}\s*(PASS|NEEDS_REVISION)\b",
                    answer,
                    flags=re.IGNORECASE,
                )

                if verdict_match:
                    review_status = verdict_match.group(1).upper()
                else:
                    review_status = "unknown"

            # Record the provider and model used.
            model_usage[subtask.id] = {
                "agent": subtask.agent,
                "provider": response.get("provider"),
                "model": response.get("model"),
            }

            # Record successful execution.
            execution_log.append({
                "task_id": subtask.id,
                "agent": subtask.agent,
                "status": "completed",
                "provider": response.get("provider"),
                "model": response.get("model"),
            })

        except Exception as exc:
            execution_log.append({
                "task_id": subtask.id,
                "agent": subtask.agent,
                "status": "failed",
                "error": str(exc),
            })

            return {
                "status": "failed",
                "review_status": review_status,
                "results": results,
                "model_usage": model_usage,
                "execution_log": execution_log,
            }

    return {
        "status": "completed",
        "review_status": review_status,
        "results": results,
        "model_usage": model_usage,
        "execution_log": execution_log,
    }
