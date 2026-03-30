"""Validation logic for extracted invoice fields."""

from __future__ import annotations

from .schemas import InvoiceFields

REQUIRED_FIELDS = ["supplier", "invoice_number", "invoice_date", "total"]


def validate_fields(fields: InvoiceFields) -> list[str]:
    """Validate extracted fields and return a list of warnings."""
    warnings: list[str] = []

    # Check required fields
    for field_name in REQUIRED_FIELDS:
        value = getattr(fields, field_name, None)
        if value is None or value == "":
            warnings.append(f"missing_{field_name}")

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
