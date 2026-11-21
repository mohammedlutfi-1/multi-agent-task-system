
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPolicy:
    provider: str
    model_id: str
    approved: bool = True


APPROVED_MODELS = {
    "gemini": ModelPolicy(
        provider="gemini",
        model_id="gemini-3.5-flash-lite",
    ),
    "groq": ModelPolicy(
        provider="groq",
        model_id="openai/gpt-oss-20b",
    ),
    "openrouter": ModelPolicy(
        provider="openrouter",
        model_id="inclusionai/ling-3.2-flash:free",
    ),
}


def validate_model(
    provider: str,
    model_id: str,
) -> bool:
    policy = APPROVED_MODELS.get(provider)

    if policy is None:
        raise ValueError(
            f"Provider '{provider}' is not approved"
        )

    if not policy.approved:
        raise ValueError(
            f"Provider '{provider}' is disabled"
        )

    if model_id != policy.model_id:
        raise ValueError(
            f"Model '{model_id}' is not approved "
            f"for provider '{provider}'"
        )

    return True
