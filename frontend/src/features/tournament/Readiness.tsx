import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useLang } from '../../i18n';
import { Skeleton } from '../../components/ui/core';
import { FLOW } from '../../components/ui/tournament';
import type { TournamentDetail as TournamentDetailT, ValidationItem } from '../../types/api';

export type TabId = 'overview' | 'participants' | 'brackets' | 'schedule' | 'live' | 'results' | 'weighin';

const CHECK_TAB: Record<string, TabId> = {
  categories: 'overview', registrations: 'participants', weighin: 'weighin',
  brackets: 'brackets', conflicts: 'schedule',
};
export const CHECK_ORDER = ['categories', 'registrations', 'weighin', 'brackets', 'conflicts'];

/** Operational readiness: progress + blockers with deep-links. Public sees stage only. */
export function Readiness({ tt, validation, canManage, onTab }: {
  tt: TournamentDetailT; validation: ValidationItem[] | undefined; canManage: boolean; onTab: (t: TabId) => void;
}) {
  const { t } = useLang();
  if (!validation) return <div className="card p-5"><Skeleton className="h-20" /></div>;
  const top = validation.filter((v) => CHECK_ORDER.includes(v.key));
  const extra = validation.filter((v) => !CHECK_ORDER.includes(v.key) && !v.ok);
  const done = top.filter((v) => v.ok).length;
  const pct = top.length ? Math.round((done / top.length) * 100) : 0;
  const next = CHECK_ORDER.map((k) => top.find((v) => v.key === k)).find((v) => v && !v.ok);
  const rows = canManage ? [...top, ...extra] : [];
  void FLOW;
  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-extrabold text-sm flex-1">{t('ov.ready')} · {pct}%</div>
        <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('ov.stage')}: {t(`status.${tt.status}`)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('ov.ready')}
        style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .4s ease' }} />
      </div>
      {rows.map((v) => {
        const tab = CHECK_TAB[v.key] ?? (v.key.startsWith('cat-') ? 'participants' : 'overview');
        const warn = v.level === 'warning';
        return (
          <div key={v.key} className="check-row">
            {v.ok
              ? <CheckCircle2 size={16} className="flex-none mt-0.5" style={{ color: 'var(--ok)' }} />
              : <AlertTriangle size={16} className="flex-none mt-0.5" style={{ color: warn ? 'var(--warn)' : 'var(--live)' }} />}
            <span className="flex-1">{v.message}
              {v.suggestion && <span className="block text-[13px]" style={{ color: 'var(--muted)' }}>→ {v.suggestion}</span>}
            </span>
            {canManage && !v.ok && tab !== 'overview' && (
              <button className="btn-ghost text-xs !py-1.5 flex-none" onClick={() => onTab(tab)}>{t('ov.open')}</button>
            )}
          </div>
        );
      })}
      {canManage && next && CHECK_TAB[next.key] !== 'overview' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('ov.next')}:</span>
          <button className="btn-primary text-sm" onClick={() => onTab(CHECK_TAB[next.key])}>
            {t(`tab.${CHECK_TAB[next.key]}`)} <ArrowRight size={15} />
          </button>
        </div>
      )}
      {canManage && !next && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ov.allOk')}</div>}
    </div>
  );
}
