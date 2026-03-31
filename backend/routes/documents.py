"""Document API routes — list, detail, file download."""

from __future__ import annotations

import math
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, String, cast
from sqlalchemy.orm import Session

from auth import get_required_user
from db.database import get_db
from db.models import Document

router = APIRouter(prefix="/api")


def _json_field(field_name: str, session: Session):
    """Extract a field from the extracted_fields JSON column, dialect-aware."""
    dialect = session.bind.dialect.name if session.bind else "sqlite"
    if dialect == "postgresql":
        return Document.extracted_fields[field_name].astext
    else:
        return func.json_extract(Document.extracted_fields, f"$.{field_name}")


def _doc_to_dict(doc: Document) -> dict:
    """Convert a Document ORM object to a serializable dict."""
    return {
        "id": doc.id,
        "filename": doc.filename,
        "file_size": doc.file_size,
        "content_type": doc.content_type,
        "uploaded_at": doc.uploaded_at.isoformat() if doc.uploaded_at else None,
        "status": doc.status,
        "confidence": doc.confidence,
        "raw_text": doc.raw_text,
        "extracted_fields": doc.extracted_fields,
        "warnings": doc.warnings,
        "user_id": doc.user_id,
        "original_file_path": doc.original_file_path,
    }


@router.get("/documents")
def list_documents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    sort_by: str = Query("uploaded_at"),
    sort_dir: str = Query("desc"),
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """List documents with pagination, search, and sorting."""
    query = db.query(Document)
    if user_id is not None:
        query = query.filter(Document.user_id == user_id)

    # Exclude duplicates
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        query = query.filter(~Document.warnings.op("@>")(cast('["duplicate_invoice"]', String)))
    else:
        query = query.filter(
            or_(
                Document.warnings.is_(None),
                ~func.json_extract(Document.warnings, "$").like("%duplicate_invoice%"),
            )
        )

    # Search filter — match against supplier or invoice_number inside JSON, or filename
    if search:
        search_pattern = f"%{search}%"
        supplier_expr = cast(_json_field("supplier", db), String)
        invoice_expr = cast(_json_field("invoice_number", db), String)
        query = query.filter(
            or_(
                supplier_expr.ilike(search_pattern),
                invoice_expr.ilike(search_pattern),
                Document.filename.ilike(search_pattern),
            )
        )

    # Sorting
    allowed_sort_fields = {"uploaded_at", "filename", "status", "confidence"}
    if sort_by not in allowed_sort_fields:
        sort_by = "uploaded_at"
    sort_column = getattr(Document, sort_by)
    if sort_dir == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    total = query.count()
    pages = math.ceil(total / limit) if total > 0 else 1
    items = query.offset((page - 1) * limit).limit(limit).all()

    return {
        "items": [_doc_to_dict(doc) for doc in items],
        "total": total,
        "page": page,
        "pages": pages,
    }


@router.get("/documents/{doc_id}")
def get_document(
    doc_id: str,
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Get a single document by ID."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user_id is not None and doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _doc_to_dict(doc)


@router.get("/documents/{doc_id}/file")
def get_document_file(
    doc_id: str,
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Serve the original uploaded file."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user_id is not None and doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if not doc.original_file_path or not os.path.isfile(doc.original_file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        path=doc.original_file_path,
        filename=doc.filename,
        media_type=doc.content_type or "application/octet-stream",
    )
