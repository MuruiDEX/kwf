import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLang } from '../i18n';
import { errMsg, pageItems } from '../lib/api';
import { groupSessionsByDay, parseLocal, todaySessions, weekStart } from '../lib/schedule';
import { useClubGroups, useSessions, useSaveSession, useDeleteSession, useClubSchedule } from '../lib/queries';
import { dayLabel, SessionCard, WeekStrip, type AgendaSession } from './ScheduleView';
import { EmptyState, Skeleton } from '../components/ui/core';
import type { Club, TrainingSession } from '../types/api';

export type AgendaItem = Pick<TrainingSession, 'id' | 'title' | 'starts_at' | 'ends_at' | 'group_id' | 'group'> & {
  note?: string;
  club?: string;
};

// Multi-role: coach training schedule (club lessons). Scoped by club
// ownership server-side; works for coach-primary and coach-secondary alike.
// D2 P3: sessions optionally link one of the club's groups (NULL = club-wide).
export function ScheduleSection({ clubs }: { clubs: Club[] }) {
  const { t } = useLang();
  const [clubId, setClubId] = useState<number | null>(clubs[0]?.id ?? null);
  const cid = clubId ?? clubs[0]?.id ?? null;
  // One unfiltered club list: Today/Upcoming/group filter derive client-side
  // (single request, shared cache) — the server ?group_id= path stays for API clients.
  const { data: raw, isLoading, isError, refetch } = useSessions(cid, cid != null);
  const data = pageItems(raw);
  const { data: groupsRaw } = useClubGroups(cid, cid != null);
  const groups = groupsRaw ?? [];
  const save = useSaveSession();
  const del = useDeleteSession();
  const [form, setForm] = useState({ title: '', starts_at: '', ends_at: '', note: '', group_id: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const submit = async () => {
    if (!cid || !form.title.trim() || !form.starts_at) {
      setMsg(`${t('common.err')}: ${t('sched.needFields')}`);
      return;
    }
    setMsg('');
    try {
      await save.mutateAsync({
        id: editId,
        body: {
          club_id: cid, group_id: form.group_id ? Number(form.group_id) : null,
          title: form.title.trim(), starts_at: form.starts_at,
          ends_at: form.ends_at || null, note: form.note,
        },
      });
      setForm({ title: '', starts_at: '', ends_at: '', note: '', group_id: '' });
      setEditId(null);
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  const startEdit = (s: { id: number; title: string; starts_at: string; ends_at: string | null; note: string; group_id: number | null }) => {
    setEditId(s.id);
    setForm({ title: s.title, starts_at: s.starts_at.slice(0, 16), ends_at: (s.ends_at ?? '').slice(0, 16), note: s.note, group_id: s.group_id != null ? String(s.group_id) : '' });
    setMsg('');
  };
  const remove = async (id: number) => {
    if (confirmId !== id) { setConfirmId(id); return; }
    setConfirmId(null);
    try {
      await del.mutateAsync(id);
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  if (!clubs.length) return null;
  return (
    <section className="space-y-3" aria-label={t('sched.title')}>
      <h2 className="font-bold">{t('sched.title')}</h2>
      <div className="card p-5 space-y-3">
        <select aria-label={t('sched.pickClub')} className="field w-full" value={cid ?? ''}
                onChange={(e) => setClubId(e.target.value ? Number(e.target.value) : null)}>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <ScheduleBrowser
          items={data} isLoading={isLoading} isError={isError} refetch={refetch}
          groups={groups.filter((g) => g.is_active)}
          manageFor={(s) => (
            <>
              <button className="btn-ghost text-xs !py-1" onClick={() => startEdit({ ...s, ends_at: s.ends_at, note: s.note ?? '' })}>✎</button>
              <button className="btn-ghost text-xs !py-1" onClick={() => remove(s.id)}>
                {confirmId === s.id ? `⚠ ${t('adm.yes')}?` : '✕'}
              </button>
            </>
          )}
        />
        <div className="grid sm:grid-cols-2 gap-2 pt-1">
          <input aria-label={t('sched.sessionTitle')} className="field sm:col-span-2" placeholder={t('sched.sessionTitle')}
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select aria-label={t('sched.group')} className="field sm:col-span-2" value={form.group_id}
                  onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">{t('sched.noGroup')}</option>
            {groups.filter((g) => g.is_active).map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
          <input aria-label={t('sched.starts')} type="datetime-local" className="field"
                 value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          <input aria-label={t('sched.ends')} type="datetime-local" className="field"
                 value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
          <input aria-label={t('sched.note')} className="field sm:col-span-2" placeholder={t('sched.note')}
                 value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={submit} disabled={save.isPending}>
            {save.isPending ? '…' : editId == null ? t('sched.add') : t('common.save')}
          </button>
        </div>
        {msg && <div className="text-sm">{msg}</div>}
      </div>
    </section>
  );
}

/** Shared schedule browser: mode tabs (Agenda / Week / Today), optional
 *  group filter, day-grouped timeline cards. Used by the coach cabinet
 *  (with manage actions + form above) and the public club page (read-only).
 *  All rendering derives from the passed items — no fetching inside. */
export function ScheduleBrowser({ items, groups, isLoading, isError, refetch, manageFor }: {
  items: AgendaItem[];
  groups: { id: number; name: string }[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  manageFor?: (s: AgendaItem) => React.ReactNode;
}) {
  const { t, lang } = useLang();
  const [mode, setMode] = useState<'agenda' | 'week' | 'today'>('agenda');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('');
  const filtered = groupFilter ? items.filter((s) => s.group_id != null && String(s.group_id) === groupFilter) : items;

  let visible = filtered;
  if (mode === 'today') visible = todaySessions(filtered);
  else if (mode === 'week') {
    const start = weekStart(weekOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    visible = filtered.filter((s) => {
      const d = parseLocal(s.starts_at);
      return d >= start && d < end && (selectedDay == null || s.starts_at.slice(0, 10) === selectedDay);
    }).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  }
  const days = mode === 'today' ? [] : groupSessionsByDay(visible);

  return (
    <div className="space-y-3">
      <div className="tabs" role="tablist" aria-label={t('sched.title')}>
        {(['agenda', 'week', 'today'] as const).map((m) => (
          <button key={m} className="tab" role="tab" aria-selected={mode === m}
                  onClick={() => { setMode(m); if (m !== 'week') { setWeekOffset(0); setSelectedDay(null); } }}>
            {t(`sched.mode_${m}`)}
          </button>
        ))}
      </div>
      {mode === 'week' && (
        <WeekStrip weekOffset={weekOffset} selectedDay={selectedDay}
                   onOffset={(d) => setWeekOffset((o) => (d === 0 ? 0 : o + d))}
                   onSelect={setSelectedDay} />
      )}
      <select aria-label={t('sched.groupFilter')} className="field w-full" value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}>
        <option value="">{t('sched.allGroups')}</option>
        {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>
      {isLoading ? <Skeleton className="h-16" /> : isError ? (
        <div className="text-sm space-x-2"><span>{t('common.err')}</span>
          <button className="underline font-bold" onClick={() => refetch()}>{t('common.retry')}</button></div>
      ) : mode === 'today' && !visible.length ? (
        <EmptyState title={t('sched.emptyToday')} hint={manageFor ? t('sched.emptyTodayHint') : ''} />
      ) : !visible.length ? (
        <EmptyState title={t('sched.empty')} hint={manageFor ? t('sched.emptyHintCoach') : ''} />
      ) : mode === 'today' ? (
        <div className="space-y-2">
          {visible.map((s) => <SessionCard key={s.id} s={s} actions={manageFor?.(s)} />)}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(({ day, items: rows }) => (
            <div key={day} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="font-extrabold text-sm">{dayLabel(day, lang)}</span>
                <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{rows.length}</span>
              </div>
              {rows.map((s) => <SessionCard key={s.id} s={s} actions={manageFor?.(s)} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Public read-only schedule browser for a club page: same agenda UX,
 *  active-group filter, never management controls or notes. */
export function ClubScheduleBrowser({ clubId }: { clubId: string | undefined }) {
  const cid = clubId != null && clubId !== '' && Number.isFinite(Number(clubId)) ? Number(clubId) : null;
  const sched = useClubSchedule(clubId, !!clubId);
  const groupsQ = useClubGroups(cid, !!clubId);
  const items = sched.data?.items ?? [];
  const groups = (groupsQ.data ?? []).filter((g) => g.is_active);
  const refetch = () => { void sched.refetch(); void groupsQ.refetch(); };
  return (
    <div data-testid="club-schedule">
      <ScheduleBrowser
        items={items} isLoading={sched.isLoading} isError={sched.isError} refetch={refetch}
        groups={groups}
      />
    </div>
  );
}
