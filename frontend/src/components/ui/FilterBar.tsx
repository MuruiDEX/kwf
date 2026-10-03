/** Wave A2: reusable tournament FilterBar. URL is the source of truth —
 *  the parent owns the TournamentFilters value (parsed from useSearchParams).
 *  No local-only filter state lives here; the q input debounce calls back.
 */
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useLang } from '../../i18n';
import { commitFilterField, hasActiveFilters, type TournamentFilters } from '../../lib/search';
import { usePublicCities } from '../../lib/queries';

export type DatePreset = '' | 'week' | 'month';

export function toDatePresetRange(preset: DatePreset, today = new Date()): { from: string; to: string } {
  if (!preset) return { from: '', to: '' };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + (preset === 'week' ? 7 : 30));
  return { from: iso(today), to: iso(end) };
}

export function FilterBar({
  filters,
  onChange,
  onReset,
  resultCount,
}: {
  filters: TournamentFilters;
  onChange: (f: TournamentFilters) => void;
  onReset: () => void;
  resultCount?: number;
}) {
  const { t } = useLang();
  const [input, setInput] = useState(filters.q);
  const [cityInput, setCityInput] = useState(filters.city);
  const { data: cities } = usePublicCities(50);

  // Sync when URL changes externally (back/forward, shared link).
  useEffect(() => setInput(filters.q), [filters.q]);
  useEffect(() => setCityInput(filters.city), [filters.city]);

  // F-UX-2: refs always hold the latest filters/onChange, so debounced
  // commits merge the typed value into CURRENT state. Without this, a
  // status/date change made while typing was clobbered by the stale
  // {...filters} snapshot captured when the timeout was scheduled.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Debounced callbacks (~300ms) — URL updates stay coalesced.
  useEffect(() => {
    const snap = input;
    if (snap === filtersRef.current.q) return;
    const h = setTimeout(() => onChangeRef.current(commitFilterField(filtersRef.current, 'q', snap)), 300);
    return () => clearTimeout(h);
  }, [input]);
  useEffect(() => {
    const snap = cityInput;
    if (snap === filtersRef.current.city) return;
    const h = setTimeout(() => onChangeRef.current(commitFilterField(filtersRef.current, 'city', snap)), 300);
    return () => clearTimeout(h);
  }, [cityInput]);

  const set = (patch: Partial<TournamentFilters>) => onChange({ ...filters, ...patch });
  const active = hasActiveFilters(filters);
  const cityOptions = cities?.items?.map((c) => c.city) ?? [];

  return (
    <div className="card p-3 sm:p-4 space-y-3" data-testid="filter-bar" role="search" aria-label={t('flt.title')}>
      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input
            aria-label={t('flt.q')}
            className="field w-full pl-9"
            placeholder={t('flt.qPh')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            data-testid="filter-q"
          />
        </label>
        <input
          aria-label={t('flt.city')}
          className="field min-w-[140px] flex-1 sm:flex-none"
          placeholder={t('flt.cityPh')}
          list="kwf-city-options"
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          data-testid="filter-city"
        />
        <datalist id="kwf-city-options">
          {cityOptions.map((c) => <option key={c} value={c} />)}
        </datalist>
        <select
          aria-label={t('flt.status')}
          className="field"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          data-testid="filter-status"
        >
          <option value="">{t('t.all')}</option>
          <option value="upcoming">{t('flt.upcoming')}</option>
          <option value="registration">{t('status.registration')}</option>
          <option value="live">{t('status.live')}</option>
          <option value="finished">{t('status.finished')}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          aria-label={t('flt.from')}
          type="date"
          className="field"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
          data-testid="filter-from"
        />
        <span style={{ color: 'var(--muted)' }}>—</span>
        <input
          aria-label={t('flt.to')}
          type="date"
          className="field"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
          data-testid="filter-to"
        />
        <div className="flex gap-1.5" role="group" aria-label={t('flt.presets')}>
          {(['', 'week', 'month'] as DatePreset[]).map((p) => {
            const label = p === '' ? t('flt.anyDate') : p === 'week' ? t('flt.week') : t('flt.month');
            const isActive = !p
              ? !filters.from && !filters.to
              : (() => { const r = toDatePresetRange(p); return filters.from === r.from && filters.to === r.to; })();
            void isActive;
            return (
              <button
                key={p || 'any'}
                className={p === '' && !filters.from && !filters.to ? 'btn-primary !py-1.5 !px-3 text-xs' : 'btn-ghost !py-1.5 !px-3 text-xs'}
                onClick={() => set({ ...toDatePresetRange(p) })}
                data-testid={`filter-preset-${p || 'any'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {typeof resultCount === 'number' && (
            <span className="text-xs font-bold" style={{ color: 'var(--muted)' }} data-testid="filter-count">
              {t('flt.found')}: {resultCount}
            </span>
          )}
          {active && (
            <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onReset} data-testid="filter-reset">
              <RotateCcw size={13} /> {t('flt.reset')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
