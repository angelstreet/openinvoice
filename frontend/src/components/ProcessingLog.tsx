import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { LogEntry } from '../types';

const STEP_ICONS: Record<string, string> = {
  start: '▶',
  text_extraction: '📄',
  field_extraction: '🧠',
  validation: '✓',
  done: '✓',
};

const STEP_COLORS: Record<string, string> = {
  start: 'text-slate-400',
  text_extraction: 'text-blue-500',
  field_extraction: 'text-amber-500',
  validation: 'text-emerald-500',
  done: 'text-emerald-600',
};

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
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {t(lang, 'pipelineLabel')}
          </span>
          <span className={`text-xs font-mono tabular-nums ${isDone ? 'text-emerald-600' : 'text-slate-400'}`}>
            {elapsed.toFixed(1)}s
          </span>
        </div>

        {/* Log entries */}
        <div className="px-4 py-2 max-h-72 overflow-y-auto divide-y divide-slate-50">
          {logs.map((log, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="text-slate-400 text-xs font-mono tabular-nums w-12 text-right shrink-0">
                {log.elapsed.toFixed(2)}s
              </span>
              <span className={`w-5 text-center shrink-0 ${STEP_COLORS[log.step] || 'text-slate-400'}`}>
                {STEP_ICONS[log.step] || '●'}
              </span>
              <span className={`${log.step === 'done' ? 'text-emerald-700 font-medium' : 'text-slate-700'}`}>
                {log.message}
              </span>
            </div>
          ))}

          {/* Waiting indicator */}
          {logs.length > 0 && !isDone && (
            <div className="flex items-center gap-3 py-1.5 text-sm">
              <span className="text-slate-400 text-xs font-mono tabular-nums w-12 text-right shrink-0">
                {elapsed.toFixed(2)}s
              </span>
              <span className="w-5 text-center shrink-0">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              </span>
              <span className="text-slate-400 animate-pulse">{t(lang, 'waiting')}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
