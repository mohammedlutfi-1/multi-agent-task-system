
import json
import re

from pydantic import BaseModel, Field, ValidationError


ALLOWED_AGENTS = {
    "research",
    "coding",
    "analysis",
    "document",
    "reviewer",
}


class Subtask(BaseModel):
    id: str
    agent: str
    description: str
    depends_on: list[str] = Field(default_factory=list)


class TaskPlan(BaseModel):
    objective: str
    subtasks: list[Subtask]


def validate_task_plan(plan: TaskPlan) -> TaskPlan:
    if not 1 <= len(plan.subtasks) <= 8:
        raise ValueError("A plan must contain 1 to 8 subtasks")

    seen_ids = set()

    for subtask in plan.subtasks:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", subtask.id):
            raise ValueError("Invalid subtask ID")

        if subtask.agent not in ALLOWED_AGENTS:
            raise ValueError(f"Unknown agent: {subtask.agent}")

        if not subtask.description.strip():
            raise ValueError("Subtask description cannot be empty")

        if subtask.id in seen_ids:
            raise ValueError("Duplicate subtask ID")

        if len(set(subtask.depends_on)) != len(subtask.depends_on):
            raise ValueError("Duplicate dependencies")

        if any(dep not in seen_ids for dep in subtask.depends_on):
            raise ValueError(
                "Dependencies must refer to earlier subtasks"
            )

        seen_ids.add(subtask.id)

    return plan


def parse_task_plan(response: str) -> TaskPlan:
    text = response.strip()

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
        plan = TaskPlan.model_validate(data)
        return validate_task_plan(plan)
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise ValueError(
            "AI returned an invalid task plan"
        ) from exc


async def create_task_plan(task: str, ai_caller) -> TaskPlan:
    if not task.strip():
        raise ValueError("Task cannot be empty")

    prompt = (
        "You are the coordinator of a Multi-Agent Task System. "
        "Divide the user's request into meaningful subtasks. "
        "Use only these agents: research, coding, analysis, document, reviewer. "
        "Return ONLY a JSON object with this structure: "
        '{"objective":"...","subtasks":['
        '{"id":"task_1","agent":"analysis",'
        '"description":"...","depends_on":[]},'
        '{"id":"task_2","agent":"document",'
        '"description":"...","depends_on":["task_1"]}'
        "]}. "
        "Create between 1 and 8 subtasks. "
        "Each ID must be unique. "
        "Dependencies must refer only to earlier subtasks. "
        "Assign agents according to actual task requirements. "
        "Do not invent unnecessary work. "
        "For tasks that produce a substantive answer, code, analysis, or document, "
        "include a reviewer subtask as the final subtask. "
        "The reviewer must depend on all earlier subtasks whose outputs "
        "are necessary to evaluate the final result. "
        "The reviewer must check accuracy, completeness, logical consistency, "
        "and unsupported claims. "
        "Do not create more than one reviewer subtask."
    )

    result = await ai_caller([
        {"role": "system", "content": prompt},
        {"role": "user", "content": task},
    ])

    return parse_task_plan(result["answer"])
