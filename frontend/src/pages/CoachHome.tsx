import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, Trophy, Users, Inbox, User as UserIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { pageItems } from '../lib/api';
import { useNotes, useTournaments, useMyAthletes, useMyClubs, useMyGroups, useSessions, useGuardianLinks } from '../lib/queries';
import { todaySessions, upcomingSessions } from '../lib/schedule';
import { Badge, Skeleton } from '../components/ui/core';
import { PageHeader, PageWrap, RoleHero, RoleTabs, SectionCard, StatCard, QuickAction, AttentionList } from '../components/ui/role';
import type { AttentionItem } from '../components/ui/role';
import { AthleteCreateSection } from './AthleteCreate';
import { BulkRegSection } from './BulkReg';
import { ScheduleSection } from './Schedule';
import { GroupsSection } from './Groups';
import { ClubCreateSection } from './ClubCreate';
import { SpravkiSection } from './Spravki';
import { CoachApprovalSection } from './CoachApproval';
import type { Athlete, Club, Tournament } from '../types/api';

const TABS = [
  { id: 'home', labelKey: 'rx.home' },
  { id: 'team', labelKey: 'rx.team' },
  { id: 'athletes', labelKey: 'rx.athletes' },
  { id: 'regs', labelKey: 'rx.regs' },
  { id: 'schedule', labelKey: 'rx.schedule' },
  { id: 'docs', labelKey: 'rx.docs' },
];

/** Team command center (medium-high density, wide):
 *  team overview → attention/tasks → tournaments → roster → schedule. */
export function CoachHome() {
  const { t } = useLang();
  const { user, hasRole, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'home';
  const setTab = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });

  const isCoach = hasRole('coach');
  const canManageAthletes = isCoach || can('athletes.manage');
  const { data: myAthletesRaw } = useMyAthletes(!!user && canManageAthletes);
  const { data: myClubsRaw } = useMyClubs(!!user && (isCoach || can('clubs.manage')));
  const { data: tournamentsRaw } = useTournaments('', '', { enabled: !!user });
  const { data: notes } = useNotes(!!user);
  const { data: sessRaw } = useSessions(null, isCoach && (tab === 'home' || tab === 'schedule'));
  const { data: groupsRaw } = useMyGroups(isCoach && (tab === 'home' || tab === 'team'));
  const { data: links } = useGuardianLinks(!!user && isCoach);

  const myAthletes: Athlete[] = pageItems(myAthletesRaw);
  const myClubs: Club[] = pageItems(myClubsRaw);
  const tournaments: Tournament[] = pageItems(tournamentsRaw);
  const open = tournaments.filter((x) => x.status === 'registration' || x.status === 'upcoming').slice(0, 4);
  const sessions = pageItems(sessRaw);
  const today = todaySessions(sessions);
  const upcoming = upcomingSessions(sessions, new Date(), 3);
  const firstClub = myClubs[0];
  const groupCount = (groupsRaw ?? []).length;
  const incomingCount = links?.incoming?.length ?? 0;

  if (!isCoach && !can('athletes.manage')) return null;

  const attention: AttentionItem[] = [];
  if (incomingCount > 0) {
    attention.push({
      key: 'approvals', tone: 'warn', titleKey: 'guard.incoming',
      detail: `${incomingCount}`, to: '/coach?tab=athletes', actionLabelKey: 'nav.open',
    });
  }
  if (myAthletesRaw && !myAthletes.length) {
    attention.push({
      key: 'no-athletes', tone: 'warn', titleKey: 'coach.noAthletes',
      to: '/coach?tab=athletes', actionLabelKey: 'ac.add',
    });
  }
  if (open.length > 0 && myAthletes.length > 0) {
    attention.push({
      key: 'open-reg', tone: 'info', titleKey: 'bulk.title',
      detail: open[0].name, to: '/coach?tab=regs', actionLabelKey: 'nav.open',
    });
  }
  if ((notes?.unread ?? 0) > 0) {
    attention.push({
      key: 'notes', tone: 'info', titleKey: 'me.notes',
      detail: `${notes?.unread}`, to: '/notifications', actionLabelKey: 'nav.open',
    });
  }

  return (
    <PageWrap width="wide">
      <PageHeader eyebrowKey="coach2.dash" title={firstClub ? firstClub.name : t('coach2.dash')} sub={`${myAthletes.length} · ${t('gr.members')} · ${groupCount} ${t('gr.title').toLowerCase()}`} />
      <RoleHero
        eyebrowKey="coach2.dash"
        title={`${t('rx.team')}: ${myAthletes.length} · ${groupCount} · ${open.length}`}
        sub={today[0] ? `${t('sched.today')}: ${today[0].title}` : t('sched.emptyHintCoach')}
        badges={<><Badge tone="gold">{t('role.coach')}</Badge>{firstClub && <Badge>{firstClub.name}</Badge>}</>}
        primaryCta={<Link to="/coach?tab=regs" className="btn-primary text-sm justify-center">{t('bulk.title')} →</Link>}
        secondaryCta={<Link to="/coach?tab=schedule" className="btn-ghost text-sm !py-2">{t('sched.title')} →</Link>}
      />
      <RoleTabs tabs={TABS} active={tab} onChange={setTab} />

      {(tab === 'home' || tab === 'team') && tab === 'home' && (
        <>
          {!!attention.length && (
            <SectionCard titleKey="rx.attention">
              <AttentionList items={attention} />
            </SectionCard>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            <StatCard icon={Users} value={myAthletes.length} labelKey="gr.members" sub={`${groupCount} · ${t('gr.title').toLowerCase()}`} />
            <StatCard icon={Inbox} value={open.length} labelKey="nav.tournaments" sub={open[0]?.name} />
            <StatCard icon={CalendarDays} value={today.length} labelKey="sched.today" sub={today[0]?.title} />
          </div>
          <SectionCard titleKey="coach.myAthletes" action={firstClub ? <Link to={`/clubs/${firstClub.id}`} className="text-xs font-bold underline">{t('nav.open')}</Link> : undefined}>
            {!myAthletesRaw ? <Skeleton className="h-16" />
              : !myAthletes.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('coach.noAthletes')}</div>
              : myAthletes.slice(0, 8).map((a) => (
                <Link key={a.id} to={`/athletes/${a.id}`} className="flex items-center gap-2 text-sm font-semibold py-1">
                  <UserIcon size={15} style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-xs font-bold" style={{ color: 'var(--muted)' }}>{a.points} pts</span>
                </Link>
              ))}
            {!!myClubs.length && (
              <div className="pt-2 text-sm" style={{ color: 'var(--muted)' }}>
                {t('coach.myClubs')}: {myClubs.slice(0, 5).map((c) => <Link key={c.id} to={`/clubs/${c.id}`} className="font-semibold underline mr-2">{c.name}</Link>)}
              </div>
            )}
          </SectionCard>
          <SectionCard titleKey="nav.tournaments" action={<Link to="/coach?tab=regs" className="text-xs font-bold underline">{t('bulk.title')} →</Link>}>
            {!open.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('t.empty')}</div>
              : open.map((x) => (
                <Link key={x.id} to={`/tournaments/${x.id}`} className="flex items-center gap-2 text-sm font-semibold py-1">
                  <Trophy size={15} style={{ color: 'var(--accent)' }} />
                  <span className="truncate flex-1">{x.name}</span>
                  <Badge>{x.status}</Badge>
                </Link>
              ))}
          </SectionCard>
          {!!upcoming.length && (
            <SectionCard titleKey="sched.upcoming">
              {upcoming.map((s) => (
                <div key={s.id} className="text-sm flex items-center gap-2 py-0.5">
                  <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
                  <span className="flex-1 min-w-0 truncate font-semibold">{s.title}</span>
                </div>
              ))}
            </SectionCard>
          )}
        </>
      )}

      {tab === 'team' && (
        <>
          <GroupsSection clubs={myClubs} athletes={myAthletes} />
          <ClubCreateSection />
        </>
      )}

      {tab === 'athletes' && (
        <>
          {myAthletesRaw && <AthleteCreateSection clubs={myClubs} />}
          <SectionCard titleKey="coach.myAthletes">
            {!myAthletes.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('coach.noAthletes')}</div>
              : myAthletes.map((a) => (
                <Link key={a.id} to={`/athletes/${a.id}`} className="flex items-center gap-2 text-sm font-semibold py-1">
                  <UserIcon size={15} style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{a.points} pts</span>
                </Link>
              ))}
          </SectionCard>
          <CoachApprovalSection />
        </>
      )}

      {tab === 'regs' && <BulkRegSection athletes={myAthletes} tournaments={tournaments} />}

      {tab === 'schedule' && <ScheduleSection clubs={myClubs} />}

      {tab === 'docs' && <SpravkiSection athletes={myAthletes} />}

      {tab === 'home' && (
        <div className="grid sm:grid-cols-3 gap-3">
          <QuickAction to="/coach?tab=regs" icon={Inbox} labelKey="bulk.title" hintKey="bulk.pickT" primary />
          <QuickAction to="/coach?tab=schedule" icon={CalendarDays} labelKey="sched.title" hintKey="sched.today" />
          <QuickAction to="/coach?tab=team" icon={Users} labelKey="rx.team" hintKey="coach.myClubs" />
        </div>
      )}
    </PageWrap>
  );
}
