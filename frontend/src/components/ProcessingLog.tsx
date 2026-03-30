import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { LogEntry } from '../types';

const STEP_ICONS: Record<string, string> = {
  start: '\u25B6',
  text_extraction: '\u{1F4C4}',
  field_extraction: '\u{1F9E0}',
  validation: '\u2705',
  done: '\u{1F3C1}',
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-slate-400 text-xs font-mono ml-2">{t(lang, 'pipelineLabel')}</span>
          </div>
          <div className="text-slate-400 text-xs font-mono">
            {elapsed.toFixed(1)}s
          </div>
        </div>

        {/* Log entries */}
        <div className="p-4 font-mono text-sm max-h-80 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="flex gap-3 py-1">
              <span className="text-slate-500 w-14 text-right shrink-0">
                {log.elapsed.toFixed(2)}s
              </span>
              <span className="w-5 text-center shrink-0">
                {STEP_ICONS[log.step] || '\u25CF'}
              </span>
              <span className={
                log.step === 'done'
                  ? 'text-green-400'
                  : 'text-slate-300'
              }>
                {log.message}
              </span>
            </div>
          ))}

          {/* Blinking cursor while processing */}
          {logs.length > 0 && logs[logs.length - 1]?.step !== 'done' && (
            <div className="flex gap-3 py-1">
              <span className="text-slate-500 w-14 text-right shrink-0">
                {elapsed.toFixed(2)}s
              </span>
              <span className="w-5 text-center shrink-0 text-blue-400 animate-pulse">
                {'\u25CF'}
              </span>
              <span className="text-slate-500 animate-pulse">{t(lang, 'waiting')}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
