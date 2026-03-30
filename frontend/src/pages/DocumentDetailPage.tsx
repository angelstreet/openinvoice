import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import DocumentPreview from '../components/DocumentPreview';
import ExtractedFields from '../components/ExtractedFields';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { DocumentListItem, ExtractionResult } from '../types';

interface DocumentDetailPageProps {
  lang: Lang;
}

export default function DocumentDetailPage({ lang }: DocumentDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentListItem | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function fetchData() {
      setError(null);

      // Check cache for metadata
      const cacheKey = `doc:${id}`;
      const cached = cacheGet<DocumentListItem>(cacheKey);
      if (cached) {
        setDoc(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        // Fetch document metadata (even if cached, refresh in background)
        if (!cached) {
          const metaRes = await apiFetch(`/api/documents/${id}`);
          if (!metaRes.ok) throw new Error(`Failed to load document (${metaRes.status})`);
          const metaData: DocumentListItem = await metaRes.json();
          if (cancelled) return;
          setDoc(metaData);
          cacheSet(cacheKey, metaData);
        }

        // Fetch file blob (not cached — blob URLs are cheap)
        if (!fileUrl) {
          const fileRes = await apiFetch(`/api/documents/${id}/file`);
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            if (cancelled) return;
            setFileUrl(URL.createObjectURL(blob));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [id]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-lg font-medium text-red-800">{error || 'Document not found'}</p>
        </div>
        <button
          onClick={() => navigate('/history')}
          className="mt-6 px-5 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          {t(lang, 'backToHistory')}
        </button>
      </div>
    );
  }

  // Build an ExtractionResult from the document data for ExtractedFields
  const extractionResult: ExtractionResult | null = doc.extracted_fields
    ? {
        filename: doc.filename,
        pages: 0,
        raw_text: '',
        confidence: doc.confidence ?? 0,
        fields: doc.extracted_fields,
        warnings: doc.warnings || [],
      }
    : null;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/history')}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        {t(lang, 'backToHistory')}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Document preview */}
        <div className="lg:col-span-2">
          {fileUrl ? (
            <DocumentPreview fileUrl={fileUrl} filename={doc.filename} contentType={doc.content_type} lang={lang} />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-500 text-sm">
              {t(lang, 'noData')}
            </div>
          )}
        </div>

        {/* Extracted fields */}
        <div className="lg:col-span-3">
          {extractionResult ? (
            <ExtractedFields result={extractionResult} lang={lang} />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-500 text-sm">
              {t(lang, 'noData')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
