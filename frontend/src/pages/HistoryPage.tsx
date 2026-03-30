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

  const fetchDocuments = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      per_page: '20',
      sort: sortField,
      order: sortDir,
    });
    if (search.trim()) params.set('search', search.trim());
    const cacheKey = `history:${params}`;

    // Check cache first
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
  }, [page, search, sortField, sortDir]);

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

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
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
                      {doc.filename}
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
                      <StatusBadge status={doc.status} lang={lang} />
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
