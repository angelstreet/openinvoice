# OpenInvoice — Webhook Ingestion

## Overview

OpenInvoice exposes a webhook endpoint that accepts invoice files (PDF, PNG, JPG) from external systems. This enables automatic ingestion from Microsoft 365 via Power Automate.

**OneDrive `/Invoices` is the single source of truth.** Subfolders differentiate the origin:

- `/Invoices/email/` — Outlook attachments (saved by Flow 1)
- `/Invoices/` (root) — manual drops from OneDrive or SharePoint

Two separate OneDrive flows watch each location and tag the source accordingly.

## Architecture

```
Outlook email with PDF
        │
        ▼
Flow 1: Save attachment to OneDrive /Invoices/email/

OneDrive /Invoices/
├── email/    ← Flow 2 watches this (source=outlook)
│   └── invoice.pdf
└── manual/   ← Flow 3 watches root, excludes /email/ (source=onedrive)
    └── invoice.pdf

Flow 2: /Invoices/email/ ──→ POST /api/webhook/ingest (source=outlook)
Flow 3: /Invoices/        ──→ POST /api/webhook/ingest (source=onedrive)
                                      │
                                      ▼
                              ┌──────────────────┐
                              │ Validate API key │
                              │ Validate file    │
                              │ Run pipeline     │
                              │ Save to DB       │
                              └──────────────────┘
                                      │
                              Document in History
                              (source: outlook or onedrive)
```

All flows use `team=openinvoice` so documents from email, OneDrive, and Teams manual upload share the same history.

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
| `source` | String | No | `outlook`, `onedrive`, `sharepoint`, `webhook` (default: `webhook`) |
| `team` | String | No | Team identifier for shared history (use `openinvoice`) |
| `sender_email` | String | No | Original email sender |
| `subject` | String | No | Original email subject |
| `folder_path` | String | No | Source folder path in OneDrive/SharePoint |

**Response (200):**
```json
{
  "document_id": null,
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
| 503 | `WEBHOOK_KEY` not configured on server |

## Configuration

Add to `.env` or `ecosystem.config.js`:
```
WEBHOOK_KEY=your-secret-key-here
```

## Power Automate Setup

You need **3 flows** total.

### Flow 1: Outlook → OneDrive /Invoices/email/ (save attachments)

Saves PDF attachments from incoming emails into the `/Invoices/email/` subfolder.

1. **Create:** Go to https://make.powerautomate.com > Create > Automated cloud flow
2. **Name:** `OpenInvoice - Save Email Attachments`
3. **Trigger:** "When a new email arrives (V3)" (Office 365 Outlook)
   - Folder: Inbox
   - Only with Attachments: Yes
   - Include Attachments: Yes

4. **Add action:** "Apply to each"
   - Select output: **Attachments**

5. **Inside loop — Condition:**
   - Attachment Content Type `is equal to` `application/pdf`
   - (Add "or" conditions for `image/png`, `image/jpeg` if needed)

6. **If yes — Add action:** "Create file" (OneDrive for Business)
   - Folder Path: `/Invoices/email`
   - File Name: **Attachment Name** (from dynamic content)
   - File Content: **Attachment Content** (from dynamic content)

7. **Save** the flow.

### Flow 2: OneDrive /Invoices/email/ → Webhook (email source)

Watches the email subfolder and sends files to the webhook tagged as `source=outlook`.

1. **Create:** Automated cloud flow
2. **Name:** `OpenInvoice - Ingest Email Invoices`
3. **Trigger:** "When a file is created" (OneDrive for Business)
   - Folder: `/Invoices/email`

4. **Add action:** "Get file content" (OneDrive for Business)
   - File: select **File identifier** from trigger

5. **Add action:** "HTTP"
   - Method: `POST`
   - URI: `https://openinvoice.angelstreet.io/api/webhook/ingest`
   - Headers: `X-Webhook-Key` = `your-secret-key`

   Switch to code view (`</>`) for the body:
   ```json
   {
     "$content-type": "multipart/form-data",
     "$multipart": [
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"file\"; filename=\"@{triggerOutputs()?['headers/x-ms-file-name']}\""
         },
         "body": @{body('Get_file_content')}
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"source\""
         },
         "body": "outlook"
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"team\""
         },
         "body": "openinvoice"
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"folder_path\""
         },
         "body": "@{triggerOutputs()?['headers/x-ms-file-path']}"
       }
     ]
   }
   ```

6. **Save** the flow.

### Flow 3: OneDrive /Invoices/ root → Webhook (manual drops)

Watches the root `/Invoices` folder and sends files to the webhook tagged as `source=onedrive`. Excludes files in the `/email/` subfolder to avoid double-processing.

1. **Create:** Automated cloud flow
2. **Name:** `OpenInvoice - Ingest OneDrive Invoices`
3. **Trigger:** "When a file is created" (OneDrive for Business)
   - Folder: `/Invoices`

4. **Add a Condition** (exclude email subfolder):
   - Left: **File path** (from dynamic content, or use expression `triggerOutputs()?['headers/x-ms-file-path']`)
   - Operator: **does not contain**
   - Right: `/email/`

5. **If yes — Add action:** "Get file content" (OneDrive for Business)
   - File: select **File identifier** from trigger

6. **Add action:** "HTTP"
   - Method: `POST`
   - URI: `https://openinvoice.angelstreet.io/api/webhook/ingest`
   - Headers: `X-Webhook-Key` = `your-secret-key`

   Switch to code view (`</>`) for the body:
   ```json
   {
     "$content-type": "multipart/form-data",
     "$multipart": [
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"file\"; filename=\"@{triggerOutputs()?['headers/x-ms-file-name']}\""
         },
         "body": @{body('Get_file_content')}
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"source\""
         },
         "body": "onedrive"
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"team\""
         },
         "body": "openinvoice"
       },
       {
         "headers": {
           "Content-Disposition": "form-data; name=\"folder_path\""
         },
         "body": "@{triggerOutputs()?['headers/x-ms-file-path']}"
       }
     ]
   }
   ```

7. **If no:** leave empty (files in `/email/` are handled by Flow 2).

8. **Save** the flow.

### Optional: SharePoint → OneDrive

If invoices also land in a SharePoint document library:

1. **Trigger:** "When a file is created in a folder" (SharePoint)
2. **Action:** "Get file content" (SharePoint)
3. **Action:** "Create file" (OneDrive) in `/Invoices` (root, not `/email/`)

This funnels SharePoint files into the OneDrive root folder, and Flow 3 handles the rest with `source=onedrive`.

## OneDrive Folder Structure

Create this in your OneDrive before enabling the flows:

```
Invoices/
├── email/       ← auto-populated by Flow 1 (Outlook attachments)
└── (root)       ← manual drops, SharePoint copies
```

## Flow Summary

| Flow | Name | Watches | Sends to | Source tag |
|------|------|---------|----------|------------|
| 1 | Save Email Attachments | Outlook Inbox | OneDrive `/Invoices/email/` | — |
| 2 | Ingest Email Invoices | OneDrive `/Invoices/email/` | Webhook | `outlook` |
| 3 | Ingest OneDrive Invoices | OneDrive `/Invoices/` (excludes `/email/`) | Webhook | `onedrive` |

All flows use `team=openinvoice` for shared history across Teams tab, email, and OneDrive.

## Testing

### Quick test with curl

```bash
# Simulate an email-sourced invoice
curl -X POST https://openinvoice.angelstreet.io/api/webhook/ingest \
  -H "X-Webhook-Key: your-secret-key" \
  -F "file=@invoice.pdf" \
  -F "source=outlook" \
  -F "team=openinvoice"

# Simulate an OneDrive-sourced invoice
curl -X POST https://openinvoice.angelstreet.io/api/webhook/ingest \
  -H "X-Webhook-Key: your-secret-key" \
  -F "file=@invoice.pdf" \
  -F "source=onedrive" \
  -F "team=openinvoice" \
  -F "folder_path=/Invoices"

# Poll for result
curl https://openinvoice.angelstreet.io/api/extract/{job_id}/status
```

### End-to-end test with Microsoft dev account

1. **Outlook test:**
   - Send yourself an email with a PDF invoice attached
   - Flow 1 saves it to OneDrive `/Invoices/email/`
   - Flow 2 sends it to webhook with `source=outlook`
   - Check History page — should show source=outlook

2. **OneDrive test:**
   - Drop a PDF directly into OneDrive `/Invoices/` (root, not email/)
   - Flow 3 sends it to webhook with `source=onedrive`
   - Check History page — should show source=onedrive

3. **Verify:** Each test should complete within 1-5 minutes (Power Automate polling interval)

### Test script

```bash
./scripts/test-webhook.sh invoice.pdf outlook
./scripts/test-webhook.sh invoice.pdf onedrive
```
