import { useState } from 'react';
import { useLang } from '../i18n';
import { errMsg, pageItems } from '../lib/api';
import { useSessions, useSaveSession, useDeleteSession } from '../lib/queries';
import { EmptyState, Skeleton } from '../components/ui/core';
import type { Club } from '../types/api';

// Multi-role: coach training schedule (club lessons). Scoped by club
// ownership server-side; works for coach-primary and coach-secondary alike.
export function ScheduleSection({ clubs }: { clubs: Club[] }) {
  const { t } = useLang();
  const [clubId, setClubId] = useState<number | null>(clubs[0]?.id ?? null);
  const cid = clubId ?? clubs[0]?.id ?? null;
  const { data: raw, isLoading, isError, refetch } = useSessions(cid, cid != null);
  const data = pageItems(raw);
  const save = useSaveSession();
  const del = useDeleteSession();
  const [form, setForm] = useState({ title: '', starts_at: '', ends_at: '', note: '' });
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
          club_id: cid, title: form.title.trim(), starts_at: form.starts_at,
          ends_at: form.ends_at || null, note: form.note,
        },
      });
      setForm({ title: '', starts_at: '', ends_at: '', note: '' });
      setEditId(null);
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  const startEdit = (s: { id: number; title: string; starts_at: string; ends_at: string | null; note: string }) => {
    setEditId(s.id);
    setForm({ title: s.title, starts_at: s.starts_at.slice(0, 16), ends_at: (s.ends_at ?? '').slice(0, 16), note: s.note });
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
        {isLoading ? <Skeleton className="h-16" /> : isError ? (
          <div className="text-sm space-x-2"><span>{t('common.err')}</span>
            <button className="underline font-bold" onClick={() => refetch()}>{t('common.retry')}</button></div>
        ) : !data.length ? (
          <EmptyState title={t('sched.empty')} hint="" />
        ) : data.map((s) => (
          <div key={s.id} className="text-sm flex items-center gap-2 py-1 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
            <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
            <span className="flex-1 min-w-0 truncate font-semibold">{s.title}
              {s.ends_at && <span style={{ color: 'var(--muted)' }}> → {s.ends_at.slice(11, 16)}</span>}
            </span>
            <button className="btn-ghost text-xs !py-1" onClick={() => startEdit({ ...s, ends_at: s.ends_at })}>✎</button>
            <button className="btn-ghost text-xs !py-1" onClick={() => remove(s.id)}>
              {confirmId === s.id ? `⚠ ${t('adm.yes')}?` : '✕'}
            </button>
          </div>
        ))}
        <div className="grid sm:grid-cols-2 gap-2 pt-1">
          <input aria-label={t('sched.sessionTitle')} className="field sm:col-span-2" placeholder={t('sched.sessionTitle')}
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
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
