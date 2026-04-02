"""Field extraction: custom regex + invoice2data merge, with LLM fallback."""

from __future__ import annotations

import json
import logging
import os
import re
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
# Load built-in templates (189 vendor-specific) + custom ones
_builtin_templates = read_templates()
_custom_templates = read_templates(str(TEMPLATES_DIR)) if TEMPLATES_DIR.exists() else []
_templates = _custom_templates + _builtin_templates

# Minimum fields needed to skip LLM
REQUIRED_FIELDS = {"supplier", "invoice_number", "total"}


@dataclass
class ExtractionMeta:
    method: str = ""  # "regex+invoice2data" | "regex" | "invoice2data" | "llm" | "none"
    llm_model: str = ""
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    templates_checked: int = 0
    steps: list[dict] = field(default_factory=list)


def _has_required(fields: InvoiceFields | None) -> bool:
    """Check if all required fields are present."""
    if not fields:
        return False
    return all(getattr(fields, f, None) not in (None, "") for f in REQUIRED_FIELDS)


def extract_fields_from_text(raw_text: str, file_bytes: bytes, filename: str) -> tuple[InvoiceFields, float, ExtractionMeta]:
    """Extract fields using cascading fallbacks:
    1) regex — fast, no cost
    2) invoice2data — only if regex missed required fields
    3) LLM — only if both above missed required fields

    Returns (fields, confidence, meta).
    """
    meta = ExtractionMeta(templates_checked=len(_templates))

    # --- Layer 1: Custom regex on pdfplumber text ---
    t0 = time.time()
    regex_fields = _try_regex(raw_text)
    regex_dur = round(time.time() - t0, 4)
    regex_found = _count_fields(regex_fields)
    meta.steps.append({"name": "regex", "duration": regex_dur, "fields_found": regex_found})

    # If regex got all required fields, skip invoice2data and LLM
    if _has_required(regex_fields):
        meta.method = "regex"
        confidence = min(0.95, 0.50 + regex_found * 0.075)
        return regex_fields, confidence, meta

    # --- Layer 2: invoice2data fallback ---
    t1 = time.time()
    i2d_fields, _ = _try_invoice2data(file_bytes, filename)
    i2d_dur = round(time.time() - t1, 4)
    i2d_found = _count_fields(i2d_fields) if i2d_fields else 0
    meta.steps.append({"name": "invoice2data", "duration": i2d_dur, "fields_found": i2d_found, "templates_checked": meta.templates_checked})

    # Merge regex + invoice2data
    merged = _merge_fields(regex_fields, i2d_fields)
    merged_found = _count_fields(merged)

    if _has_required(merged):
        sources = []
        if regex_found > 0:
            sources.append("regex")
        if i2d_found > 0:
            sources.append("invoice2data")
        meta.method = "+".join(sources) or "regex"
        confidence = min(0.95, 0.50 + merged_found * 0.075)
        return merged, confidence, meta

    # --- Layer 3: LLM fallback ---
    logger.info("Regex+invoice2data found %d fields, missing required — trying LLM", merged_found)
    t2 = time.time()
    llm_fields, llm_confidence, llm_info = _try_llm_extraction(raw_text)
    llm_dur = round(time.time() - t2, 2)
    meta.llm_model = llm_info.get("model", "")
    meta.llm_input_tokens = llm_info.get("input_tokens", 0)
    meta.llm_output_tokens = llm_info.get("output_tokens", 0)
    meta.steps.append({
        "name": "llm", "duration": llm_dur, "model": meta.llm_model,
        "input_tokens": meta.llm_input_tokens, "output_tokens": meta.llm_output_tokens,
        "success": llm_confidence > 0,
    })

    if llm_confidence > 0:
        final = _merge_fields(merged, llm_fields)
        meta.method = "llm"
        return final, llm_confidence, meta

    # Nothing worked — return whatever we have
    meta.method = "none"
    return merged, 0.0, meta


# ---------------------------------------------------------------------------
# Custom regex extraction (runs on clean pdfplumber text)
# ---------------------------------------------------------------------------

_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "CHF": "CHF"}

_PATTERNS = {
    "supplier": [
        re.compile(r"^([A-ZÀ-Ü][A-Za-zÀ-ü ,.\-&']+?)\s+INVOICE", re.MULTILINE),
        re.compile(r"^([A-ZÀ-Ü][A-Za-zÀ-ü ,.\-&']+?)\s+(?:Rechnung|Facture)\b", re.MULTILINE),
        # French invoices: first all-caps line (3+ words) is usually the supplier
        re.compile(r"^([A-ZÀ-Ü][A-ZÀ-Ü\s\-&.]{4,})$", re.MULTILINE),
    ],
    "client": [
        # "Bill To: Ship To:\nShip Mode: ...\nAaron Hawkins ..." — skip Ship To + Ship Mode lines
        re.compile(r"(?:Bill\s*To|Destinataire|Facturé\s*à|Kunde|Client)\s*:.*\n(?:.*(?:Ship|Mode).*\n)*\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)+)", re.MULTILINE),
        # "Bill To: John Doe" on same line
        re.compile(r"(?:Bill\s*To|Destinataire|Facturé\s*à|Kunde|Client)\s*:\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)+)"),
    ],
    "invoice_number": [
        re.compile(r"Facture\s*n°\s*:?\s*(\d[\w\-/]*)", re.IGNORECASE),
        re.compile(r"(?:Invoice|Facture|Rechnung)\s*(?:No|Number|Nr)?\.?\s*[:#]?\s*(\d[\w\-/]+)", re.IGNORECASE),
        re.compile(r"#\s*(\d+)"),
    ],
    "invoice_date": [
        re.compile(r"Date\s*de\s*[Ff]acture\s*:\s*(\d{1,2}[\.\-/][A-Za-z0-9]{2,3}[\.\-/]\d{2,4})", re.IGNORECASE),
        re.compile(r"(?:Invoice\s*)?Date\s*[:\s]\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})", re.IGNORECASE),
        re.compile(r"(?:Invoice\s*)?Date\s*[:\s]\s*(\w+\s+\d{1,2}[,]?\s+\d{4})", re.IGNORECASE),
        re.compile(r"(?:Datum|Date)\s*[:\s]\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})", re.IGNORECASE),
    ],
    "due_date": [
        re.compile(r"(?:Due\s*Date|Zahlbar\s*bis|Fällig|Échéance)\s*[:\s]\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})", re.IGNORECASE),
        re.compile(r"(?:Due\s*Date)\s*[:\s]\s*(\w+\s+\d{1,2}[,]?\s+\d{4})", re.IGNORECASE),
    ],
    "total": [
        re.compile(r"(?:Total|Balance\s*Due)\s*[:\s]\s*[\$€£]?\s?([\d,]+\.?\d*)", re.IGNORECASE),
        re.compile(r"Net\s*[àa]\s*payer\s*TTC[\s\S]{0,80}?[€$£]\s*([\d.,]+\d)", re.IGNORECASE),
        re.compile(r"\bTTC\s+([\d.,]+)\s*(?:EUR|€)", re.IGNORECASE),
        re.compile(r"(?:Gesamtbetrag|Betrag)\s*[:\s]\s*(?:CHF\s*)?([\d',]+\.?\d*)", re.IGNORECASE),
    ],
    "subtotal": [
        re.compile(r"Subtotal\s*[:\s]\s*[\$€£]?\s?([\d,]+\.?\d*)", re.IGNORECASE),
        re.compile(r"Zwischensumme\s*[:\s]\s*(?:CHF\s*)?([\d',]+\.?\d*)", re.IGNORECASE),
    ],
    "tax": [
        re.compile(r"(?:Tax|VAT|MwSt|TVA)\s*[:\s]\s*[\$€£]?\s?([\d,]+\.?\d*)", re.IGNORECASE),
    ],
    "currency": [
        re.compile(r"([\$€£])\s*\d"),
        re.compile(r"(CHF|USD|EUR|GBP)\s", re.IGNORECASE),
    ],
    "siret": [
        re.compile(r"SIRET\s*:?\s*([\d\s]{14,20})", re.IGNORECASE),
    ],
    "vat_number": [
        re.compile(r"(?:code\s*)?(?:TVA|VAT|USt-?Id)\s*:?\s*([A-Z]{2}\s*\d{2}\s*\d{9})\b", re.IGNORECASE),
        re.compile(r"\b(FR\s*\d{2}\s*\d{9})\b"),
        re.compile(r"\b(DE\s*\d{9})\b"),
        re.compile(r"\b(GB\s*\d{9})\b"),
    ],
    "client_number": [
        re.compile(r"Client\s*Factur[ée]\s*[-:]\s*(\d+)\s*Client\s*livr[ée]\s*[-:]\s*(\d+)", re.IGNORECASE),
        re.compile(r"(?:No|N°|Numéro)\s*(?:de\s*)?Client\s*:?\s*([\d]+(?:\s*/\s*[\d]+)*)", re.IGNORECASE),
        re.compile(r"(?:Customer|Account)\s*(?:No|Number|#)\s*:?\s*([\w\-/]+)", re.IGNORECASE),
    ],
}


_SUPPLIER_REJECT = ("merci", "rappeler", "conditions", "veuillez", "page ", "date ", "n°", "no ")


def _try_regex(raw_text: str) -> InvoiceFields:
    """Run custom regex patterns on pdfplumber-extracted text."""
    extracted: dict[str, str | None] = {}

    for field_name, patterns in _PATTERNS.items():
        for pat in patterns:
            m = pat.search(raw_text)
            if m:
                # Join all capture groups for multi-group patterns (e.g. client facturé / livré)
                groups = [g for g in m.groups() if g is not None]
                value = " / ".join(g.strip() for g in groups) if len(groups) > 1 else m.group(1).strip()
                # Validate supplier — reject false positives and try next pattern
                if field_name == "supplier":
                    lower = value.lower()
                    if any(r in lower for r in _SUPPLIER_REJECT) or len(value) < 3:
                        continue
                extracted[field_name] = value
                break

    # Resolve currency symbol to code
    currency = extracted.get("currency")
    if currency in _CURRENCY_SYMBOLS:
        extracted["currency"] = _CURRENCY_SYMBOLS[currency]

    # Normalize SIRET: remove spaces
    siret = extracted.get("siret")
    if siret:
        siret = siret.replace(" ", "")

    # Normalize VAT number: remove extra spaces
    vat = extracted.get("vat_number")
    if vat:
        vat = re.sub(r"\s+", " ", vat).strip()

    return InvoiceFields(
        supplier=extracted.get("supplier"),
        client=extracted.get("client"),
        invoice_number=extracted.get("invoice_number"),
        invoice_date=extracted.get("invoice_date"),
        due_date=extracted.get("due_date"),
        currency=extracted.get("currency"),
        subtotal=_to_float(extracted.get("subtotal")),
        tax=_to_float(extracted.get("tax")),
        total=_to_float(extracted.get("total")),
        siret=siret,
        vat_number=vat,
        client_number=extracted.get("client_number"),
    )


# ---------------------------------------------------------------------------
# invoice2data (uses its own pdftotext internally)
# ---------------------------------------------------------------------------

def _try_invoice2data(file_bytes: bytes, filename: str) -> tuple[InvoiceFields | None, float]:
    if not _templates:
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

    # Discard template name as supplier (e.g. "French Invoice Template")
    issuer = result.get("issuer")
    if issuer and "template" in issuer.lower():
        issuer = None

    fields = InvoiceFields(
        supplier=issuer,
        invoice_number=result.get("invoice_number"),
        invoice_date=_fmt_date(result.get("date")),
        due_date=_fmt_date(result.get("due_date")),
        currency=result.get("currency"),
        total=_to_float(result.get("amount")),
    )
    return fields, 0.75


# ---------------------------------------------------------------------------
# Merge: pick best value per field from two InvoiceFields
# ---------------------------------------------------------------------------

def _merge_fields(a: InvoiceFields | None, b: InvoiceFields | None) -> InvoiceFields:
    """Merge two InvoiceFields, preferring non-null values. a takes priority when both have a value."""
    if not a and not b:
        return InvoiceFields()
    if not a:
        return b  # type: ignore
    if not b:
        return a

    def pick(va, vb):
        if va is not None and va != "":
            return va
        return vb

    return InvoiceFields(
        supplier=pick(a.supplier, b.supplier),
        client=pick(a.client, b.client),
        invoice_number=pick(a.invoice_number, b.invoice_number),
        invoice_date=pick(a.invoice_date, b.invoice_date),
        due_date=pick(a.due_date, b.due_date),
        currency=pick(a.currency, b.currency),
        subtotal=pick(a.subtotal, b.subtotal),
        tax=pick(a.tax, b.tax),
        total=pick(a.total, b.total),
        siret=pick(a.siret, b.siret),
        vat_number=pick(a.vat_number, b.vat_number),
        client_number=pick(a.client_number, b.client_number),
        line_items=a.line_items or b.line_items,
    )


def _count_fields(fields: InvoiceFields | None) -> int:
    """Count how many key fields are non-null."""
    if not fields:
        return 0
    count = 0
    for f in ("supplier", "client", "invoice_number", "invoice_date", "due_date", "currency", "subtotal", "tax", "total"):
        v = getattr(fields, f, None)
        if v is not None and v != "":
            count += 1
    return count


# ---------------------------------------------------------------------------
# LLM fallback
# ---------------------------------------------------------------------------

def _try_llm_extraction(raw_text: str) -> tuple[InvoiceFields, float, dict]:
    api_key = settings.MINIMAX_API_KEY
    if not api_key:
        logger.warning("MINIMAX_API_KEY not set, skipping LLM extraction")
        return InvoiceFields(), 0.0, {}

    client = anthropic.Anthropic(api_key=api_key, base_url="https://api.minimax.io/anthropic")
    model = "MiniMax-M2.7-highspeed"

    prompt = f"""Extract structured invoice data from the following text. Return ONLY valid JSON with no markdown, no explanation.

The JSON must have exactly these keys:
- "supplier": string or null (company that issued the invoice)
- "client": string or null (person or company billed, from "Bill To" / "Destinataire")
- "invoice_number": string or null
- "invoice_date": string (YYYY-MM-DD) or null
- "due_date": string (YYYY-MM-DD) or null
- "currency": string (3-letter code) or null
- "subtotal": number or null
- "tax": number or null
- "total": number or null
- "siret": string or null (SIRET number, 14 digits)
- "vat_number": string or null (VAT/TVA number, e.g. "FR 32 784257164")
- "client_number": string or null (customer/client account number)
- "line_items": array of objects with keys "description" (string), "quantity" (number or null), "unit_price" (number or null), "amount" (number or null)

Invoice text:
---
{raw_text[:8000]}
---

Return ONLY the JSON object:"""

    # Initialize outside try so token counts survive parse errors
    llm_info: dict = {"model": model}

    try:
        message = client.messages.create(model=model, max_tokens=8000, messages=[{"role": "user", "content": prompt}])
        llm_info["input_tokens"] = getattr(message.usage, "input_tokens", 0)
        llm_info["output_tokens"] = getattr(message.usage, "output_tokens", 0)

        response_text = ""
        for block in message.content:
            if block.type == "text" and block.text:
                response_text = block.text.strip()
                break

        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1])

        data = json.loads(response_text)
        line_items = [LineItem(**item) for item in data.get("line_items", [])]
        fields = InvoiceFields(
            supplier=data.get("supplier"),
            client=data.get("client"),
            invoice_number=data.get("invoice_number"),
            invoice_date=data.get("invoice_date"),
            due_date=data.get("due_date"),
            currency=data.get("currency"),
            subtotal=_to_float(data.get("subtotal")),
            tax=_to_float(data.get("tax")),
            total=_to_float(data.get("total")),
            siret=data.get("siret"),
            vat_number=data.get("vat_number"),
            client_number=data.get("client_number"),
            line_items=line_items,
        )
        return fields, 0.85, llm_info
    except Exception as e:
        logger.error("LLM extraction failed: %s", e)
        return InvoiceFields(), 0.0, llm_info


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        s = str(val).strip().replace(" ", "").replace("'", "")
        if "," in s and "." in s:
            # Determine format by which separator comes last
            if s.rfind(",") > s.rfind("."):
                # European: 1.234,56 → 1234.56
                s = s.replace(".", "").replace(",", ".")
            else:
                # US: 1,353.08 → 1353.08
                s = s.replace(",", "")
        elif "," in s:
            # 179,81 → 179.81 (single comma = decimal separator)
            s = s.replace(",", ".")
        return float(s)
    except (ValueError, TypeError):
        return None


def _fmt_date(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    return str(val)
