import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { Bell, CalendarDays, Trophy, FileCheck2 } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { api, errMsg, pageItems } from '../lib/api';
import { useAthleteGroups, useClubSchedule, useMyAthleteProfile, useMyRegistrations, useNotes, useScopedAthlete, useRankings, useAthleteDocs } from '../lib/queries';
import { todaySessions } from '../lib/schedule';
import { nearestReg, pendingActions } from '../lib/athlete';
import { Badge, EmptyState } from '../components/ui/core';
import { PageHeader, PageWrap, RoleHero, SectionCard, QuickAction, RoleTabs } from '../components/ui/role';
import { ProfileAvatar } from './ProfileEdit';
import { MyParticipation } from './MyParticipation';

const TABS = [
  { id: 'home', labelKey: 'rx.home' },
  { id: 'tournaments', labelKey: 'rx.myTournaments' },
  { id: 'results', labelKey: 'rx.results' },
  { id: 'docs', labelKey: 'rx.docs' },
  { id: 'profile', labelKey: 'rx.profile' },
];

/** Personal athlete workspace (medium density, vertical flow):
 *  identity → next event → today's training → registrations → results → docs. */
export function AthleteHome() {
  const { t } = useLang();
  const { user, hasRole } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'home';
  const setTab = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });

  const isAthlete = hasRole('athlete');
  const { data: mine } = useMyAthleteProfile(!!user && isAthlete);
  const { data: scoped } = useScopedAthlete(mine ? String(mine.id) : undefined, !!mine);
  const clubId = scoped?.club_id ?? null;
  const { data: groups } = useAthleteGroups(mine?.id ?? null, !!mine);
  const { data: sched } = useClubSchedule(clubId != null ? String(clubId) : undefined, clubId != null);
  const { data: regs, refetch: refetchRegs } = useMyRegistrations(!!user && isAthlete);
  const { data: notes } = useNotes(!!user);
  const { data: docs } = useAthleteDocs(mine ? String(mine.id) : undefined, !!mine && tab === 'docs');
  const { data: rankRaw } = useRankings(tab === 'results' ? '' : '');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [wMsg, setWMsg] = useState('');
  const drop = async (r: { id: number; tournament_id: number }) => {
    setBusyId(r.id);
    setWMsg('');
    try {
      await api(`/api/tournaments/${r.tournament_id}/registrations/${r.id}/status`, {
        method: 'POST', body: JSON.stringify({ status: 'withdrawn' }),
      });
      setWMsg('✓');
      refetchRegs();
    } catch (e: unknown) { setWMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusyId(null);
  };

  if (!isAthlete) return null;
  const actions = pendingActions(regs, notes?.unread ?? 0);
  const next = nearestReg(regs);
  const today = todaySessions(sched?.items ?? []);
  const identity = [scoped?.club ?? (groups ?? []).map((g) => g.name)[0], user?.email].filter(Boolean).join(' · ');

  return (
    <PageWrap width="narrow">
      <PageHeader eyebrowKey="ath.dash" title={mine?.name ?? user?.full_name ?? t('me.login')} sub={identity} />
      <RoleHero
        eyebrowKey="ath.dash"
        title={next ? next.tournament : t('ath.noRegs')}
        sub={next ? `${next.category} · ${t(`rg.${next.reg_status}`)}` : t('ath.findTournaments')}
        badges={<Badge tone="navy">{t('role.athlete')}</Badge>}
        primaryCta={next
          ? <Link to={`/tournaments/${next.tournament_id}`} className="btn-primary text-sm justify-center">{t('ath.participation')} →</Link>
          : <Link to="/tournaments" className="btn-primary text-sm justify-center">{t('rx.findTournament')}</Link>}
        secondaryCta={next
          ? <Link to="/tournaments" className="btn-ghost text-sm !py-2">{t('rx.findTournament')}</Link>
          : undefined}
      />
      <RoleTabs tabs={TABS} active={tab} onChange={setTab} />

      {(tab === 'home' || tab === 'tournaments') && (
        <>
          {!!today.length && (
            <SectionCard titleKey="sched.today">
              {today.slice(0, 3).map((s) => (
                <div key={s.id} className="flex items-baseline gap-3 py-1 text-sm">
                  <span className="display text-xl font-semibold flex-none tabular-nums">{s.starts_at.slice(11, 16)}</span>
                  <span className="flex-1 min-w-0 truncate font-semibold">{s.title}</span>
                  {s.group && <span className="text-xs flex-none" style={{ color: 'var(--muted)' }}>{s.group}</span>}
                </div>
              ))}
            </SectionCard>
          )}
          <SectionCard titleKey="myreg.title" action={next ? <Link to={`/tournaments/${next.tournament_id}`} className="text-xs font-bold underline">{t('rx.viewMine')}</Link> : undefined}>
            {!regs?.length ? (
              <EmptyState
                title={t('ath.noRegs')}
                hint={t('ath.findTournaments')}
                action={<Link to="/tournaments" className="btn-primary text-sm justify-center inline-flex">{t('rx.findTournament')}</Link>}
              />
            ) : (regs ?? []).slice(0, 6).map((r) => (
              <div key={r.id} className="text-sm flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <Link to={`/tournaments/${r.tournament_id}`} className="font-semibold flex-1 truncate">{r.tournament} · {r.category}</Link>
                <Badge tone={r.reg_status === 'approved' ? 'gold' : 'gray'}>{t(`rg.${r.reg_status}`)}</Badge>
                {(r.reg_status === 'approved' || r.reg_status === 'pending') && (
                  <button className="btn-ghost text-xs !py-1 flex-none" disabled={busyId === r.id}
                    onClick={() => drop(r)}>{busyId === r.id ? '…' : t('self.withdraw')}</button>
                )}
              </div>
            ))}
            {wMsg && <div className="text-sm">{wMsg}</div>}
          </SectionCard>
          {!!actions.length && (
            <SectionCard titleKey="ath.pending">
              {actions.map((a) => (
                <Link key={a.key} to={a.to} className="flex items-center gap-2 text-sm font-semibold py-1">
                  <span className="flex-1 truncate">{t(a.labelKey)}</span><Badge tone={a.tone}>→</Badge>
                </Link>
              ))}
            </SectionCard>
          )}
        </>
      )}

      {tab === 'results' && (
        <SectionCard titleKey="rx.results">
          {!regs?.length ? <EmptyState title={t('myreg.empty')} hint={t('ath.findTournaments')} action={<Link to="/tournaments" className="btn-primary text-sm">{t('rx.findTournament')}</Link>} />
            : (regs ?? []).filter((r) => r.status === 'finished' || (r as { place?: number }).place).slice(0, 10).map((r) => (
              <div key={r.id} className="text-sm flex items-center gap-2 py-1">
                <Link to={`/tournaments/${r.tournament_id}?tab=results`} className="font-semibold flex-1 truncate">{r.tournament} · {r.category}</Link>
                <Badge tone="gold">{t(`rg.${r.reg_status}`)}</Badge>
              </div>
            ))}
          {!!pageItems(rankRaw).length && (
            <div className="text-xs pt-2" style={{ color: 'var(--muted)' }}>
              {t('rk.title')}: {pageItems(rankRaw).slice(0, 3).map((x: { name: string; points: number }) => `${x.name} (${x.points})`).join(' · ')} <Link to="/rankings" className="underline font-bold">{t('sec.fullRank')}</Link>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'docs' && (
        <SectionCard titleKey="rx.docs" action={<Link to="/verify" className="btn-ghost text-xs !py-1.5">{t('nav.verify')}</Link>}>
          {!docs?.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ath.noDocs')}</div>
            : docs.map((d) => (
              <div key={d.code} className="text-sm flex items-center gap-2 py-1">
                <FileCheck2 size={15} style={{ color: 'var(--accent)' }} />
                <span className="flex-1 truncate font-semibold">{d.tournament} · {d.category} · {d.place}</span>
                <Link to={`/verify/${d.code}`} className="text-xs font-bold underline">{t('nav.open')}</Link>
              </div>
            ))}
        </SectionCard>
      )}

      {tab === 'profile' && mine && (
        <SectionCard titleKey="rx.profile" action={<Link to={`/athletes/${mine.id}`} className="text-xs font-bold underline">{t('ath.myProfile')} →</Link>}>
          <div className="flex items-center gap-3">
            <ProfileAvatar name={mine.name ?? user?.full_name ?? user?.email ?? ''} />
            <div className="min-w-0">
              <div className="font-extrabold">{mine.name}</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>{[mine.club, (groups ?? []).map((g) => g.name)[0]].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </SectionCard>
      )}

      {tab === 'home' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <QuickAction to="/tournaments" icon={Trophy} labelKey="nav.tournaments" hintKey="ath.findTournaments" primary />
          {mine ? <QuickAction to={`/athletes/${mine.id}`} icon={CalendarDays} labelKey="ath.myProfile" hintKey="rx.profile" />
            : <QuickAction to="/notifications" icon={Bell} labelKey="me.notes" hintKey="me.allCaught" />}
        </div>
      )}
      {next && tab === 'home' && mine && <MyParticipation tid={String(next.tournament_id)} tt={{ status: 'registration' } as never} me={mine as never} reg={next as never} />}
    </PageWrap>
  );
}
