"""Text extraction from PDFs (pdfplumber) and images (pytesseract)."""

from __future__ import annotations

import io
import logging
from pathlib import Path

import pdfplumber
import pytesseract
from pdf2image import convert_from_bytes
from PIL import Image

logger = logging.getLogger(__name__)

# Minimum characters to consider a PDF page as having extractable text
MIN_TEXT_LENGTH = 30


def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, int]:
    """Extract text from a PDF using pdfplumber. Falls back to OCR for scanned pages.

    Returns (text, page_count).
    """
    pages_text: list[str] = []
    page_count = 0

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            text = (page.extract_text() or "").strip()
            if len(text) >= MIN_TEXT_LENGTH:
                pages_text.append(text)
            else:
                # Page has little/no extractable text — treat as scanned
                logger.info("Page %d has no text, falling back to OCR", page.page_number)

    # If we got decent text from pdfplumber, return it
    if pages_text:
        return "\n\n".join(pages_text), page_count

    # Otherwise OCR the entire PDF
    logger.info("No extractable text in PDF, running full OCR")
    ocr_text = ocr_pdf_bytes(file_bytes)
    return ocr_text, page_count


def ocr_pdf_bytes(file_bytes: bytes) -> str:
    """Convert PDF bytes to images and OCR each page."""
    images = convert_from_bytes(file_bytes, dpi=300)
    texts: list[str] = []
    for img in images:
        text = pytesseract.image_to_string(img).strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def extract_text_from_image(file_bytes: bytes) -> str:
    """Extract text from an image file using pytesseract OCR."""
    img = Image.open(io.BytesIO(file_bytes))
    text = pytesseract.image_to_string(img).strip()
    return text
