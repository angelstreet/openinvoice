# OpenInvoice — Webhook Ingestion

## Overview

OpenInvoice exposes a webhook endpoint that accepts invoice files (PDF, PNG, JPG) from external systems. This enables automatic ingestion from Microsoft 365 services via Power Automate:

- **Outlook** — new email arrives with PDF attachment
- **OneDrive** — new file added to an Invoices folder
- **SharePoint** — new file uploaded to a document library

## Architecture

```
Microsoft 365                          OpenInvoice
─────────────                          ───────────
Outlook email arrives ──┐
OneDrive file created ──┤  Power Automate flow
SharePoint file added ──┘       │
                                │  POST /api/webhook/ingest
                                │  Headers: X-Webhook-Key: <secret>
                                │  Body: multipart (file + metadata)
                                ▼
                        ┌──────────────────┐
                        │ Validate API key │
                        │ Validate file    │
                        │ Run pipeline     │ (same as manual upload)
                        │ Save to DB       │
                        └──────────────────┘
                                │
                        Document in History
                        (source: outlook/onedrive/sharepoint)
```

## Webhook Endpoint

### `POST /api/webhook/ingest`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `X-Webhook-Key` | Yes | API key for authentication |

**Body (multipart/form-data):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF, PNG, or JPG (max 10 MB) |
| `source` | String | No | `outlook`, `onedrive`, `sharepoint` (default: `webhook`) |
| `sender_email` | String | No | Email sender (Outlook) |
| `subject` | String | No | Email subject (Outlook) |
| `folder_path` | String | No | Source folder (OneDrive/SharePoint) |

**Response (200):**
```json
{
  "document_id": "abc-123",
  "job_id": "def-456",
  "status": "processing",
  "message": "Invoice queued for extraction"
}
```

**Errors:**
| Code | Reason |
|------|--------|
| 401 | Missing or invalid `X-Webhook-Key` |
| 400 | Invalid file type, empty file, or file too large |

## Configuration

Add to `.env`:
```
WEBHOOK_KEY=your-secret-key-here
```

## Power Automate Setup

### Flow 1: Outlook — New email with invoice attachment

1. **Trigger:** "When a new email arrives (V3)"
   - Folder: Inbox (or a specific subfolder like "Invoices")
   - Has Attachment: Yes
   - Include Attachments: Yes

2. **Condition:** Check attachment content type
   - `@contains(createArray('application/pdf','image/png','image/jpeg'), items('Apply_to_each')?['ContentType'])`

3. **Action:** "HTTP" (for each attachment)
   - Method: `POST`
   - URI: `https://openinvoice.angelstreet.io/api/webhook/ingest`
   - Headers:
     - `X-Webhook-Key`: your secret key
   - Body: Form-data
     - `file`: attachment content (base64 decoded)
     - `source`: `outlook`
     - `sender_email`: `triggerOutputs()?['body/from']`
     - `subject`: `triggerOutputs()?['body/subject']`

### Flow 2: OneDrive — New file in Invoices folder

1. **Trigger:** "When a file is created" in `/Invoices`
2. **Action:** "Get file content" using file identifier
3. **Action:** "HTTP" POST to webhook with file content
   - `source`: `onedrive`
   - `folder_path`: file path from trigger

### Flow 3: SharePoint — New file in document library

1. **Trigger:** "When a file is created in a folder" (SharePoint site + library)
2. **Action:** "Get file content" using file identifier
3. **Action:** "HTTP" POST to webhook with file content
   - `source`: `sharepoint`
   - `folder_path`: file path from trigger

## Testing

### Quick test with curl

```bash
# Test with a local PDF
curl -X POST https://openinvoice.angelstreet.io/api/webhook/ingest \
  -H "X-Webhook-Key: your-secret-key" \
  -F "file=@invoice.pdf" \
  -F "source=outlook" \
  -F "sender_email=supplier@example.com" \
  -F "subject=Invoice #1234"

# Poll for result
curl https://openinvoice.angelstreet.io/api/extract/{job_id}/status
```

### Test script

A test script is provided at `scripts/test-webhook.sh` to simulate all 3 sources.
