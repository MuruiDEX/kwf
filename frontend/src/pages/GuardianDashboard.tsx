import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { nearestReg } from '../lib/athlete';
import { nextSession, notesActions, wardPendingActions } from '../lib/guardian-dashboard';
import {
  useAthleteGroups, useClubSchedule, useGuardianRegs, useNotes,
} from '../lib/queries';
import { Badge, Skeleton } from '../components/ui/core';
import type { GuardianLink, Ward } from '../types/api';

/** Guardian 2.0 dashboard for the selected ward. Composes shared caches
 *  only (regs, notes, club schedule, groups) — no new endpoints.
 *  Strictly read-only; every CTA deep-links an existing screen. */
export function GuardianDashboard({ wards, currentId, outgoing }: {
  wards: Ward[]; currentId: number | null; outgoing: GuardianLink[];
}) {
  const { t } = useLang();
  const { user } = useAuth();
  const ward = wards.find((w) => w.id === currentId) ?? null;
  const { data: regs, isLoading: regsLoading } = useGuardianRegs(currentId, !!user && currentId != null);
  const { data: notes } = useNotes(!!user);
  const { data: sched } = useClubSchedule(
    ward?.club_id != null ? String(ward.club_id) : undefined, ward?.club_id != null,
  );
  const { data: groups } = useAthleteGroups(ward?.id ?? null, ward != null);

  if (ward == null) return null;
  const actions = [
    ...wardPendingActions({ wardId: ward.id, wardName: ward.name, regs, outgoing }),
    ...notesActions(notes?.unread ?? 0),
  ];
  const next = nearestReg(regs);
  const session = nextSession(sched?.items);
  const groupNames = (groups ?? []).map((g) => g.name);

  return (
    <div className="space-y-3" aria-label={t('guard.dash')}>
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <div className="font-extrabold flex-1 min-w-0">
            <span className="text-xs font-bold block" style={{ color: 'var(--muted)' }}>{t('guard.dash')}</span>
            <span className="truncate">{ward.name}</span>
          </div>
          <Badge tone="navy">{t('guard.ward')}</Badge>
        </div>
        <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {[ward.club, ...groupNames].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('guard.pending')}</div>
        {regsLoading ? <Skeleton className="h-16" /> : !actions.length ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.pendingEmpty')}</div>
        ) : actions.map((a) => (
          <div key={a.key} className="text-sm flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="font-semibold">{t(a.labelKey)}</span>
              {a.detail && (
                <span className="block truncate" style={{ color: 'var(--muted)' }}>{a.detail}</span>
              )}
            </span>
            {a.to ? (
              <Link to={a.to} className="btn-ghost text-xs !py-1 flex-none">{t('nav.open')}</Link>
            ) : (
              <Badge tone={a.tone}>{t('guard.outgoingPending')}</Badge>
            )}
          </div>
        ))}
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('guard.nearest')}</div>
        {regsLoading ? <Skeleton className="h-16" /> : next == null ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.noTournaments')}</div>
        ) : (
          <div className="text-sm flex items-center gap-2">
            <Link to={`/tournaments/${next.tournament_id}`} className="font-semibold flex-1 truncate">
              {next.tournament} · {next.category}
            </Link>
            <Badge tone={next.reg_status === 'approved' ? 'gold' : 'gray'}>{t(`rg.${next.reg_status}`)}</Badge>
          </div>
        )}
        {next != null && (
          <Link to={`/tournaments/${next.tournament_id}`} className="btn-ghost text-xs !py-1 self-start">
            {t('ath.participation')} →
          </Link>
        )}
      </div>

      <div className="card p-5 space-y-2">
        <div className="font-extrabold text-sm">{t('guard.nextTraining')}</div>
        {session == null ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.noTraining')}</div>
        ) : (
          <div className="text-sm flex items-center gap-2">
            <span className="font-extrabold flex-none">{session.starts_at.slice(0, 16).replace('T', ' ')}</span>
            <span className="flex-1 min-w-0 truncate font-semibold">{session.title}</span>
            {session.group && (
              <span className="text-xs font-bold flex-none" style={{ color: 'var(--muted)' }}>{session.group}</span>
            )}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="font-extrabold text-sm flex-1">{t('me.notes')}</div>
          {!!notes?.unread && <Badge tone="gold">{notes.unread}</Badge>}
        </div>
        {!notes?.items?.length ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.noNotes')}</div>
        ) : (
          notes.items.slice(0, 3).map((n) => (
            <div key={n.id} className="text-sm py-1 border-b last:border-0"
                 style={{ borderColor: 'var(--border)', opacity: n.is_read ? 0.65 : 1 }}>
              {n.link ? <Link to={n.link}>{n.message}</Link> : n.message}
            </div>
          ))
        )}
        <Link to="/notifications" className="btn-ghost text-xs !py-1 self-start">{t('guard.allNotes')}</Link>
      </div>
    </div>
  );
}
