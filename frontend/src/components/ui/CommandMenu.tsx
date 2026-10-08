import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../../i18n';
import { api, errMsg } from '../../lib/api';
import { SEARCH_SUGGEST_LIMIT, buildSearchUrl, useDebouncedValue } from '../../lib/search';
import { useAuth, notify } from '../../auth';
import type { Role, SearchResult } from '../../types/api';

type Action = { id: string; label: string; hint: string; run: () => void; roles?: Role[]; perm?: string };

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const { hasRole, can, roles } = useAuth();
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const qc = useQueryClient();
  const go = (p: string) => { nav(p); onClose(); };

  // Wave A2: shared search contract (same /api/search, suggestions limit=5).
  // Kept as a direct fetch (not react-query) so the palette stays instant and
  // never warms the /search page cache with partial keystrokes.
  const dq = useDebouncedValue(q, 250);
  useEffect(() => {
    if (!open || dq.trim().length < 2) { setRes(null); return; }
    let cancelled = false;
    api<SearchResult>(buildSearchUrl(dq.trim(), ['athletes', 'clubs', 'tournaments'], SEARCH_SUGGEST_LIMIT))
      .then(r => { if (!cancelled) setRes(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dq, open]);
  useEffect(() => setIdx(0), [q, res]);

  const tid = useMemo(() => {
    const m = window.location.pathname.match(/^\/tournaments\/(\d+)/);
    return m ? m[1] : null;
  }, [open]);

  const post = async (path: string, label: string) => {
    try {
      await api(path, { method: 'POST' });
      notify('✓ ' + label, 'ok');
      qc.invalidateQueries({ queryKey: ['br'] });
      qc.invalidateQueries({ queryKey: ['val'] });
    } catch (e: unknown) { notify(`${t('common.err')}: ` + errMsg(e), 'err'); }
    onClose();
  };

  const actions: Action[] = useMemo(() => {
    const list: Action[] = [
      { id: 'tournaments', label: t('c.openT'), hint: t('c.nav'), run: () => go('/tournaments') },
      { id: 'live', label: t('c.openLive'), hint: t('c.nav'), run: () => go('/live') },
      { id: 'news', label: t('c.news'), hint: t('c.nav'), run: () => go('/news') },
      { id: 'verify', label: t('c.verify'), hint: t('c.nav'), run: () => go('/verify') },
      // Role homes (same source of truth as navigation.ts ROLE_HOME).
      ...(roles.includes('athlete') ? [{ id: 'ath-home', label: t('ath.dash'), hint: t('c.nav'), run: () => go('/athlete') } as Action] : []),
      ...(roles.includes('coach') ? [{ id: 'coach-home', label: t('coach2.dash'), hint: t('c.nav'), run: () => go('/coach') } as Action] : []),
      ...(roles.includes('organizer') || can('tournaments.manage') ? [{ id: 'org-home', label: t('org.dash'), hint: t('c.nav'), run: () => go('/organizer') } as Action] : []),
      { id: 'referee', label: t('c.referee'), hint: t('c.nav'), run: () => go('/referee'), roles: ['referee', 'organizer', 'admin'], perm: 'matches.manage' },
      { id: 'create', label: t('c.create'), hint: t('c.org'), run: () => go('/organizer'), roles: ['organizer', 'admin'], perm: 'tournaments.manage' },
    ];
    if (tid) {
      list.push(
        { id: 't-open', label: `#${tid} — ${t('c.tOpen')}`, hint: t('c.nav'), run: () => go(`/tournaments/${tid}`) },
        { id: 't-live', label: `#${tid} — ${t('c.tLive')}`, hint: t('c.nav'), run: () => go(`/tournaments/${tid}?tab=live`) },
        { id: 't-tv', label: `#${tid} — ${t('c.tTv')}`, hint: t('c.nav'), run: () => go(`/tv/${tid}`) },
        { id: 't-parts', label: `#${tid} — ${t('c.tParts')}`, hint: t('c.nav'), run: () => go(`/tournaments/${tid}?tab=participants`) },
        { id: 't-brackets', label: `#${tid} — ${t('c.tBrackets')}`, hint: t('c.org'), run: () => post(`/api/tournaments/${tid}/brackets/generate`, `#${tid}`), roles: ['organizer', 'admin'], perm: 'tournaments.manage' },
        { id: 't-sched', label: `#${tid} — ${t('c.tSched')}`, hint: t('c.org'), run: () => post(`/api/tournaments/${tid}/schedule/generate`, `#${tid}`), roles: ['organizer', 'admin'], perm: 'tournaments.manage' },
        { id: 't-validate', label: `#${tid} — ${t('c.tCheck')}`, hint: t('c.org'), run: () => go(`/tournaments/${tid}?tab=overview`), roles: ['organizer', 'admin'], perm: 'tournaments.manage' },
      );
    }
    const needle = q.toLowerCase();
    // P1: role-gated actions also pass for direct permission holders (grants),
    // so UI hints stay consistent with the backend (which stays source of truth).
    // Multi-role: any held role counts.
    const visible = (a: Action) =>
      (!a.roles || hasRole(...a.roles) || hasRole('admin') || (a.perm !== undefined && can(a.perm)));
    return list.filter(a => visible(a) && (!needle || a.label.toLowerCase().includes(needle)));
  }, [q, tid, t, can, hasRole, roles]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, actions.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && actions[idx]) actions[idx].run();
    if (e.key === 'Escape') onClose();
  };
  return (
    <div role="dialog" aria-label="Command menu" className="fixed inset-0 z-50 p-4" style={{ background: 'rgba(2,6,12,.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="card max-w-lg mx-auto mt-16 md:mt-24 p-2 fade-up" style={{ background: 'var(--bg)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
               placeholder={t('cmdk.ph')} className="field w-full !border-0 !shadow-none !text-[15px] !py-3" aria-label={t('nav.search')} />
        <div className="mt-1 text-sm max-h-[40vh] overflow-y-auto" role="listbox" aria-label="Commands">
          {!actions.length && !res && <div className="px-3 py-4 text-[13px]" style={{ color: 'var(--muted)' }}>{t('cmdk.empty')}</div>}
          {actions.map((a, i) => (
            <button key={a.id} role="option" aria-selected={i === idx} onClick={a.run}
                    onMouseEnter={() => setIdx(i)} className="flex w-full items-center justify-between px-3 py-2 rounded-lg"
                    style={i === idx ? { background: 'var(--accent-soft)', fontWeight: 800 } : {}}>
              <span>{a.label}</span><span className="badge">{a.hint}</span>
            </button>
          ))}
        </div>
        {res && (
          <div className="mt-1 px-3 py-2 text-sm border-t" style={{ borderColor: 'var(--border)' }}>
            {res.tournaments?.map((x) => <button key={'t' + x.id} className="block py-1 font-semibold" onClick={() => go(`/tournaments/${x.id}`)}>🏆 {x.name}</button>)}
            {res.athletes?.map((a) => <button key={'a' + a.id} className="block py-1" onClick={() => go(`/athletes/${a.id}`)}>{a.name}</button>)}
            {res.clubs?.map((c) => <button key={'c' + c.id} className="block py-1" onClick={() => go(`/clubs/${c.id}`)}>{c.name}</button>)}
            <button className="block py-1 text-[12px] font-bold underline" style={{ color: 'var(--muted)' }} onClick={() => go(`/search?q=${encodeURIComponent((dq.trim() || q.trim()))}`)}>{t('cmdk.fullSearch')}</button>
          </div>
        )}
        <div className="flex gap-3 px-3 py-2 text-[11px] border-t" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          <span><kbd>↑↓</kbd></span><span>Enter</span><span>Esc</span>
        </div>
      </div>
    </div>
  );
}
