import type { ExtractionResult } from '../types';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import LineItemsTable from './LineItemsTable';

interface ExtractedFieldsProps {
  result: ExtractionResult;
  lang: Lang;
}

function ConfidenceBadge({ score, lang }: { score: number; lang: Lang }) {
  const pct = Math.round(score * 100);
  let colorClasses: string;
  if (score >= 0.8) {
    colorClasses = 'bg-green-100 text-green-800';
  } else if (score >= 0.5) {
    colorClasses = 'bg-yellow-100 text-yellow-800';
  } else {
    colorClasses = 'bg-red-100 text-red-800';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}>
      {pct}% {t(lang, 'confidence').toLowerCase()}
    </span>
  );
}

function FieldRow({ label, value, noValue }: { label: string; value: string | null | undefined; noValue: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">
        {value || noValue}
      </span>
    </div>
  );
}

function formatAmount(value: number | null | undefined, currency: string | null, noValue: string): string {
  if (value === null || value === undefined) return noValue;
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(value);
    } catch {
      // Invalid currency code
    }
  }
  return value.toFixed(2);
}

export default function ExtractedFields({ result, lang }: ExtractedFieldsProps) {
  const { fields, confidence, warnings } = result;
  const noValue = t(lang, 'noValue');

  return (
    <div className="space-y-5">
      {/* Header + confidence */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {t(lang, 'extractedFields')}
          </h3>
          <ConfidenceBadge score={confidence} lang={lang} />
        </div>

        <div className="space-y-0">
          <FieldRow label={t(lang, 'supplier')} value={fields.supplier} noValue={noValue} />
          <FieldRow label={t(lang, 'client')} value={fields.client} noValue={noValue} />
          <FieldRow label={t(lang, 'invoiceNumber')} value={fields.invoice_number} noValue={noValue} />
          <FieldRow label={t(lang, 'invoiceDate')} value={fields.invoice_date} noValue={noValue} />
          <FieldRow label={t(lang, 'dueDate')} value={fields.due_date} noValue={noValue} />
          <FieldRow label={t(lang, 'currency')} value={fields.currency} noValue={noValue} />
          <FieldRow
            label={t(lang, 'subtotal')}
            value={formatAmount(fields.subtotal, fields.currency, noValue)}
            noValue={noValue}
          />
          <FieldRow
            label={t(lang, 'tax')}
            value={formatAmount(fields.tax, fields.currency, noValue)}
            noValue={noValue}
          />

          <div className="flex justify-between py-2 mt-1 border-t-2 border-slate-200">
            <span className="text-sm font-semibold text-slate-700">{t(lang, 'total')}</span>
            <span className="text-base font-bold text-slate-900">
              {formatAmount(fields.total, fields.currency, noValue)}
            </span>
          </div>
        </div>
      </div>

      {/* Line items — collapsed by default */}
      <details className="bg-white rounded-xl shadow-sm border border-slate-200 group">
        <summary className="flex items-center justify-between p-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h3 className="text-lg font-semibold text-slate-800">
            {t(lang, 'lineItems')}
          </h3>
          <svg className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="px-5 pb-5">
          <LineItemsTable items={fields.line_items} currency={fields.currency} lang={lang} />
        </div>
      </details>

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
            >
              <svg
                className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <span className="text-sm text-yellow-800">
                {warning.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
