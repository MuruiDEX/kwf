import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowUpRight, MapPin, Search, Users } from 'lucide-react';
import { useLang } from '../i18n';
import { pageItems } from '../lib/api';
import { Badge, EmptyState, Skeleton } from '../components/ui/core';
import { STATUS_TONE } from '../components/ui/tournament';
import { useTournaments } from '../lib/queries';
import { fmtDay, fmtMon } from '../lib/format';
import type { Tournament } from '../types/api';

export function Tournaments() {
  const { t, lang } = useLang();
  const STATUSES = [
    { v: '', label: t('t.all') }, { v: 'upcoming', label: t('status.upcoming') },
    { v: 'registration', label: t('status.registration') }, { v: 'live', label: t('status.live') }, { v: 'finished', label: t('status.finished') },
  ];
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '', status = sp.get('status') ?? '';
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  useEffect(() => {
    if (input === q) return;
    const h = setTimeout(() => setSp(prev => { const p = new URLSearchParams(prev); p.set('q', input); return p; }, { replace: true }), 300);
    return () => clearTimeout(h);
  }, [input]);
  const { data: raw, isLoading, isError, refetch } = useTournaments(q, status);
  const data: Tournament[] = pageItems(raw);
  return (
    <div className="space-y-5">
      <div>
        <span className="eyebrow">{t('t.calendar')}</span>
        <h1 className="display text-3xl md:text-4xl font-semibold mt-1">{t('nav.tournaments')}</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input aria-label={t('nav.search')} className="field w-full pl-9" placeholder={t('t.searchPh')} value={input}
                 onChange={e => setInput(e.target.value)} />
        </label>
        <select aria-label={t('status.registration')} className="field" value={status}
                onChange={e => setSp(prev => { const p = new URLSearchParams(prev); p.set('status', e.target.value); return p; })}>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </div>
      {isLoading ? <div className="grid md:grid-cols-2 gap-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        : isError ? <div className="card p-6 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
            <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>
        : !data.length ? <EmptyState title={t('t.empty')} hint={t('t.emptyHint')} />
        : <div className="grid md:grid-cols-2 gap-3 fade-up">
            {data.map((x) => (
              <Link key={x.id} to={`/tournaments/${x.id}`} className="card card-hover p-5 flex gap-4">
                <div className="text-center rounded-xl px-3 py-2 flex-none self-start" style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}>
                  <div className="display text-2xl font-semibold">{fmtDay(x.start_date)}</div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)' }}>{fmtMon(x.start_date, lang)}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[x.status] ?? 'gray'}>{x.status}</Badge>
                  <div className="font-extrabold mt-1.5 leading-tight">{x.name}</div>
                  <div className="text-[13px] mt-1 flex flex-wrap gap-x-3" style={{ color: 'var(--muted)' }}>
                    <span className="inline-flex items-center gap-1"><MapPin size={13} />{x.city}{x.country ? `, ${x.country}` : ''}</span>
                    <span className="inline-flex items-center gap-1"><Users size={13} />{x.participants}</span>
                  </div>
                </div>
                <ArrowUpRight size={18} className="flex-none" style={{ color: 'var(--muted)' }} />
              </Link>
            ))}
          </div>}
    </div>
  );
}
