"""Clerk JWT authentication dependencies for FastAPI."""

from __future__ import annotations

import logging

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from config import settings

logger = logging.getLogger(__name__)

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    """Lazily initialize the JWKS client."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client

    if not settings.CLERK_SECRET_KEY:
        return None

    jwks_url = settings.CLERK_JWKS_URL
    if not jwks_url:
        logger.warning(
            "CLERK_SECRET_KEY is set but CLERK_JWKS_URL is not. "
            "Auth will be disabled until CLERK_JWKS_URL is configured."
        )
        return None

    _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def get_optional_user(request: Request) -> str | None:
    """Return the authenticated user ID or None.

    If CLERK_SECRET_KEY is not configured, auth is disabled and None is returned.
    If the token is missing or invalid, None is returned (no error).
    """
    if not settings.CLERK_SECRET_KEY:
        return None

    client = _get_jwks_client()
    if client is None:
        return None

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        user_id = payload.get("sub")
        return user_id
    except Exception as e:
        logger.debug("JWT verification failed: %s", e)
        return None


def get_required_user(user_id: str | None = Depends(get_optional_user)) -> str | None:
    """Require an authenticated user when Clerk is configured.

    When CLERK_SECRET_KEY is not set, auth is disabled and None is returned
    (open access). When Clerk IS configured, raises 401 if not authenticated.
    """
    if not settings.CLERK_SECRET_KEY:
        return None  # Auth disabled — open access
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id
