
import os
from pathlib import Path

from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_PATH)


def get_cipher() -> Fernet:
    key = os.getenv("API_KEY_ENCRYPTION_KEY", "").strip()

    if not key:
        raise RuntimeError("API key encryption is not configured")

    try:
        return Fernet(key.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Invalid encryption configuration") from exc


def encrypt_api_key(api_key: str) -> str:
    if not api_key or not api_key.strip():
        raise ValueError("API key cannot be empty")

    cipher = get_cipher()

    return cipher.encrypt(
        api_key.strip().encode("utf-8")
    ).decode("utf-8")


def decrypt_api_key(encrypted_key: str) -> str:
    if not encrypted_key:
        raise ValueError("Encrypted API key cannot be empty")

    cipher = get_cipher()

    try:
        return cipher.decrypt(
            encrypted_key.encode("utf-8")
        ).decode("utf-8")

    except InvalidToken as exc:
        raise RuntimeError("Unable to decrypt API key") from exc
