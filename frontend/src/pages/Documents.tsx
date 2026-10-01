import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { api, errMsg, pageItems } from '../lib/api';
import { firstIssue, newsSchema } from '../lib/validators';
import { DataTable, EmptyState, Skeleton } from '../components/ui/core';
import { useNews, useNewsDetail, useResults, useReport, useVerify } from '../lib/queries';
import type { NewsItem } from '../types/api';

const CATS = ['events', 'tournaments', 'clubs', 'results', 'announcements'];

// Public document verification (§19): enter/scan QR code → validity + details
export function Verify() {
  const { t } = useLang();
  const { code: routeCode } = useParams();
  const [code, setCode] = useState(routeCode ?? '');
  const [submitted, setSubmitted] = useState(routeCode ?? '');
  const [nonce, setNonce] = useState(0);
  const { data, isFetching, isError, refetch } = useVerify(submitted, nonce);
  const check = () => {
    const v = code.trim();
    if (!v) return;
    if (v === submitted) { setNonce(n => n + 1); void refetch(); }
    else setSubmitted(v);
  };
  return (
    <div className="space-y-4 max-w-lg mx-auto fade-up">
      <div><span className="eyebrow">{t('v.eyebrow')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('v.title')}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{t('v.sub')}</p></div>
      <div className="flex gap-2">
        <input aria-label={t('v.title')} className="field flex-1 uppercase"
               placeholder={t('v.ph')} value={code}
               onChange={e => setCode(e.target.value.toUpperCase())} />
        <button className="btn-primary text-sm" onClick={check}>{t('v.btn')}</button>
      </div>
      {isFetching && <Skeleton />}
      {isError && <div className="card p-5 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
        <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>}
      {data && !data.valid && <div className="card p-5 text-center font-bold">{t('v.invalid')}</div>}
      {data?.valid && (
        <div className="card p-5 space-y-1 text-sm">
          <div className="font-black text-base" style={{ color: 'var(--accent)' }}>{t('v.valid')}</div>
          <div>{t('v.id')}: {data.code}</div>
          <div>{t('v.athlete')}: {data.athlete}</div>
          <div>{t('v.tournament')}: {data.tournament} · {data.date}</div>
          {data.category && <div>{t('v.category')}: {data.category}</div>}
          {data.place && <div>{t('v.place')}: {data.place} {t('v.placeN')}</div>}
          <a className="inline-block mt-2 underline" href={`/api/documents/${data.code}/certificate.pdf`}>{t('v.pdf')}</a>
        </div>
      )}
    </div>
  );
}

function catName(t: (k: string) => string, c: string) {
  const names = t('n.cats').split(',');
  const i = CATS.indexOf(c);
  return i >= 0 ? names[i] : c;
}

export function News() {
  const { t } = useLang();
  const { can } = useAuth();
  const canPost = can('news.manage');
  const { data: raw, isLoading, isError, refetch } = useNews();
  const data: NewsItem[] = pageItems(raw);
  if (isLoading) return <Skeleton className="h-60" />;
  if (isError) return (
    <div className="card p-6 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>
  );
  if (!data.length) return <EmptyState title={t('n.empty')} hint={t('n.emptyHint')} action={canPost ? <Link to="/news/new" className="btn-primary text-sm">{t('n.new')}</Link> : undefined} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <div className="flex-1"><span className="eyebrow">{t('nav.news')}</span>
          <h1 className="display text-3xl font-semibold mt-1">{t('n.title')}</h1></div>
        {canPost && <Link to="/news/new" className="card px-3 py-1.5 text-sm font-semibold">{t('n.new')}</Link>}</div>
      {data.map((n) => (
        <article key={n.id} className="card p-4">
          <div className="text-xs font-bold uppercase" style={{ color: 'var(--accent)' }}>{catName(t, n.category)}</div>
          <Link to={`/news/${n.slug}`} className="font-bold">{n.title}</Link>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{n.excerpt}</p>
        </article>
      ))}
    </div>
  );
}

export function NewsDetail() {
  const { t } = useLang();
  const { slug } = useParams();
  const { data, isLoading, isError, refetch } = useNewsDetail(slug);
  if (isLoading) return <Skeleton className="h-60" />;
  if (isError || !data) return (
    <div className="card p-6 text-center space-y-2 max-w-2xl"><div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>
  );
  return (
    <article className="card p-6 max-w-2xl space-y-3 fade-up">
      <div className="text-xs font-bold uppercase" style={{ color: 'var(--accent)' }}>{data.category}</div>
      <h1 className="display text-2xl md:text-3xl font-semibold">{data.title}</h1>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{data.body}</p>
    </article>
  );
}

// Minimal news editor (§18): no full CMS, just the fields that matter
export function NewsEditor() {
  const { t } = useLang();
  const nav = useNavigate();
  const [form, setForm] = useState({ title: '', slug: '', excerpt: '', body: '', category: 'events' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    if (busy) return;
    const bad = firstIssue(newsSchema, form);
    if (bad) { setMsg(`${t('common.err')}: ${bad}`); return; }
    setBusy(true);
    try {
      const r = await api<{ id: number; slug: string }>('/api/news', { method: 'POST', body: JSON.stringify(form) });
      nav(`/news/${r.slug}`);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="card p-5 max-w-2xl space-y-3 fade-up">
      <h1 className="display text-2xl font-semibold">{t('n.create')}</h1>
      <input aria-label={t('n.fTitle')} className="field w-full" placeholder={t('n.fTitle')} value={form.title}
             onChange={e => { set('title')(e); if (!form.slug) setForm(f => ({ ...f, title: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9а-яёәіңғүұқөһү]+/gi, '-').slice(0, 60) })); }} />
      <div className="grid grid-cols-2 gap-2">
        <input aria-label={t('n.fSlug')} className="field" placeholder={t('n.fSlug')} value={form.slug} onChange={set('slug')} />
        <select aria-label={t('n.fCat')} className="field" value={form.category} onChange={set('category')}>
          {CATS.map((c, i) => <option key={c} value={c}>{t('n.cats').split(',')[i]}</option>)}
        </select>
      </div>
      <input aria-label={t('n.fExcerpt')} className="field w-full" placeholder={t('n.fExcerpt')} value={form.excerpt} onChange={set('excerpt')} />
      <textarea aria-label={t('n.fBody')} className="field w-full" rows={10} placeholder={t('n.fBody')} value={form.body} onChange={set('body')} />
      <button className="btn-primary text-sm" onClick={save} disabled={busy}>{busy ? '…' : t('n.publish')}</button>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}

// Export buttons (§21) + results/medal table (§47) for tournament page
export function ExportBar({ tid }: { tid: string }) {
  const { t } = useLang();
  const { can } = useAuth();
  if (!can('tournaments.manage')) return null;
  const files = [
    ['participants.csv', t('exp.pcsv')],
    ['participants.xlsx', t('exp.pxlsx')],
    ['schedule.csv', t('exp.scsv')],
    ['protocol.pdf', t('exp.proto')],
  ];
  return (
    <div className="flex gap-2 flex-wrap">
      {files.map(([f, label]) => (
        <a key={f} className="card px-3 py-1.5 text-sm font-semibold" href={`/api/tournaments/${tid}/export/${f}`}>{label}</a>
      ))}
    </div>
  );
}

export function Results({ tid }: { tid: string }) {
  const { t } = useLang();
  const { can } = useAuth();
  const canIssue = can('documents.manage');
  const { data, isLoading, isError, refetch } = useResults(tid);
  if (isLoading) return <Skeleton className="h-40" />;
  if (isError || !data) return (
    <div className="card p-4 text-sm space-y-2"><div>{t('common.err')}</div>
      <button className="btn-ghost text-xs !py-1.5" onClick={() => refetch()}>{t('common.retry')}</button></div>
  );
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold mb-2">{t('res.champs')}</h3>
        <DataTable cols={[t('res.category'), t('res.champ'), t('res.finalists')]}
          rows={data.standings.map((s, i: number) => [s.category, s.champion, s.finalists.join(', ') || '—'])} />
      </div>
      {!!data.medal_table?.length && (
        <div>
          <h3 className="font-bold mb-2">{t('res.medals')}</h3>
          <DataTable cols={[t('res.athlete'), t('res.club'), t('res.gold'), t('res.titles')].concat(canIssue ? [t('res.diploma')] : [])}
            rows={data.medal_table.map((m): ReactNode[] => {
              const row: ReactNode[] = [m.athlete, m.club, m.gold, m.titles.join(', ')];
              if (canIssue) row.push(<DiplomaButton key={m.athlete_id} tid={tid} athleteId={m.athlete_id} category={m.titles[0] ?? ''} />);
              return row;
            })} />
        </div>
      )}
      <ReportBlock tid={tid} />
    </div>
  );
}

function DiplomaButton({ tid, athleteId, category }: { tid: string; athleteId: number; category: string }) {
  const { t } = useLang();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const issue = async () => {
    if (busy || code) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await api<{ code: string }>(
        `/api/documents/issue?athlete_id=${athleteId}&tournament_id=${tid}&kind=diploma&place=1&category=${encodeURIComponent(category)}`,
        { method: 'POST' });
      setCode(r.code);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  if (code) return <Link to={`/verify/${code}`} className="underline text-sm font-bold">{t('res.issued')} · {code}</Link>;
  return (
    <button className="btn-ghost text-xs !py-1.5" onClick={issue} disabled={busy}>
      {busy ? '…' : failed ? t('common.retry') : t('res.diploma')}
    </button>
  );
}

// Auto-generated post-tournament report (§46): stats + news draft, organizer reviews
export function ReportBlock({ tid }: { tid: string }) {
  const { t, lang } = useLang();
  const { can } = useAuth();
  const canPost = can('news.manage');
  const { data, isLoading, isError, refetch } = useReport(tid, lang);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (isLoading) return <Skeleton className="h-32" />;
  if (isError || !data) return (
    <div className="card p-4 text-sm space-y-2"><div>{t('common.err')}</div>
      <button className="btn-ghost text-xs !py-1.5" onClick={() => refetch()}>{t('common.retry')}</button></div>
  );
  const s = data.stats;
  const createNews = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/news', { method: 'POST', body: JSON.stringify({
        title: `${data.tournament}: ${lang === 'kk' ? 'қорытынды' : 'итоги'}`,
        slug: `t${tid}-results-${Date.now() % 100000}`,
        excerpt: `${s.participants} · ${s.fights_finished}/${s.fights_total}`,
        body: data.markdown, category: 'results' }) });
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="card p-4 space-y-2">
      <div className="font-bold">{t('res.report')}</div>
      <div className="text-sm" style={{ color: 'var(--muted)' }}>{data.markdown.split('\n')[2] || ''}</div>
      <pre className="text-xs card p-3 whitespace-pre-wrap" style={{ background: 'var(--bg)' }}>{data.markdown}</pre>
      <div className="flex gap-2 items-center">
        {canPost && <button className="btn-primary text-sm" onClick={createNews} disabled={busy}>{busy ? '…' : t('res.mkNews')}</button>}
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  );
}
