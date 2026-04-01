"""Deterministic AI assessment — no LLM cost."""

from __future__ import annotations

from datetime import datetime, timezone

from .schemas import InvoiceFields


def generate_ai_feedback(fields: InvoiceFields, confidence: float, warnings: list[str], meta_dict: dict) -> dict:
    """Generate an automatic OK/NOK verdict based on extraction quality."""
    reasons = []

    # Check confidence
    if confidence < 0.5:
        reasons.append(f"Low confidence ({confidence:.0%})")
    elif confidence < 0.7:
        reasons.append(f"Medium confidence ({confidence:.0%})")

    # Check critical fields
    critical = {"missing_supplier", "missing_total", "missing_invoice_number"}
    missing = [w for w in warnings if w in critical]
    if missing:
        readable = [w.replace("missing_", "") for w in missing]
        reasons.append(f"Missing: {', '.join(readable)}")

    # Check method
    method = meta_dict.get("method", "")
    if method == "none":
        reasons.append("No extraction method succeeded")

    # Check for date-as-invoice-number
    if "invoice_number_is_date" in warnings:
        reasons.append("Invoice number was a date")

    # Check totals mismatch
    if "totals_mismatch" in warnings:
        reasons.append("Subtotal + tax does not match total")

    # Verdict
    verdict = "NOK" if reasons else "OK"
    if verdict == "OK":
        comment = f"Extraction OK ({confidence:.0%} confidence, method: {method})"
    else:
        comment = "; ".join(reasons)

    return {
        "verdict": verdict,
        "comment": comment,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
