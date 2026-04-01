import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { DocumentListItem, DocumentListResponse } from '../types';

interface HistoryPageProps {
  lang: Lang;
}

type SortField = 'filename' | 'uploaded_at' | 'supplier' | 'invoice_number' | 'total' | 'confidence' | 'status';
type SortDir = 'asc' | 'desc';
type DatePreset = 'all' | '24h' | 'week' | 'month' | 'year' | 'custom';

function getDateRange(preset: DatePreset): { from: string; to: string } {
  if (preset === 'all' || preset === 'custom') return { from: '', to: '' };
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now);
  switch (preset) {
    case '24h': from.setDate(from.getDate() - 1); break;
    case 'week': from.setDate(from.getDate() - 7); break;
    case 'month': from.setMonth(from.getMonth() - 1); break;
    case 'year': from.setFullYear(from.getFullYear() - 1); break;
  }
  return { from: from.toISOString(), to };
}

function formatDate(dateStr: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatAmount(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
    } catch { /* fallback */ }
  }
  return value.toFixed(2);
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-400">—</span>;
  const pct = Math.round(score * 100);
  let cls: string;
  if (score >= 0.8) cls = 'bg-green-100 text-green-800';
  else if (score >= 0.5) cls = 'bg-yellow-100 text-yellow-800';
  else cls = 'bg-red-100 text-red-800';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {pct}%
    </span>
  );
}

function StatusBadge({ status, lang }: { status: string; lang: Lang }) {
  let cls: string;
  let label: string;
  switch (status) {
    case 'success':
      cls = 'bg-green-100 text-green-800';
      label = t(lang, 'status_success');
      break;
    case 'error':
      cls = 'bg-red-100 text-red-800';
      label = t(lang, 'status_error');
      break;
    default:
      cls = 'bg-blue-100 text-blue-800';
      label = t(lang, 'status_processing');
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function SourceBadge({ source, lang }: { source: string; lang: Lang }) {
  let label: string;
  let cls: string;
  switch (source) {
    case 'email':
    case 'outlook':
      label = t(lang, 'sourceEmail');
      cls = 'bg-blue-50 text-blue-700';
      break;
    case 'onedrive':
      label = t(lang, 'sourceOnedrive');
      cls = 'bg-indigo-50 text-indigo-700';
      break;
    case 'webhook':
      label = t(lang, 'sourceWebhook');
      cls = 'bg-purple-50 text-purple-700';
      break;
    default:
      label = t(lang, 'sourceWeb');
      cls = 'bg-slate-100 text-slate-600';
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function HistoryPage({ lang }: HistoryPageProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('uploaded_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);

  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Load supplier list
  useEffect(() => {
    apiFetch('/api/documents/suppliers').then(res => {
      if (res.ok) res.json().then((data: { suppliers: string[] }) => setSuppliers(data.suppliers));
    }).catch(() => {});
  }, []);

  // Compute active date range
  const dateRange = datePreset === 'custom'
    ? { from: customFrom ? new Date(customFrom).toISOString() : '', to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : '' }
    : getDateRange(datePreset);

  const hasActiveFilters = datePreset !== 'all' || supplier !== '';

  const fetchDocuments = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      per_page: '20',
      sort: sortField,
      order: sortDir,
    });
    if (search.trim()) params.set('search', search.trim());
    if (supplier) params.set('supplier', supplier);
    if (dateRange.from) params.set('date_from', dateRange.from);
    if (dateRange.to) params.set('date_to', dateRange.to);

    const cacheKey = `history:${params}`;
    const cached = cacheGet<DocumentListResponse>(cacheKey);
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      setPages(cached.pages);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(`/api/documents?${params}`);
      if (res.ok) {
        const data: DocumentListResponse = await res.json();
        setItems(data.items);
        setTotal(data.total);
        setPages(data.pages);
        cacheSet(cacheKey, data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [page, search, sortField, sortDir, supplier, dateRange.from, dateRange.to]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleExportCsv = async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (supplier) params.set('supplier', supplier);
    if (dateRange.from) params.set('date_from', dateRange.from);
    if (dateRange.to) params.set('date_to', dateRange.to);

    try {
      const res = await apiFetch(`/api/documents/export/csv?${params}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silently fail */ }
  };

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation(); // Don't navigate to detail
    if (!confirm(t(lang, 'confirmDelete'))) return;
    try {
      const res = await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(prev => prev.filter(d => d.id !== docId));
        setTotal(prev => prev - 1);
      }
    } catch { /* silently fail */ }
  };

  const clearFilters = () => {
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
    setSupplier('');
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-slate-300 ml-1">{'\u2195'}</span>;
    return <span className="text-slate-600 ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
  };

  const ThButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="text-left py-3 px-4 font-medium text-slate-600 text-sm cursor-pointer hover:text-slate-900 select-none"
      onClick={() => handleSort(field)}
    >
      {children}<SortIcon field={field} />
    </th>
  );

  const presetButtons: { key: DatePreset; label: string }[] = [
    { key: 'all', label: t(lang, 'allTime') },
    { key: '24h', label: t(lang, 'last24h') },
    { key: 'week', label: t(lang, 'lastWeek') },
    { key: 'month', label: t(lang, 'lastMonth') },
    { key: 'year', label: t(lang, 'lastYear') },
    { key: 'custom', label: t(lang, 'custom') },
  ];

  return (
    <div className="space-y-4">
      {/* Search + Filter toggle + Export */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t(lang, 'searchPlaceholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
              hasActiveFilters
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <svg className="inline-block w-4 h-4 mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
            </svg>
            {t(lang, 'filters')}{hasActiveFilters ? ' *' : ''}
          </button>
          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <svg className="inline-block w-4 h-4 mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t(lang, 'exportCsv')}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4">
          {/* Date presets */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">{t(lang, 'dateRange')}</label>
            <div className="flex flex-wrap gap-1.5">
              {presetButtons.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setDatePreset(key); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    datePreset === key
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date inputs */}
          {datePreset === 'custom' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t(lang, 'from')}</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t(lang, 'to')}</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Supplier filter */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t(lang, 'supplierFilter')}</label>
            <select
              value={supplier}
              onChange={e => { setSupplier(e.target.value); setPage(1); }}
              className="w-full sm:w-64 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t(lang, 'allSuppliers')}</option>
              {suppliers.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {t(lang, 'clear')}
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            {t(lang, 'noDocuments')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <ThButton field="filename">{t(lang, 'description')}</ThButton>
                  <ThButton field="uploaded_at">{t(lang, 'invoiceDate')}</ThButton>
                  <ThButton field="supplier">{t(lang, 'supplier')}</ThButton>
                  <ThButton field="invoice_number">{t(lang, 'invoiceNumber')}</ThButton>
                  <ThButton field="total">{t(lang, 'total')}</ThButton>
                  <ThButton field="confidence">{t(lang, 'confidence')}</ThButton>
                  <ThButton field="status">Status</ThButton>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t(lang, 'source')}</th>
                  <th className="py-3 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(doc => (
                  <tr
                    key={doc.id}
                    onClick={() => navigate(`/history/${doc.id}`)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-slate-800 font-medium truncate max-w-[200px]">
                      <span className="inline-flex items-center gap-1.5">
                        {doc.corrected_fields && Object.keys(doc.corrected_fields).length > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                        {doc.filename}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {formatDate(doc.uploaded_at, lang)}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {doc.extracted_fields?.supplier || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {doc.extracted_fields?.invoice_number || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-800 font-medium">
                      {formatAmount(doc.extracted_fields?.total, doc.extracted_fields?.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <ConfidenceBadge score={doc.confidence} />
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status={doc.status} lang={lang} />
                        {doc.human_feedback?.verdict === 'OK' && (
                          <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                        )}
                        {doc.human_feedback?.verdict === 'NOK' && (
                          <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <SourceBadge source={doc.source} lang={lang} />
                    </td>
                    <td className="py-3 px-2">
                      <button
                        onClick={(e) => handleDelete(e, doc.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        title={t(lang, 'deleteDocument')}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {total} {t(lang, 'totalDocuments').toLowerCase()}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              &larr; Prev
            </button>
            <span className="text-sm text-slate-600">
              {t(lang, 'page')} {page} {t(lang, 'of')} {pages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
