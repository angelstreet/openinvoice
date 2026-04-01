"""Document API routes — list, detail, file download, CSV export."""

from __future__ import annotations

import csv
import io
import math
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
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
        "source": getattr(doc, "source", None) or "upload",
        "pipeline_meta": getattr(doc, "pipeline_meta", None),
        "corrected_fields": getattr(doc, "corrected_fields", None),
        "human_feedback": getattr(doc, "human_feedback", None),
        "ai_feedback": getattr(doc, "ai_feedback", None),
    }


def _apply_filters(query, db: Session, user_id: str | None, search: str | None,
                    supplier: str | None, date_from: str | None, date_to: str | None):
    """Apply shared filters to a document query."""
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

    # Search filter
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

    # Supplier filter
    if supplier:
        supplier_expr = cast(_json_field("supplier", db), String)
        query = query.filter(supplier_expr.ilike(f"%{supplier}%"))

    # Date range filter
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            query = query.filter(Document.uploaded_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            query = query.filter(Document.uploaded_at <= dt)
        except ValueError:
            pass

    return query


@router.get("/documents")
def list_documents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    supplier: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort_by: str = Query("uploaded_at"),
    sort_dir: str = Query("desc"),
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """List documents with pagination, search, filters, and sorting."""
    query = _apply_filters(db.query(Document), db, user_id, search, supplier, date_from, date_to)

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


@router.get("/documents/export/csv")
def export_csv(
    search: str | None = Query(None),
    supplier: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Export filtered documents as CSV."""
    query = _apply_filters(db.query(Document), db, user_id, search, supplier, date_from, date_to)
    query = query.order_by(Document.uploaded_at.desc())
    docs = query.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Filename", "Supplier", "Client", "Invoice Number",
        "Invoice Date", "Due Date", "Currency", "Subtotal", "Tax", "Total",
        "Confidence", "Status", "Source",
    ])

    for doc in docs:
        fields = doc.extracted_fields or {}
        writer.writerow([
            doc.uploaded_at.strftime("%Y-%m-%d %H:%M") if doc.uploaded_at else "",
            doc.filename,
            fields.get("supplier", ""),
            fields.get("client", ""),
            fields.get("invoice_number", ""),
            fields.get("invoice_date", ""),
            fields.get("due_date", ""),
            fields.get("currency", ""),
            fields.get("subtotal", ""),
            fields.get("tax", ""),
            fields.get("total", ""),
            f"{doc.confidence:.0%}" if doc.confidence is not None else "",
            doc.status or "",
            getattr(doc, "source", "") or "",
        ])

    output.seek(0)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="invoices-{today}.csv"'},
    )


@router.get("/documents/suppliers")
def list_suppliers(
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Return distinct supplier names for filter dropdown."""
    query = db.query(Document)
    if user_id is not None:
        query = query.filter(Document.user_id == user_id)

    supplier_expr = _json_field("supplier", db)
    rows = query.with_entities(supplier_expr).distinct().all()
    suppliers = sorted([r[0] for r in rows if r[0] and r[0].strip()])
    return {"suppliers": suppliers}


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


@router.patch("/documents/{doc_id}")
def update_document(
    doc_id: str,
    body: dict,
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Update corrected fields and/or human feedback."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user_id is not None and doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if "corrected_fields" in body:
        existing = doc.corrected_fields or {}
        existing.update(body["corrected_fields"])
        doc.corrected_fields = existing

    if "human_feedback" in body:
        fb = body["human_feedback"]
        fb["submitted_at"] = datetime.now(timezone.utc).isoformat()
        doc.human_feedback = fb

    db.commit()
    db.refresh(doc)
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


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Delete a document and its file from disk."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user_id is not None and doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    # Remove file from disk
    if doc.original_file_path and os.path.isfile(doc.original_file_path):
        os.remove(doc.original_file_path)
    db.delete(doc)
    db.commit()
    return {"ok": True}
