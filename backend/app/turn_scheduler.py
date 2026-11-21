
from dataclasses import dataclass


MAX_MODELS = 4
MAX_ROUNDS = 3


@dataclass(frozen=True)
class CollaborationTurn:
    round_number: int
    model_id: str
    turn_number: int


def create_collaboration_schedule(
    model_ids: list[str],
    max_rounds: int = MAX_ROUNDS,
) -> list[CollaborationTurn]:

    if not model_ids:
        raise ValueError("At least one model is required")

    if len(model_ids) > MAX_MODELS:
        raise ValueError("Maximum 4 models allowed")

    if len(set(model_ids)) != len(model_ids):
        raise ValueError("Duplicate models are not allowed")

    if not 1 <= max_rounds <= MAX_ROUNDS:
        raise ValueError("Rounds must be between 1 and 3")

    schedule = []
    turn_number = 0

    for round_number in range(1, max_rounds + 1):
        for model_id in model_ids:
            turn_number += 1

            schedule.append(
                CollaborationTurn(
                    round_number=round_number,
                    model_id=model_id,
                    turn_number=turn_number,
                )
            )

    return schedule
