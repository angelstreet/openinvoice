# OpenInvoice

**AI-powered invoice data extraction** — upload a PDF or image, get structured data back in seconds.

OpenInvoice extracts key fields from invoices using a cascading pipeline: fast regex patterns first, template matching second, and LLM as a last resort. No manual data entry, no per-document fees from third-party OCR APIs.

## What it does

- **Upload** a PDF or scanned invoice (PNG, JPG)
- **Extract** supplier, client, invoice number, date, total, tax, currency, SIRET, VAT number, client number, and line items
- **Review** extracted fields side-by-side with the original document
- **Correct** any field inline — corrections are tracked separately from the original extraction
- **Export** to CSV or JSON
- **Dashboard** with volume, success rates, supplier distribution, and LLM cost tracking

## How extraction works

OpenInvoice uses a 3-layer cascading pipeline — each layer only runs if the previous one didn't find all required fields:

| Layer | Method | Speed | Cost |
|-------|--------|-------|------|
| 1. **Regex** | Custom patterns on extracted text (pdfplumber) | ~1ms | Free |
| 2. **invoice2data** | 190+ vendor-specific templates | ~30ms | Free |
| 3. **LLM fallback** | MiniMax M2.7 via Anthropic-compatible API | ~5-20s | ~$0.001/invoice |

Most invoices resolve at layer 1 or 2 with zero LLM cost. The LLM only activates when regex and templates can't find the supplier, invoice number, or total.

### Supported formats

- Standard English invoices (INVOICE, Bill To, Total, Balance Due)
- French invoices (FACTURE, Facture n°, Date de facture, Net à payer TTC, SIRET, TVA)
- German invoices (Rechnung, Betrag, MwSt)
- Swiss invoices (CHF, Zahlbar bis)
- 190+ vendor-specific templates (built-in from invoice2data)

## Tech stack

| Component | Technology |
|-----------|------------|
| Backend | Python, FastAPI, SQLAlchemy, pdfplumber, pytesseract, invoice2data |
| Frontend | React 18, TypeScript, Tailwind CSS, PDF.js, Recharts |
| Auth | Clerk (optional — works without auth in demo mode) |
| LLM | MiniMax M2.7 via Anthropic SDK (pay-per-use, ~$0.10/1M input tokens) |
| Database | SQLite (default) or PostgreSQL |

## License & Business Model

**OpenInvoice is free and open source.** The code is yours to read, run, and modify.

The business model is **B2B service and integration** — we deploy OpenInvoice on your infrastructure, integrate it with your existing systems (ERP, accounting, Microsoft 365, email ingestion), and provide ongoing support. You pay for the service, not the code.

Typical integrations:
- **Microsoft Teams** — extract invoices from chat messages and channels
- **Outlook / email** — automatic ingestion from a mailbox via Power Automate
- **OneDrive / SharePoint** — watch folders for new invoices
- **Webhook API** — push invoices from any system

## Quick start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Tesseract OCR (`apt install tesseract-ocr`)
- poppler-utils (`apt install poppler-utils`)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit with your MINIMAX_API_KEY
uvicorn main:app --host 0.0.0.0 --port 5023 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --port 3023
```

Open `http://localhost:3023` — the demo page works without authentication.

## API

### Extract an invoice

```bash
curl -X POST http://localhost:5023/api/extract \
  -F "file=@invoice.pdf"
# Returns: { "job_id": "..." }

# Poll for result
curl http://localhost:5023/api/extract/{job_id}/status
```

### Webhook ingestion

```bash
curl -X POST http://localhost:5023/api/webhook/ingest \
  -H "X-Webhook-Key: your-key" \
  -F "file=@invoice.pdf" \
  -F "source=outlook" \
  -F "metadata={\"sender_email\":\"supplier@example.com\"}"
```

### Document management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List documents (paginated, filterable) |
| `/api/documents/{id}` | GET | Get document with all extracted data |
| `/api/documents/{id}` | PATCH | Update corrected fields or feedback |
| `/api/documents/{id}/file` | GET | Download original file |
| `/api/documents/export/csv` | GET | Export filtered documents as CSV |
| `/api/dashboard/stats` | GET | Aggregated stats |
| `/api/dashboard/quality` | GET | Quality metrics and LLM usage |

## Contact

For deployment, integration, or support inquiries: **hello@angelstreet.io**
