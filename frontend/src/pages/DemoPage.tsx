import { useState, useRef, useEffect, useCallback } from 'react';
import UploadZone from '../components/UploadZone';
import DocumentPreview from '../components/DocumentPreview';
import ExtractedFields from '../components/ExtractedFields';
import ProcessingLog from '../components/ProcessingLog';
import { apiFetch } from '../lib/api';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { ExtractionResult, LogEntry } from '../types';

type PageState = 'idle' | 'loading' | 'done' | 'error';

interface DemoPageProps {
  lang: Lang;
}

export default function DemoPage({ lang }: DemoPageProps) {
  const [state, setState] = useState<PageState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => { stopTimer(); stopPolling(); }, [stopTimer, stopPolling]);

  const handleUpload = async (uploadedFile: File) => {
    setFile(uploadedFile);
    setState('loading');
    setErrorMsg('');
    setResult(null);
    setLogs([]);
    setElapsed(0);

    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 100);

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const response = await apiFetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Server responded with ${response.status}`);
      }

      const { job_id } = await response.json();

      // Poll for progress
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await apiFetch(`/api/extract/${job_id}/status`);
          if (!statusRes.ok) return;
          const data = await statusRes.json();

          // Update logs
          setLogs(data.logs as LogEntry[]);

          if (data.status === 'done') {
            stopPolling();
            stopTimer();
            setResult(data.result as ExtractionResult);
            setState('done');
            // Clean up job on server
            apiFetch(`/api/extract/${job_id}`, { method: 'DELETE' }).catch(() => {});
          } else if (data.status === 'error') {
            stopPolling();
            stopTimer();
            setErrorMsg(data.error || 'Extraction failed');
            setState('error');
            apiFetch(`/api/extract/${job_id}`, { method: 'DELETE' }).catch(() => {});
          }
        } catch {
          // Polling error — keep trying
        }
      }, 1000);
    } catch (err) {
      stopTimer();
      stopPolling();
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setState('error');
    }
  };

  const handleReset = () => {
    stopTimer();
    stopPolling();
    setState('idle');
    setFile(null);
    setResult(null);
    setErrorMsg('');
    setLogs([]);
    setElapsed(0);
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.filename.replace(/\.[^.]+$/, '')}_extracted.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Upload state */}
      {state === 'idle' && (
        <div className="flex items-center justify-center py-8 sm:py-0 sm:flex-1">
          <UploadZone onUpload={handleUpload} disabled={false} lang={lang} />
        </div>
      )}

      {/* Loading state */}
      {state === 'loading' && (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-lg font-medium text-slate-700">
              {t(lang, 'processing')} <span className="font-semibold">{file?.name}</span>
            </p>
          </div>
          <ProcessingLog logs={logs} elapsed={elapsed} lang={lang} />
        </div>
      )}

      {/* Error state */}
      {state === 'error' && (
        <div className="space-y-6">
          {logs.length > 0 && (
            <ProcessingLog logs={logs} elapsed={elapsed} lang={lang} />
          )}
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-lg font-medium text-red-800">
                {t(lang, 'extractionFailed')}
              </p>
              <p className="text-sm text-red-600 mt-1">{errorMsg}</p>
            </div>
            <div className="flex justify-center gap-3 mt-6">
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                {t(lang, 'back')}
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                {t(lang, 'tryAnother')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result state */}
      {state === 'done' && result && file && (
        <>
          <details className="mb-6 max-w-7xl group">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5 list-none [&::-webkit-details-marker]:hidden">
              <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              <span>{t(lang, 'processingLog')} ({elapsed.toFixed(1)}s)</span>
            </summary>
            <div className="mt-3">
              <ProcessingLog logs={logs} elapsed={elapsed} lang={lang} />
            </div>
          </details>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2">
              <DocumentPreview file={file} lang={lang} />
            </div>
            <div className="lg:col-span-3">
              <ExtractedFields result={result} lang={lang} />
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              {t(lang, 'back')}
            </button>
            <button
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t(lang, 'downloadJson')}
            </button>
            <button
              onClick={handleReset}
              className="px-5 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              {t(lang, 'tryAnother')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
