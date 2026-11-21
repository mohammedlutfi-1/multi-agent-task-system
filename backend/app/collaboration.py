
from typing import Awaitable, Callable

from app.turn_scheduler import create_collaboration_schedule
from app.fallback_policy import get_fallback_order



async def execute_collaboration(
    task: str,
    model_ids: list[str],
    ai_caller: Callable[..., Awaitable[dict]],
    max_rounds: int = 2,
    checkpoint_callback: Callable[..., Awaitable[None]] | None = None,
    saved_turns: list[dict] | None = None,
) -> dict:


    if not isinstance(task, str) or not task.strip():
        raise ValueError("Task cannot be empty")

    schedule = create_collaboration_schedule(
        model_ids=model_ids,
        max_rounds=max_rounds,
    )


    saved_turns = saved_turns or []

    if len(saved_turns) > len(schedule):
        raise ValueError("Saved turns exceed scheduled turns")

    discussion = []
    model_usage = []

    for index, saved in enumerate(saved_turns):
        expected = schedule[index]


        if not isinstance(saved, dict):
            raise ValueError("Saved checkpoint must be a dictionary")

        required_fields = (
            "turn_number",
            "round_number",
            "requested_provider",
            "actual_provider",
            "model_id",
            "response",
        )

        missing_fields = [
            field for field in required_fields
            if field not in saved
        ]

        if missing_fields:
            raise ValueError(
                "Saved checkpoint is missing required fields: "
                + ", ".join(missing_fields)
            )

        if (
            type(saved["turn_number"]) is not int
            or type(saved["round_number"]) is not int
        ):
            raise ValueError("Saved checkpoint has invalid turn metadata")

        for field in (
            "requested_provider",
            "actual_provider",
            "model_id",
            "response",
        ):
            value = saved[field]

            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"Saved checkpoint has invalid {field}"
                )

        if saved["turn_number"] != expected.turn_number:
            raise ValueError("Saved turn number does not match schedule")

        if saved["round_number"] != expected.round_number:
            raise ValueError("Saved round number does not match schedule")

        if saved["requested_provider"] != expected.model_id:
            raise ValueError("Saved provider does not match schedule")

        answer = saved["response"]

        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Saved response is invalid")

        discussion.append({
            "turn": expected.turn_number,
            "round": expected.round_number,
            "model": expected.model_id,
            "response": answer.strip(),
        })

        model_usage.append({
            "turn": expected.turn_number,
            "requested_provider": expected.model_id,
            "provider": saved["actual_provider"],
            "model": saved["model_id"],
        })

    for turn in schedule[len(saved_turns):]:

        previous_contributions = "\n\n".join(
            f"Round {item['round']} - {item['model']}:\n"
            f"{item['response']}"
            for item in discussion
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are participating in a multi-model "
                    "AI collaboration. Analyze the task, "
                    "consider previous model contributions, "
                    "identify errors or disagreements, "
                    "and improve the proposed solution. "
                    "Do not blindly agree with other models."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Original task:\n{task}\n\n"
                    f"Previous model contributions:\n"
                    f"{previous_contributions or 'None yet.'}\n\n"
                    f"Current round: {turn.round_number}\n"
                    "Provide your contribution."
                ),
            },
        ]

        response = await ai_caller(
            messages=messages,
            provider_order=get_fallback_order(turn.model_id)
        )

        if not isinstance(response, dict):
            raise ValueError("Invalid AI response")

        answer = response.get("answer")

        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("AI returned an empty response")


        if checkpoint_callback is not None:
            actual_provider = response.get("provider")
            actual_model = response.get("model")

            if (
                not isinstance(actual_provider, str)
                or not actual_provider.strip()
                or not isinstance(actual_model, str)
                or not actual_model.strip()
            ):
                raise ValueError(
                    "Cannot save checkpoint: missing provider or model"
                )

            await checkpoint_callback(
                turn_number=turn.turn_number,
                round_number=turn.round_number,
                requested_provider=turn.model_id,
                actual_provider=actual_provider,
                model_id=actual_model,
                response=answer.strip(),
            )

        discussion.append({
            "turn": turn.turn_number,
            "round": turn.round_number,
            "model": turn.model_id,
            "response": answer.strip(),
        })

        model_usage.append({
            "turn": turn.turn_number,
            "requested_provider": turn.model_id,
            "provider": response.get("provider"),
            "model": response.get("model"),
        })

    return {
        "status": "completed",
        "task": task,
        "total_turns": len(discussion),
        "discussion": discussion,
        "model_usage": model_usage,
    }


async def synthesize_collaboration(
    task: str,
    discussion: list[dict],
    ai_caller,
    provider: str = "gemini",
) -> dict:
    """Create a final answer from the completed AI discussion."""

    if not discussion:
        raise ValueError("Cannot synthesize an empty discussion")

    contributions = "\n\n".join(
        f"Round {item['round']} - {item['model']}:\n"
        f"{item['response']}"
        for item in discussion
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are the final synthesis agent in a "
                "multi-model AI collaboration system. "
                "Examine all contributions critically. "
                "Identify disagreements, reject unsupported "
                "claims, and combine the strongest ideas. "
                "Produce one accurate, practical, complete answer. "
                "Do not simply copy the last model's response."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Original task:\n{task}\n\n"
                f"AI discussion:\n{contributions}\n\n"
                "Produce the final consolidated answer."
            ),
        },
    ]

    result = await ai_caller(
        messages=messages,
        provider_order=get_fallback_order(provider),
    )

    answer = result.get("answer")

    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("Final synthesis returned an empty answer")

    return {
        "final_answer": answer.strip(),
        "synthesis_provider": result.get("provider"),
        "synthesis_model": result.get("model"),
    }
