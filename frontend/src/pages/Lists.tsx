import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAuth, notify } from '../auth';
import { DataTable, Skeleton, Badge, QueryState } from '../components/ui/core';
import { useAthletes, useAthlete, useRankings, useClubs, useClub, useTournamentsLive } from '../lib/queries';
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
      : <DataTable cols={[t('a.name'), t('a.country'), t('a.weight'), t('a.points'), t('a.wl')]}
        rows={data.map((a) => [<Link key={a.id} to={`/athletes/${a.id}`} className="font-semibold">{a.name}</Link>, a.country, a.weight, a.points, `${a.wins}-${a.losses}`])} />}</div>;
}

export function AthleteDetail() {
  const { t } = useLang();
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const RESULT: Record<string, string> = { champion: t('r.champion'), finalist: t('r.finalist'), semifinalist: t('r.semi'), participant: t('r.part'), registered: t('r.reg') };
  const { data, isLoading, isError, refetch } = useAthlete(id);
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
    setForm({ first_name: data.first_name, last_name: data.last_name, weight_kg: String(data.weight ?? 0), level: data.level, country: data.country });
    setMsg('');
    setEdit(true);
  };
  const save = async () => {
    if (busy) return;
    const w = Number(String(form.weight_kg).replace(',', '.'));
    if (!form.first_name.trim() || !form.last_name.trim()) { setMsg(`${t('common.err')}: ${t('me.name')}`); return; }
    if (!Number.isFinite(w) || w < 0 || w > 500) { setMsg(`${t('common.err')}: ${t('w.kg')} 0–500`); return; }
    setBusy(true);
    try {
      await api(`/api/athletes/${id}`, { method: 'PUT', body: JSON.stringify({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        gender: data.gender, birth_year: data.birth_year, weight_kg: w,
        level: form.level || data.level, country: form.country, club_id: data.club_id,
      }) });
      notify(t('adm.saved'), 'ok');
      setEdit(false);
      qc.invalidateQueries({ queryKey: ['athlete', String(id)] });
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
          {data.gender === 'male' ? t('a.men') : t('a.women')} · {data.birth_year} {t('a.born')} · {data.weight} {t('w.kg')} · {data.level} · {data.country}
        </div>
        <div className="mt-1 text-sm">{t('a.club')}: {data.club_id ? <Link to={`/clubs/${data.club_id}`}>{data.club}</Link> : data.club} · {t('a.points')}: <b>{data.points}</b> · {t('a.wl')}: {data.wins}-{data.losses}</div>
        {can('athletes.manage') && (
          <button className="btn-ghost text-xs !py-1.5 mt-2" onClick={() => (edit ? setEdit(false) : openEdit())}>✎ {t('common.edit')}</button>
        )}</div>
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
      <h2 className="font-bold">{t('a.history')}</h2>
      {!data.history.length ? <div className="card p-4 text-sm" style={{ color: 'var(--muted)' }}>{t('a.noHist')}</div> :
        <DataTable cols={[t('a.tournament'), t('a.date'), t('res.category'), t('a.result')]}
          rows={data.history.map((h, i: number) => [<Link key={i} to={`/tournaments/${h.tournament_id}`}>{h.tournament}</Link>, h.date, h.category, <Badge key={i} tone="gold">{RESULT[h.result] ?? h.result}</Badge>])} />}
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
    <DataTable cols={[t('rk.rank'), t('a.name'), t('rk.weight'), t('a.points'), t('a.wl')]}
      rows={data.map((r) => [r.rank, <Link key={r.id} to={`/athletes/${r.id}`}>{r.name}</Link>, r.weight, r.points, `${r.wins}-${r.losses}`])} /></div>;
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
  const { data, isLoading, isError, refetch } = useClub(id);
  // NOTE: gate on flags, never on a JSX element (always truthy).
  if (isLoading || isError) return <div className="space-y-4 max-w-2xl"><QueryState isLoading={isLoading} isError={isError} isEmpty={false}
    retry={() => refetch()} emptyTitle="" emptyHint="" /></div>;
  if (!data) return <div className="space-y-4 max-w-2xl"><Skeleton className="h-60" /></div>;
  return (
    <div className="space-y-4 max-w-2xl">
      <div><Link to="/clubs" className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{t('c.back')}</Link>
        <h1 className="display text-3xl font-semibold mt-1">{data.name}</h1>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{data.country} · {data.city} · {t('c.coach')}: {data.coach} · {t('c.titles')}: {data.titles}</div></div>
      <h2 className="font-bold">{t('c.athletes')}</h2>
      <DataTable cols={[t('a.name'), t('a.points'), t('a.wl')]}
        rows={data.athletes.map((a) => [<Link key={a.id} to={`/athletes/${a.id}`}>{a.name}</Link>, a.points, `${a.wins}-${a.losses}`])} />
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
