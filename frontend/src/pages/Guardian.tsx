import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { User as UserIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { Badge, EmptyState, Skeleton } from '../components/ui/core';
import { isGoneError, resolveWardId } from '../lib/guardian';
import { AthleteDocList } from './Lists';
import { GuardianDashboard } from './GuardianDashboard';
import { LinkRequestButton } from './LinkRequest';
import { qk, useAthleteDocs, useGuardianLinks, useGuardianRegs, useGuardianWards, useScopedAthlete } from '../lib/queries';

/** C3: guardian cabinet section (approved wards, strictly read-only).
 *
 * No guardian role exists — visibility is data-driven from
 * GET /api/guardian/athletes. Selection is in-memory UI context only;
 * every request re-authorizes server-side (C2). Revoked wards surface as
 * 403/404 and switch the UI to a safe "no longer available" state without
 * ever rendering stale protected data.
 */
export function GuardianSection() {
  const { t } = useLang();
  const { user } = useAuth();
  const wardsQ = useGuardianWards(!!user);
  const linksQ = useGuardianLinks(!!user);
  const [sel, setSel] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const wards = wardsQ.data ?? [];
  const outgoing = linksQ.data?.outgoing ?? [];
  const current = gone ? null : resolveWardId(wards, sel);

  if (!user) return null;
  return (
    <section className="space-y-3" aria-label={t('guard.title')}>
      <h2 className="font-bold">{t('guard.title')}</h2>
      {wardsQ.isLoading ? <Skeleton className="h-24" /> :
        wardsQ.isError ? (
          <div className="card p-6 text-center space-y-2">
            <div className="font-bold">{t('common.err')}</div>
            <button className="btn-ghost text-sm !py-2" onClick={() => wardsQ.refetch()}>{t('common.retry')}</button>
          </div>
        ) : gone ? (
          <div className="card p-6 text-center space-y-2">
            <div className="font-bold">{t('guard.gone')}</div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.goneHint')}</div>
            <button className="btn-ghost text-sm !py-2" onClick={() => { setGone(false); wardsQ.refetch(); }}>{t('common.retry')}</button>
          </div>
        ) : !wards.length ? (
          <div className="space-y-3">
            <EmptyState title={t('guard.empty')} hint={t('guard.emptyHint')} />
            {outgoing.filter((l) => l.status === 'pending').map((l) => (
              <div key={l.id} className="card p-4 text-sm flex items-center gap-2">
                <span className="font-semibold flex-1">{t('guard.linkPending')}</span>
                <Badge tone="gray">{t('guard.outgoingPending')}</Badge>
              </div>
            ))}
            <LinkRequestButton />
          </div>
        ) : (
          <div className="space-y-3">
            {wards.length > 1 && (
              <label className="card p-4 flex items-center gap-2 text-sm font-semibold">
                <UserIcon size={15} style={{ color: 'var(--accent)' }} />
                <span>{t('guard.switch')}</span>
                <select
                  aria-label={t('guard.switch')}
                  className="field flex-1 min-w-0"
                  value={current ?? ''}
                  onChange={(e) => { setSel(Number(e.target.value)); setGone(false); }}
                >
                  {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            )}
            <GuardianDashboard wards={wards} currentId={current} outgoing={outgoing} />
            <LinkRequestButton compact />
            {current != null && (
              <WardDetail key={current} id={current} onGone={() => { setSel(null); setGone(true); }} />
            )}
          </div>
        )}
    </section>
  );
}

// Read-only ward dashboard: permitted profile + guardian registrations +
// permitted non-spravka documents. No mutation control is rendered anywhere.
function WardDetail({ id, onGone }: { id: number; onGone: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const qc = useQueryClient();
  const scoped = useScopedAthlete(String(id), !!user);
  // Regs/docs load only after the profile read succeeds, so a revoked ward
  // shows one clean denial instead of three parallel 403s.
  const ready = !!user && !scoped.isLoading && !scoped.isError && !!scoped.data;
  const regs = useGuardianRegs(id, ready);
  const docs = useAthleteDocs(String(id), ready);
  const gone = scoped.isError && isGoneError(scoped.error);
  useEffect(() => {
    if (gone) {
      // Access disappeared mid-session: drop cached ward data and let the
      // parent render the safe state. Never keep showing stale rows.
      qc.invalidateQueries({ queryKey: qk.guardianWards });
      qc.invalidateQueries({ queryKey: qk.guardianRegs(id) });
      onGone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);
  if (scoped.isLoading) return <Skeleton className="h-60" />;
  if (scoped.isError || !scoped.data) {
    return (
      <div className="card p-6 text-center space-y-2">
        <div className="font-bold">{t('common.err')}</div>
        <button className="btn-ghost text-sm !py-2" onClick={() => scoped.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  const s = scoped.data;
  return (
    <div className="space-y-3">
      <div className="card p-5 space-y-2">
        <div className="flex items-center gap-2">
          <UserIcon size={15} style={{ color: 'var(--accent)' }} />
          <div className="font-extrabold">{s.name}</div>
        </div>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {s.gender === 'male' ? t('a.men') : t('a.women')} · {s.age_group} · {s.weight_class} · {s.level} · {s.country}
        </div>
        <div className="text-sm">
          {t('a.club')}: {s.club_id ? <Link to={`/clubs/${s.club_id}`} className="font-semibold underline">{s.club}</Link> : s.club}
          {' '}· {t('a.points')}: <b>{s.points}</b> · {t('a.wl')}: {s.wins}-{s.losses}
        </div>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {s.birth_year} {t('a.born')} · {t('a.weight')}: {s.weight}
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('guard.regs')}</div>
        {regs.isLoading ? <Skeleton className="h-16" /> :
          regs.isError ? (
            <div className="text-sm space-x-2">
              <span>{t('common.err')}</span>
              <button className="font-bold underline" onClick={() => regs.refetch()}>{t('common.retry')}</button>
            </div>
          ) : !regs.data?.length ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.regsEmpty')}</div>
          ) : regs.data.map((r) => (
            <div key={r.id} className="text-sm flex items-center gap-2">
              <Link to={`/tournaments/${r.tournament_id}`} className="font-semibold flex-1 truncate">
                {r.tournament} · {r.category}
              </Link>
              <Badge tone={r.reg_status === 'approved' ? 'gold' : 'gray'}>{t(`rg.${r.reg_status}`)}</Badge>
            </div>
          ))}
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('a.docs')}</div>
        {docs.isLoading ? <Skeleton className="h-16" /> :
          docs.isError ? (
            <div className="text-sm space-x-2">
              <span>{t('common.err')}</span>
              <button className="font-bold underline" onClick={() => docs.refetch()}>{t('common.retry')}</button>
            </div>
          ) : !docs.data?.length ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.docsEmpty')}</div>
          ) : (
            <AthleteDocList docs={docs.data} />
          )}
      </div>
    </div>
  );
}
