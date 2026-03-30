import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { LogEntry } from '../types';

// Map backend step names to numbered display labels
const STEP_LABELS: Record<string, string> = {
  start: '0. Start',
  text_extraction: '1. Text extraction',
  field_extraction: '2. Field extraction',
  validation: '3. Validation',
  done: 'Done',
};

function isSuccess(msg: string): boolean | null {
  if (msg.startsWith('✓') || msg.startsWith('Method:') || msg.includes('Supplier:') || msg.includes('Confidence:')) return true;
  if (msg.startsWith('✗')) return false;
  if (msg.startsWith('⚠')) return false;
  return null; // neutral / in-progress
}

interface Props {
  logs: LogEntry[];
  elapsed: number;
  lang: Lang;
}

export default function ProcessingLog({ logs, elapsed, lang }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const isDone = logs.length > 0 && logs[logs.length - 1]?.step === 'done';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[200px]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {t(lang, 'pipelineLabel')}
          </span>
          <span className={`text-xs font-mono tabular-nums ${isDone ? 'text-emerald-600' : 'text-slate-400'}`}>
            {elapsed.toFixed(1)}s
          </span>
        </div>

        {/* Log entries */}
        <div className="px-5 py-3 max-h-80 overflow-y-auto">
          {logs.map((log, i) => {
            const status = isSuccess(log.message);
            // Clean message: strip leading ✓/✗/⚠ symbols
            const cleanMsg = log.message.replace(/^[✓✗⚠]\s*/, '');

            return (
              <div key={i} className="flex items-center gap-4 py-1 text-sm">
                {/* Step label */}
                <span className="text-slate-400 text-xs font-medium w-28 shrink-0 truncate">
                  {STEP_LABELS[log.step] || log.step}
                </span>
                {/* Elapsed */}
                <span className="text-slate-400 text-xs font-mono tabular-nums w-14 text-right shrink-0">
                  {log.elapsed.toFixed(2)}s
                </span>
                {/* Message */}
                <span className={`flex-1 truncate ${log.step === 'done' ? 'text-emerald-700 font-medium' : 'text-slate-600'}`}>
                  {cleanMsg}
                </span>
                {/* Status icon */}
                <span className="w-5 shrink-0 text-center">
                  {status === true && (
                    <svg className="w-4 h-4 text-emerald-500 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {status === false && (
                    <svg className="w-4 h-4 text-red-400 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
              </div>
            );
          })}

          {/* Waiting indicator */}
          {logs.length > 0 && !isDone && (
            <div className="flex items-center gap-4 py-1 text-sm">
              <span className="text-slate-400 text-xs font-medium w-28 shrink-0" />
              <span className="text-slate-400 text-xs font-mono tabular-nums w-14 text-right shrink-0">
                {elapsed.toFixed(2)}s
              </span>
              <span className="flex-1 text-slate-400 animate-pulse">{t(lang, 'waiting')}</span>
              <span className="w-5 shrink-0 text-center">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
