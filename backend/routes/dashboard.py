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

    # Exclude duplicates
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        from sqlalchemy import cast, String, or_
        base_query = base_query.filter(~Document.warnings.op("@>")(cast('["duplicate_invoice"]', String)))
    else:
        from sqlalchemy import or_
        base_query = base_query.filter(
            or_(
                Document.warnings.is_(None),
                ~func.json_extract(Document.warnings, "$").like("%duplicate_invoice%"),
            )
        )

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


LLM_INPUT_RATE = 0.10 / 1_000_000   # $0.10 per 1M tokens
LLM_OUTPUT_RATE = 0.30 / 1_000_000  # $0.30 per 1M tokens


@router.get("/dashboard/quality")
def get_quality_stats(
    user_id: str | None = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Quality KPIs for platform evaluation."""
    base = db.query(Document)
    if user_id is not None:
        base = base.filter(Document.user_id == user_id)

    all_docs = base.all()
    total = len(all_docs)
    if total == 0:
        return {"total": 0}

    # Method distribution
    method_counts: dict[str, int] = defaultdict(int)
    method_confidence: dict[str, list[float]] = defaultdict(list)
    method_durations: dict[str, list[float]] = defaultdict(list)
    llm_total_input = 0
    llm_total_output = 0
    llm_doc_count = 0
    corrected_count = 0
    human_ok = 0
    human_nok = 0
    human_total = 0
    ai_ok = 0
    ai_nok = 0
    ai_total = 0
    agreements = 0
    disagreements = 0
    false_positives = 0  # AI=OK but human=NOK
    recent_disagreements = []

    for doc in all_docs:
        meta = doc.pipeline_meta or {} if hasattr(doc, 'pipeline_meta') else {}
        method = meta.get("method", "unknown")
        method_counts[method] += 1

        if doc.confidence is not None:
            method_confidence[method].append(doc.confidence)

        dur = meta.get("total_duration")
        if dur is not None:
            method_durations[method].append(dur)

        # LLM usage
        inp = meta.get("llm_input_tokens", 0)
        out = meta.get("llm_output_tokens", 0)
        if inp > 0 or out > 0:
            llm_total_input += inp
            llm_total_output += out
            llm_doc_count += 1

        # Corrections
        cf = getattr(doc, 'corrected_fields', None)
        if cf and len(cf) > 0:
            corrected_count += 1

        # Human feedback
        hf = getattr(doc, 'human_feedback', None)
        if hf and hf.get("verdict"):
            human_total += 1
            if hf["verdict"] == "OK":
                human_ok += 1
            else:
                human_nok += 1

        # AI feedback
        af = getattr(doc, 'ai_feedback', None)
        if af and af.get("verdict"):
            ai_total += 1
            if af["verdict"] == "OK":
                ai_ok += 1
            else:
                ai_nok += 1

        # Agreement
        if hf and af and hf.get("verdict") and af.get("verdict"):
            if hf["verdict"] == af["verdict"]:
                agreements += 1
            else:
                disagreements += 1
                if len(recent_disagreements) < 10:
                    recent_disagreements.append({
                        "id": doc.id,
                        "filename": doc.filename,
                        "ai_verdict": af["verdict"],
                        "human_verdict": hf["verdict"],
                        "ai_comment": af.get("comment", ""),
                        "uploaded_at": doc.uploaded_at.isoformat() if doc.uploaded_at else None,
                    })
                if af["verdict"] == "OK" and hf["verdict"] == "NOK":
                    false_positives += 1

    # Compute aggregates
    llm_cost = llm_total_input * LLM_INPUT_RATE + llm_total_output * LLM_OUTPUT_RATE
    review_total = agreements + disagreements
    agreement_rate = round(agreements / review_total * 100, 1) if review_total > 0 else 0.0
    correction_rate = round(corrected_count / total * 100, 1) if total > 0 else 0.0
    false_positive_rate = round(false_positives / human_total * 100, 1) if human_total > 0 else 0.0

    avg_duration = {}
    for m, durs in method_durations.items():
        avg_duration[m] = round(sum(durs) / len(durs), 2) if durs else 0

    avg_conf_by_method = {}
    for m, confs in method_confidence.items():
        avg_conf_by_method[m] = round(sum(confs) / len(confs), 3) if confs else 0

    return {
        "total": total,
        "method_distribution": [{"method": m, "count": c} for m, c in sorted(method_counts.items(), key=lambda x: -x[1])],
        "confidence_by_method": [{"method": m, "avg_confidence": avg_conf_by_method.get(m, 0)} for m in method_counts],
        "duration_by_method": [{"method": m, "avg_duration": avg_duration.get(m, 0)} for m in method_counts],
        "llm_usage": {
            "documents": llm_doc_count,
            "total_input_tokens": llm_total_input,
            "total_output_tokens": llm_total_output,
            "total_cost": round(llm_cost, 4),
        },
        "correction_rate": correction_rate,
        "corrected_count": corrected_count,
        "human_feedback": {"ok": human_ok, "nok": human_nok, "total": human_total},
        "ai_feedback": {"ok": ai_ok, "nok": ai_nok, "total": ai_total},
        "agreement_rate": agreement_rate,
        "false_positive_rate": false_positive_rate,
        "avg_duration_overall": round(sum(sum(d) for d in method_durations.values()) / max(sum(len(d) for d in method_durations.values()), 1), 2),
        "recent_disagreements": recent_disagreements,
    }
