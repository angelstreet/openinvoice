## Product Requirements Document (PRD)

**Product**: Invoice Inbox (API-first invoice extraction for Microsoft 365 workflows)
**Core stack**: FastAPI backend + optional React UI + Microsoft integration (Power Automate, Teams, Copilot Studio)

---

# 1. Objective

Provide a **low-friction invoice processing service** that:

* ingests invoices from email or shared folders
* extracts structured data
* integrates directly into Microsoft workflows

Primary value:

> "Drop invoices into your existing tools -> get structured, validated data"

---

# 2. System Overview

## Core components

1. **FastAPI backend (core product)**
2. **Document processing pipeline (OCR + extraction)**
3. **Microsoft integration layer**
4. **Optional review UI (React embedded in Teams)**

---

# 3. Backend (FastAPI)

## Why FastAPI

* native OpenAPI -> required for Power Automate / Copilot connectors
* async support -> file processing, webhooks
* strong typing -> structured invoice schema

---

## API Design

### 1. Upload / ingestion

```
POST /documents
```

* input: file (PDF/image)
* output:

```json
{
  "id": "doc_123",
  "status": "processing"
}
```

---

### 2. Get result

```
GET /documents/{id}
```

returns:

```json
{
  "id": "doc_123",
  "status": "completed",
  "confidence": 0.92,
  "fields": {
    "supplier": "ABC AG",
    "invoice_number": "INV-2025-001",
    "invoice_date": "2025-01-10",
    "due_date": "2025-02-10",
    "currency": "CHF",
    "total": 1200.50,
    "tax": 92.50
  }
}
```

---

### 3. Webhook (for Power Automate async)

```
POST /webhooks/result
```

---

### 4. Review correction

```
POST /documents/{id}/review
```

---

# 4. Processing Pipeline (3 steps)

## STEP 1 -- Acquisition

### Sources

* Outlook shared mailbox
* SharePoint / OneDrive folder
* manual upload (API/UI)

### Implementation

**Option A: Power Automate trigger**

* "When a new email arrives (with attachment)"
* "When file is created in SharePoint"

Power Automate then:
-> calls your API

---

## STEP 2 -- Text extraction

```
PDF bytes → pdfplumber → 30+ chars per page?
  ├─ YES → return text (method: pdfplumber)
  └─ NO  → Tesseract OCR on full PDF (method: OCR)
```

* **pdfplumber** — primary, works on native-text PDFs
* **Tesseract OCR** — fallback for scanned/image-based PDFs (via pdf2image + Pillow)

---

## STEP 3 -- Field extraction (4-layer cascade)

Each layer only runs if previous layers didn't find all required fields (`supplier`, `invoice_number`, `total`). This minimizes cost (LLM calls) and latency.

```
Layer 1: Regex ──── found required? ──→ YES ──→ Layer 3 (fill gaps) ──→ done
                         │ NO
                         ▼
Layer 2: invoice2data ── found required? ──→ YES ──→ Layer 3 (fill gaps) ──→ done
                              │ NO
                              ▼
Layer 3: Edge-case regex ─── found required? ──→ YES ──→ done
                                  │ NO
                                  ▼
Layer 4: LLM fallback ─────────────────────────────→ done
```

### Layer 1 — Custom regex (~1ms, free)

Pattern-based extraction on pdfplumber text. Covers:

* **English**: Invoice, Bill To, Date, Total, Balance Due, Tax
* **French**: Facture, Facture n°, Date fact, Date de facture, Net à payer TTC, Montant TTC, Échéance, TVA, SIRET
* **German**: Rechnung, Betrag, MwSt, Zahlbar bis
* **Swiss**: CHF, Datum, Fällig

Also extracts: supplier (via legal-form suffix — S.A.S., SARL, GmbH, Ltd, Inc), client, client_number, currency, SIRET, VAT number.

Stops here if all required fields found (most invoices).

### Layer 2 — invoice2data templates (~30ms, free)

192 built-in vendor-specific templates + 3 custom templates in `/backend/templates/`. Only runs when Layer 1 missed required fields. Results merged with Layer 1 (Layer 1 takes priority).

### Layer 3 — Edge-case regex (free)

Targeted patterns for known tricky formats that standard regex can't handle (e.g. table-column layouts with underscore artifacts, values on separate lines from their headers). **Only runs for fields still missing** — never re-extracts fields already found.

This is the place to add new patterns as we encounter invoice formats that break Layers 1-2, without falling back to LLM.

### Layer 4 — LLM fallback (~2-5s, ~$0.001/invoice)

MiniMax M2.7 via Anthropic-compatible API. Sends first 8000 chars of raw text, expects structured JSON. Only runs when all regex layers failed to find required fields. Returns confidence 0.85.

---

## Validation

* Required fields present (supplier, invoice_number, invoice_date, total)
* Invoice number doesn't look like a date
* Totals arithmetic: |subtotal + tax - total| ≤ 0.02
* Tax rate sanity: tax/subtotal ≤ 30%
* Line items sum matches subtotal
* Duplicate detection (same invoice_number + total + supplier)

---

# 5. Microsoft Integration

---

## A. Power Automate integration (core)

### Approach: Custom Connector

Power Platform supports connectors built from OpenAPI specs.

### Steps

#### 1. Expose OpenAPI from FastAPI

FastAPI auto-generates:

```
/openapi.json
```

---

#### 2. Create connector in Power Automate

* import OpenAPI spec
* define:

  * POST /documents
  * GET /documents/{id}

---

#### 3. Build flow

Example flow:

1. Trigger:

   * "When new email arrives (Outlook)"

2. Action:

   * "Get attachment"

3. Action:

   * call your API (POST /documents)

4. Loop:

   * poll GET /documents/{id}

5. Condition:

   * if confidence < threshold -> approval

6. Output:

   * store in SharePoint / Dataverse

---

## B. Copilot Studio integration

Copilot Studio can call connectors.

### Use cases

* "Show invoices pending approval"
* "What invoices failed extraction?"

### Steps

1. Add your connector to Copilot Studio
2. Define actions:

   * get invoices
   * trigger processing
3. Create conversational topics

This is optional layer, not core pipeline.

---

# 6. Teams UI Integration

## Approach: Teams Tab (recommended)

Teams tabs allow embedding web apps.

---

## Steps

### 1. Build React UI

Pages:

* `/queue`
* `/document/{id}`

---

### 2. Host UI

* Vercel / AWS / Azure

---

### 3. Create Teams app manifest

```json
{
  "tabs": [
    {
      "entityId": "invoice-review",
      "name": "Invoice Review",
      "contentUrl": "https://yourapp.com",
      "scopes": ["personal", "team"]
    }
  ]
}
```

---

### 4. Upload to Teams

* Teams Admin -> Apps -> Upload custom app

---

### Result

Users open:
-> Teams tab
-> your React UI loads inside Teams

---

# 7. UI Requirements (minimal)

## Required screens

### 1. Queue

* list invoices
* status:

  * processing
  * needs review
  * completed

---

### 2. Review screen

* PDF viewer (left)
* extracted fields (right)
* edit + approve
* confidence indicators

---

### 3. Settings

* mailbox / folder config
* export config

---

# 8. Architecture Diagram (simplified)

```
[Outlook / SharePoint / Manual upload]
        |
[Power Automate / Webhook / UI]
        |
[FastAPI API]
        |
[Text extraction]
  pdfplumber → Tesseract OCR fallback
        |
[Field extraction — 4-layer cascade]
  1. Custom regex
  2. invoice2data (192 templates)
  3. Edge-case regex (gap filler)
  4. LLM fallback (MiniMax M2.7)
        |
[Validation + AI feedback]
        |
[SQLite DB]
        |
[Teams UI / React UI / API / CSV export]
```

---

# 9. Tech Stack

## Backend

* FastAPI
* PostgreSQL
* Redis (queue)
* Celery / Dramatiq

## Processing

* pdfplumber (text extraction)
* Tesseract OCR + pdf2image (scanned PDF fallback)
* Custom regex (primary field extraction)
* invoice2data (192 vendor templates)
* MiniMax M2.7 LLM (last-resort fallback)

## Frontend

* React

## Infra

* Docker
* AWS / Azure

---

# 10. Key Decisions

## Should you use invoice2data?

Yes, for MVP:

* fast to implement
* good baseline accuracy
* supports templates

But:

* limited for unknown layouts
* combine with LLM fallback

---

## Should you rely only on AI vision?

No:

* too expensive
* less deterministic
* harder to audit

---

# 11. MVP Scope

Build only:

* FastAPI API
* basic pipeline (PDF + OCR + invoice2data)
* Power Automate connector
* Teams tab UI (review only)

---

# 12. Success Criteria

* < 5 min setup with Power Automate
* > 80% correct extraction without review
* review time < 30 seconds per invoice
* zero need to leave Teams for normal users

---

If needed, next step can be:

* OpenAPI spec example
* Power Automate flow JSON
* database schema
* invoice field extraction prompt for LLM fallback
