from __future__ import annotations

from pydantic import BaseModel, Field


class LineItem(BaseModel):
    description: str = ""
    quantity: float | None = None
    unit_price: float | None = None
    amount: float | None = None


class InvoiceFields(BaseModel):
    supplier: str | None = None
    client: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    due_date: str | None = None
    currency: str | None = None
    subtotal: float | None = None
    tax: float | None = None
    total: float | None = None
    siret: str | None = None
    vat_number: str | None = None
    client_number: str | None = None
    line_items: list[LineItem] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    filename: str
    pages: int = 1
    raw_text: str = ""
    confidence: float = 0.0
    fields: InvoiceFields = Field(default_factory=InvoiceFields)
    warnings: list[str] = Field(default_factory=list)
