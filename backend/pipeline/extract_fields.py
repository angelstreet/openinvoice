"""Field extraction: invoice2data template matching with LLM fallback."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

import anthropic
from invoice2data import extract_data
from invoice2data.extract.loader import read_templates

from config import settings
from .schemas import InvoiceFields, LineItem

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

# Load invoice2data templates once at import time
_templates = read_templates(str(TEMPLATES_DIR)) if TEMPLATES_DIR.exists() else []


def extract_fields_from_text(raw_text: str, file_bytes: bytes, filename: str) -> tuple[InvoiceFields, float]:
    """Try invoice2data first, fall back to LLM if it fails.

    Returns (fields, confidence).
    """
    # Layer 1: invoice2data template matching
    fields, confidence = _try_invoice2data(file_bytes, filename)
    if fields and confidence > 0.5:
        logger.info("invoice2data matched with confidence %.2f", confidence)
        return fields, confidence

    # Layer 2: LLM fallback
    logger.info("invoice2data failed or low confidence, trying LLM fallback")
    fields, confidence = _try_llm_extraction(raw_text)
    return fields, confidence


def _try_invoice2data(file_bytes: bytes, filename: str) -> tuple[InvoiceFields | None, float]:
    """Run invoice2data template matching on the file."""
    if not _templates:
        logger.info("No invoice2data templates found")
        return None, 0.0

    # invoice2data needs a file on disk
    suffix = Path(filename).suffix or ".pdf"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        result = extract_data(tmp_path, templates=_templates)
    except Exception as e:
        logger.warning("invoice2data error: %s", e)
        return None, 0.0
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not result:
        return None, 0.0

    # Convert invoice2data result dict to our schema
    fields = InvoiceFields(
        supplier=result.get("issuer"),
        invoice_number=result.get("invoice_number"),
        invoice_date=_fmt_date(result.get("date")),
        due_date=_fmt_date(result.get("due_date")),
        currency=result.get("currency"),
        total=_to_float(result.get("amount")),
    )
    return fields, 0.75


def _try_llm_extraction(raw_text: str) -> tuple[InvoiceFields, float]:
    """Use MiniMax (Anthropic-compatible API) to extract invoice fields from raw text."""
    api_key = settings.MINIMAX_API_KEY
    if not api_key:
        logger.warning("MINIMAX_API_KEY not set, skipping LLM extraction")
        return InvoiceFields(), 0.0

    client = anthropic.Anthropic(
        api_key=api_key,
        base_url="https://api.minimax.io/anthropic",
    )

    prompt = f"""Extract structured invoice data from the following text. Return ONLY valid JSON with no markdown, no explanation.

The JSON must have exactly these keys:
- "supplier": string or null
- "invoice_number": string or null
- "invoice_date": string (YYYY-MM-DD) or null
- "due_date": string (YYYY-MM-DD) or null
- "currency": string (3-letter code) or null
- "subtotal": number or null
- "tax": number or null
- "total": number or null
- "line_items": array of objects with keys "description" (string), "quantity" (number or null), "unit_price" (number or null), "amount" (number or null)

Invoice text:
---
{raw_text[:8000]}
---

Return ONLY the JSON object:"""

    try:
        message = client.messages.create(
            model="MiniMax-M2.7-highspeed",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        # MiniMax may return thinking blocks before text — find the text block
        response_text = ""
        for block in message.content:
            if block.type == "text" and block.text:
                response_text = block.text.strip()
                break

        # Parse JSON from response (handle possible markdown wrapping)
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1])

        data = json.loads(response_text)
        line_items = [
            LineItem(**item)
            for item in data.get("line_items", [])
        ]
        fields = InvoiceFields(
            supplier=data.get("supplier"),
            invoice_number=data.get("invoice_number"),
            invoice_date=data.get("invoice_date"),
            due_date=data.get("due_date"),
            currency=data.get("currency"),
            subtotal=_to_float(data.get("subtotal")),
            tax=_to_float(data.get("tax")),
            total=_to_float(data.get("total")),
            line_items=line_items,
        )
        return fields, 0.85

    except Exception as e:
        logger.error("LLM extraction failed: %s", e)
        return InvoiceFields(), 0.0


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _fmt_date(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    return str(val)
