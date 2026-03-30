"""Field extraction: invoice2data template matching with LLM fallback."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass, field
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


@dataclass
class ExtractionMeta:
    """Metadata about the extraction process."""
    method: str = ""              # "invoice2data" | "llm" | "none"
    llm_model: str = ""
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    invoice2data_duration: float = 0.0
    invoice2data_matched: bool = False
    llm_duration: float = 0.0
    templates_checked: int = 0
    steps: list[dict] = field(default_factory=list)


def extract_fields_from_text(raw_text: str, file_bytes: bytes, filename: str) -> tuple[InvoiceFields, float, ExtractionMeta]:
    """Try invoice2data first, fall back to LLM if it fails.

    Returns (fields, confidence, meta).
    """
    meta = ExtractionMeta(templates_checked=len(_templates))

    # Layer 1: invoice2data template matching
    t0 = time.time()
    fields, confidence = _try_invoice2data(file_bytes, filename)
    meta.invoice2data_duration = round(time.time() - t0, 2)
    meta.steps.append({
        "name": "invoice2data",
        "duration": meta.invoice2data_duration,
        "matched": fields is not None and confidence > 0.5,
        "templates_checked": meta.templates_checked,
    })

    if fields and confidence > 0.5:
        meta.method = "invoice2data"
        meta.invoice2data_matched = True
        logger.info("invoice2data matched with confidence %.2f", confidence)
        return fields, confidence, meta

    # Layer 2: LLM fallback
    logger.info("invoice2data failed or low confidence, trying LLM fallback")
    t1 = time.time()
    fields, confidence, llm_info = _try_llm_extraction(raw_text)
    meta.llm_duration = round(time.time() - t1, 2)
    meta.method = "llm" if confidence > 0 else "none"
    meta.llm_model = llm_info.get("model", "")
    meta.llm_input_tokens = llm_info.get("input_tokens", 0)
    meta.llm_output_tokens = llm_info.get("output_tokens", 0)
    meta.steps.append({
        "name": "llm",
        "duration": meta.llm_duration,
        "model": meta.llm_model,
        "input_tokens": meta.llm_input_tokens,
        "output_tokens": meta.llm_output_tokens,
        "success": confidence > 0,
    })

    return fields, confidence, meta


def _try_invoice2data(file_bytes: bytes, filename: str) -> tuple[InvoiceFields | None, float]:
    """Run invoice2data template matching on the file."""
    if not _templates:
        logger.info("No invoice2data templates found")
        return None, 0.0

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

    fields = InvoiceFields(
        supplier=result.get("issuer"),
        invoice_number=result.get("invoice_number"),
        invoice_date=_fmt_date(result.get("date")),
        due_date=_fmt_date(result.get("due_date")),
        currency=result.get("currency"),
        total=_to_float(result.get("amount")),
    )
    return fields, 0.75


def _try_llm_extraction(raw_text: str) -> tuple[InvoiceFields, float, dict]:
    """Use MiniMax (Anthropic-compatible API) to extract invoice fields from raw text.

    Returns (fields, confidence, llm_info_dict).
    """
    api_key = settings.MINIMAX_API_KEY
    if not api_key:
        logger.warning("MINIMAX_API_KEY not set, skipping LLM extraction")
        return InvoiceFields(), 0.0, {}

    client = anthropic.Anthropic(
        api_key=api_key,
        base_url="https://api.minimax.io/anthropic",
    )

    model = "MiniMax-M2.7-highspeed"

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
            model=model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )

        llm_info = {
            "model": model,
            "input_tokens": getattr(message.usage, "input_tokens", 0),
            "output_tokens": getattr(message.usage, "output_tokens", 0),
        }

        response_text = ""
        for block in message.content:
            if block.type == "text" and block.text:
                response_text = block.text.strip()
                break

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
        return fields, 0.85, llm_info

    except Exception as e:
        logger.error("LLM extraction failed: %s", e)
        return InvoiceFields(), 0.0, {"model": model}


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
