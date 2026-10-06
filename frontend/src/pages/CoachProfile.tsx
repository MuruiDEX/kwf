import { Link, useParams } from 'react-router-dom';
import { useLang } from '../i18n';
import { useCoachProfile, useClubSchedule } from '../lib/queries';
import { DataTable, Skeleton } from '../components/ui/core';

/** Coach 2.0 P3: public coach profile (private profiles are 404 — no oracle).
 *  Every number below is derived from real data; nothing is fabricated. */
export function CoachProfile() {
  const { t } = useLang();
  const { id } = useParams();
  const { data, isLoading, isError, refetch } = useCoachProfile(id);
  if (isLoading || isError || !data) {
    return (
      <div className="space-y-4 max-w-2xl">
        {isLoading ? <Skeleton className="h-60" /> : isError ? (
          <div className="card p-6 text-center space-y-2">
            <div className="font-bold">{t('common.err')}</div>
            <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button>
          </div>
        ) : null}
      </div>
    );
  }
  const firstClub = data.clubs[0];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-5">
        <div className="flex items-center gap-3">
          {data.avatar ? (
            <img src={data.avatar} alt="" className="w-14 h-14 rounded-full object-cover flex-none" />
          ) : (
            <span className="grid place-items-center w-14 h-14 rounded-full font-black text-xl flex-none"
              style={{ background: 'var(--navy)', color: 'var(--bg)' }} aria-hidden>
              {(data.name || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="display text-2xl font-semibold leading-tight break-words">{data.name}</h1>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {[data.specialization, data.city, data.country].filter(Boolean).join(' · ')}
              {data.experience_years != null && ` · ${data.experience_years} ${t('coach2.years')}`}
            </div>
          </div>
        </div>
        {data.bio && <p className="text-sm mt-3">{data.bio}</p>}
        <div className="grid grid-cols-4 gap-2 mt-4 text-center">
          {[
            [data.stats.athletes, t('coach2.athletes')],
            [data.stats.groups, t('gr.title')],
            [data.stats.tournaments, t('coach2.tournaments')],
            [data.stats.titles, t('coach2.titles')],
          ].map(([n, label]) => (
            <div key={String(label)} className="card p-3" style={{ background: 'var(--bg)' }}>
              <div className="display text-xl font-semibold">{n as number}</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>{label as string}</div>
            </div>
          ))}
        </div>
      </div>

      {!!data.clubs.length && (
        <section aria-label={t('coach2.clubs')}>
          <h2 className="font-bold mb-2">{t('coach2.clubs')}</h2>
          <div className="grid gap-2">
            {data.clubs.map((c) => (
              <Link key={c.id} to={`/clubs/${c.id}`} className="card card-hover p-4 flex items-center gap-3">
                {c.logo && <img src={c.logo} alt="" className="w-10 h-10 rounded-lg object-cover flex-none" />}
                <span className="font-extrabold">{c.name}</span>
                <span className="text-sm ml-auto" style={{ color: 'var(--muted)' }}>{c.city}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!data.groups.length && (
        <section aria-label={t('gr.title')}>
          <h2 className="font-bold mb-2">{t('gr.title')}</h2>
          <DataTable cols={[t('gr.name'), t('coach2.athletes')]}
            rows={data.groups.map((g) => [g.name, g.member_count])} />
        </section>
      )}

      {firstClub && <CoachClubSchedule clubId={firstClub.id} clubName={firstClub.name} />}
    </div>
  );
}

function CoachClubSchedule({ clubId, clubName }: { clubId: number; clubName: string }) {
  const { t } = useLang();
  const { data } = useClubSchedule(String(clubId), true);
  const items = (data?.items ?? []).slice(0, 5);
  if (!items.length) return null;
  return (
    <section aria-label={t('sched.title')}>
      <h2 className="font-bold mb-2">{t('sched.title')} · {clubName}</h2>
      <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
        {items.map((s) => (
          <div key={s.id} className="p-3 text-sm flex items-center gap-3">
            <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
            <span className="flex-1 min-w-0 truncate font-semibold">{s.title}
              {s.group && <span className="ml-2 text-xs font-bold" style={{ color: 'var(--muted)' }}>{s.group}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
