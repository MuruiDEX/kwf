/** Wave A2: /search page on the shared /api/search contract (A1).
 *  URL is the source of truth: /search?q=..&scope=..
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { MapPin, Search as SearchIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { Badge, EmptyState, QueryState } from '../components/ui/core';
import { STATUS_TONE } from '../components/ui/tournament';
import { SEARCH_PAGE_LIMIT, normalizeScope, useDebouncedValue, useGlobalSearch } from '../lib/search';
import type { SearchScope } from '../types/api';

const SCOPES: SearchScope[] = ['athletes', 'clubs', 'tournaments'];

export function SearchPage() {
  const { t } = useLang();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const scopeParam = sp.get('scope') ?? '';
  const scopes = normalizeScope(scopeParam);
  const [input, setInput] = useState(q);
  // Single debounce for the whole flow: URL q -> input -> dq -> API.
  const dq = useDebouncedValue(input, 280);

  // F-UX-1: URL is the source of truth. External q changes (Back/Forward,
  // shared links, CommandMenu "All results") flow into the input. dirtyRef
  // marks user-typed content: only that may be committed back. This kills
  // two loops at once — (a) sync echo (setInput same value bails out) and
  // (b) the same-commit echo where the commit effect runs before the synced
  // setInput has applied (dq === stale input would otherwise clobber a
  // just-pushed external URL with the old query).
  const dirtyRef = useRef(false);
  useEffect(() => { setInput(q); }, [q]);

  // input -> URL (debounced, replace: no history spam).
  useEffect(() => {
    if (!dirtyRef.current || dq === q || dq !== input) return;
    dirtyRef.current = false;
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (dq) p.set('q', dq);
      else p.delete('q');
      return p;
    }, { replace: true });
  }, [dq, q, input, setSp]);

  // Immediate commit for explicit actions (reset button).
  const commitQ = (v: string) => {
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (v) p.set('q', v);
      else p.delete('q');
      return p;
    }, { replace: true });
  };
  const toggleScope = (s: SearchScope) => {
    const next = scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s];
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (!next.length || next.length === SCOPES.length) p.delete('scope');
      else p.set('scope', next.join(','));
      return p;
    }, { replace: true });
  };

  const trimmed = dq.trim();
  const { data, isLoading, isError, refetch } = useGlobalSearch(trimmed, scopes, SEARCH_PAGE_LIMIT);
  const athletes = data?.athletes ?? [];
  const clubs = data?.clubs ?? [];
  const tournaments = data?.tournaments ?? [];
  const total = athletes.length + clubs.length + tournaments.length;
  const showResults = trimmed.length >= 2;

  return (
    <div className="space-y-5" data-testid="search-page">
      <div>
        <span className="eyebrow">{t('search.eyebrow')}</span>
        <h1 className="display text-3xl md:text-4xl font-semibold mt-1">{t('nav.search')}</h1>
      </div>
      <label className="relative block">
        <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
        <input
          autoFocus
          aria-label={t('nav.search')}
          className="field w-full pl-10 !py-3.5 !text-[15px]"
          placeholder={t('search.ph')}
          value={input}
          onChange={(e) => { dirtyRef.current = true; setInput(e.target.value); }}
          data-testid="search-input"
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('search.scopes')}>
        {SCOPES.map((s) => (
          <button
            key={s}
            aria-pressed={scopes.includes(s)}
            onClick={() => toggleScope(s)}
            data-testid={`search-scope-${s}`}
            className={scopes.includes(s) ? 'btn-primary !py-1.5 !px-3 text-xs' : 'btn-ghost !py-1.5 !px-3 text-xs'}
          >
            {t(`search.${s}`)}
          </button>
        ))}
      </div>
      {!showResults ? (
        <EmptyState
          title={t('search.hintTitle')}
          hint={t('search.hint')}
          action={null}
        />
      ) : (
        <>
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={!isLoading && !isError && total === 0}
            retry={() => refetch()}
            emptyTitle={t('t.empty')}
            emptyHint={t('t.emptyHint')}
            loader={
              <div className="grid md:grid-cols-2 gap-3" aria-label="Loading">
                <div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" />
              </div>
            }
          />
          {!isLoading && !isError && total > 0 && (
            <div className="space-y-6">
              {scopes.includes('tournaments') && !!tournaments.length && (
                <section aria-label={t('search.tournaments')}>
                  <div className="section-head"><h2>{t('search.tournaments')}</h2></div>
                  <div className="grid md:grid-cols-2 gap-3" data-testid="search-tournaments">
                    {tournaments.map((x) => (
                      <Link key={x.id} to={`/tournaments/${x.id}`} className="card card-hover discovery-card p-4" data-testid="search-tournament-hit">
                        <div className="min-w-0 flex-1">
                          <Badge tone={STATUS_TONE[x.status] ?? 'gray'}>{x.status}</Badge>
                          <div className="font-extrabold mt-1.5 leading-tight">{x.name}</div>
                          <div className="text-[13px] mt-1 inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                            <MapPin size={13} />{x.city} · {x.start_date}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {scopes.includes('clubs') && !!clubs.length && (
                <section aria-label={t('search.clubs')}>
                  <div className="section-head"><h2>{t('search.clubs')}</h2></div>
                  <div className="grid md:grid-cols-2 gap-3" data-testid="search-clubs">
                    {clubs.map((c) => (
                      <Link key={c.id} to={`/clubs/${c.id}`} className="card card-hover p-4 font-bold text-sm" data-testid="search-club-hit">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {scopes.includes('athletes') && !!athletes.length && (
                <section aria-label={t('search.athletes')}>
                  <div className="section-head"><h2>{t('search.athletes')}</h2></div>
                  <div className="grid md:grid-cols-2 gap-3" data-testid="search-athletes">
                    {athletes.map((a) => (
                      <Link key={a.id} to={`/athletes/${a.id}`} className="card card-hover p-4 font-bold text-sm" data-testid="search-athlete-hit">
                        {a.name}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          {!isLoading && !isError && total === 0 && (
            <button className="btn-ghost text-sm" onClick={() => { setInput(''); commitQ(''); }} data-testid="search-reset">
              {t('flt.reset')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

