import { Link } from 'react-router-dom';
import { Bell, CalendarDays, Trophy } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { todaySessions } from '../lib/schedule';
import { nearestReg, pendingActions } from '../lib/athlete';
import {
  useAthleteGroups, useClubSchedule, useMyAthleteProfile, useMyRegistrations,
  useNotes, useScopedAthlete,
} from '../lib/queries';
import { Badge } from '../components/ui/core';
import { ProfileAvatar } from './ProfileEdit';

/** Athlete P1 dashboard: composes already-loaded queries only.
 *  No new endpoints except the athlete's own public group list. */
export function AthleteDashboard() {
  const { t } = useLang();
  const { user, hasRole } = useAuth();
  const isAthlete = hasRole('athlete');
  const { data: mine } = useMyAthleteProfile(!!user && isAthlete);
  const { data: scoped } = useScopedAthlete(mine ? String(mine.id) : undefined, !!mine);
  const clubId = scoped?.club_id ?? null;
  const { data: groups } = useAthleteGroups(mine?.id ?? null, !!mine);
  const { data: sched } = useClubSchedule(clubId != null ? String(clubId) : undefined, clubId != null);
  const { data: regs } = useMyRegistrations(!!user && isAthlete);
  const { data: notes } = useNotes(!!user);

  if (!user || !isAthlete) return null;
  const actions = pendingActions(regs, notes?.unread ?? 0);
  const next = nearestReg(regs);
  const today = todaySessions(sched?.items ?? []);
  const first = today[0];

  return (
    <section className="space-y-3" aria-label={t('ath.dash')}>
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <ProfileAvatar name={mine?.name ?? user.full_name ?? user.email} />
          <div className="min-w-0 flex-1">
            <div className="font-extrabold leading-tight break-words">{mine?.name ?? user.full_name ?? '—'}</div>
            <div className="text-sm break-words" style={{ color: 'var(--muted)' }}>
              {[mine?.club, (groups ?? []).map((g) => g.name)[0]].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-1"><Badge tone="navy">{t('role.athlete')}</Badge></div>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <CalendarDays size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{today.length}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('ath.today')}</div>
          {first && (
            <div className="text-xs mt-1 truncate font-semibold">
              {first.starts_at.slice(11, 16)} · {first.title}
            </div>
          )}
        </div>
        <div className="card p-4">
          <Trophy size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{regs?.length ?? '…'}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('myreg.title')}</div>
          {next && (
            <>
              <Link to={`/tournaments/${next.tournament_id}`} className="text-xs mt-1 truncate font-semibold underline block">
                {next.tournament}
              </Link>
              <Link to={`/tournaments/${next.tournament_id}`} className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                {t('ath.participation')} →
              </Link>
            </>
          )}
        </div>
        <div className="card p-4">
          <Bell size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{notes ? notes.unread : '…'}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('me.stU')}</div>
          {!!notes?.items?.length && (
            <div className="text-xs mt-1 truncate" style={{ color: 'var(--muted)' }}>{notes.items[0].message}</div>
          )}
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('ath.pending')}</div>
        {!actions.length ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ath.pendingEmpty')}</div>
        ) : actions.map((a) => (
          <Link key={a.key} to={a.to} className="flex items-center gap-2 text-sm font-semibold py-1">
            <span className="flex-1 truncate">{t(a.labelKey)}</span>
            <Badge tone={a.tone}>→</Badge>
          </Link>
        ))}
      </div>

      {!!(groups ?? []).length && (
        <div className="card p-5 space-y-2">
          <div className="font-extrabold text-sm">{t('gr.title')}</div>
          <div className="flex gap-1 flex-wrap">
            {(groups ?? []).map((g) => (
              <span key={g.id} className="badge">{g.name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Link to="/tournaments" className="card card-hover p-4 text-sm font-extrabold">{t('nav.tournaments')} →</Link>
        {mine ? (
          <Link to={`/athletes/${mine.id}`} className="card card-hover p-4 text-sm font-extrabold">{t('ath.myProfile')} →</Link>
        ) : (
          <Link to="/notifications" className="card card-hover p-4 text-sm font-extrabold">{t('me.notes')} →</Link>
        )}
      </div>
    </section>
  );
}

/** Athlete P1: proper empty state for applications (was null). */
export function MyApplicationsEmpty() {
  const { t } = useLang();
  return (
    <section className="space-y-3" aria-label={t('myreg.title')}>
      <h2 className="font-bold">{t('myreg.title')}</h2>
      <div className="card p-5 space-y-2">
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ath.noRegs')}</div>
        <Link to="/tournaments" className="btn-primary text-sm justify-center inline-block">
          {t('ath.findTournaments')}
        </Link>
      </div>
    </section>
  );
}
