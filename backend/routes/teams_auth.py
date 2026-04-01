"""Teams context-based authentication endpoint."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings
from db.database import SessionLocal
from db.models import User

router = APIRouter(prefix="/api/auth")


class TeamsContextRequest(BaseModel):
    user_id: str
    display_name: str = ""
    upn: str = ""
    tenant_id: str = ""
    team: str = ""


class TeamsContextResponse(BaseModel):
    token: str
    user_id: str
    name: str
    email: str


@router.post("/teams-context", response_model=TeamsContextResponse)
def teams_context_auth(body: TeamsContextRequest):
    """Exchange Teams context for an app session token."""
    if not settings.APP_JWT_SECRET:
        raise HTTPException(status_code=503, detail="Teams auth not configured")

    if not body.user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if not body.team:
        raise HTTPException(status_code=400, detail="team is required")

    # Individual user identity for the User table
    local_user_id = f"teams:{body.user_id}"
    # Team-level identity used as document owner (all team members share documents)
    team_owner_id = f"team:{body.team}"
    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == local_user_id).first()
        if user:
            user.email = body.upn
            user.name = body.display_name
            user.last_login = now
            user.team_username = body.team or user.team_username
        else:
            user = User(
                id=local_user_id,
                provider="teams",
                provider_id=body.user_id,
                tenant_id=body.tenant_id,
                email=body.upn,
                name=body.display_name,
                team_username=body.team,
                created_at=now,
                last_login=now,
            )
            db.add(user)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # JWT sub = team owner ID so all team members see the same documents
    app_token = jwt.encode(
        {
            "sub": team_owner_id,
            "exp": now + timedelta(hours=8),
        },
        settings.APP_JWT_SECRET,
        algorithm="HS256",
    )

    return TeamsContextResponse(
        token=app_token,
        user_id=team_owner_id,
        name=body.display_name,
        email=body.upn,
    )
