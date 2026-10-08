import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Bell, Menu, Moon, Sun, Search, Trophy, User, ShieldCheck } from 'lucide-react';
import { useLang, LangToggle } from '../../i18n';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import { PUBLIC_NAV } from '../../config/navigation';
import { AccountMenu } from './AccountMenu';
import { ProfileAvatar } from '../../pages/ProfileEdit';
import type { KwfNotification, NotesResponse } from '../../types/api';

export function Header({ onCmdk }: { onCmdk: () => void }) {
  const { t } = useLang();
  const nav = useNavigate();
  const { user, can } = useAuth();
  // Single source of truth: public discovery nav from config. Role workspaces
  // live in BottomNav + per-home tabs (no duplicate desktop RoleTabs bar).
  const NAV: [string, string][] = [
    ...PUBLIC_NAV.filter((it) => !it.mobileOnly).map((it) => [it.to, t(it.labelKey)] as [string, string]),
    ...(can('matches.manage') ? [['/referee', t('nav.referee')] as [string, string]] : []),
  ];
  // Wave A2: persist theme in localStorage (was toggle-only, reset on reload).
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('kwf-theme');
      if (saved === 'dark') { document.documentElement.classList.add('dark'); return true; }
      if (saved === 'light') { document.documentElement.classList.remove('dark'); return false; }
    } catch { /* private mode: fall through to DOM state */ }
    return document.documentElement.classList.contains('dark');
  });
  const [notes, setNotes] = useState<NotesResponse | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showUser, setShowUser] = useState(false);
  // P1: admin icon via permission (admin holds all perms), so users granted
  // roles.manage-equivalent visibility aren't hidden by a raw role check.
  const isAdmin = can('roles.manage');
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('kwf-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  const loadNotes = () => api<NotesResponse>('/api/notifications').then(setNotes).catch(() => {});
  useEffect(() => {
    if (!user) { setNotes(null); return; }
    loadNotes();
    const t = setInterval(loadNotes, 30000);
    return () => clearInterval(t);
  }, [user?.id]);
  useEffect(() => {
    if (!menu && !showNotes && !showUser) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenu(false); setShowNotes(false); setShowUser(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [menu, showNotes, showUser]);
  const link = ({ isActive }: { isActive: boolean }) => ({
    color: isActive ? 'var(--accent)' : 'var(--text)', fontWeight: 700, fontSize: 13.5,
    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent', paddingBottom: 4,
  });
  return (
    <header className="header-blur border-b sticky top-0 z-20" style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)', borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-2 sm:gap-3 md:gap-5">
        <Link to="/" className="flex items-center gap-2.5" aria-label="KWF home">
          <span className="grid place-items-center w-9 h-9 rounded-[10px] font-black" style={{ background: 'var(--navy)', color: 'var(--bg)' }}>
            <Trophy size={17} strokeWidth={2.5} />
          </span>
          <span className="leading-none">
            <span className="display block text-[19px] font-semibold tracking-wide">KWF</span>
            <span className="block text-[10px] font-bold tracking-[.18em]" style={{ color: 'var(--muted)' }}>KYOKUSHIN</span>
          </span>
        </Link>
        <nav className="hidden lg:flex gap-4 items-center" aria-label="Main">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} style={link}>{label}{to === '/live' && <span className="pulse-dot inline-block ml-1.5" style={{ width: 7, height: 7 }} />}</NavLink>)}
        </nav>
        <div className="ml-auto flex gap-2 items-center relative">
          <span className="hidden sm:block"><LangToggle /></span>
          <button onClick={() => setMenu(v => !v)} className="lg:hidden card p-2" aria-label={t('nav.menu')} aria-expanded={menu}><Menu size={18} /></button>
          <button onClick={onCmdk} className="card hidden lg:flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold" aria-label="Command menu">
            <Search size={14} /> {t('nav.search')} <kbd className="text-[11px] px-1 rounded" style={{ background: 'var(--border)' }}>⌘K</kbd>
          </button>
          <button onClick={() => nav('/search')} className="lg:hidden card p-2" aria-label={t('nav.search')}><Search size={18} /></button>
          <button onClick={() => setShowNotes(v => !v)} className="card p-2 relative" aria-label={t('nav.notifications')}>
            <Bell size={18} />
            {!!notes?.unread && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black grid place-items-center" style={{ background: 'var(--accent)', color: '#05080D' }}>{notes.unread}</span>}
          </button>
          {showNotes && notes && (
            <div className="card absolute right-0 top-12 w-80 p-3 z-30 text-sm shadow-xl" style={{ background: 'var(--bg)' }} role="menu" aria-label={t('nav.notifications')}>
              {!notes.items?.length && <div style={{ color: 'var(--muted)' }}>{t('nav.noNotes')}</div>}
              {notes.items?.slice(0, 8).map((n: KwfNotification) => (
                <div key={n.id} className="py-1.5 border-b" style={{ borderColor: 'var(--border)', opacity: n.is_read ? .6 : 1 }}>
                  <div>{n.message}</div>
                  <div className="flex gap-2 text-xs mt-0.5">
                    {n.link && <Link to={n.link} onClick={() => setShowNotes(false)}>{t('nav.open')}</Link>}
                    {!n.is_read && <button onClick={() => api(`/api/notifications/${n.id}/read`, { method: 'POST' }).then(loadNotes)}>{t('nav.read')}</button>}
                  </div>
                </div>
              ))}
              <Link to="/notifications" onClick={() => setShowNotes(false)}
                    className="block pt-2 text-xs font-bold underline">{t('nt.title')} →</Link>
            </div>
          )}
          <button onClick={toggle} className="card p-2 hidden sm:block" aria-label={t('nav.theme')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          {user ? (
            <div className="relative">
              <button onClick={() => setShowUser((v) => !v)} className="card p-1 pr-2 flex items-center gap-2"
                      aria-label={t('me.profile')} aria-expanded={showUser}>
                <ProfileAvatar name={user.full_name || user.email} size={28} />
                <span className="hidden md:block text-[13px] font-bold max-w-[120px] truncate">
                  {user.full_name || user.email}
                </span>
              </button>
              {showUser && <AccountMenu onNav={() => setShowUser(false)} />}
            </div>
          ) : (
            <Link to="/me" className="card p-2" aria-label={t('nav.cabinet')} title={t('nav.cabinet')}>
              <User size={18} />
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="card p-2" aria-label={t('adm.title')} title={t('adm.title')}>
              <ShieldCheck size={18} />
            </Link>
          )}
        </div>
      </div>
      {menu && (
        <nav className="lg:hidden border-t px-4 py-2 flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }} aria-label="Mobile">
          {[...NAV, ['/search', t('nav.search')] as [string, string], ['/verify', t('nav.verify')] as [string, string]].map(([to, label]) => (
            <Link key={to} to={to} onClick={() => { setMenu(false); if (to === '/live') nav(to); }} className="py-2.5 font-bold text-sm border-b" style={{ borderColor: 'var(--border)' }}>{label}</Link>
          ))}
          <div className="flex items-center gap-3 py-2.5 sm:hidden">
            <LangToggle />
            <button onClick={toggle} className="card p-2 sm:hidden" aria-label={t('nav.theme')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </nav>
      )}
    </header>
  );
}
