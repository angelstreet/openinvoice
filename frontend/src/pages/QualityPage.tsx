import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api';
import KpiCard from '../components/dashboard/KpiCard';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface QualityPageProps { lang: Lang; }

interface QualityStats {
  total: number;
  method_distribution: { method: string; count: number }[];
  confidence_by_method: { method: string; avg_confidence: number }[];
  duration_by_method: { method: string; avg_duration: number }[];
  llm_usage: { documents: number; total_input_tokens: number; total_output_tokens: number; total_cost: number };
  correction_rate: number;
  corrected_count: number;
  human_feedback: { ok: number; nok: number; total: number };
  ai_feedback: { ok: number; nok: number; total: number };
  agreement_rate: number;
  false_positive_rate: number;
  avg_duration_overall: number;
  recent_disagreements: { id: string; filename: string; ai_verdict: string; human_verdict: string; ai_comment: string; uploaded_at: string | null }[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#475569'];

export default function QualityPage({ lang }: QualityPageProps) {
  const [stats, setStats] = useState<QualityStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/dashboard/quality').then(async res => {
      if (res.ok) {
        const data = await res.json();
        if (!cancelled) setStats(data);
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return <div className="text-center py-24 text-slate-500 text-sm">{t(lang, 'noData')}</div>;
  }

  const feedbackData = [
    ...(stats.human_feedback.ok > 0 ? [{ name: 'OK', value: stats.human_feedback.ok }] : []),
    ...(stats.human_feedback.nok > 0 ? [{ name: 'NOK', value: stats.human_feedback.nok }] : []),
    ...(stats.human_feedback.total === 0 ? [{ name: lang === 'fr' ? 'Non évalué' : 'Not reviewed', value: stats.total }] : []),
  ];

  const methodData = stats.method_distribution.map(m => ({
    name: m.method || 'unknown',
    value: m.count,
  }));

  const confData = stats.confidence_by_method.map(m => ({
    method: m.method || 'unknown',
    confidence: Math.round(m.avg_confidence * 100),
  }));

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          title={lang === 'fr' ? 'Taux correction' : 'Correction Rate'}
          value={`${stats.correction_rate}%`}
        />
        <KpiCard
          title={lang === 'fr' ? 'Accord IA/Humain' : 'AI/Human Agreement'}
          value={`${stats.agreement_rate}%`}
        />
        <KpiCard
          title={lang === 'fr' ? 'Coût LLM total' : 'Total LLM Cost'}
          value={`$${stats.llm_usage.total_cost.toFixed(2)}`}
        />
        <KpiCard
          title={lang === 'fr' ? 'Durée moy.' : 'Avg Duration'}
          value={`${stats.avg_duration_overall}s`}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Method distribution */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {lang === 'fr' ? 'Méthode d\'extraction' : 'Extraction Method'}
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={methodData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value"
                label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
                {methodData.map((_e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Confidence by method */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {lang === 'fr' ? 'Confiance par méthode' : 'Confidence by Method'}
          </h3>
          {confData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t(lang, 'noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={confData}>
                <XAxis dataKey="method" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Bar dataKey="confidence" fill="#3b82f6" radius={[4, 4, 0, 0]} name={t(lang, 'confidence')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Human feedback */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {lang === 'fr' ? 'Évaluation humaine' : 'Human Feedback'}
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={feedbackData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value"
                label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
                {feedbackData.map((_e, i) => <Cell key={i} fill={i === 0 ? '#10b981' : i === 1 ? '#f43f5e' : '#94a3b8'} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* LLM usage */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {lang === 'fr' ? 'Utilisation LLM' : 'LLM Usage'}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-purple-500">{lang === 'fr' ? 'Documents' : 'Documents'}</p>
                <p className="text-lg font-bold text-purple-700">{stats.llm_usage.documents}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-purple-500">{lang === 'fr' ? 'Coût total' : 'Total Cost'}</p>
                <p className="text-lg font-bold text-purple-700">${stats.llm_usage.total_cost.toFixed(2)}</p>
              </div>
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <p>{lang === 'fr' ? 'Tokens entrée' : 'Input tokens'}: {stats.llm_usage.total_input_tokens.toLocaleString()}</p>
              <p>{lang === 'fr' ? 'Tokens sortie' : 'Output tokens'}: {stats.llm_usage.total_output_tokens.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Disagreements table */}
      {stats.recent_disagreements.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {lang === 'fr' ? 'Désaccords IA / Humain' : 'AI / Human Disagreements'}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 pr-4 font-medium text-slate-600">{lang === 'fr' ? 'Fichier' : 'File'}</th>
                  <th className="text-center py-2 px-2 font-medium text-slate-600">AI</th>
                  <th className="text-center py-2 px-2 font-medium text-slate-600">{lang === 'fr' ? 'Humain' : 'Human'}</th>
                  <th className="text-left py-2 pl-4 font-medium text-slate-600">{lang === 'fr' ? 'Commentaire IA' : 'AI Comment'}</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_disagreements.map((d, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-slate-800 truncate max-w-[200px]">{d.filename}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.ai_verdict === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {d.ai_verdict}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.human_verdict === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {d.human_verdict}
                      </span>
                    </td>
                    <td className="py-2 pl-4 text-slate-500 text-xs truncate max-w-[300px]">{d.ai_comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex justify-center gap-6 text-xs text-slate-400">
        <span>{stats.total} {lang === 'fr' ? 'documents analysés' : 'documents analyzed'}</span>
        <span>{stats.human_feedback.total} {lang === 'fr' ? 'évalués' : 'reviewed'}</span>
        <span>{stats.corrected_count} {lang === 'fr' ? 'corrigés' : 'corrected'}</span>
      </div>
    </div>
  );
}
