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
  const startTimeRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

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

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      let gotResult = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let eventType = '';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }

          if (!data) continue;

          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            // JSON parse error, skip this event
            continue;
          }

          try {
            if (eventType === 'log') {
              setLogs(prev => [...prev, {
                step: parsed!.step as string,
                message: parsed!.message as string,
                elapsed: parsed!.elapsed as number,
              }]);
            } else if (eventType === 'error') {
              setLogs(prev => [...prev, {
                step: parsed!.step as string,
                message: parsed!.message as string,
                elapsed: parsed!.elapsed as number,
              }]);
              throw new Error(parsed!.message as string);
            } else if (eventType === 'result') {
              setResult((parsed!.result as ExtractionResult));
              setState('done');
              stopTimer();
              gotResult = true;
            }
          } catch (e) {
            throw e;
          }
        }
      }

      if (!gotResult) {
        stopTimer();
      }
    } catch (err) {
      stopTimer();
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setState('error');
    }
  };

  const handleReset = () => {
    stopTimer();
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
    <>
      {/* Upload state */}
      {state === 'idle' && (
        <UploadZone onUpload={handleUpload} disabled={false} lang={lang} />
      )}

      {/* Loading state */}
      {state === 'loading' && (
        <div className="space-y-6">
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
            <div className="flex justify-center mt-6">
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
          <details className="mb-6 max-w-7xl">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 flex items-center gap-2">
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

          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
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
    </>
  );
}
