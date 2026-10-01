import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Trophy, Bell, Scale, FileCheck2, ShieldCheck, Users, User as UserIcon, LogOut, type LucideIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAuth, notify } from '../auth';
import { Badge, Skeleton } from '../components/ui/core';
import { OrgRequestForm } from './AuthForms';
import { useNotes, useTournaments, useMyAthletes, useMyClubs } from '../lib/queries';
import type { Athlete, Club, KwfNotification, Tournament } from '../types/api';

function Action({ to, icon: Icon, label, hint }: { to: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <Link to={to} className="card card-hover p-4 flex items-center gap-3 min-w-0">
      <span className="grid place-items-center w-10 h-10 rounded-xl flex-none" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold text-sm leading-tight">{label}</span>
        <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{hint}</span>
      </span>
    </Link>
  );
}

export function Cabinet() {
  const { t } = useLang();
  const { user, role, can, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: tournamentsRaw } = useTournaments('', '', { enabled: !!user });
  const { data: notes } = useNotes(!!user);
  const tournaments: Tournament[] = pageItems(tournamentsRaw);
  const isCoach = role === 'coach';
  const { data: myAthletesRaw } = useMyAthletes(!!user && (isCoach || can('athletes.manage')));
  const { data: myClubsRaw } = useMyClubs(!!user && (isCoach || can('clubs.manage')));
  const myAthletes: Athlete[] = pageItems(myAthletesRaw);
  const myClubs: Club[] = pageItems(myClubsRaw);

  if (!user) return null;
  const mine = tournaments.filter((x) => x.created_by === user.id);
  const unread: number = notes?.unread ?? 0;
  const canOrganize = can('tournaments.manage');
  const canJudge = can('matches.manage');
  // P1: admin holds every permission (backend effective_permissions), so a
  // plain can() check already includes them — the old role!=='admin' exclusion
  // hid /admin/users from admins while the route itself allowed them.
  const canSeeUsers = can('users.view');

  const out = async () => {
    await logout();
    notify(t('me.outOk') ?? 'Logged out', 'ok');
    nav('/me', { replace: true });
  };
  const readAll = async () => {
    const items: KwfNotification[] = (notes?.items ?? []).filter((n) => !n.is_read);
    try {
      await Promise.all(items.slice(0, 20).map((n) =>
        api(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined)));
    } finally {
      qc.invalidateQueries({ queryKey: ['notes'] });
    }
  };

  return (
    <div className="space-y-5 max-w-3xl fade-up">
      <div>
        <span className="eyebrow">{t('nav.cabinet')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('me.login')}</h1>
        <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {t('me.welcome')}, {user.full_name || user.email}
        </div>
      </div>

      {/* profile */}
      <section className="card p-5" aria-label={t('me.profile')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid place-items-center w-12 h-12 rounded-full font-black text-lg flex-none"
            style={{ background: 'var(--navy)', color: 'var(--bg)' }} aria-hidden>
            {(user.full_name || user.email || '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold leading-tight break-words">{user.full_name || '—'}</div>
            <div className="text-sm break-all" style={{ color: 'var(--muted)' }}>{user.email}</div>
            <div className="mt-1"><Badge tone="gold">{t(`role.${role}`)}</Badge></div>
          </div>
          <button className="btn-ghost text-sm !py-2" onClick={out}>
            <LogOut size={15} /> {t('me.out')}
          </button>
        </div>
      </section>

      {/* stats (only real data) */}
      <section className="grid grid-cols-2 gap-3" aria-label="stats">
        <div className="card p-4">
          <Trophy size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{tournaments ? mine.length : '…'}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('me.stT')}</div>
        </div>
        <div className="card p-4">
          <Bell size={18} style={{ color: 'var(--accent)' }} />
          <div className="display text-[26px] font-semibold mt-1.5">{notes ? unread : '…'}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t('me.stU')}</div>
        </div>
      </section>

      {/* quick actions */}
      <section aria-label={t('me.actions')}>
        <h2 className="font-bold mb-2">{t('me.actions')}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {canOrganize && <Action to="/organizer" icon={Trophy} label={t('me.newT')} hint={t('org.title')} />}
          {canOrganize && <Action to="/news/new" icon={FilePlus2} label={t('me.newN')} hint={t('nav.news')} />}
          {canJudge && <Action to="/referee" icon={Scale} label={t('me.judge')} hint={t('cmdk.referee')} />}
          <Action to="/verify" icon={FileCheck2} label={t('me.checkDoc')} hint={t('v.sub')} />
          {can('roles.manage') && <Action to="/admin" icon={ShieldCheck} label={t('me.adminT2')} hint={t('me.adminT')} />}
          {canSeeUsers && <Action to="/admin/users" icon={Users} label={t('adm.users')} hint={t('adm.usersHint')} />}
        </div>
      </section>

      {/* coach: my athletes & clubs */}
      {(isCoach || (can('athletes.manage') && myAthletes.length > 0)) && (
        <section className="space-y-3" aria-label={t('coach.myAthletes')}>
          <h2 className="font-bold">{t('coach.myAthletes')}</h2>
          <div className="card p-5 space-y-2">
            {!myAthletesRaw ? <Skeleton className="h-16" /> :
              !myAthletes.length ? (
                <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('coach.noAthletes')}</div>
              ) : myAthletes.slice(0, 8).map((a) => (
                <Link key={a.id} to={`/athletes/${a.id}`} className="flex items-center gap-2 text-sm font-semibold py-1">
                  <UserIcon size={15} style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-xs font-bold" style={{ color: 'var(--muted)' }}>{a.points} pts</span>
                </Link>
              ))}
            {!!myClubs.length && (
              <div className="pt-2 text-sm" style={{ color: 'var(--muted)' }}>
                {t('coach.myClubs')}: {myClubs.slice(0, 5).map((c) => (
                  <Link key={c.id} to={`/clubs/${c.id}`} className="font-semibold underline mr-2">{c.name}</Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* activity */}
      <section className="space-y-3" aria-label={t('me.activity')}>
        <h2 className="font-bold">{t('me.activity')}</h2>
        <div className="card p-5 space-y-2">
          <div className="font-extrabold text-sm">{t('me.myT')}</div>
          {!tournaments ? <Skeleton className="h-16" /> :
            !mine.length ? (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                {t('me.noT')}. {canOrganize && <Link to="/organizer" className="underline">{t('me.goOrg')}</Link>}
              </div>
            ) : mine.slice(0, 5).map((x) => (
              <Link key={x.id} to={`/tournaments/${x.id}`} className="flex items-center gap-2 text-sm font-semibold py-1">
                <Badge>{x.status}</Badge><span className="truncate">{x.name}</span>
              </Link>
            ))}
        </div>
        <div className="card p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="font-extrabold text-sm flex-1">{t('me.notes')}</div>
            {!!unread && <button className="text-xs font-bold underline" onClick={readAll}>{t('nav.read')}</button>}
          </div>
          {!notes ? <Skeleton className="h-16" /> :
            !notes.items?.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('me.allCaught')}</div> :
            notes.items.slice(0, 5).map((n: KwfNotification) => (
              <div key={n.id} className="text-sm py-1 border-b last:border-0" style={{ borderColor: 'var(--border)', opacity: n.is_read ? .65 : 1 }}>
                {n.link ? <Link to={n.link}>{n.message}</Link> : n.message}
              </div>
            ))}
        </div>
      </section>

      {/* organizer request only for non-organizers */}
      {!canOrganize && (
        <section className="card p-5 space-y-3" aria-label={t('me.reqT')}>
          <h2 className="font-bold">{t('me.reqT')}</h2>
          <OrgRequestForm />
        </section>
      )}
    </div>
  );
}
