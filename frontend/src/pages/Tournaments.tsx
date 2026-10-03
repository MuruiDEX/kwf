/** Wave A2: tournament discovery — FilterBar + URL source of truth.
 *  Legacy ?q&?status URLs keep working; refresh/shared links reproduce filters.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLang } from '../i18n';
import { pageItems } from '../lib/api';
import { EmptyState, Skeleton } from '../components/ui/core';
import { DiscoveryCard } from '../components/ui/DiscoveryCard';
import { FilterBar } from '../components/ui/FilterBar';
import { useTournamentsPage } from '../lib/queries';
import { EMPTY_TOURNAMENT_FILTERS, parseTournamentFilters, writeTournamentFilters, type TournamentFilters } from '../lib/search';
import type { Tournament } from '../types/api';

// B4: catalog page size. First page renders the same cards as before;
// "show more" appends the next slice (single cumulative query, no dupes).
const PAGE_SIZE = 20;

export function Tournaments() {
  const { t, lang } = useLang();
  const [sp, setSp] = useSearchParams();
  const filters: TournamentFilters = { ...EMPTY_TOURNAMENT_FILTERS, ...parseTournamentFilters(sp) };
  const { q, city, status, from, to } = filters;

  // B4: loaded-page count is UI state only (URL pagination deliberately
  // excluded); any filter change resets to the first page.
  const [pages, setPages] = useState(1);
  useEffect(() => { setPages(1); }, [q, city, status, from, to]);

  const { data: raw, isLoading, isError, isFetching, refetch } = useTournamentsPage(q, status, { city, from, to }, pages * PAGE_SIZE);
  const data: Tournament[] = pageItems(raw);
  const total: number = raw?.total ?? 0;
  const hasMore = data.length < total;

  const onChange = (f: TournamentFilters) =>
    setSp((prev) => writeTournamentFilters(prev, f), { replace: true });
  const onReset = () =>
    setSp((prev) => writeTournamentFilters(prev, EMPTY_TOURNAMENT_FILTERS), { replace: true });

  return (
    <div className="space-y-5">
      <div>
        <span className="eyebrow">{t('t.calendar')}</span>
        <h1 className="display text-3xl md:text-4xl font-semibold mt-1">{t('nav.tournaments')}</h1>
      </div>
      <FilterBar filters={filters} onChange={onChange} onReset={onReset} resultCount={raw?.total} />
      {isLoading ? <div className="grid md:grid-cols-2 gap-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        : isError ? <div className="card p-6 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
            <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>
        : !data.length ? <EmptyState title={t('t.empty')} hint={t('t.emptyHint')} action={<button className="btn-ghost text-sm !py-2" onClick={onReset} data-testid="tournaments-reset">{t('flt.reset')}</button>} />
        : <div className="space-y-4 fade-up">
            <div className="grid md:grid-cols-2 gap-3">
              {data.map((x) => <DiscoveryCard key={x.id} t={x} locale={lang} />)}
            </div>
            {hasMore && (
              <div className="text-center">
                <button className="btn-ghost text-sm !py-2" disabled={isFetching}
                        onClick={() => setPages((p) => p + 1)} data-testid="tournaments-more">
                  {isFetching ? '…' : `${t('c.showMore')} (${data.length}/${total})`}
                </button>
              </div>
            )}
          </div>}
    </div>
  );
}
