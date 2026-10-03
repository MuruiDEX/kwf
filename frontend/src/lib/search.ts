/** Wave A2: shared discovery contracts on top of the Wave A1 API.
 *
 *  Uses ONLY existing backend endpoints:
 *  - GET /api/search?q&scope&limit&offset (A1: scope/limit/offset + tournaments[])
 *  - GET /api/tournaments?q&city&country&status&date_from&date_to (A1 filters)
 *
 *  No new endpoints, no migrations, no RBAC changes.
 */
import { useEffect, useState } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';
import type { SearchResult, SearchScope } from '../types/api';

export const SEARCH_MIN_LEN = 2;
export const SEARCH_SUGGEST_LIMIT = 5;
export const SEARCH_PAGE_LIMIT = 12;
export const SEARCH_MAX_LIMIT = 50;

/** Debounce any value (~250-300ms for search inputs). Pure React, no deps. */
export function useDebouncedValue<T>(value: T, delay = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}

export function normalizeScope(scope: string): SearchScope[] {
  const allowed: SearchScope[] = ['athletes', 'clubs', 'tournaments'];
  const picked = scope
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SearchScope => (allowed as string[]).includes(s));
  return picked.length ? [...new Set(picked)] : [...allowed];
}

export function buildSearchUrl(q: string, scope: SearchScope[] | string, limit = SEARCH_SUGGEST_LIMIT, offset = 0): string {
  const scopes = Array.isArray(scope) ? scope : normalizeScope(scope);
  const capped = Math.max(1, Math.min(limit, SEARCH_MAX_LIMIT));
  return `/api/search?q=${encodeURIComponent(q)}&scope=${scopes.join(',')}&limit=${capped}&offset=${Math.max(0, offset)}`;
}

type Opt<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

/** Shared hook for CommandMenu (limit=5) and /search page (limit=12).
 *  q < 2 => disabled query (no request), returns undefined data.
 */
export function useGlobalSearch(q: string, scope: SearchScope[] | string = ['athletes', 'clubs', 'tournaments'], limit = SEARCH_SUGGEST_LIMIT, opt?: Opt<SearchResult>) {
  const query = q.trim();
  const scopes = Array.isArray(scope) ? scope : normalizeScope(scope);
  const capped = Math.max(1, Math.min(limit, SEARCH_MAX_LIMIT));
  const enabled = query.length >= SEARCH_MIN_LEN;
  return useQuery<SearchResult>({
    queryKey: ['search', query, [...scopes].sort().join(','), capped],
    queryFn: () => api<SearchResult>(buildSearchUrl(query, scopes, capped)),
    staleTime: 30_000,
    retry: 1,
    enabled,
    ...opt,
  });
}

// ---------- tournament discovery filters (URL is the source of truth) ----------

export interface TournamentFilters {
  q: string;
  city: string;
  status: string;
  from: string;
  to: string;
}

export const EMPTY_TOURNAMENT_FILTERS: TournamentFilters = { q: '', city: '', status: '', from: '', to: '' };

/** Read filters from a URLSearchParams (legacy ?q&?status URLs keep working). */
export function parseTournamentFilters(sp: URLSearchParams): TournamentFilters {
  return {
    q: sp.get('q') ?? '',
    city: sp.get('city') ?? '',
    status: sp.get('status') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
  };
}

/** Write filters back to a URLSearchParams. Empty values are REMOVED so
 *  copied URLs stay clean and legacy consumers see no phantom params.
 */
export function writeTournamentFilters(prev: URLSearchParams, f: TournamentFilters): URLSearchParams {
  const p = new URLSearchParams(prev);
  const set = (k: string, v: string) => {
    if (v) p.set(k, v);
    else p.delete(k);
  };
  set('q', f.q);
  set('city', f.city);
  set('status', f.status);
  set('from', f.from);
  set('to', f.to);
  return p;
}

/** Backend query string for GET /api/tournaments (A1 params only). */
export function buildTournamentsQuery(f: TournamentFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.city) p.set('city', f.city);
  if (f.status) p.set('status', f.status);
  if (f.from) p.set('date_from', f.from);
  if (f.to) p.set('date_to', f.to);
  const qs = p.toString();
  return qs ? `/api/tournaments?${qs}` : '/api/tournaments';
}

/** True when at least one filter is active (Reset button visibility). */
export function hasActiveFilters(f: TournamentFilters): boolean {
  return !!(f.q || f.city || f.status || f.from || f.to);
}

/** Merge one debounced text field into the LATEST filter snapshot.
 *  Pure + unit-tested. F-UX-2: FilterBar timeouts read filtersRef at fire
 *  time and commit through this function, so a status/date change made
 *  while typing is preserved instead of being clobbered by a stale closure.
 */
export function commitFilterField(
  latest: TournamentFilters,
  field: 'q' | 'city',
  value: string,
): TournamentFilters {
  return { ...latest, [field]: value };
}
