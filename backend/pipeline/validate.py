"""Validation logic for extracted invoice fields."""

from __future__ import annotations

import re

from .schemas import InvoiceFields

REQUIRED_FIELDS = ["supplier", "invoice_number", "invoice_date", "total"]

# Patterns that look like dates, not invoice numbers
_DATE_PATTERNS = [
    r"^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$",   # 01/02/2024, 1-2-24
    r"^\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}$",       # 2024-01-02
    r"^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\w*\s+\d{2,4}$",
]


def _looks_like_date(value: str) -> bool:
    """Return True if value looks like a date rather than an invoice number."""
    v = value.strip().lower()
    return any(re.match(p, v, re.IGNORECASE) for p in _DATE_PATTERNS)


def validate_fields(fields: InvoiceFields) -> list[str]:
    """Validate extracted fields and return a list of warnings."""
    warnings: list[str] = []

    # Check required fields
    for field_name in REQUIRED_FIELDS:
        value = getattr(fields, field_name, None)
        if value is None or value == "":
            warnings.append(f"missing_{field_name}")

    # Check invoice_number isn't actually a date
    if fields.invoice_number and _looks_like_date(fields.invoice_number):
        warnings.append("invoice_number_is_date")
        fields.invoice_number = None
        if "missing_invoice_number" not in warnings:
            warnings.append("missing_invoice_number")

    # Check totals add up
    if fields.subtotal is not None and fields.tax is not None and fields.total is not None:
        expected = round(fields.subtotal + fields.tax, 2)
        actual = round(fields.total, 2)
        if abs(expected - actual) > 0.02:
            warnings.append("totals_mismatch")

    # Check tax rate is reasonable (0-30%)
    if fields.subtotal and fields.tax is not None and fields.subtotal > 0:
        tax_rate = fields.tax / fields.subtotal
        if tax_rate > 0.30:
            warnings.append("tax_rate_unusual")
        elif tax_rate < 0:
            warnings.append("negative_tax")

    # Check line items total vs subtotal/total
    if fields.line_items:
        items_total = sum(
            item.amount for item in fields.line_items if item.amount is not None
        )
        if items_total > 0:
            compare_to = fields.subtotal if fields.subtotal is not None else fields.total
            if compare_to is not None and abs(items_total - compare_to) > 0.02:
                warnings.append("line_items_total_mismatch")

    return warnings
