import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { errMsg, pageItems } from '../lib/api';
import { parseLocal } from '../lib/schedule';
import { toGroupCreate, validateGroupForm } from '../lib/groups';
import { qk, useClubGroups, useCreateGroup, useGroup, useGroupMember, useSessions, useUpdateGroup } from '../lib/queries';
import { Badge, DataTable, EmptyState, Skeleton } from '../components/ui/core';
import type { Athlete, Club, TrainingGroup, TrainingSession } from '../types/api';

/** D2 P2: coach training squads.
 *
 * Same gate as the roster section. Club picker offers only the coach's own
 * clubs; all management is owner-or-admin server-side. Members render in
 * the public roster shape (no birth/weight/user ids anywhere).
 */
export function GroupsSection({ clubs, athletes }: { clubs: Club[]; athletes: Athlete[] }) {
  const { t } = useLang();
  const [clubId, setClubId] = useState<number | null>(clubs[0]?.id ?? null);
  const cid = clubId ?? clubs[0]?.id ?? null;
  // Cabinet manages groups, so archived squads stay listed (badged) and can
  // be unarchived; the public club page below filters to active only.
  const groupsQ = useClubGroups(cid, cid != null, true);
  // D2 P3: one session list per selected club, shared by all group cards —
  // no per-card requests.
  const { data: sessRaw } = useSessions(cid, cid != null);
  const sessions = pageItems(sessRaw);
  const create = useCreateGroup();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', level: '', age_min: '', age_max: '' });
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!clubs.length) return null;
  const groups = groupsQ.data ?? [];

  const save = async () => {
    const errKey = validateGroupForm(form);
    if (errKey) { setMsg(`${t('common.err')}: ${t(errKey)}`); return; }
    if (cid == null) return;
    // Consume-then-send (same rationale as member add below).
    const body = toGroupCreate(form, cid);
    const prev = form;
    setForm({ name: '', level: '', age_min: '', age_max: '' });
    setOpen(false);
    setMsg('');
    try {
      await create.mutateAsync(body);
      setMsg('✓');
    } catch (e: unknown) { setForm(prev); setOpen(true); setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  return (
    <section className="space-y-3" aria-label={t('gr.title')}>
      <h2 className="font-bold">{t('gr.title')}</h2>
      <div className="card p-5 space-y-3">
        <select aria-label={t('sched.pickClub')} className="field w-full" value={cid ?? ''}
                onChange={(e) => { setClubId(e.target.value ? Number(e.target.value) : null); setExpanded(null); }}>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs !py-1" onClick={() => { setOpen((v) => !v); setMsg(''); }}>
            {open ? '—' : `+ ${t('gr.add')}`}
          </button>
        </div>
        {open && (
          <div className="grid sm:grid-cols-2 gap-2">
            <input aria-label={t('gr.name')} className="field sm:col-span-2" placeholder={t('gr.name')}
                   value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input aria-label={t('gr.level')} className="field" placeholder={t('gr.level')}
                   value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
            <div className="flex gap-2 items-center">
              <input aria-label={`${t('gr.ages')} min`} className="field w-full" placeholder="10" inputMode="numeric"
                     value={form.age_min} onChange={(e) => setForm({ ...form, age_min: e.target.value })} />
              <span style={{ color: 'var(--muted)' }}>–</span>
              <input aria-label={`${t('gr.ages')} max`} className="field w-full" placeholder="12" inputMode="numeric"
                     value={form.age_max} onChange={(e) => setForm({ ...form, age_max: e.target.value })} />
            </div>
            <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={save} disabled={create.isPending}>
              {create.isPending ? '…' : t('common.save')}
            </button>
          </div>
        )}
        {msg && <div className="text-sm">{msg}</div>}
        {groupsQ.isLoading ? <Skeleton className="h-16" /> :
          groupsQ.isError ? (
            <div className="text-sm space-x-2"><span>{t('common.err')}</span>
              <button className="font-bold underline" onClick={() => groupsQ.refetch()}>{t('common.retry')}</button></div>
          ) : !groups.length ? (
            <EmptyState title={t('gr.empty')} hint={t('gr.emptyHint')} />
          ) : groups.map((g) => (
            <GroupCard key={g.id} summary={g} athletes={athletes.filter((a) => a.club_id === g.club_id)}
                       sessions={sessions.filter((s) => s.group_id === g.id)}
                       expanded={expanded === g.id} onToggle={() => setExpanded((cur) => (cur === g.id ? null : g.id))} />
          ))}
      </div>
    </section>
  );
}

function GroupCard({ summary, athletes, sessions, expanded, onToggle }: {
  summary: TrainingGroup; athletes: Athlete[]; sessions: TrainingSession[];
  expanded: boolean; onToggle: () => void;
}) {
  const { t } = useLang();
  const detailQ = useGroup(expanded ? summary.id : null);
  const upd = useUpdateGroup(summary.id);
  const mem = useGroupMember(summary.id);
  const [name, setName] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState('');
  const g = detailQ.data;
  const members = g?.members ?? [];
  const outsiders = athletes.filter((a) => !members.some((m) => m.id === a.id));
  // C5-style hardening (found by E2E): never let the picker act on an option
  // list that is mid-refetch — a swap under the selection silently drops it.
  const syncing = detailQ.isFetching;

  const act = async (fn: () => Promise<unknown>, okReset?: () => void, errReset?: () => void) => {
    setMsg('');
    try {
      await fn();
      setMsg('✓');
      okReset?.();
    } catch (e: unknown) { errReset?.(); setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  // Consume-then-send: form state resets synchronously at click time, so a
  // slow mutation (or its cache refetches) can never wipe input the user
  // entered afterwards. On failure the consumed value is restored.
  const addMember = () => {
    if (!pick) return;
    const id = Number(pick);
    setPick('');
    void act(() => mem.add.mutateAsync(id), undefined, () => setPick(String(id)));
  };
  const rename = () => {
    if (name == null || !name.trim()) return;
    const next = name;
    setName(null);
    void act(() => upd.mutateAsync({ name: next }), undefined, () => setName(next));
  };

  return (
    <div className="card p-4 space-y-2" style={{ background: 'var(--bg)' }}>
      <button className="flex items-center gap-2 w-full text-left" onClick={onToggle} aria-expanded={expanded}>
        <span className="font-extrabold text-sm flex-1 truncate">
          {summary.name}
          {!summary.is_active && <Badge tone="gray">{t('gr.archived')}</Badge>}
        </span>
        <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
          {summary.member_count}
        </span>
      </button>
      {expanded && (
        g == null ? <Skeleton className="h-24" /> : (
          <div className="space-y-2">
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {[g.level, (g.age_min != null || g.age_max != null)
                ? `${g.age_min ?? '?'}–${g.age_max ?? '?'}` : ''].filter(Boolean).join(' · ')}
            </div>
            {members.length ? (
              <DataTable cols={[t('a.name'), t('a.points'), '']}
                rows={members.map((m) => [
                  <Link key={m.id} to={`/athletes/${m.id}`} className="font-semibold">{m.name}</Link>,
                  m.points,
                  <button key={`rm-${m.id}`} className="btn-ghost text-xs !py-1"
                          disabled={mem.remove.isPending}
                          onClick={() => void act(() => mem.remove.mutateAsync(m.id))}>{t('gr.remove')}</button>,
                ])} />
            ) : (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('gr.empty')}</div>
            )}
            {g.is_active && (
              <div className="flex gap-2 items-center">
                <select aria-label={t('gr.pickAthlete')} className="field flex-1 min-w-0 !py-1.5 !text-[13px]"
                        value={pick} disabled={syncing}
                        onChange={(e) => setPick(e.target.value)}>
                  <option value="">{t('gr.pickAthlete')}</option>
                  {outsiders.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                </select>
                <button className="btn-primary text-xs !py-1.5" disabled={!pick || mem.add.isPending || syncing}
                        onClick={addMember}>
                  {t('gr.addMember')}
                </button>
              </div>
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <input aria-label={t('gr.rename')} className="field flex-1 min-w-[140px] !py-1.5 !text-[13px]"
                     placeholder={t('gr.rename')} value={name ?? g.name}
                     onChange={(e) => setName(e.target.value)} />
              <button className="btn-ghost text-xs !py-1.5" disabled={upd.isPending || name == null || !name.trim()}
                      onClick={rename}>
                {t('common.save')}
              </button>
              <button className="btn-ghost text-xs !py-1.5" disabled={upd.isPending}
                      onClick={() => void act(() => upd.mutateAsync({ is_active: !g.is_active }))}>
                {g.is_active ? t('gr.archive') : t('gr.unarchive')}
              </button>
            </div>
            {msg && <div className="text-sm">{msg}</div>}
            <GroupUpcoming sessions={sessions} />
          </div>
        )
      )}
    </div>
  );
}

/** D2 P3: next sessions of this group (from the parent-fetched club list —
 *  no extra request). Read-only preview; management lives in Schedule. */
function GroupUpcoming({ sessions }: { sessions: TrainingSession[] }) {
  const { t } = useLang();
  const now = new Date();
  const next = sessions
    .filter((s) => parseLocal(s.starts_at) >= now)
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
    .slice(0, 3);
  if (!next.length) return null;
  return (
    <div className="space-y-1">
      <div className="font-extrabold text-sm">{t('sched.upcoming')}</div>
      {next.map((s) => (
        <div key={s.id} className="text-sm flex items-center gap-2">
          <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
          <span className="flex-1 min-w-0 truncate font-semibold">{s.title}</span>
        </div>
      ))}
    </div>
  );
}

/** Read-only group list for the public club page (roster-equivalent shape). */
export function ClubGroups({ clubId }: { clubId: number }) {
  const { t } = useLang();
  const groupsQ = useClubGroups(clubId, true);
  const groups = pageItems(groupsQ.data);
  if (groupsQ.isLoading) return <Skeleton className="h-16" />;
  if (groupsQ.isError || !groups.length) return null;
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{t('gr.title')}</h2>
      {groups.filter((g) => g.is_active).map((g) => (
        <div key={g.id} className="card p-4 text-sm">
          <span className="font-extrabold">{g.name}</span>
          <span style={{ color: 'var(--muted)' }}>
            {g.level ? ` · ${g.level}` : ''} · {g.member_count}
          </span>
        </div>
      ))}
    </div>
  );
}
