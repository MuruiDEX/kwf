import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, Search, Trophy, Radio, FileBadge, Medal, Zap } from 'lucide-react';
import { useLang } from '../i18n';
import { pageItems } from '../lib/api';
import { EmptyState, Skeleton, DataTable } from '../components/ui/core';
import { DiscoveryCard } from '../components/ui/DiscoveryCard';
import { useTournaments, useRankings, useNews } from '../lib/queries';
import type { NewsItem, RankingEntry, Tournament } from '../types/api';

function SearchHero() {
  const { t } = useLang();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      className="relative max-w-xl"
      role="search"
      aria-label={t('nav.search')}
      onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search'); }}
    >
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
      <input
        aria-label={t('nav.search')}
        className="field w-full pl-10 !py-3.5 !text-[15px]"
        placeholder={t('search.ph')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="home-search"
      />
    </form>
  );
}

export function Home() {
  const { t, lang } = useLang();
  const FEATURES = [
    { icon: Zap, title: t('feat.1t'), text: t('feat.1x') },
    { icon: Radio, title: t('feat.2t'), text: t('feat.2x') },
    { icon: FileBadge, title: t('feat.3t'), text: t('feat.3x') },
    { icon: Medal, title: t('feat.4t'), text: t('feat.4x') },
  ];
  const { data: tournamentsRaw, isLoading } = useTournaments();
  const { data: rankingsRaw } = useRankings();
  const { data: newsRaw } = useNews();
  const tournaments: Tournament[] = pageItems(tournamentsRaw);
  const rankings: RankingEntry[] = pageItems(rankingsRaw);
  const news: NewsItem[] = pageItems(newsRaw);
  const live = tournaments.filter((x) => x.status === 'live');
  const upcoming = tournaments.filter((x) => x.status !== 'live' && x.status !== 'finished').slice(0, 3);
  const finished = tournaments.filter((x) => x.status === 'finished').slice(0, 3);
  const athletes = tournaments.reduce((s: number, x) => s + (x.participants || 0), 0);

  return (
    <div className="space-y-10">
      {!!live.length && (
        <Link to={`/tournaments/${live[0].id}?tab=live`} className="live-banner fade-up" aria-label={t('nav.live')}>
          <span className="pulse-dot" />
          <span>{t('live.now')}: {live[0].name}</span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{t('live.watch')}</span>
          <ArrowRight size={16} className="ml-auto" />
        </Link>
      )}

      <section className="hero p-8 md:p-14 fade-up">
        <div className="hero-kanji" aria-hidden>極真</div>
        <div className="max-w-2xl relative">
          <span className="eyebrow">{t('hero.eyebrow')}</span>
          <h1 className="display font-semibold mt-4" style={{ fontSize: 'clamp(44px, 7vw, 84px)' }}>
            {t('hero.l1')}<br />{t('hero.l2')}<br /><span style={{ color: 'var(--accent)' }}>{t('hero.l3')}</span>
          </h1>
          <p className="mt-4 text-[15px] md:text-base max-w-xl" style={{ color: 'var(--muted)' }}>{t('hero.sub')}</p>
          <div className="flex flex-wrap gap-3 mt-7">
            <Link to="/tournaments" className="btn-primary">{t('hero.ctaT')} <ArrowRight size={16} /></Link>
            <Link to="/live" className="btn-ghost"><span className="pulse-dot" style={{ width: 8, height: 8 }} /> {t('hero.ctaLive')}</Link>
          </div>
          <div className="mt-5"><SearchHero /></div>
          <div className="hero-stats mt-9">
            <div className="hero-stat"><b>{tournaments?.length ?? '—'}</b><span>{t('hero.stT')}</span></div>
            <div className="hero-stat"><b>{athletes}</b><span>{t('hero.stP')}</span></div>
            <div className="hero-stat"><b>{rankings?.length ?? '—'}</b><span>{t('hero.stR')}</span></div>
          </div>
        </div>
      </section>

      <section className="fade-up fade-up-1">
        <div className="section-head"><h2>{t('sec.upcoming')}</h2><Link to="/tournaments">{t('sec.allT')}</Link></div>
        {isLoading ? <div className="grid md:grid-cols-3 gap-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          : !upcoming.length ? <EmptyState title={t('t.empty')} hint={t('t.emptyHint')} />
          : <div className="grid md:grid-cols-3 gap-3">{upcoming.map((x) => <DiscoveryCard key={x.id} t={x} locale={lang} />)}</div>}
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 fade-up fade-up-2">
        {FEATURES.map(f => (
          <div key={f.title} className="card p-4">
            <f.icon size={20} style={{ color: 'var(--accent)' }} />
            <div className="font-extrabold text-sm mt-2">{f.title}</div>
            <div className="text-[13px] mt-1 leading-snug" style={{ color: 'var(--muted)' }}>{f.text}</div>
          </div>
        ))}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="fade-up fade-up-2">
          <div className="section-head"><h2>{t('sec.top')}</h2><Link to="/rankings">{t('sec.fullRank')}</Link></div>
          {rankings ? <DataTable cols={['#', t('a.name'), t('a.points'), t('a.wl')]}
            rows={rankings.slice(0, 5).map((r) => [
              <span key="rk" className="display font-semibold" style={{ color: r.rank <= 3 ? 'var(--accent)' : 'var(--muted)' }}>{r.rank}</span>,
              <Link key={r.id} to={`/athletes/${r.id}`} className="font-semibold">{r.name}</Link>, r.points, `${r.wins}-${r.losses}`])} />
            : <Skeleton className="h-48" />}
        </section>
        <section className="fade-up fade-up-3">
          <div className="section-head"><h2>{t('sec.results')}</h2><Link to="/tournaments">{t('sec.allT')}</Link></div>
          {!finished.length
            ? <div className="card p-5 text-sm flex gap-3 items-start"><Trophy size={18} className="flex-none mt-0.5" style={{ color: 'var(--accent)' }} />
                <span style={{ color: 'var(--muted)' }}>{t('sec.resultsHint')}</span></div>
            : <div className="space-y-2">{finished.map((x) => (
              <Link key={x.id} to={`/tournaments/${x.id}?tab=results`} className="card card-hover p-4 flex items-center gap-3">
                <Trophy size={18} style={{ color: 'var(--accent)' }} />
                <span className="font-bold text-sm flex-1">{x.name}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{x.start_date}</span>
              </Link>))}</div>}
        </section>
      </div>

      {!!news?.length && (
        <section>
          <div className="section-head"><h2>{t('sec.news')}</h2><Link to="/news">{t('sec.allNews')}</Link></div>
          <div className="grid md:grid-cols-3 gap-3">
            {news.slice(0, 3).map((n) => (
              <Link key={n.id} to={`/news/${n.slug}`} className="card card-hover p-5">
                <div className="text-[11px] font-extrabold uppercase tracking-[.14em]" style={{ color: 'var(--accent)' }}>{n.category}</div>
                <div className="font-extrabold mt-1.5 leading-snug">{n.title}</div>
                <div className="text-[13px] mt-1 line-clamp-2" style={{ color: 'var(--muted)' }}>{n.excerpt}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="hero p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-5 fade-up">
        <div className="flex-1">
          <span className="eyebrow">{t('org.eyebrow')}</span>
          <div className="display text-2xl md:text-3xl font-semibold mt-2">{t('org.title')}</div>
          <p className="text-sm mt-2 max-w-lg" style={{ color: 'var(--muted)' }}>{t('org.text')}</p>
        </div>
        <div className="flex gap-3 flex-none flex-wrap">
          <Link to="/organizer" className="btn-primary">{t('org.create')}</Link>
          <Link to="/verify" className="btn-ghost">{t('org.verify')}</Link>
        </div>
      </section>
    </div>
  );
}
