import type { ReactNode } from 'react';
import { useLang } from '../i18n';
import { dayKeyOf, groupSessionsByDay, parseLocal, weekStart } from '../lib/schedule';
import { EmptyState } from '../components/ui/core';

export interface AgendaSession {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  group_id: number | null;
  group: string | null;
  club?: string;
}

export function dayLabel(day: string, lang: string): string {
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function durationMin(s: AgendaSession): number | null {
  if (!s.ends_at) return null;
  const ms = parseLocal(s.ends_at).getTime() - parseLocal(s.starts_at).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

/** Timeline session card: big time range, title, group chip, meta, actions.
 *  No gradients/glass — KWF card language. `actions` only for managers. */
export function SessionCard({ s, actions }: { s: AgendaSession; actions?: ReactNode }) {
  const dur = durationMin(s);
  return (
    <div className="card p-4 flex gap-4 card-hover" data-testid="club-schedule-hit">
      <div className="flex-none w-[86px]">
        <div className="display text-[17px] font-semibold leading-tight">{s.starts_at.slice(11, 16)}</div>
        <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
          {s.ends_at ? `– ${s.ends_at.slice(11, 16)}` : ''}
          {dur != null && <span> · {dur}′</span>}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-extrabold leading-tight break-words">{s.title}</div>
        <div className="text-xs mt-1 flex gap-2 flex-wrap" style={{ color: 'var(--muted)' }}>
          {s.group && <span className="font-bold" style={{ color: 'var(--accent)' }}>{s.group}</span>}
          {s.club && <span>{s.club}</span>}
        </div>
        {actions && <div className="mt-2 flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Week strip: 7 day buttons + Today reset. Pure navigation, no fetching. */
export function WeekStrip({ weekOffset, selectedDay, onOffset, onSelect }: {
  weekOffset: number; selectedDay: string | null;
  onOffset: (d: number) => void; onSelect: (day: string | null) => void;
}) {
  const { t, lang } = useLang();
  const start = weekStart(weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
  const keyOf = (d: Date) => dayKeyOf(d);
  const todayKey = dayKeyOf(new Date());
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button className="btn-ghost text-sm !py-1.5" onClick={() => onOffset(-1)} aria-label="‹">‹</button>
        <button className="btn-ghost text-sm !py-1.5" onClick={() => { onOffset(0); onSelect(null); }}>
          {t('sched.todayLabel')}
        </button>
        <button className="btn-ghost text-sm !py-1.5" onClick={() => onOffset(1)} aria-label="›">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const k = keyOf(d);
          const sel = selectedDay === k;
          return (
            <button key={k} onClick={() => onSelect(sel ? null : k)}
                    aria-pressed={sel} aria-label={dayLabel(k, lang)}
                    className="card p-2 text-center min-w-0"
                    style={sel ? { borderColor: 'var(--accent)' } : undefined}>
              <div className="text-[11px] font-bold uppercase" style={{ color: 'var(--muted)' }}>
                {d.toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { weekday: 'short' })}
              </div>
              <div className="display text-[17px] font-semibold" style={k === todayKey ? { color: 'var(--accent)' } : undefined}>
                {d.getDate()}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
