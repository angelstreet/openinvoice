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

### Decision tree

```
if PDF has text:
    use pdfplumber / pdfminer
else:
    convert to image
    run OCR
```

### OCR engines

* PaddleOCR (preferred)
* Tesseract OCR (fallback)

---

## STEP 3 -- Field extraction

### Recommended hybrid

#### Layer 1 -- Rules/templates

Use:

* invoice2data

Pros:

* fast
* deterministic
* good for known vendors

#### Layer 2 -- LLM fallback

Use when:

* template fails
* layout unknown
* OCR noisy

Input:

* raw text or image

Output:

* structured JSON

---

## Final validation

* totals match (subtotal + tax = total)
* currency present
* required fields exist

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
[Outlook / SharePoint]
        |
[Power Automate]
        |
[FastAPI API]
        |
[Processing Pipeline]
  - PDF parse
  - OCR
  - invoice2data
  - LLM fallback
        |
[Database]
        |
[Teams UI / API / Export]
```

---

# 9. Tech Stack

## Backend

* FastAPI
* PostgreSQL
* Redis (queue)
* Celery / Dramatiq

## Processing

* pdfplumber
* PaddleOCR
* invoice2data
* LLM (optional fallback)

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
