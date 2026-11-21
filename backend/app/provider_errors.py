
from fastapi import HTTPException

class ProviderCapacityError(HTTPException):
    """Raised when configured AI providers are temporarily unavailable."""

    def __init__(self):
        super().__init__(
            status_code=503,
            detail="Configured AI providers are temporarily unavailable.",
        )

RETRYABLE_STATUS_CODES = {
    408,  # Request timeout
    429,  # Rate limit
    500,  # Server error
    502,  # Bad gateway
    503,  # Service unavailable
    504,  # Gateway timeout
}


def is_retryable_provider_error(
    error: Exception,
) -> bool:
    """
    Determine whether a provider failure is
    eligible for fallback.
    """

    if isinstance(error, HTTPException):
        return (
            error.status_code
            in RETRYABLE_STATUS_CODES
        )

    return False
