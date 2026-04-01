import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { PipelineMeta } from '../types';

const INPUT_RATE = 0.10 / 1_000_000;  // $0.10 per 1M tokens
const OUTPUT_RATE = 0.30 / 1_000_000; // $0.30 per 1M tokens

interface Props {
  meta: PipelineMeta;
  lang: Lang;
}

export default function PipelineInfo({ meta, lang }: Props) {
  const cost = meta.llm_input_tokens * INPUT_RATE + meta.llm_output_tokens * OUTPUT_RATE;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">{t(lang, 'textMethod')}</p>
          <p className="text-sm font-medium text-slate-800 mt-0.5">{meta.text_method || '—'}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">{t(lang, 'fieldMethod')}</p>
          <p className="text-sm font-medium text-slate-800 mt-0.5">{meta.method || '—'}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">{t(lang, 'totalDuration')}</p>
          <p className="text-sm font-medium text-slate-800 mt-0.5">{meta.total_duration?.toFixed(2)}s</p>
        </div>
        {meta.llm_input_tokens > 0 && (
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">{t(lang, 'estimatedCost')}</p>
            <p className="text-sm font-medium text-slate-800 mt-0.5">${cost.toFixed(4)}</p>
          </div>
        )}
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Steps</p>
        <div className="space-y-1.5">
          {meta.steps.map((step, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded-lg text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  step.name === 'llm' ? 'bg-purple-500' :
                  step.name === 'invoice2data' ? 'bg-blue-500' : 'bg-green-500'
                }`} />
                <span className="text-slate-700 font-medium">{step.name}</span>
                {step.fields_found !== undefined && (
                  <span className="text-slate-400 text-xs">{step.fields_found} fields</span>
                )}
              </div>
              <span className="text-slate-500 text-xs">{step.duration?.toFixed(3)}s</span>
            </div>
          ))}
        </div>
      </div>

      {/* LLM details */}
      {meta.llm_input_tokens > 0 && (
        <div className="bg-purple-50 rounded-lg p-3">
          <p className="text-xs font-medium text-purple-600 mb-1.5">LLM ({meta.llm_model || 'unknown'})</p>
          <div className="flex gap-4 text-xs text-purple-700">
            <span>{t(lang, 'inputTokens')}: {meta.llm_input_tokens.toLocaleString()}</span>
            <span>{t(lang, 'outputTokens')}: {meta.llm_output_tokens.toLocaleString()}</span>
            <span>{t(lang, 'estimatedCost')}: ${cost.toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
