import { Link } from 'react-router-dom';
import { CalendarDays, Trophy, Users } from 'lucide-react';
import { useLang } from '../i18n';
import { pageItems } from '../lib/api';
import { todaySessions, upcomingSessions } from '../lib/schedule';
import { useMyGroups, useNotes, useSessions } from '../lib/queries';
import { Skeleton } from '../components/ui/core';
import type { Athlete, Club } from '../types/api';

/** Coach 2.0 P3 dashboard: composes already-loaded queries only.
 *  No new endpoints: sessions come from the shared schedule cache,
 *  activity from the shared notes cache. */
export function CoachDashboard({ clubs, athletes, isCoach }: {
  clubs: Club[]; athletes: Athlete[]; isCoach: boolean;
}) {
  const { t } = useLang();
  const { data: sessRaw, isLoading: sessLoading } = useSessions(null, isCoach);
  const { data: groupsRaw } = useMyGroups(isCoach);
  const { data: notes } = useNotes(isCoach);
  const sessions = pageItems(sessRaw);
  const groups = groupsRaw ?? [];
  const today = todaySessions(sessions);
  const upcoming = upcomingSessions(sessions, new Date(), 3);
  const firstClub = clubs[0];

  return (
    <section className="space-y-3" aria-label={t('coach2.dash')}>
      <h2 className="font-bold">{t('coach2.dash')}</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <CalendarDays size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{sessLoading ? '…' : today.length}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('sched.today')}</div>
          {!!today.length && (
            <div className="text-xs mt-1 truncate font-semibold">{today[0].title}</div>
          )}
        </div>
        <div className="card p-4">
          <Users size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{athletes.length}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('gr.members')}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {groups.length} · {t('gr.title').toLowerCase()}
          </div>
        </div>
        <div className="card p-4">
          <Trophy size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{notes?.unread ?? '…'}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('me.stU')}</div>
          {!!notes?.items?.length && (
            <div className="text-xs mt-1 truncate" style={{ color: 'var(--muted)' }}>{notes.items[0].message}</div>
          )}
        </div>
      </div>
      {!!upcoming.length && (
        <div className="card p-4 space-y-1">
          <div className="font-extrabold text-sm">{t('sched.upcoming')}</div>
          {upcoming.map((s) => (
            <div key={s.id} className="text-sm flex items-center gap-2">
              <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
              <span className="flex-1 min-w-0 truncate font-semibold">{s.title}</span>
              {s.group && <span className="text-xs font-bold flex-none" style={{ color: 'var(--muted)' }}>{s.group}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {firstClub && (
          <Link to={`/clubs/${firstClub.id}`} className="card card-hover p-4 text-sm font-extrabold">
            {firstClub.name} →
          </Link>
        )}
        <Link to="/tournaments" className="card card-hover p-4 text-sm font-extrabold">
          {t('nav.tournaments')} →
        </Link>
      </div>
      {sessLoading && <Skeleton className="h-16" />}
    </section>
  );
}
