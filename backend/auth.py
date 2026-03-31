"""JWT authentication dependencies for FastAPI — supports Clerk and Teams app tokens."""

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


def _auth_configured() -> bool:
    """Return True if any auth provider is configured."""
    return bool(settings.CLERK_SECRET_KEY) or bool(settings.APP_JWT_SECRET)


def get_optional_user(request: Request) -> str | None:
    """Return the authenticated user ID or None.

    Tries Clerk JWKS (RS256) first, then app JWT (HS256) for Teams sessions.
    If no auth provider is configured, returns None (open access).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    # Try Clerk first (RS256 via JWKS)
    if settings.CLERK_SECRET_KEY:
        client = _get_jwks_client()
        if client:
            try:
                signing_key = client.get_signing_key_from_jwt(token)
                payload = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    options={"verify_aud": False},
                )
                return payload.get("sub")
            except Exception:
                pass  # Fall through to app JWT

    # Try app JWT (HS256 — Teams sessions)
    if settings.APP_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                settings.APP_JWT_SECRET,
                algorithms=["HS256"],
            )
            return payload.get("sub")
        except Exception:
            pass

    return None


def get_required_user(user_id: str | None = Depends(get_optional_user)) -> str | None:
    """Require an authenticated user when any auth provider is configured.

    When no auth provider is configured, returns None (open access).
    When auth IS configured, raises 401 if not authenticated.
    """
    if not _auth_configured():
        return None  # Auth disabled — open access
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id
