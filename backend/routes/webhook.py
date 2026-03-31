"""Webhook ingestion — accepts files from Power Automate (Outlook, OneDrive, SharePoint)."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse

from config import settings
from db.database import SessionLocal
from db.models import Document
from pipeline.extract_fields import extract_fields_from_text
from pipeline.extract_text import extract_text_from_image, extract_text_from_pdf
from pipeline.schemas import ExtractionResult, InvoiceFields
from pipeline.validate import validate_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["webhook"])

MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/jpg"}
VALID_SOURCES = {"outlook", "onedrive", "sharepoint", "webhook"}

# Shared job store (imported from main at registration time)
_jobs: dict[str, dict[str, Any]] = {}


def set_jobs_store(jobs: dict):
    """Allow main.py to share its job store."""
    global _jobs
    _jobs = jobs


def _add_log(job_id: str, step: str, message: str, t0: float):
    entry = {"step": step, "message": message, "elapsed": round(time.time() - t0, 2)}
    _jobs[job_id]["logs"].append(entry)


def _update_doc(document_id: str | None, **kwargs):
    if not document_id:
        return
    try:
        db = SessionLocal()
        try:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                for k, v in kwargs.items():
                    setattr(doc, k, v)
                db.commit()
        except Exception as e:
            logger.error("Failed to update document: %s", e)
            db.rollback()
        finally:
            db.close()
    except Exception as e:
        logger.error("DB session error: %s", e)


async def _run_webhook_pipeline(
    job_id: str, file_bytes: bytes, filename: str, content_type: str,
    source: str, source_meta: dict, user_id: str | None = None,
):
    """Run extraction pipeline for webhook-ingested files."""
    job = _jobs[job_id]
    t0 = time.time()
    document_id = None

    try:
        # Save file
        doc_id = str(uuid.uuid4())
        safe_filename = f"{doc_id}_{filename}"
        file_path = os.path.join(settings.UPLOADS_DIR, safe_filename)
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        # Create DB record with source info
        db = SessionLocal()
        try:
            doc = Document(
                id=doc_id, filename=filename, file_size=len(file_bytes),
                content_type=content_type, status="processing",
                user_id=user_id,
                original_file_path=file_path, source=source,
                source_metadata=source_meta,
            )
            db.add(doc)
            db.commit()
            document_id = doc_id
        except Exception as e:
            logger.error("Failed to create document: %s", e)
            db.rollback()
        finally:
            db.close()

        _add_log(job_id, "start", f"Webhook [{source}] — {filename} ({len(file_bytes) / 1024:.1f} KB)", t0)

        # Text extraction
        _add_log(job_id, "text_extraction", "Extracting text...", t0)
        if content_type == "application/pdf":
            raw_text, pages = await asyncio.to_thread(extract_text_from_pdf, file_bytes)
        else:
            raw_text = await asyncio.to_thread(extract_text_from_image, file_bytes)
            pages = 1

        if not raw_text.strip():
            _update_doc(document_id, status="success", raw_text="", extracted_fields={}, confidence=0.0, warnings=["no_text_extracted"])
            _add_log(job_id, "done", "No text extracted", t0)
            job["status"] = "done"
            job["result"] = ExtractionResult(filename=filename, pages=pages, raw_text="", confidence=0.0, fields=InvoiceFields(), warnings=["no_text_extracted"]).model_dump()
            job["document_id"] = document_id
            return

        _add_log(job_id, "text_extraction", f"Extracted {len(raw_text)} chars, {pages} page(s)", t0)

        # Field extraction
        _add_log(job_id, "field_extraction", "Extracting fields...", t0)
        fields, confidence, meta = await asyncio.to_thread(extract_fields_from_text, raw_text, file_bytes, filename)
        _add_log(job_id, "field_extraction", f"Method: {meta.method} | Confidence: {confidence:.0%}", t0)

        # Validation
        warnings = await asyncio.to_thread(validate_fields, fields)

        # Duplicate check — same invoice_number + total for same owner
        is_duplicate = False
        if fields.invoice_number and fields.total is not None:
            db = SessionLocal()
            try:
                existing = db.query(Document).filter(
                    Document.user_id == user_id,
                    Document.id != document_id,
                    Document.extracted_fields["invoice_number"].as_string() == fields.invoice_number,
                    Document.extracted_fields["total"].as_string() == str(fields.total),
                ).first()
                is_duplicate = existing is not None
            finally:
                db.close()

        if is_duplicate:
            warnings.append("duplicate_invoice")

        # Save
        result = ExtractionResult(filename=filename, pages=pages, raw_text=raw_text, confidence=confidence, fields=fields, warnings=warnings)
        critical_missing = [w for w in warnings if w in ("missing_supplier", "missing_total")]
        doc_status = "partial" if critical_missing else "success"
        _update_doc(document_id, status=doc_status, raw_text=raw_text, extracted_fields=fields.model_dump(), confidence=confidence, warnings=warnings)

        total = round(time.time() - t0, 2)
        _add_log(job_id, "done", f"Complete in {total}s" + (" [DUPLICATE]" if is_duplicate else ""), t0)
        job["status"] = "done"
        job["result"] = result.model_dump()
        job["document_id"] = document_id

    except Exception as e:
        logger.error("Webhook pipeline error for job %s: %s", job_id, e)
        _add_log(job_id, "error", f"Error: {e}", t0)
        job["status"] = "error"
        job["error"] = str(e)
        _update_doc(document_id, status="error")


@router.post("/ingest")
async def webhook_ingest(
    file: UploadFile = File(...),
    source: str = Form("webhook"),
    team: str = Form(""),
    sender_email: str = Form(""),
    subject: str = Form(""),
    folder_path: str = Form(""),
    x_webhook_key: str = Header(None, alias="X-Webhook-Key"),
):
    """Accept a file from Power Automate or any external system."""
    # Auth
    if not settings.WEBHOOK_KEY:
        return JSONResponse(status_code=503, content={"detail": "Webhook not configured (WEBHOOK_KEY not set)"})
    if not x_webhook_key or x_webhook_key.strip() != settings.WEBHOOK_KEY.strip():
        logger.warning("Webhook auth failed. Received key: %r", x_webhook_key)
        return JSONResponse(status_code=401, content={"detail": "Invalid webhook key"})

    # Validate file
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES:
        return JSONResponse(status_code=400, content={"detail": f"Unsupported file type: {content_type}"})

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        return JSONResponse(status_code=400, content={"detail": "Empty file"})
    if len(file_bytes) > MAX_FILE_SIZE:
        return JSONResponse(status_code=400, content={"detail": "File exceeds 10 MB limit"})

    # Normalize source
    source = source.lower().strip()
    if source not in VALID_SOURCES:
        source = "webhook"

    filename = file.filename or "unknown"
    team_user_id = f"team:{team}" if team else None

    source_meta = {}
    if sender_email:
        source_meta["sender_email"] = sender_email
    if subject:
        source_meta["subject"] = subject
    if folder_path:
        source_meta["folder_path"] = folder_path

    # Start pipeline
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "logs": [], "result": None, "document_id": None, "error": None}
    asyncio.create_task(_run_webhook_pipeline(job_id, file_bytes, filename, content_type, source, source_meta, team_user_id))

    logger.info("Webhook ingest: %s from %s (%s)", filename, source, sender_email or "n/a")

    return JSONResponse(content={
        "document_id": None,  # assigned async
        "job_id": job_id,
        "status": "processing",
        "message": "Invoice queued for extraction",
    })
