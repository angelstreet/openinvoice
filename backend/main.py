"""FastAPI app — invoice extraction with polling-based progress."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import get_optional_user
from config import settings
from db.base import Base
from db.database import SessionLocal, engine
from db.models import Document
from pipeline.extract_fields import extract_fields_from_text, _templates
from pipeline.extract_text import extract_text_from_image, extract_text_from_pdf
from pipeline.schemas import ExtractionResult, InvoiceFields
from pipeline.validate import validate_fields
from routes.dashboard import router as dashboard_router
from routes.documents import router as documents_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OpenInvoice API", version="0.3.0")

# CORS — origins from config
cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(documents_router)
app.include_router(dashboard_router)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
}

# In-memory job store for progress tracking
_jobs: dict[str, dict[str, Any]] = {}


@app.on_event("startup")
def on_startup():
    """Auto-create database tables and uploads directory on startup."""
    Base.metadata.create_all(bind=engine)
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    logger.info("Database tables created, uploads dir: %s", settings.UPLOADS_DIR)


def _add_log(job_id: str, step: str, message: str, t0: float):
    """Append a log entry to a job."""
    entry = {"step": step, "message": message, "elapsed": round(time.time() - t0, 2)}
    _jobs[job_id]["logs"].append(entry)


async def _run_pipeline(job_id: str, file_bytes: bytes, filename: str, content_type: str, current_user_id: str | None):
    """Run extraction pipeline in background, updating job progress."""
    job = _jobs[job_id]
    t0 = time.time()
    file_size = len(file_bytes)
    file_size_kb = round(file_size / 1024, 1)
    document_id = None

    try:
        # -- Save file to disk and create DB record --
        doc_id = str(uuid.uuid4())
        safe_filename = f"{doc_id}_{filename}"
        file_path = os.path.join(settings.UPLOADS_DIR, safe_filename)
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        db = SessionLocal()
        try:
            doc = Document(
                id=doc_id,
                filename=filename,
                file_size=file_size,
                content_type=content_type,
                status="processing",
                user_id=current_user_id,
                original_file_path=file_path,
            )
            db.add(doc)
            db.commit()
            document_id = doc_id
        except Exception as e:
            logger.error("Failed to create document record: %s", e)
            db.rollback()
        finally:
            db.close()

        # -- Start --
        _add_log(job_id, "start", f"Received {filename} ({file_size_kb} KB, {content_type})", t0)

        # -- Step 1: Text extraction --
        _add_log(job_id, "text_extraction", "Extracting text from document...", t0)
        step_start = time.time()
        try:
            if content_type == "application/pdf":
                raw_text, pages = await asyncio.to_thread(extract_text_from_pdf, file_bytes)
                method = "pdfplumber"
                if not raw_text.strip():
                    method = "OCR (tesseract)"
            else:
                raw_text = await asyncio.to_thread(extract_text_from_image, file_bytes)
                pages = 1
                method = "OCR (tesseract)"
        except Exception as e:
            _add_log(job_id, "text_extraction", f"Text extraction failed: {e}", t0)
            job["status"] = "error"
            job["error"] = str(e)
            _update_document_status(document_id, status="error")
            return

        step_dur = round(time.time() - step_start, 2)
        text_len = len(raw_text)
        _add_log(job_id, "text_extraction", f"✓ {method} — {text_len} chars, {pages} page(s) [{step_dur}s]", t0)

        if not raw_text.strip():
            result = ExtractionResult(
                filename=filename, pages=pages, raw_text="", confidence=0.0,
                fields=InvoiceFields(), warnings=["no_text_extracted"],
            )
            _update_document_on_success(document_id, raw_text="", extracted_fields=InvoiceFields().model_dump(), confidence=0.0, warnings=["no_text_extracted"])
            _add_log(job_id, "done", "No text could be extracted", t0)
            job["status"] = "done"
            job["result"] = result.model_dump()
            job["document_id"] = document_id
            return

        # -- Step 2: Field extraction --
        _add_log(job_id, "field_extraction", f"Trying invoice2data templates ({len(_templates)} templates)...", t0)
        try:
            fields, confidence, meta = await asyncio.to_thread(extract_fields_from_text, raw_text, file_bytes, filename)
        except Exception as e:
            _add_log(job_id, "field_extraction", f"Field extraction failed: {e}", t0)
            job["status"] = "error"
            job["error"] = str(e)
            _update_document_status(document_id, status="error")
            return

        # Log invoice2data step result
        i2d_step = meta.steps[0] if meta.steps else {}
        if i2d_step.get("matched"):
            _add_log(job_id, "field_extraction", f"✓ invoice2data matched [{i2d_step.get('duration', 0)}s]", t0)
        else:
            _add_log(job_id, "field_extraction", f"✗ invoice2data — no match [{i2d_step.get('duration', 0)}s]", t0)

        # Log LLM step if used
        if meta.method == "llm":
            llm_step = meta.steps[1] if len(meta.steps) > 1 else {}
            tokens_in = meta.llm_input_tokens
            tokens_out = meta.llm_output_tokens
            _add_log(job_id, "field_extraction",
                     f"✓ LLM {meta.llm_model} — {tokens_in} in / {tokens_out} out tokens [{meta.llm_duration}s]", t0)
        elif meta.method == "none":
            _add_log(job_id, "field_extraction", "✗ All extraction methods failed", t0)

        # Confidence summary
        _add_log(job_id, "field_extraction", f"Method: {meta.method} | Confidence: {confidence:.0%}", t0)

        # Show key extracted info
        parts = []
        if fields.supplier:
            parts.append(f"Supplier: {fields.supplier}")
        if fields.invoice_number:
            parts.append(f"Invoice: {fields.invoice_number}")
        if fields.total is not None:
            currency = fields.currency or ""
            parts.append(f"Total: {currency} {fields.total:.2f}".strip())
        if parts:
            _add_log(job_id, "field_extraction", " | ".join(parts), t0)

        # -- Step 3: Validation --
        _add_log(job_id, "validation", "Validating extracted fields...", t0)
        step_start = time.time()
        warnings = await asyncio.to_thread(validate_fields, fields)
        step_dur = round(time.time() - step_start, 2)

        if warnings:
            _add_log(job_id, "validation", f"⚠ {len(warnings)} warning(s): {', '.join(warnings)} [{step_dur}s]", t0)
        else:
            _add_log(job_id, "validation", f"✓ All validations passed [{step_dur}s]", t0)

        # -- Done --
        total_time = round(time.time() - t0, 2)
        result = ExtractionResult(
            filename=filename, pages=pages, raw_text=raw_text,
            confidence=confidence, fields=fields, warnings=warnings,
        )

        _update_document_on_success(document_id, raw_text=raw_text, extracted_fields=fields.model_dump(), confidence=confidence, warnings=warnings)

        _add_log(job_id, "done", f"Processing complete in {total_time}s", t0)
        job["status"] = "done"
        job["result"] = result.model_dump()
        job["document_id"] = document_id

    except Exception as e:
        logger.error("Pipeline error for job %s: %s", job_id, e)
        _add_log(job_id, "error", f"Unexpected error: {e}", t0)
        job["status"] = "error"
        job["error"] = str(e)
        _update_document_status(document_id, status="error")


@app.post("/api/extract")
async def extract_invoice(request: Request, file: UploadFile = File(...)):
    """Upload a file — starts extraction in background, returns job_id for polling."""
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES:
        return JSONResponse(
            status_code=400,
            content={"detail": f"Unsupported file type: {content_type}. Accepted: PDF, PNG, JPG."},
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        return JSONResponse(status_code=400, content={"detail": "File exceeds 10 MB limit."})
    if len(file_bytes) == 0:
        return JSONResponse(status_code=400, content={"detail": "Empty file."})

    filename = file.filename or "unknown"
    current_user_id = get_optional_user(request)

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "logs": [], "result": None, "document_id": None, "error": None}

    # Fire and forget — pipeline runs in background
    asyncio.create_task(_run_pipeline(job_id, file_bytes, filename, content_type, current_user_id))

    return JSONResponse(content={"job_id": job_id})


@app.get("/api/extract/{job_id}/status")
async def extract_status(job_id: str):
    """Poll for extraction progress. Returns logs seen so far + status."""
    job = _jobs.get(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"detail": "Job not found"})

    response: dict[str, Any] = {
        "status": job["status"],
        "logs": job["logs"],
    }
    if job["status"] == "done":
        response["result"] = job["result"]
        response["document_id"] = job["document_id"]
    elif job["status"] == "error":
        response["error"] = job["error"]

    return JSONResponse(content=response)


@app.delete("/api/extract/{job_id}")
async def extract_cleanup(job_id: str):
    """Clean up a finished job from memory."""
    _jobs.pop(job_id, None)
    return JSONResponse(content={"ok": True})


def _update_document_status(document_id: str | None, status: str):
    if not document_id:
        return
    try:
        db = SessionLocal()
        try:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.status = status
                db.commit()
        except Exception as e:
            logger.error("Failed to update document status: %s", e)
            db.rollback()
        finally:
            db.close()
    except Exception as e:
        logger.error("DB session error: %s", e)


def _update_document_on_success(document_id: str | None, raw_text: str, extracted_fields: dict, confidence: float, warnings: list[str]):
    if not document_id:
        return
    try:
        db = SessionLocal()
        try:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.raw_text = raw_text
                doc.extracted_fields = extracted_fields
                doc.confidence = confidence
                doc.warnings = warnings
                doc.status = "success"
                db.commit()
        except Exception as e:
            logger.error("Failed to update document results: %s", e)
            db.rollback()
        finally:
            db.close()
    except Exception as e:
        logger.error("DB session error: %s", e)
