#!/usr/bin/env bash
# Test webhook ingestion endpoint — simulates Power Automate calls
# Usage: ./scripts/test-webhook.sh <path-to-invoice.pdf> [source]

set -euo pipefail

API_URL="${API_URL:-https://openinvoice.angelstreet.io}"
WEBHOOK_KEY="${WEBHOOK_KEY:-Am_gEll_vLLN-zu8Y8Qau1HSZQDriyLkR7t0JRUn5J8}"

FILE="${1:-}"
SOURCE="${2:-outlook}"

if [ -z "$FILE" ]; then
  echo "Usage: $0 <file.pdf> [outlook|onedrive|sharepoint]"
  echo ""
  echo "Examples:"
  echo "  $0 invoice.pdf outlook          # Simulate Outlook email attachment"
  echo "  $0 invoice.pdf onedrive         # Simulate OneDrive file"
  echo "  $0 invoice.pdf sharepoint       # Simulate SharePoint file"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "Error: file not found: $FILE"
  exit 1
fi

echo "=== Webhook Ingest Test ==="
echo "File:   $FILE"
echo "Source: $SOURCE"
echo "API:    $API_URL"
echo ""

# Build source-specific metadata
case "$SOURCE" in
  outlook)
    EXTRA='-F "sender_email=supplier@example.com" -F "subject=Invoice #1234 - March 2026"'
    ;;
  onedrive)
    EXTRA='-F "folder_path=/Documents/Invoices"'
    ;;
  sharepoint)
    EXTRA='-F "folder_path=/sites/Finance/Shared Documents/Invoices"'
    ;;
  *)
    EXTRA=""
    ;;
esac

# Send file to webhook
echo ">>> Sending file..."
RESPONSE=$(eval curl -s -X POST "$API_URL/api/webhook/ingest" \
  -H "X-Webhook-Key: $WEBHOOK_KEY" \
  -F "file=@$FILE" \
  -F "source=$SOURCE" \
  $EXTRA)

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
  echo "Error: no job_id returned"
  exit 1
fi

echo ""
echo ">>> Polling job $JOB_ID..."

# Poll until done
for i in $(seq 1 30); do
  sleep 1
  STATUS_RESP=$(curl -s "$API_URL/api/extract/$JOB_ID/status")
  STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

  if [ "$STATUS" = "done" ]; then
    echo ""
    echo "=== Extraction Complete ==="
    echo "$STATUS_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
r = data.get('result', {})
f = r.get('fields', {})
print(f'Document ID: {data.get(\"document_id\", \"n/a\")}')
print(f'Confidence:  {r.get(\"confidence\", 0):.0%}')
print(f'Supplier:    {f.get(\"supplier\", \"n/a\")}')
print(f'Invoice #:   {f.get(\"invoice_number\", \"n/a\")}')
print(f'Total:       {f.get(\"currency\", \"\")} {f.get(\"total\", \"n/a\")}')
print()
print('Logs:')
for log in data.get('logs', []):
    print(f'  [{log[\"elapsed\"]:5.1f}s] {log[\"step\"]}: {log[\"message\"]}')
" 2>/dev/null
    # Cleanup
    curl -s -X DELETE "$API_URL/api/extract/$JOB_ID" > /dev/null
    exit 0
  elif [ "$STATUS" = "error" ]; then
    echo "Error:"
    echo "$STATUS_RESP" | python3 -m json.tool 2>/dev/null
    exit 1
  fi

  echo "  [$i] status=$STATUS"
done

echo "Timeout waiting for extraction"
exit 1
