import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAuth } from '../auth';
import { useClubs, useClub, useRegs, useTournament } from '../lib/queries';
import { EmptyState, Skeleton } from '../components/ui/core';
import type { Category } from '../types/api';

/** Organizer participant discovery + registration wizard (UX layer only).
 *  Tournament → Club → Athletes → Review → Submit. Uses existing list,
 *  roster, bulk-register and moderation endpoints; backend stays authoritative
 *  (per-row errors, e.g. duplicates or scope, are shown, never bypassed). */
export function RegWizard({ tid }: { tid: string }) {
  const { t } = useLang();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState('');
  const [clubId, setClubId] = useState<number | null>(null);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [catId, setCatId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([]);

  const { data: clubsRaw, isLoading: clubsLoading } = useClubs(q);
  const clubs = pageItems(clubsRaw);
  const { data: clubDetail } = useClub(clubId != null ? String(clubId) : undefined, 100);
  const { data: tt } = useTournament(tid);
  const cats: Category[] = tt?.categories ?? [];
  const { data: regsRaw } = useRegs(tid);
  const registered = new Set(pageItems(regsRaw).map((r) => r.athlete_id));
  const roster = useMemo(() => (clubDetail?.athletes ?? []).filter((a) => !registered.has(a.id)), [clubDetail, regsRaw]);
  if (!can('tournaments.manage')) return null;
  const chosen = roster.filter((a) => sel[a.id]);
  const canNextAth = chosen.length > 0;
  const canSubmit = chosen.length > 0 && catId != null;

  const back = () => { setMsg(''); setErrors([]); setStep((s) => Math.max(0, s - 1)); };
  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setMsg('');
    setErrors([]);
    try {
      const r = await api<{ registered: unknown[]; errors: { row: number; error: string }[]; summary: string }>(
        `/api/tournaments/${tid}/registrations/bulk`,
        { method: 'POST', body: JSON.stringify({ items: chosen.map((a) => ({ athlete_id: a.id, category_id: catId })) }) });
      setMsg(`✓ ${r.summary}`);
      setErrors(r.errors);
      setSel({});
      qc.invalidateQueries({ queryKey: ['regs', String(tid)] });
      qc.invalidateQueries({ queryKey: ['t', String(tid)] });
      if (!r.errors.length) setStep(3);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };

  return (
    <div className="card p-5 space-y-3" aria-label={t('regwiz.title')}>
      <div className="font-extrabold text-sm">{t('regwiz.title')} · {t(`regwiz.s${step + 1}`)}</div>
      {step === 0 && (
        <div className="space-y-2">
          <input aria-label={t('nav.search')} className="field w-full" placeholder={t('regwiz.findClub')}
                 value={q} onChange={(e) => setQ(e.target.value)} />
          {clubsLoading ? <Skeleton className="h-16" /> : !clubs.length ? (
            <EmptyState title={t('regwiz.noClubs')} hint="" />
          ) : clubs.slice(0, 8).map((c) => (
            <button key={c.id} onClick={() => { setClubId(c.id); setSel({}); setStep(1); }}
                    className="card card-hover p-3 w-full text-left text-sm flex items-center gap-2">
              <span className="font-extrabold flex-1 truncate">{c.name}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.city}</span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="space-y-2">
          <button className="text-xs font-bold underline" onClick={back}>{t('regwiz.backClub')}</button>
          {!roster.length ? (
            <EmptyState title={t('regwiz.noAthletes')} hint={t('regwiz.noAthletesHint')} />
          ) : roster.map((a) => (
            <label key={a.id} className="card p-3 flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" aria-label={a.name} checked={!!sel[a.id]}
                     onChange={() => setSel((s) => ({ ...s, [a.id]: !s[a.id] }))} />
              <span className="font-semibold flex-1 truncate">{a.name}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{a.points} pts</span>
            </label>
          ))}
          <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
            {t('regwiz.selected')}: {chosen.length}
          </div>
          <button className="btn-primary text-sm" disabled={!canNextAth} onClick={() => setStep(2)}>
            {t('regwiz.continue')}
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-2">
          <button className="text-xs font-bold underline" onClick={back}>{t('regwiz.backAth')}</button>
          <select aria-label={t('bulk.category')} className="field w-full" value={catId ?? ''}
                  onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('bulk.category')}…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {chosen.map((a) => (
            <div key={a.id} className="text-sm flex items-center gap-2">
              <span className="font-semibold flex-1 truncate">{a.name}</span>
            </div>
          ))}
          <button className="btn-primary text-sm" disabled={!canSubmit || busy} onClick={submit}>
            {busy ? '…' : `${t('bulk.send')} (${chosen.length})`}
          </button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-2">
          <div className="font-extrabold text-sm">✓</div>
          <button className="btn-ghost text-sm !py-2" onClick={() => { setStep(0); setClubId(null); setQ(''); }}>{t('regwiz.again')}</button>
        </div>
      )}
      {!!errors.length && (
        <ul className="text-xs space-y-1" style={{ color: 'var(--muted)' }}>
          {errors.slice(0, 5).map((e, i) => <li key={i}>#{e.row}: {e.error}</li>)}
        </ul>
      )}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
