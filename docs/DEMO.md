# Demo Plan — Invoice Upload & Extract

Goal: a working online demo where a user uploads an invoice (PDF or image), and gets back structured extracted data displayed in the UI.

No auth, no Microsoft integration, no queue system — just upload → process → display.

---

## Scope

### What it does

1. User opens the demo page
2. Drags or selects a file (PDF or image)
3. Backend extracts text and fields
4. UI displays the extracted invoice data in a clean structured view

### What it does NOT do

- No login / multi-tenancy
- No Power Automate / Teams / Copilot
- No webhook or async queue
- No database persistence (in-memory or temp files only)
- No review/correction flow

---

## Architecture

```
[Browser]
   |
   | POST /api/extract (multipart file upload)
   |
[FastAPI backend]
   |
   |-- PDF with text? → pdfplumber
   |-- PDF without text / image? → OCR (PaddleOCR or Tesseract)
   |
   |-- Extract fields:
   |     Layer 1: invoice2data (template matching)
   |     Layer 2: LLM fallback (if invoice2data fails or low confidence)
   |
   |-- Validate (totals, required fields)
   |
   | returns JSON
   |
[Browser displays result]
```

---

## Backend

### Stack

- Python 3.11+
- FastAPI
- pdfplumber (text extraction from digital PDFs)
- pdf2image + Pillow (PDF → image conversion for scanned docs)
- PaddleOCR (primary OCR) or Tesseract (fallback)
- invoice2data (rule-based field extraction)
- LLM fallback via API (Claude or OpenAI) for unknown layouts

### API

Single endpoint:

```
POST /api/extract
Content-Type: multipart/form-data
Body: file (PDF or image)
```

Response:

```json
{
  "filename": "invoice.pdf",
  "pages": 1,
  "raw_text": "...",
  "confidence": 0.89,
  "fields": {
    "supplier": "ABC AG",
    "invoice_number": "INV-2025-001",
    "invoice_date": "2025-01-10",
    "due_date": "2025-02-10",
    "currency": "CHF",
    "subtotal": 1108.00,
    "tax": 92.50,
    "total": 1200.50,
    "line_items": [
      {
        "description": "Consulting services",
        "quantity": 8,
        "unit_price": 138.50,
        "amount": 1108.00
      }
    ]
  },
  "warnings": ["tax_rate_unusual"]
}
```

### Processing pipeline

```
receive file
  → detect type (PDF / image)
  → if PDF: try pdfplumber for text
      → if no text found: convert to image via pdf2image
  → if image (or converted): run OCR
  → pass extracted text to invoice2data
  → if invoice2data returns empty or low confidence: call LLM
  → validate fields (required fields present, totals add up)
  → return structured JSON
```

### File structure

```
backend/
  main.py              # FastAPI app, single /api/extract endpoint
  pipeline/
    __init__.py
    extract_text.py    # PDF text extraction + OCR
    extract_fields.py  # invoice2data + LLM fallback
    validate.py        # field validation logic
    schemas.py         # Pydantic models for request/response
  templates/           # invoice2data YAML templates
  requirements.txt
```

---

## Frontend

### Stack

- React (Vite)
- Tailwind CSS
- Single page, no routing needed

### UI Layout

```
┌─────────────────────────────────────────────┐
│  OpenInvoice Demo                           │
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │   Drop invoice here or click to       │  │
│  │   upload (PDF, PNG, JPG)              │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ── after upload ──                         │
│                                             │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │              │  │ Extracted Fields   │  │
│  │  Document    │  │                    │  │
│  │  Preview     │  │ Supplier: ABC AG  │  │
│  │              │  │ Invoice #: INV-.. │  │
│  │  (PDF/image  │  │ Date: 2025-01-10  │  │
│  │   viewer)    │  │ Due: 2025-02-10   │  │
│  │              │  │ Currency: CHF     │  │
│  │              │  │ Total: 1200.50    │  │
│  │              │  │ Tax: 92.50        │  │
│  │              │  │                    │  │
│  │              │  │ Line Items:        │  │
│  │              │  │ ┌────────────────┐ │  │
│  │              │  │ │ table rows     │ │  │
│  │              │  │ └────────────────┘ │  │
│  │              │  │                    │  │
│  │              │  │ Confidence: 89%   │  │
│  │              │  │ ⚠ Warnings: ...  │  │
│  └──────────────┘  └────────────────────┘  │
│                                             │
│  [ Download JSON ]  [ Try Another ]         │
└─────────────────────────────────────────────┘
```

### Features

- Drag & drop or click-to-upload
- Loading spinner during processing
- Split view: document preview (left) + extracted fields (right)
- Confidence score with color indicator (green/yellow/red)
- Warnings displayed if validation issues found
- Download raw JSON button
- "Try another" to reset

### File structure

```
frontend/
  src/
    App.tsx
    components/
      UploadZone.tsx      # drag & drop area
      DocumentPreview.tsx  # PDF/image viewer
      ExtractedFields.tsx  # structured field display
      LineItemsTable.tsx   # line items table
  index.html
  vite.config.ts
  package.json
  tailwind.config.js
```

---

## Implementation Steps

### Phase 1 — Backend core

1. Set up FastAPI project with dependencies
2. Implement PDF text extraction (pdfplumber)
3. Implement image OCR (PaddleOCR or Tesseract)
4. Implement invoice2data field extraction with a few sample templates
5. Implement LLM fallback extraction
6. Implement field validation
7. Wire up `/api/extract` endpoint
8. Test with sample invoices

### Phase 2 — Frontend

1. Scaffold React + Vite + Tailwind project
2. Build upload zone component
3. Build document preview (PDF.js for PDFs, img tag for images)
4. Build extracted fields display
5. Build line items table
6. Add loading state, error handling
7. Add JSON download button
8. Connect to backend API

### Phase 3 — Polish & deploy

1. Add CORS config for frontend ↔ backend
2. Add file size limit (10MB) and type validation
3. Add rate limiting (prevent abuse on public demo)
4. Dockerize backend and frontend
5. Deploy (backend on our infra, frontend on Vercel or same server)
6. Test end-to-end with real invoices

---

## Dependencies

### Python

```
fastapi
uvicorn
python-multipart
pdfplumber
pdf2image
Pillow
paddleocr  # or pytesseract
invoice2data
anthropic  # or openai, for LLM fallback
```

### System

```
poppler-utils  # for pdf2image
```

### Node

```
react
react-dom
vite
tailwindcss
@react-pdf-viewer/core  # or pdfjs-dist
```

---

## Hosting (demo)

- Backend: VM on our infra or Docker on node 2
- Frontend: Vercel or co-hosted with backend
- Domain: TBD (e.g. demo.openinvoice.ch or openinvoice.angelstreet.io)
