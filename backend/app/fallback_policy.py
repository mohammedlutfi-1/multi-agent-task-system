
APPROVED_FREE_PROVIDERS = (
    "gemini",
    "groq",
    "openrouter",
)


def get_fallback_order(
    requested_provider: str,
    allow_fallback: bool = True,
) -> tuple[str, ...]:
    """
    Return approved provider order.

    This policy only selects providers.
    Actual API errors are handled by the caller.
    """

    if requested_provider not in APPROVED_FREE_PROVIDERS:
        raise ValueError("Provider is not approved")

    if not allow_fallback:
        return (requested_provider,)

    alternatives = tuple(
        provider
        for provider in APPROVED_FREE_PROVIDERS
        if provider != requested_provider
    )

    return (requested_provider,) + alternatives
