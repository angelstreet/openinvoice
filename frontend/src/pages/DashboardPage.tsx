import { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { apiFetch } from '../lib/api';
import KpiCard from '../components/dashboard/KpiCard';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { DashboardStats } from '../types';

interface DashboardPageProps {
  lang: Lang;
}

const COLORS = ['#475569', '#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DashboardPage({ lang }: DashboardPageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await apiFetch('/api/dashboard/stats');
        if (res.ok) {
          const data: DashboardStats = await res.json();
          if (!cancelled) setStats(data);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-24 text-slate-500 text-sm">
        {t(lang, 'noData')}
      </div>
    );
  }

  // Prepare supplier distribution data (top 5 + other)
  const supplierData = (() => {
    const sorted = [...stats.supplier_distribution].sort((a, b) => b.count - a.count);
    const top5 = sorted.slice(0, 5);
    const others = sorted.slice(5);
    const result = top5.map(s => ({ name: s.name, value: s.count }));
    if (others.length > 0) {
      result.push({
        name: t(lang, 'other'),
        value: others.reduce((sum, s) => sum + s.count, 0),
      });
    }
    return result;
  })();

  return (
    <div className="space-y-8">

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title={t(lang, 'successRate')} value={`${Math.round(stats.success_rate)}%`} />
        <KpiCard title="Total" value={stats.total_documents} />
        <KpiCard title={lang === 'fr' ? 'Succès' : 'Success'} value={stats.success_count} />
        <KpiCard title={lang === 'fr' ? 'Échec' : 'Fail'} value={stats.error_count} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoices per Month */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">{t(lang, 'invoicesPerMonth')}</h3>
          {stats.invoices_per_month.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t(lang, 'noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.invoices_per_month}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name={t(lang, 'count')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Supplier Distribution Donut */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">{t(lang, 'supplierDistribution')}</h3>
          {supplierData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t(lang, 'noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={supplierData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                  labelLine={false}
                >
                  {supplierData.map((_entry, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Amounts per Month */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">{t(lang, 'amountsPerMonth')}</h3>
          {stats.amounts_per_month.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t(lang, 'noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.amounts_per_month}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => formatCurrency(v)} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} name={t(lang, 'totalAmount')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Suppliers Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">{t(lang, 'topSuppliers')}</h3>
          {stats.top_suppliers.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t(lang, 'noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 pr-4 font-medium text-slate-600">{t(lang, 'supplier')}</th>
                    <th className="text-right py-2 px-4 font-medium text-slate-600">{t(lang, 'count')}</th>
                    <th className="text-right py-2 pl-4 font-medium text-slate-600">{t(lang, 'totalAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_suppliers.map((s, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-slate-800">{s.name}</td>
                      <td className="py-2 px-4 text-right text-slate-600">{s.count}</td>
                      <td className="py-2 pl-4 text-right font-medium text-slate-800">{formatCurrency(s.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
