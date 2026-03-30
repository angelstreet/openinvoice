import type { LineItem } from '../types';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface LineItemsTableProps {
  items: LineItem[];
  currency: string | null;
  lang: Lang;
}

function formatAmount(value: number | null, currency: string | null, noValue: string): string {
  if (value === null || value === undefined) return noValue;
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(value);
    } catch {
      // Invalid currency code — fall back to plain number
    }
  }
  return value.toFixed(2);
}

export default function LineItemsTable({ items, currency, lang }: LineItemsTableProps) {
  const noValue = t(lang, 'noValue');

  if (!items || items.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">No line items extracted.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-2 pr-4 font-medium text-slate-600">
              {t(lang, 'description')}
            </th>
            <th className="text-right py-2 px-4 font-medium text-slate-600">
              {t(lang, 'quantity')}
            </th>
            <th className="text-right py-2 px-4 font-medium text-slate-600">
              {t(lang, 'unitPrice')}
            </th>
            <th className="text-right py-2 pl-4 font-medium text-slate-600">
              {t(lang, 'amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4 text-slate-800">
                {item.description || noValue}
              </td>
              <td className="py-2 px-4 text-right text-slate-700">
                {item.quantity ?? noValue}
              </td>
              <td className="py-2 px-4 text-right text-slate-700">
                {formatAmount(item.unit_price, currency, noValue)}
              </td>
              <td className="py-2 pl-4 text-right font-medium text-slate-800">
                {formatAmount(item.amount, currency, noValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
