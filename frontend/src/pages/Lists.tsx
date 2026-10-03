import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAuth, notify } from '../auth';
import { DataTable, Skeleton, Badge, QueryState, EmptyState } from '../components/ui/core';
import { useAthletes, useAthlete, useScopedAthlete, useAthleteDocs, useMyAthleteProfile, useClaimAthlete, useRankings, useClubs, useClub, useClubSchedule, useTournamentsLive } from '../lib/queries';
import type { Athlete, RankingEntry, Club } from '../types/api';

function useDebounced<T>(v: T, ms = 300) {
  const [v2, setV2] = useState(v);
  useEffect(() => { const t = setTimeout(() => setV2(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return v2;
}

export function Athletes() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data: raw, isLoading, isError, refetch } = useAthletes(dq);
  const data: Athlete[] = pageItems(raw);
  // NOTE: never test a JSX element for truthiness (`<QueryState/>` is always a
  // truthy object) — gate on the underlying flags, otherwise the data branch
  // below becomes unreachable and the page stays blank after loading.
  const empty = !isLoading && !isError && !data.length;
  const showState = isLoading || isError || empty;
  return <div className="space-y-4"><div><span className="eyebrow">{t('a.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('a.title')}</h1></div>
    <input aria-label={t('a.searchPh')} className="field w-full" placeholder={t('a.searchPh')} value={q} onChange={e => setQ(e.target.value)} />
    {showState
      ? <QueryState isLoading={isLoading} isError={isError} isEmpty={empty} retry={() => refetch()} emptyTitle={t('a.searchPh')} emptyHint={t('t.emptyHint')} />
      : <DataTable cols={[t('a.name'), t('a.country'), t('a.points'), t('a.wl')]}
        rows={data.map((a) => [<Link key={a.id} to={`/athletes/${a.id}`} className="font-semibold">{a.name}</Link>, a.country, a.points, `${a.wins}-${a.losses}`])} />}</div>;
}

export function AthleteDetail() {
  const { t } = useLang();
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const RESULT: Record<string, string> = { champion: t('r.champion'), finalist: t('r.finalist'), semifinalist: t('r.semi'), participant: t('r.part'), registered: t('r.reg') };
  const { data, isLoading, isError, refetch } = useAthlete(id);
  // B1: exact values come only from the scoped endpoint (coach scope/self).
  // Public AthleteProfile carries bands; the edit form must not read exact
  // fields from it.
  const canManage = can('athletes.manage');
  const { data: scoped } = useScopedAthlete(id, canManage);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', weight_kg: '', level: '', country: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // NOTE: gate on flags, never on a JSX element (always truthy) — otherwise
  // the content branch below is unreachable and the page stays blank.
  if (isLoading || isError) return <div className="space-y-4 max-w-2xl"><QueryState isLoading={isLoading} isError={isError} isEmpty={false}
    retry={() => refetch()} emptyTitle="" emptyHint="" /></div>;
  if (!data) return <div className="space-y-4 max-w-2xl"><Skeleton className="h-60" /></div>;
  const openEdit = () => {
    setForm({ first_name: data.first_name, last_name: data.last_name, weight_kg: String(scoped?.weight ?? data.weight ?? 0), level: data.level, country: data.country });
    setMsg('');
    setEdit(true);
  };
  const save = async () => {
    if (busy) return;
    const w = Number(String(form.weight_kg).replace(',', '.'));
    if (!form.first_name.trim() || !form.last_name.trim()) { setMsg(`${t('common.err')}: ${t('me.name')}`); return; }
    if (!Number.isFinite(w) || w < 0 || w > 500) { setMsg(`${t('common.err')}: ${t('w.kg')} 0–500`); return; }
    // B1: birth_year is required by PUT but no longer public — source it
    // from the scoped view. Out-of-scope managers cannot save (as before,
    // the backend require_athlete_scope would 403 anyway).
    const by = scoped?.birth_year ?? data.birth_year;
    if (by == null) { setMsg(`${t('common.err')}: ${t('me.name')}`); return; }
    setBusy(true);
    try {
      await api(`/api/athletes/${id}`, { method: 'PUT', body: JSON.stringify({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        gender: data.gender, birth_year: by, weight_kg: w,
        level: form.level || data.level, country: form.country, club_id: data.club_id,
      }) });
      notify(t('adm.saved'), 'ok');
      setEdit(false);
      qc.invalidateQueries({ queryKey: ['athlete', String(id)] });
      qc.invalidateQueries({ queryKey: ['scoped-athlete', String(id)] });
      // Wave 7: lists/rankings/clubs read the same edited row.
      qc.invalidateQueries({ queryKey: ['athletes'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
      qc.invalidateQueries({ queryKey: ['clubs'] });
    } catch (e: unknown) {
      const m = `${t('common.err')}: ` + errMsg(e);
      setMsg(m);
      notify(m, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 max-w-2xl">
      <div><Link to="/athletes" className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{t('a.back')}</Link>
        <h1 className="display text-3xl font-semibold mt-1">{data.name}</h1>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {data.gender === 'male' ? t('a.men') : t('a.women')} · {data.age_group} · {data.weight_class} · {data.level} · {data.country}
        </div>
        <div className="mt-1 text-sm">{t('a.club')}: {data.club_id ? <Link to={`/clubs/${data.club_id}`}>{data.club}</Link> : data.club} · {t('a.points')}: <b>{data.points}</b> · {t('a.wl')}: {data.wins}-{data.losses}</div>
        <div className="mt-1 text-sm" data-testid="athlete-stats">
          <b>#{data.rank}</b> {t('a.rank')} · {t('a.winRate')}: {Math.round(data.stats.win_rate * 100)}% · 🏆 {data.stats.titles}
        </div>
        <div className="mt-1 text-sm" data-testid="athlete-medals">🥇 {data.medals.gold} · 🥈 {data.medals.silver} · 🥉 {data.medals.bronze}</div>
        {can('athletes.manage') && (
          <button className="btn-ghost text-xs !py-1.5 mt-2" onClick={() => (edit ? setEdit(false) : openEdit())}>✎ {t('common.edit')}</button>
        )}
        <ClaimButton aid={id} /></div>
      {edit && (
        <div className="card p-4 space-y-2 fade-up">
          <div className="grid grid-cols-2 gap-2">
            <input aria-label={t('me.name')} className="field" placeholder={t('me.name')} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            <input aria-label={t('me.name')} className="field" placeholder={t('me.name')} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            <input aria-label={t('w.kg')} className="field" inputMode="decimal" placeholder={t('w.kg')} value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} />
            <input aria-label={t('a.country')} className="field" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </div>
          <select aria-label={t('a.level')} className="field w-full" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            {['novice', 'advanced', 'elite'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {msg && <div className="form-err" role="alert">{msg}</div>}
          <button className="btn-primary text-sm justify-center w-full" onClick={save} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </div>
      )}
      {!!data.recent_results.length && (
        <>
          <h2 className="font-bold">{t('a.recent')}</h2>
          <div className="space-y-2" data-testid="athlete-recent">
            {data.recent_results.map((r) => (
              <Link key={`${r.tournament_id}-${r.category}`} to={`/tournaments/${r.tournament_id}`}
                    className="card card-hover p-3 flex items-center gap-3" data-testid="athlete-recent-hit">
                <span className="font-bold text-sm flex-1 min-w-0 truncate">{r.tournament}</span>
                <span className="text-xs flex-none" style={{ color: 'var(--muted)' }}>{r.date} · {r.category}</span>
                <Badge tone={r.place === 1 ? 'gold' : 'gray'}>{r.place ? `#${r.place}` : (RESULT[r.result] ?? r.result)}</Badge>
              </Link>
            ))}
          </div>
        </>
      )}
      <h2 className="font-bold">{t('a.history')}</h2>
      {!data.history.length ? <div className="card p-4 text-sm" style={{ color: 'var(--muted)' }}>{t('a.noHist')}</div> :
        <DataTable cols={[t('a.tournament'), t('a.date'), t('res.category'), t('a.result')]}
          rows={data.history.map((h, i: number) => [<Link key={i} to={`/tournaments/${h.tournament_id}`}>{h.tournament}</Link>, h.date, h.category, <Badge key={i} tone="gold">{RESULT[h.result] ?? h.result}</Badge>])} />}
      <AthleteDocs id={id} />
    </div>
  );
}

export function Rankings() {
  const { t } = useLang();
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [wmax, setWmax] = useState('');
  const qs = `gender=${gender}&country=${country}${wmax ? `&weight_max=${wmax}` : ''}`;
  const { data: raw, isLoading, isError, refetch } = useRankings(qs);
  const data: RankingEntry[] = pageItems(raw);
  // NOTE: gate on flags, never on a JSX element (always truthy).
  const rkEmpty = !isLoading && !isError && !data.length;
  const rkState = isLoading || isError || rkEmpty;
  if (rkState) return <div className="space-y-4"><div><span className="eyebrow">{t('rk.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('rk.title')}</h1></div>{
    <QueryState isLoading={isLoading} isError={isError} isEmpty={rkEmpty} retry={() => refetch()} emptyTitle={t('rk.title')} emptyHint={t('t.emptyHint')} />}</div>;
  return <div className="space-y-4"><div><span className="eyebrow">{t('rk.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('rk.title')}</h1></div>
    <div className="flex gap-2 flex-wrap text-sm">
      <select aria-label={t('a.men') + '/' + t('a.women')} className="field" value={gender} onChange={e => setGender(e.target.value)}>
        <option value="">{t('rk.all')}</option><option value="male">{t('rk.men')}</option><option value="female">{t('rk.women')}</option>
      </select>
      <input aria-label={t('rk.country')} className="field w-28" placeholder={t('rk.country')} value={country} onChange={e => setCountry(e.target.value)} />
      <input aria-label={t('rk.wmax')} className="field w-32" placeholder={t('rk.wmax')} inputMode="decimal" value={wmax} onChange={e => setWmax(e.target.value)} />
    </div>
    <DataTable cols={[t('rk.rank'), t('a.name'), t('a.points'), t('a.wl')]}
      rows={data.map((r) => [r.rank, <Link key={r.id} to={`/athletes/${r.id}`}>{r.name}</Link>, r.points, `${r.wins}-${r.losses}`])} /></div>;
}

export function Clubs() {
  const { t } = useLang();
  const { data: raw, isLoading, isError, refetch } = useClubs();
  const data: Club[] = pageItems(raw);
  // NOTE: gate on flags, never on a JSX element (always truthy).
  const cEmpty = !isLoading && !isError && !data.length;
  const cState = isLoading || isError || cEmpty;
  if (cState) return <div className="space-y-4"><div><span className="eyebrow">{t('c.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('c.title')}</h1></div>{
    <QueryState isLoading={isLoading} isError={isError} isEmpty={cEmpty} retry={() => refetch()} emptyTitle={t('c.title')} emptyHint={t('t.emptyHint')} />}</div>;
  return <div className="space-y-4"><div><span className="eyebrow">{t('c.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('c.title')}</h1></div>
    <DataTable cols={[t('res.club'), t('a.country'), t('c.city'), t('c.coach')]}
      rows={data.map((c) => [<Link key={c.id} to={`/clubs/${c.id}`} className="font-semibold">{c.name}</Link>, c.country, c.city, c.coach])} /></div>;
}

export function ClubDetail() {
  const { t } = useLang();
  const { id } = useParams();
  // B2: roster page grows via "show more" (server paginates, counts stay full-club).
  const [rLimit, setRLimit] = useState(50);
  const { data, isLoading, isError, refetch } = useClub(id, rLimit);
  const { data: sched } = useClubSchedule(id, !isLoading && !isError);
  // NOTE: gate on flags, never on a JSX element (always truthy).
  if (isLoading || isError) return <div className="space-y-4 max-w-2xl"><QueryState isLoading={isLoading} isError={isError} isEmpty={false}
    retry={() => refetch()} emptyTitle="" emptyHint="" /></div>;
  if (!data) return <div className="space-y-4 max-w-2xl"><Skeleton className="h-60" /></div>;
  const upcoming = data.upcoming_tournaments ?? [];
  const recent = data.recent_results ?? [];
  const sessions = sched?.items ?? [];
  return (
    <div className="space-y-4 max-w-2xl" data-testid="club-profile">
      <div><Link to="/clubs" className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{t('c.back')}</Link>
        <h1 className="display text-3xl font-semibold mt-1">{data.name}</h1>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{data.country} · {data.city} · {t('c.coach')}: {data.coach} · {t('c.titles')}: {data.titles}</div></div>
      {!!upcoming.length && (
        <section aria-label={t('c.upcoming')}>
          <h2 className="font-bold mb-2">{t('c.upcoming')}</h2>
          <div className="grid md:grid-cols-2 gap-3" data-testid="club-upcoming">
            {upcoming.map((x) => (
              <Link key={x.id} to={`/tournaments/${x.id}`} className="card card-hover discovery-card p-4" data-testid="club-upcoming-hit">
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold leading-tight">{x.name}</div>
                  <div className="text-[13px] mt-1" style={{ color: 'var(--muted)' }}>{x.city} · {x.start_date} · {x.participants}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <h2 className="font-bold">{t('c.athletes')} · {data.athlete_count}</h2>
      {!data.athletes.length ? <EmptyState title={t('c.emptyRoster')} hint="" /> : (
        <>
          <DataTable cols={[t('a.name'), t('a.points'), t('a.wl')]}
            rows={data.athletes.map((a) => [<Link key={a.id} to={`/athletes/${a.id}`}>{a.name}</Link>, a.points, `${a.wins}-${a.losses}`])} />
          {data.athletes.length < data.athlete_count && (
            <button className="btn-ghost text-sm !py-2" onClick={() => setRLimit((l) => l + 50)} data-testid="club-roster-more">
              {t('c.showMore')} ({data.athletes.length}/{data.athlete_count})
            </button>
          )}
        </>
      )}
      {!!recent.length && (
        <section aria-label={t('c.results')}>
          <h2 className="font-bold mb-2">{t('c.results')}</h2>
          <DataTable cols={[t('a.tournament'), t('a.date'), '🥇', '🥈', '🥉']}
            rows={recent.map((r) => [<Link key={r.tournament_id} to={`/tournaments/${r.tournament_id}?tab=results`}>{r.tournament}</Link>, r.date, r.gold, r.silver, r.bronze])} />
        </section>
      )}
      <section aria-label={t('c.schedule')}>
        <h2 className="font-bold mb-2">{t('c.schedule')}</h2>
        {!sessions.length ? <EmptyState title={t('c.noSchedule')} hint="" /> : (
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }} data-testid="club-schedule">
            {sessions.map((s) => (
              <div key={s.id} className="p-3 text-sm flex items-center gap-3" data-testid="club-schedule-hit">
                <span className="font-extrabold flex-none">{s.starts_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="flex-1 min-w-0 truncate font-semibold">{s.title}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="flex gap-2 flex-wrap">
        <a className="card px-3 py-1.5 text-sm font-semibold" href={`/api/clubs/${id}/report.pdf`}>{t('c.reportPdf')}</a>
        <a className="card px-3 py-1.5 text-sm font-semibold" href={`/api/clubs/${id}/report.xlsx`}>{t('c.reportXlsx')}</a>
      </div>
    </div>
  );
}

export function LiveAll() {
  const { t } = useLang();
  const { data: raw, isLoading, isError, refetch } = useTournamentsLive();
  const data = pageItems(raw);
  if (isLoading) return <div className="space-y-4"><div><span className="eyebrow">{t('l.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('l.title')}</h1></div><Skeleton className="h-24" /></div>;
  if (isError) return <div className="space-y-4"><div><span className="eyebrow">{t('l.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('l.title')}</h1></div>
    <div className="card p-6 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div></div>;
  return <div className="space-y-4"><div><span className="eyebrow">{t('l.eyebrow')}</span><h1 className="display text-3xl font-semibold mt-1">{t('l.title')}</h1></div>
    {!data?.length ? <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('l.empty')}</div> :
      data.map((x) => <Link key={x.id} to={`/tournaments/${x.id}?tab=live`} className="card card-hover p-4 flex items-center gap-3 font-bold"><span className="pulse-dot" />{x.name}</Link>)}</div>;
}

// Wave 2: athlete's public-kind documents (diplomas/participation/protocol)
// with re-download. Spravki (PII) are excluded server-side; guests see nothing
// (endpoint requires login).
function AthleteDocs({ id }: { id: string | undefined }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { data, isLoading } = useAthleteDocs(id, !!user);
  if (!user || isLoading) return null;
  if (!data?.length) return null;
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{t('a.docs')}</h2>
      <DataTable cols={[t('res.diploma'), t('res.category'), t('res.place')]}
        rows={data.map((d) => [
          <Link key={d.code} to={`/verify/${d.code}`} className="font-semibold">{d.tournament} · {d.date}</Link>,
          d.category || '—',
          d.place || d.kind,
        ])} />
      <div className="flex gap-2 flex-wrap">
        {data.map((d) => (
          <a key={d.code} className="card px-3 py-1.5 text-sm font-semibold" href={`/api/documents/${d.code}/certificate.pdf`}>{t('v.pdf')} · {d.code.slice(0, 6)}</a>
        ))}
      </div>
    </div>
  );
}

// Wave 4: claim athlete profile for self-service (athlete role only).
function ClaimButton({ aid }: { aid: string | undefined }) {
  const { t } = useLang();
  const { user, hasRole } = useAuth();
  const { data: mine } = useMyAthleteProfile(!!user && hasRole('athlete'));
  const claim = useClaimAthlete();
  const [msg, setMsg] = useState('');
  if (!user || !hasRole('athlete') || aid == null) return null;
  if (mine && String(mine.id) === String(aid)) {
    return <div className="mt-2"><Badge tone="gold">{t('claim.mine')}</Badge></div>;
  }
  if (mine) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      <button className="btn-ghost text-xs !py-1.5"
              disabled={claim.isPending}
              onClick={() => claim.mutate(Number(aid), {
                onSuccess: () => setMsg(t('claim.ok')),
                onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
              })}>
        {claim.isPending ? '…' : t('claim.me')}
      </button>
      {msg && <span className="text-xs">{msg}</span>}
    </div>
  );
}
