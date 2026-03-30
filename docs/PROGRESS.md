# OpenInvoice — Progress & Roadmap

**Repo:** https://github.com/angelstreet/openinvoice
**Live:** https://openinvoice.angelstreet.io
**Date:** 2026-03-30

---

## What's Done

### Infrastructure
- [x] Project bootstrapped at `~/shared/projects/openinvoice`
- [x] GitHub public repo (`angelstreet/openinvoice`)
- [x] Nginx config on VM 133 — `openinvoice.angelstreet.io` (dedicated domain, no subpath)
- [x] PM2 services: `openinvoice-api` (port 5023), `openinvoice-web` (port 3023)
- [x] Registered in `workspace/apps.md`
- [x] Logo + favicon

### Backend (FastAPI)
- [x] Single SSE endpoint `POST /api/extract` — streams real-time processing steps with timing
- [x] 3-step extraction pipeline:
  - **Text extraction:** pdfplumber (digital PDFs) + pytesseract OCR (scanned PDFs / images)
  - **Field extraction:** invoice2data template matching (Layer 1) → MiniMax-M2.7-highspeed LLM fallback via Anthropic-compatible API (Layer 2)
  - **Validation:** required fields check, totals verification, tax rate sanity
- [x] Extracted fields: supplier, invoice_number, invoice_date, due_date, currency, subtotal, tax, total, line_items[]
- [x] Centralized config via pydantic-settings (`backend/config.py`) — all settings from `.env`
- [x] SQLite database (default, zero-config) with SQLAlchemy 2.x
  - `documents` table: stores all extraction results + metadata
  - Auto-creates tables on startup
  - Switchable to PostgreSQL via `DATABASE_URL` env var
- [x] File storage: uploaded PDFs/images saved to `backend/uploads/`
- [x] API routes:
  - `GET /api/documents` — paginated list with search/sort
  - `GET /api/documents/{id}` — single document
  - `GET /api/documents/{id}/file` — serve original file
  - `GET /api/dashboard/stats` — aggregated KPIs
- [x] Clerk JWT auth (optional, gated by `CLERK_SECRET_KEY`)
  - Extract endpoint: open (saves user_id if authenticated)
  - Documents/dashboard: require auth when Clerk is configured, open otherwise
- [x] Alembic ready for migrations (not yet initialized with `alembic init`)

### Frontend (React + Vite + Tailwind)
- [x] Upload zone: drag & drop or click, accepts PDF/PNG/JPG, 10MB limit
- [x] Real-time processing log: terminal-style SSE log with elapsed time per step
- [x] Result view: split layout — document preview (left) + extracted fields (right)
- [x] Confidence badge (green/yellow/red), validation warnings display
- [x] Download JSON button
- [x] i18n: English/French with toggle in header
- [x] Clerk auth integration (optional, gated by `VITE_CLERK_PUBLISHABLE_KEY`)
  - Sign in/out button in header
  - AuthContext with ClerkAuthProvider / NoAuthProvider
  - ProtectedRoute component
- [x] React Router: `/` (demo), `/history`, `/history/:id`, `/dashboard`
- [x] History page: paginated document list with search, sort, status/confidence badges
- [x] Document detail page: PDF preview + extracted fields from stored data
- [x] Dashboard page: KPI cards + Recharts charts (invoices/month, supplier distribution, amounts/month, top suppliers)
- [x] Mobile layout: bottom nav bar (Konto pattern) when logged in, responsive header
- [x] Footer with DEMO badge

### Auth (Clerk Dev)
- [x] Clerk dev instance configured (`easy-sunfish-42`)
- [x] Backend: PyJWT + JWKS verification
- [x] Frontend: @clerk/clerk-react with conditional provider
- [x] Keys stored in `ecosystem.config.js` (gitignored) and `backend/.env` (gitignored)

---

## What's Not Done / Roadmap

### Short-term (polish the demo)

- [ ] **Alembic migrations:** run `alembic init` and create proper migration files (currently auto-creates tables on startup, which won't handle schema changes)
- [ ] **Error handling:** better UX for network errors, timeouts, OCR failures
- [ ] **Empty states:** nicer UI when history is empty or dashboard has no data
- [ ] **Loading skeletons:** for history and dashboard pages while data loads
- [ ] **Document deletion:** ability to delete documents from history
- [ ] **Mobile result view:** stack PDF preview above extracted fields on small screens
- [ ] **Clerk production keys:** switch from dev to production Clerk instance
- [ ] **Rate limiting:** prevent abuse on the public demo endpoint

### Medium-term (from PRD)

- [ ] **More invoice templates:** expand invoice2data YAML templates for common vendors (Swiss, French, German formats)
- [ ] **Image-based extraction:** send invoice images directly to MiniMax vision API instead of OCR + text
- [ ] **Review/correction flow:** allow users to edit extracted fields and save corrections
- [ ] **Webhook endpoint:** `POST /webhooks/result` for async notification (Power Automate integration)
- [ ] **Export:** CSV/Excel export of extracted data from history
- [ ] **Multi-page invoices:** handle PDFs with multiple pages more intelligently
- [ ] **Batch upload:** upload multiple invoices at once
- [ ] **Confidence tuning:** learn from corrections to improve confidence scoring

### Long-term (Microsoft integration — from PRD)

- [ ] **Power Automate connector:** expose OpenAPI spec, build custom connector
- [ ] **Outlook integration:** trigger extraction from email attachments via Power Automate flow
- [ ] **SharePoint/OneDrive:** watch folders for new invoices
- [ ] **Teams tab:** embed the review UI as a Teams tab app
- [ ] **Copilot Studio:** conversational interface ("Show invoices pending approval")
- [ ] **Dataverse export:** push extracted data to Dataverse for ERP integration

### Infrastructure (if scaling)

- [ ] **PostgreSQL:** switch from SQLite for multi-user production
- [ ] **Redis + Celery:** async task queue for heavy processing
- [ ] **S3/MinIO:** file storage instead of local disk
- [ ] **Docker:** containerize backend + frontend for portable deployment
- [ ] **CI/CD:** GitHub Actions for tests + deploy

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI 0.115, SQLAlchemy 2.0, Pydantic 2.10 |
| Text extraction | pdfplumber, pytesseract, pdf2image |
| Field extraction | invoice2data (templates), MiniMax-M2.7-highspeed (LLM fallback) |
| Database | SQLite (default), PostgreSQL (via DATABASE_URL) |
| Auth | Clerk (optional) — PyJWT backend, @clerk/clerk-react frontend |
| Frontend | React 18, Vite 6, TypeScript 5, Tailwind 3 |
| Charts | Recharts |
| Routing | react-router-dom |
| Hosting | VM 133 (Proxmox node 1), pm2, nginx |
| Domain | openinvoice.angelstreet.io (Cloudflare SSL) |

## Key Files

```
backend/
  main.py              # FastAPI app, SSE extract endpoint, DB save
  config.py            # pydantic-settings (all env vars)
  auth.py              # Clerk JWT verification
  db/models.py         # Document SQLAlchemy model
  db/database.py       # Engine, SessionLocal
  pipeline/
    extract_text.py    # pdfplumber + OCR
    extract_fields.py  # invoice2data + MiniMax LLM
    validate.py        # Field validation
    schemas.py         # Pydantic models
  routes/
    documents.py       # CRUD API
    dashboard.py       # Stats API

frontend/src/
  App.tsx              # Shell with routing + header + footer
  i18n.ts              # EN/FR translations
  pages/
    DemoPage.tsx       # Upload + processing + result
    HistoryPage.tsx    # Document list
    DocumentDetailPage.tsx  # Single document view
    DashboardPage.tsx  # KPIs + charts
  components/
    UploadZone.tsx, ProcessingLog.tsx, ExtractedFields.tsx,
    DocumentPreview.tsx, BottomNav.tsx, AuthButton.tsx, ...
```

## Env Vars

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MINIMAX_API_KEY` | Yes | — | MiniMax LLM for field extraction |
| `DATABASE_URL` | No | `sqlite:///./openinvoice.db` | Database connection |
| `UPLOADS_DIR` | No | `./uploads` | File storage path |
| `CLERK_SECRET_KEY` | No | — | Enables auth (backend JWT verification) |
| `CLERK_JWKS_URL` | No | — | JWKS endpoint for JWT verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | No | — | Enables auth (frontend Clerk UI) |
| `CORS_ORIGINS` | No | `http://localhost:3023,...` | Allowed CORS origins |
