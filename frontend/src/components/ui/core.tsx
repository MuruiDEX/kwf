import React from 'react';
import { useLang } from '../../i18n';
const TONES: Record<string, string> = {
  gray: 'badge', gold: 'badge badge-gold', live: 'badge badge-live', navy: 'badge badge-navy',
  upcoming: 'badge', registration: 'badge badge-navy', finished: 'badge',
};
export const Badge = ({ children, tone = 'gray' }: { children: React.ReactNode; tone?: string }) => {
  const { t } = useLang();
  const key = String(children);
  const live = tone === 'live' || key === 'live';
  const label = key.startsWith('status.') || ['upcoming', 'registration', 'live', 'finished'].includes(key) ? t(`status.${key}`) : children;
  return <span className={live ? 'badge badge-live' : (TONES[tone] ?? TONES.gray)}>{label}</span>;
};
export const EmptyState = ({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) => (
  <div className="card p-8 text-center"><h3 className="font-bold text-lg">{title}</h3><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{hint}</p><div className="mt-4">{action}</div></div>
);
export const Skeleton = ({ className = 'h-10' }: { className?: string }) => <div className={`skeleton ${className}`} aria-label="Loading" />;
export const DataTable = ({ cols, rows }: { cols: string[]; rows: React.ReactNode[][] }) => (
  <div className="overflow-x-auto card"><table className="data" role="table"><thead><tr>{cols.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
  <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
);

/** Shared async-state primitive: loading → error+retry → empty → null (render data). */
export function QueryState({ isLoading, isError, isEmpty, retry, emptyTitle, emptyHint, loader }: {
  isLoading: boolean; isError: boolean; isEmpty: boolean; retry: () => void;
  emptyTitle: string; emptyHint: string; loader?: React.ReactNode;
}) {
  const { t } = useLang();
  if (isLoading) return <>{loader ?? <Skeleton className="h-60" />}</>;
  if (isError) return (
    <div className="card p-6 text-center space-y-2">
      <div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={retry}>{t('common.retry')}</button>
    </div>
  );
  if (isEmpty) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return null;
}
