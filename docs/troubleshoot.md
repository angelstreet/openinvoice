# OpenInvoice — Troubleshooting

## 401 Unauthorized after Teams tab idle / API restart

**Symptom:** All API calls return 401. Console shows `Failed to load resource: 401`. The app shows "Authentication required" in Teams.

**Cause:** The Teams session token (JWT) has expired or the cached token in `sessionStorage` is stale. This happens when:
- The API was restarted (PM2 restart) — existing tokens are still valid if `APP_JWT_SECRET` hasn't changed
- The user was idle for longer than the token TTL (8 hours)
- The token was issued with an old TTL (1 hour) before the TTL was extended
- `sessionStorage` was cleared by the browser

**Fix:**
1. **Close the Teams tab completely** and reopen the OpenInvoice app. This clears `sessionStorage` and triggers a fresh auth via `POST /api/auth/teams-context`.
2. If that doesn't work, check `APP_JWT_SECRET` is set:
   - It must be in `backend/.env` (e.g., `APP_JWT_SECRET=XGeUFQ0BqEH2foVRi_5TBsFS4cWUBr4ZJ8jWcPnX5YU`)
   - Verify it's loaded: the `/api/auth/teams-context` endpoint returns 503 if not set
3. Test the auth endpoint directly:
   ```bash
   curl -s -X POST https://openinvoice.angelstreet.io/api/auth/teams-context \
     -H "Content-Type: application/json" \
     -d '{"user_id":"test","team":"openinvoice"}'
   ```
   Should return a `token` field. If 503, `APP_JWT_SECRET` is missing.

**Prevention:** Token TTL is set to 8 hours (`backend/routes/teams_auth.py`). The frontend caches the token in `sessionStorage` and auto-refreshes 30 minutes before expiry. A `visibilitychange` listener re-authenticates when the user returns to the tab after idle.

**Note:** `APP_JWT_SECRET` is in `backend/.env`, NOT in `ecosystem.config.js`. PM2 picks it up because uvicorn runs from the `backend/` directory where `.env` is loaded by pydantic-settings.

## Webhook ingestion returns 401

**Symptom:** Power Automate flow shows success but no invoice appears in History. API logs show `POST /api/webhook/ingest 401 Unauthorized`.

**Cause:** The `X-Webhook-Key` header value doesn't match `WEBHOOK_KEY` in the server config.

**Fix:**
1. Check what key the server expects:
   ```bash
   grep WEBHOOK_KEY ~/shared/projects/openinvoice/ecosystem.config.js
   ```
2. Update the Power Automate flow's HTTP header to match exactly (no extra spaces)
3. The server trims whitespace, but the key itself must match

**Current key:** `Am_gEll_vLLN-zu8Y8Qau1HSZQDriyLkR7t0JRUn5J8`

## Filenames show UUID prefix in History

**Symptom:** Ingested invoices show filenames like `0795214d-a146-431d-9cb9-5ed455155a7c_invoice.pdf` instead of just `invoice.pdf`.

**Cause:** The file was previously uploaded to OpenInvoice (which saves files as `{uuid}_{filename}` on disk), then that file was placed in OneDrive and re-ingested via webhook. The webhook receives whatever filename Power Automate sends.

**Fix:** The webhook endpoint now strips UUID prefixes automatically. If you see old entries with UUID filenames, the documents were ingested before this fix.

**Pattern stripped:** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_` (standard UUID v4 prefix followed by underscore).

## PDF preview fails in Teams

**Symptom:** "Failed to render PDF" or blank preview in the Teams tab.

**Cause:** Teams' embedded browser blocks blob URLs in nested iframes. The PDF preview uses pdf.js with `ArrayBuffer` (not blob URLs) to work around this.

**Fix:** If pdf.js fails, check the browser console for the specific error. Common issues:
- The pdf.js worker CDN URL (`cdn.jsdelivr.net`) is blocked — check network tab
- The file content is corrupted or empty

## Power Automate "Graph endpoint" error

**Symptom:** Power Automate action fails with "URI path is not a valid Graph endpoint".

**Cause:** You're using the **Office 365 Outlook** "Send an HTTP request" connector, which can only call Microsoft Graph APIs, not external URLs.

**Fix:** Use the **standard HTTP connector** (premium) instead. It can call any URL. The Office 365 connector is limited to `graph.microsoft.com` endpoints.
