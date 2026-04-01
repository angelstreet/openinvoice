import { useState } from 'react';
import type { ExtractionResult } from '../types';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import LineItemsTable from './LineItemsTable';

interface ExtractedFieldsProps {
  result: ExtractionResult;
  lang: Lang;
  correctedFields?: Record<string, string | number | null> | null;
  onFieldUpdate?: (field: string, value: string | number | null) => void;
  editable?: boolean;
}

function ConfidenceBadge({ score, lang }: { score: number; lang: Lang }) {
  const pct = Math.round(score * 100);
  let colorClasses: string;
  if (score >= 0.8) colorClasses = 'bg-green-100 text-green-800';
  else if (score >= 0.5) colorClasses = 'bg-yellow-100 text-yellow-800';
  else colorClasses = 'bg-red-100 text-red-800';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}>
      {pct}% {t(lang, 'confidence').toLowerCase()}
    </span>
  );
}

function EditableFieldRow({ label, value, fieldKey, corrected, onUpdate, editable, noValue }: {
  label: string;
  value: string | null | undefined;
  fieldKey: string;
  corrected?: string | number | null;
  onUpdate?: (field: string, value: string | number | null) => void;
  editable?: boolean;
  noValue: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const displayValue = corrected !== undefined && corrected !== null ? String(corrected) : (value || noValue);
  const isEdited = corrected !== undefined && corrected !== null;

  const startEdit = () => {
    if (!editable || !onUpdate) return;
    setEditValue(displayValue === noValue ? '' : displayValue);
    setEditing(true);
  };

  const saveEdit = () => {
    setEditing(false);
    if (onUpdate && editValue !== (value || '')) {
      onUpdate(fieldKey, editValue || null);
    }
  };

  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0 group">
      <span className="text-sm text-slate-500 flex items-center gap-1.5">
        {isEdited && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
        {label}
      </span>
      {editing ? (
        <input
          type="text"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={e => e.key === 'Enter' && saveEdit()}
          autoFocus
          className="text-sm text-right font-medium text-slate-800 bg-blue-50 border border-blue-300 rounded px-2 py-0.5 w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <span
          onClick={startEdit}
          className={`text-sm font-medium text-slate-800 ${editable ? 'cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 transition-colors' : ''}`}
        >
          {displayValue}
          {editable && (
            <svg className="inline-block w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
            </svg>
          )}
        </span>
      )}
    </div>
  );
}

function formatAmount(value: number | null | undefined, currency: string | null, noValue: string): string {
  if (value === null || value === undefined) return noValue;
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
    } catch { /* fallback */ }
  }
  return value.toFixed(2);
}

export default function ExtractedFields({ result, lang, correctedFields, onFieldUpdate, editable = false }: ExtractedFieldsProps) {
  const { fields, confidence, warnings } = result;
  const noValue = t(lang, 'noValue');
  const cf = correctedFields || {};

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
          <EditableFieldRow label={t(lang, 'supplier')} value={fields.supplier} fieldKey="supplier" corrected={cf.supplier} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow label={t(lang, 'client')} value={fields.client} fieldKey="client" corrected={cf.client} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow label={t(lang, 'invoiceNumber')} value={fields.invoice_number} fieldKey="invoice_number" corrected={cf.invoice_number} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow label={t(lang, 'invoiceDate')} value={fields.invoice_date} fieldKey="invoice_date" corrected={cf.invoice_date} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow label={t(lang, 'dueDate')} value={fields.due_date} fieldKey="due_date" corrected={cf.due_date} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow label={t(lang, 'currency')} value={fields.currency} fieldKey="currency" corrected={cf.currency} onUpdate={onFieldUpdate} editable={editable} noValue={noValue} />
          <EditableFieldRow
            label={t(lang, 'subtotal')}
            value={formatAmount(fields.subtotal, fields.currency, noValue)}
            fieldKey="subtotal"
            corrected={cf.subtotal}
            onUpdate={onFieldUpdate}
            editable={editable}
            noValue={noValue}
          />
          <EditableFieldRow
            label={t(lang, 'tax')}
            value={formatAmount(fields.tax, fields.currency, noValue)}
            fieldKey="tax"
            corrected={cf.tax}
            onUpdate={onFieldUpdate}
            editable={editable}
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

      {/* Line items */}
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
            <div key={i} className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <svg className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span className="text-sm text-yellow-800">{warning.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
