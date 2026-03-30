"""Dashboard statistics API route."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
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


@router.get("/dashboard/stats")
def get_dashboard_stats(
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Return aggregated dashboard statistics, scoped to user when auth is enabled."""
    base_query = db.query(Document)
    if user_id is not None:
        base_query = base_query.filter(Document.user_id == user_id)

    total_documents = base_query.count()
    success_count = base_query.filter(Document.status == "success").count()
    error_count = base_query.filter(Document.status == "error").count()
    success_rate = round((success_count / total_documents * 100), 1) if total_documents > 0 else 0.0

    avg_confidence_result = (
        db.query(func.avg(Document.confidence))
        .filter(Document.status == "success")
        .scalar()
    )
    avg_confidence = round(float(avg_confidence_result), 3) if avg_confidence_result else 0.0

    # Compute total_amount from extracted_fields JSON
    all_docs = base_query.filter(Document.status == "success").all()
    total_amount = 0.0
    supplier_data: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_amount": 0.0})
    unique_suppliers: set[str] = set()

    for doc in all_docs:
        fields = doc.extracted_fields or {}
        doc_total = fields.get("total")
        if doc_total is not None:
            try:
                total_amount += float(doc_total)
            except (ValueError, TypeError):
                pass

        supplier = fields.get("supplier")
        if supplier:
            unique_suppliers.add(supplier)
            supplier_data[supplier]["count"] += 1
            if doc_total is not None:
                try:
                    supplier_data[supplier]["total_amount"] += float(doc_total)
                except (ValueError, TypeError):
                    pass

    total_amount = round(total_amount, 2)

    # Invoices per month (last 12 months)
    now = datetime.now(timezone.utc)
    months = []
    for i in range(11, -1, -1):
        dt = now - relativedelta(months=i)
        months.append(dt.strftime("%Y-%m"))

    # Get all documents for month aggregation
    twelve_months_ago = now - relativedelta(months=12)
    recent_docs = (
        base_query.filter(Document.uploaded_at >= twelve_months_ago).all()
    )

    month_counts: dict[str, int] = defaultdict(int)
    month_amounts: dict[str, float] = defaultdict(float)
    for doc in recent_docs:
        if doc.uploaded_at:
            month_key = doc.uploaded_at.strftime("%Y-%m")
            month_counts[month_key] += 1
            if doc.status == "success" and doc.extracted_fields:
                doc_total = doc.extracted_fields.get("total")
                if doc_total is not None:
                    try:
                        month_amounts[month_key] += float(doc_total)
                    except (ValueError, TypeError):
                        pass

    invoices_per_month = [{"month": m, "count": month_counts.get(m, 0)} for m in months]
    amounts_per_month = [{"month": m, "amount": round(month_amounts.get(m, 0.0), 2)} for m in months]

    # Supplier distribution — top 5 + "other"
    sorted_suppliers = sorted(supplier_data.items(), key=lambda x: x[1]["count"], reverse=True)
    supplier_distribution = []
    other_count = 0
    other_amount = 0.0
    for i, (name, data) in enumerate(sorted_suppliers):
        if i < 5:
            supplier_distribution.append({
                "name": name,
                "count": data["count"],
                "total_amount": round(data["total_amount"], 2),
            })
        else:
            other_count += data["count"]
            other_amount += data["total_amount"]
    if other_count > 0:
        supplier_distribution.append({
            "name": "Other",
            "count": other_count,
            "total_amount": round(other_amount, 2),
        })

    # Top suppliers by total amount
    sorted_by_amount = sorted(supplier_data.items(), key=lambda x: x[1]["total_amount"], reverse=True)
    top_suppliers = [
        {
            "name": name,
            "count": data["count"],
            "total_amount": round(data["total_amount"], 2),
        }
        for name, data in sorted_by_amount[:5]
    ]

    return {
        "total_documents": total_documents,
        "success_count": success_count,
        "error_count": error_count,
        "success_rate": success_rate,
        "avg_confidence": avg_confidence,
        "total_amount": total_amount,
        "invoices_per_month": invoices_per_month,
        "supplier_distribution": supplier_distribution,
        "amounts_per_month": amounts_per_month,
        "top_suppliers": top_suppliers,
        "unique_suppliers": len(unique_suppliers),
    }
