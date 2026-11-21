
import os

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

security = HTTPBearer(auto_error=False)


def get_supabase_url():
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return url


def verify_user(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    token = credentials.credentials
    supabase_url = get_supabase_url()

    try:
        jwks_client = PyJWKClient(
            f"{supabase_url}/auth/v1/.well-known/jwks.json"
        )
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=f"{supabase_url}/auth/v1",
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )

        if not isinstance(payload.get("sub"), str) or not payload["sub"]:
            raise jwt.InvalidTokenError("Missing user ID")

        return payload

    except jwt.PyJWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token",
        )
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Authentication verification unavailable",
        )
