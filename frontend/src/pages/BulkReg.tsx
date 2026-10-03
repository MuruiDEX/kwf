import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errMsg, pageItems } from '../lib/api';
import { useTournament, useRegs } from '../lib/queries';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { Skeleton } from '../components/ui/core';
import type { Athlete, Category, Registration, Tournament } from '../types/api';

// Wave 2: coach bulk registration — own athletes → tournament → categories,
// one POST. Auto-suggests a category by gender/age/weight bounds; the coach
// can override per athlete. Server re-validates everything (same guards).
function ageOf(birthYear: number): number {
  return new Date().getFullYear() - birthYear;
}

function fits(a: Athlete, c: Category): boolean {
  // B1: exact fields are optional in the type (public views carry bands).
  // BulkReg athletes always come from ?mine=true (exact present); the
  // fallbacks only keep tsc honest, never trigger at runtime here.
  const by = a.birth_year ?? 0, w = a.weight ?? 0;
  return c.gender === a.gender
    && ageOf(by) >= c.age_min && ageOf(by) <= c.age_max
    && w >= c.weight_min && w <= c.weight_max;
}

export function BulkRegSection({ athletes, tournaments }: { athletes: Athlete[]; tournaments: Tournament[] }) {
  const { t } = useLang();
  const { can } = useAuth();
  const qc = useQueryClient();
  const open = useMemo(
    () => tournaments.filter((x) => x.status === 'upcoming' || x.status === 'registration'),
    [tournaments]);
  const [tid, setTid] = useState<number | null>(null);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [cat, setCat] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const { data: tt, isLoading: ttLoading } = useTournament(tid != null ? String(tid) : undefined);
  const cats: Category[] = tt?.categories ?? [];
  // Already-registered athletes: hidden from the selectable list, shown
  // separately with their statuses (no duplicate registrations).
  const { data: regsRaw } = useRegs(tid != null ? String(tid) : undefined);
  const regs: Registration[] = pageItems(regsRaw);
  const regByAthlete = new Map(regs.map((r) => [r.athlete_id, r]));
  const ql = q.trim().toLowerCase();
  const pool = athletes.filter((a) => !regByAthlete.has(a.id) && (!ql || a.name.toLowerCase().includes(ql)));
  const done = athletes.filter((a) => regByAthlete.has(a.id));

  if (!can('athletes.manage')) return null;
  if (!athletes.length) return null;

  const toggle = (id: number) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const chosen = pool.filter((a) => sel[a.id]);
  const suggest = (a: Athlete): number | undefined =>
    cats.find((c) => fits(a, c))?.id ?? cats[0]?.id;

  const send = async () => {
    if (busy || tid == null || !chosen.length) return;
    const items = [];
    for (const a of chosen) {
      const cid = cat[a.id] ?? suggest(a);
      if (!cid) { setMsg(`${t('common.err')}: ${a.name} — ${t('bulk.noCat')}`); return; }
      items.push({ athlete_id: a.id, category_id: cid });
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ registered: unknown[]; errors: { row: number; error: string }[]; summary: string }>(
        `/api/tournaments/${tid}/registrations/bulk`, { method: 'POST', body: JSON.stringify({ items }) });
      setMsg(`✓ ${r.summary}${r.errors.length ? ` · ${r.errors.map((e) => `#${e.row}: ${e.error}`).join('; ')}` : ''}`);
      setSel({});
      qc.invalidateQueries({ queryKey: ['regs', String(tid)] });
      qc.invalidateQueries({ queryKey: ['t', String(tid)] });
      qc.invalidateQueries({ queryKey: ['val', String(tid)] });
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };

  return (
    <section className="space-y-3" aria-label={t('bulk.title')}>
      <h2 className="font-bold">{t('bulk.title')}</h2>
      <div className="card p-5 space-y-3">
        <select aria-label={t('bulk.tournament')} className="field w-full" value={tid ?? ''}
                onChange={(e) => setTid(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('bulk.pickT')}</option>
          {open.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.status}</option>)}
        </select>
        {tid != null && (ttLoading ? <Skeleton className="h-24" /> : !cats.length ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('bulk.noCat2')}</div>
        ) : (
          <div className="space-y-1">
            <input aria-label={t('nav.search')} className="field w-full" placeholder={t('nav.search')}
                   value={q} onChange={(e) => setQ(e.target.value)} />
            {pool.map((a) => {
              const s = suggest(a);
              return (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={a.name} checked={!!sel[a.id]} onChange={() => toggle(a.id)} />
                  <span className="font-semibold flex-1 truncate">{a.name}</span>
                  <select aria-label={`${t('bulk.category')} ${a.name}`} className="field !py-1.5 !text-[13px]"
                          value={cat[a.id] ?? s ?? ''} onChange={(e) => setCat({ ...cat, [a.id]: Number(e.target.value) })}>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              );
            })}
            {!pool.length && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('bulk.allDone')}</div>}
          </div>
        ))}
        {!!done.length && tid != null && (
          <div className="text-sm space-y-1 card p-3" style={{ background: 'var(--bg)' }}>
            <div className="font-bold">{t('bulk.registered')} ({done.length})</div>
            {done.map((a) => {
              const r = regByAthlete.get(a.id)!;
              return <div key={a.id}>{a.name} · {r.status ?? ''}</div>;
            })}
          </div>
        )}
        {msg && <div className="text-sm">{msg}</div>}
        <button className="btn-primary text-sm" onClick={send} disabled={busy || tid == null || !chosen.length}>
          {busy ? '…' : `${t('bulk.send')} (${chosen.length})`}
        </button>
      </div>
    </section>
  );
}
