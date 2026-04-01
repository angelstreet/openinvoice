import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String, Text

from db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String(100), primary_key=True)
    provider = Column(String(20), nullable=False)
    provider_id = Column(String(100), nullable=False)
    tenant_id = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True)
    name = Column(String(255), nullable=True)
    team_username = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(50), nullable=True)
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    status = Column(String(20), default="processing")
    confidence = Column(Float, nullable=True)
    raw_text = Column(Text, nullable=True)
    extracted_fields = Column(JSON, nullable=True)
    warnings = Column(JSON, nullable=True)
    user_id = Column(String(100), nullable=True)
    original_file_path = Column(String, nullable=True)
    source = Column(String(20), default="upload")  # upload, outlook, onedrive, sharepoint, webhook
    source_metadata = Column(JSON, nullable=True)   # sender_email, subject, folder_path, etc.
    pipeline_meta = Column(JSON, nullable=True)      # method, steps, durations, tokens
    corrected_fields = Column(JSON, nullable=True)   # user-edited field overrides
    human_feedback = Column(JSON, nullable=True)     # {verdict, comment, submitted_at}
    ai_feedback = Column(JSON, nullable=True)        # {verdict, comment, generated_at}
