/** Wave A2: discovery contracts — URL state, search scope, reset behavior. */
import { describe, expect, it } from 'vitest';
import {
  SEARCH_MAX_LIMIT,
  buildSearchUrl,
  buildTournamentsQuery,
  commitFilterField,
  hasActiveFilters,
  normalizeScope,
  parseTournamentFilters,
  writeTournamentFilters,
  EMPTY_TOURNAMENT_FILTERS,
} from './search';
import { toDatePresetRange } from '../components/ui/FilterBar';
import { qk } from './queries';

describe('normalizeScope', () => {
  it('defaults to all scopes on empty input', () => {
    expect(normalizeScope('')).toEqual(['athletes', 'clubs', 'tournaments']);
  });
  it('keeps valid scopes and drops unknown tokens', () => {
    expect(normalizeScope('clubs,foo,tournaments')).toEqual(['clubs', 'tournaments']);
  });
  it('dedupes scopes', () => {
    expect(normalizeScope('clubs,clubs')).toEqual(['clubs']);
  });
});

describe('buildSearchUrl (shared /api/search contract)', () => {
  it('encodes q and joins scopes', () => {
    expect(buildSearchUrl('KWF Open', ['tournaments'], 5)).toBe(
      '/api/search?q=KWF%20Open&scope=tournaments&limit=5&offset=0',
    );
  });
  it('caps limit at the backend max (50)', () => {
    expect(buildSearchUrl('a', ['athletes'], 999)).toContain('limit=50');
    expect(SEARCH_MAX_LIMIT).toBe(50);
  });
  it('clamps offset at zero', () => {
    expect(buildSearchUrl('ab', ['clubs'], 5, -3)).toContain('offset=0');
  });
});

describe('tournament filter URL state', () => {
  it('parses legacy ?q&?status URLs (back-compat)', () => {
    const f = parseTournamentFilters(new URLSearchParams('q=cup&status=live'));
    expect(f).toEqual({ q: 'cup', city: '', status: 'live', from: '', to: '' });
  });
  it('parses the full Wave A2 URL', () => {
    const f = parseTournamentFilters(
      new URLSearchParams('q=cup&city=Almaty&status=upcoming&from=2026-10-01&to=2026-10-31'),
    );
    expect(f).toEqual({ q: 'cup', city: 'Almaty', status: 'upcoming', from: '2026-10-01', to: '2026-10-31' });
  });
  it('removes empty values so copied URLs stay clean', () => {
    const out = writeTournamentFilters(
      new URLSearchParams('q=cup&city=Almaty'),
      { ...EMPTY_TOURNAMENT_FILTERS, q: 'cup' },
    );
    expect(out.toString()).toBe('q=cup');
  });
  it('reset restores the empty filter set', () => {
    const out = writeTournamentFilters(
      new URLSearchParams('q=cup&city=A&status=live&from=2026-01-01&to=2026-02-01'),
      EMPTY_TOURNAMENT_FILTERS,
    );
    expect(out.toString()).toBe('');
    expect(hasActiveFilters(EMPTY_TOURNAMENT_FILTERS)).toBe(false);
  });
  it('detects active filters', () => {
    expect(hasActiveFilters({ ...EMPTY_TOURNAMENT_FILTERS, city: 'Astana' })).toBe(true);
  });
});

describe('buildTournamentsQuery (Wave A1 params only)', () => {
  it('maps from/to to date_from/date_to', () => {
    expect(buildTournamentsQuery({ q: '', city: '', status: '', from: '2026-10-01', to: '2026-10-31' })).toBe(
      '/api/tournaments?date_from=2026-10-01&date_to=2026-10-31',
    );
  });
  it('returns the bare path with no filters', () => {
    expect(buildTournamentsQuery(EMPTY_TOURNAMENT_FILTERS)).toBe('/api/tournaments');
  });
});

describe('toDatePresetRange', () => {
  it('returns empty range for the "any date" preset', () => {
    expect(toDatePresetRange('')).toEqual({ from: '', to: '' });
  });
  it('spans 7/30 days from today', () => {
    const today = new Date('2026-10-03T00:00:00Z');
    expect(toDatePresetRange('week', today)).toEqual({ from: '2026-10-03', to: '2026-10-10' });
    expect(toDatePresetRange('month', today)).toEqual({ from: '2026-10-03', to: '2026-11-02' });
  });
});

describe('query keys (Wave A2 extensions stay back-compatible)', () => {
  it('keeps legacy tournament keys byte-identical', () => {
    expect(qk.tournaments()).toEqual(['tournaments']);
    expect(qk.tournaments('cup', '')).toEqual(['tournaments', 'cup', '']);
    expect(qk.tournaments('', 'live')).toEqual(['tournaments', '', 'live']);
  });
  it('extends the key only when city/from/to are set', () => {
    expect(qk.tournaments('cup', '', 'Almaty', '', '')).toEqual(['tournaments', 'cup', '', 'Almaty', '', '']);
    expect(qk.tournaments('', '', '', '2026-10-01', '')).toEqual(['tournaments', '', '', '', '2026-10-01', '']);
  });
  it('has no dead qk.search key (single contract lives in useGlobalSearch)', () => {
    expect('search' in qk).toBe(false);
  });
});

describe('commitFilterField (F-UX-2 debounced merge)', () => {
  it('preserves status when q is typed', () => {
    expect(commitFilterField({ ...EMPTY_TOURNAMENT_FILTERS, status: 'live' }, 'q', 'cup')).toEqual({
      ...EMPTY_TOURNAMENT_FILTERS, status: 'live', q: 'cup',
    });
  });
  it('preserves status when city is typed', () => {
    expect(commitFilterField({ ...EMPTY_TOURNAMENT_FILTERS, status: 'upcoming' }, 'city', 'Almaty')).toEqual({
      ...EMPTY_TOURNAMENT_FILTERS, status: 'upcoming', city: 'Almaty',
    });
  });
  it('preserves date range when q is typed', () => {
    expect(
      commitFilterField({ ...EMPTY_TOURNAMENT_FILTERS, from: '2026-10-01', to: '2026-10-31' }, 'q', 'cup'),
    ).toEqual({ ...EMPTY_TOURNAMENT_FILTERS, from: '2026-10-01', to: '2026-10-31', q: 'cup' });
  });
  it('overwrites only its own field', () => {
    expect(commitFilterField({ ...EMPTY_TOURNAMENT_FILTERS, q: 'old' }, 'q', 'new')).toEqual({
      ...EMPTY_TOURNAMENT_FILTERS, q: 'new',
    });
  });
});
