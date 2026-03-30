"""FastAPI app — invoice extraction with SSE streaming progress."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from auth import get_optional_user
from config import settings
from db.base import Base
from db.database import SessionLocal, engine
from db.models import Document
from pipeline.extract_fields import extract_fields_from_text
from pipeline.extract_text import extract_text_from_image, extract_text_from_pdf
from pipeline.schemas import ExtractionResult, InvoiceFields
from pipeline.validate import validate_fields
from routes.dashboard import router as dashboard_router
from routes.documents import router as documents_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OpenInvoice API", version="0.2.0")

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


@app.on_event("startup")
def on_startup():
    """Auto-create database tables and uploads directory on startup."""
    Base.metadata.create_all(bind=engine)
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    logger.info("Database tables created, uploads dir: %s", settings.UPLOADS_DIR)


def _sse_event(event: str, step: str, message: str, t0: float, **extra):
    """Build an SSE data payload."""
    data = {"step": step, "message": message, "elapsed": round(time.time() - t0, 2), **extra}
    return {"event": event, "data": json.dumps(data)}


@app.post("/api/extract")
async def extract_invoice(request: Request, file: UploadFile = File(...)):
    """Upload a PDF or image invoice — streams SSE progress, then the result."""
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
    file_size = len(file_bytes)
    file_size_kb = round(file_size / 1024, 1)

    # Get optional user from auth
    current_user_id = get_optional_user(request)

    async def event_generator():
        t0 = time.time()
        document_id = None

        # -- Save file to disk and create DB record --
        try:
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
        except Exception as e:
            logger.error("Failed to save uploaded file: %s", e)

        # -- Start --
        yield _sse_event("log", "start", f"Received {filename} ({file_size_kb} KB, {content_type})", t0)

        # -- Step 1: Text extraction --
        yield _sse_event("log", "text_extraction", "Extracting text from document...", t0)
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
            yield _sse_event("error", "text_extraction", f"Text extraction failed: {e}", t0)
            _update_document_status(document_id, status="error")
            return

        text_len = len(raw_text)
        yield _sse_event("log", "text_extraction", f"Text extracted via {method} — {text_len} chars, {pages} page(s)", t0)

        if not raw_text.strip():
            result = ExtractionResult(
                filename=filename, pages=pages, raw_text="", confidence=0.0,
                fields=InvoiceFields(), warnings=["no_text_extracted"],
            )
            _update_document_on_success(
                document_id,
                raw_text="",
                extracted_fields=InvoiceFields().model_dump(),
                confidence=0.0,
                warnings=["no_text_extracted"],
            )
            yield _sse_event("result", "done", "No text could be extracted", t0,
                             result=result.model_dump(), document_id=document_id)
            return

        # -- Step 2: Field extraction --
        yield _sse_event("log", "field_extraction", "Running invoice2data template matching...", t0)
        try:
            fields, confidence = await asyncio.to_thread(extract_fields_from_text, raw_text, file_bytes, filename)
        except Exception as e:
            yield _sse_event("error", "field_extraction", f"Field extraction failed: {e}", t0)
            _update_document_status(document_id, status="error")
            return

        if confidence >= 0.8:
            yield _sse_event("log", "field_extraction", f"Fields extracted with high confidence ({confidence:.0%})", t0)
        elif confidence > 0:
            yield _sse_event("log", "field_extraction", f"Fields extracted via LLM fallback (confidence {confidence:.0%})", t0)
        else:
            yield _sse_event("log", "field_extraction", "Field extraction returned no results", t0)

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
            yield _sse_event("log", "field_extraction", " | ".join(parts), t0)

        # -- Step 3: Validation --
        yield _sse_event("log", "validation", "Validating extracted fields...", t0)
        warnings = await asyncio.to_thread(validate_fields, fields)

        if warnings:
            yield _sse_event("log", "validation", f"Validation warnings: {', '.join(warnings)}", t0)
        else:
            yield _sse_event("log", "validation", "All validations passed", t0)

        # -- Done --
        total_time = round(time.time() - t0, 2)
        result = ExtractionResult(
            filename=filename, pages=pages, raw_text=raw_text,
            confidence=confidence, fields=fields, warnings=warnings,
        )

        # Save results to DB
        _update_document_on_success(
            document_id,
            raw_text=raw_text,
            extracted_fields=fields.model_dump(),
            confidence=confidence,
            warnings=warnings,
        )

        yield _sse_event("log", "done", f"Processing complete in {total_time}s", t0)
        yield _sse_event("result", "done", "done", t0, result=result.model_dump(), document_id=document_id)

    return EventSourceResponse(event_generator())


def _update_document_status(document_id: str | None, status: str):
    """Update document status in the database. Silently fails if DB unavailable."""
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


def _update_document_on_success(
    document_id: str | None,
    raw_text: str,
    extracted_fields: dict,
    confidence: float,
    warnings: list[str],
):
    """Update document with extraction results. Silently fails if DB unavailable."""
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
