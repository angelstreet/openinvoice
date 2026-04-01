import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../lib/cache';
import DocumentPreview from '../components/DocumentPreview';
import ExtractedFields from '../components/ExtractedFields';
import PipelineInfo from '../components/PipelineInfo';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { DocumentListItem, ExtractionResult } from '../types';
import { withSearch } from '../bootstrap';

interface DocumentDetailPageProps {
  lang: Lang;
}

type Tab = 'fields' | 'pipeline' | 'ocr';

export default function DocumentDetailPage({ lang }: DocumentDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentListItem | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('fields');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function fetchData() {
      setError(null);
      const cacheKey = `doc:${id}`;
      const cached = cacheGet<DocumentListItem>(cacheKey);
      if (cached) { setDoc(cached); setLoading(false); }
      else setLoading(true);

      try {
        if (!cached) {
          const metaRes = await apiFetch(`/api/documents/${id}`);
          if (!metaRes.ok) throw new Error(`Failed to load document (${metaRes.status})`);
          const metaData: DocumentListItem = await metaRes.json();
          if (cancelled) return;
          setDoc(metaData);
          cacheSet(cacheKey, metaData);
        }
        if (!fileUrl) {
          const fileRes = await apiFetch(`/api/documents/${id}/file`);
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            if (cancelled) return;
            setFileUrl(URL.createObjectURL(blob));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    return () => { if (fileUrl) URL.revokeObjectURL(fileUrl); };
  }, [fileUrl]);

  const handleFieldUpdate = useCallback(async (field: string, value: string | number | null) => {
    if (!id || !doc) return;
    try {
      const res = await apiFetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrected_fields: { [field]: value } }),
      });
      if (res.ok) {
        const updated: DocumentListItem = await res.json();
        setDoc(updated);
        cacheInvalidatePrefix('doc:');
      }
    } catch { /* silently fail */ }
  }, [id, doc]);

  const handleFeedback = useCallback(async (verdict: 'OK' | 'NOK') => {
    if (!id || !doc) return;
    try {
      const res = await apiFetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_feedback: { verdict } }),
      });
      if (res.ok) {
        const updated: DocumentListItem = await res.json();
        setDoc(updated);
        cacheInvalidatePrefix('doc:');
      }
    } catch { /* silently fail */ }
  }, [id, doc]);

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
        <button onClick={() => navigate(withSearch('/history'))} className="mt-6 px-5 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors">
          {t(lang, 'backToHistory')}
        </button>
      </div>
    );
  }

  const extractionResult: ExtractionResult | null = doc.extracted_fields
    ? { filename: doc.filename, pages: 0, raw_text: (doc as any).raw_text || '', confidence: doc.confidence ?? 0, fields: doc.extracted_fields, warnings: doc.warnings || [] }
    : null;

  const humanVerdict = doc.human_feedback?.verdict;
  const aiVerdict = doc.ai_feedback?.verdict;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(withSearch('/history'))} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          {t(lang, 'backToHistory')}
        </button>
        <div className="flex items-center gap-3">
          {/* AI verdict badge */}
          {aiVerdict && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              aiVerdict === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {t(lang, 'aiVerdict')}: {aiVerdict}
            </span>
          )}
          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(a => !a)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showAdvanced ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {t(lang, 'advanced')}
          </button>
        </div>
      </div>

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

        {/* Right panel */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tabs (only in advanced mode) */}
          {showAdvanced && (
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {(['fields', 'pipeline', 'ocr'] as Tab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t(lang, tab === 'fields' ? 'fieldsTab' : tab === 'pipeline' ? 'pipelineTab' : 'ocrTextTab')}
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          {(!showAdvanced || activeTab === 'fields') && extractionResult && (
            <ExtractedFields
              result={extractionResult}
              lang={lang}
              correctedFields={doc.corrected_fields}
              onFieldUpdate={handleFieldUpdate}
              editable
            />
          )}

          {showAdvanced && activeTab === 'pipeline' && doc.pipeline_meta && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">{t(lang, 'pipelineTab')}</h3>
              <PipelineInfo meta={doc.pipeline_meta} lang={lang} />
              {/* AI feedback detail */}
              {doc.ai_feedback && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mb-1">{t(lang, 'aiVerdict')}</p>
                  <p className="text-sm text-slate-700">{doc.ai_feedback.comment}</p>
                </div>
              )}
            </div>
          )}

          {showAdvanced && activeTab === 'ocr' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">{t(lang, 'ocrTextTab')}</h3>
              <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-4 overflow-auto max-h-[500px] whitespace-pre-wrap font-mono">
                {(doc as any).raw_text || t(lang, 'noData')}
              </pre>
            </div>
          )}

          {/* Quick feedback — always visible */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 mr-1">{lang === 'fr' ? 'Votre avis' : 'Your review'}:</span>
            <button
              onClick={() => handleFeedback('OK')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                humanVerdict === 'OK'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'bg-white text-green-600 border-green-300 hover:bg-green-50'
              }`}
            >
              {t(lang, 'feedbackOk')}
            </button>
            <button
              onClick={() => handleFeedback('NOK')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                humanVerdict === 'NOK'
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-red-600 border-red-300 hover:bg-red-50'
              }`}
            >
              {t(lang, 'feedbackNok')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
