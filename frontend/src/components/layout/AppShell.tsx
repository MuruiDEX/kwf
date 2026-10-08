import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useAuth } from '../../auth';
import { Header } from '../ui/Header';
import { BottomNav } from './BottomNav';

function Footer() {
  const { t } = useLang();
  const { can } = useAuth();
  return (
    <footer className="border-t mt-10 pb-16 md:pb-0" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto px-4 py-10 grid gap-8 md:grid-cols-4 text-sm">
        <div>
          <div className="display text-lg font-semibold">KWF</div>
          <div className="text-[11px] font-bold tracking-[.18em] mt-0.5" style={{ color: 'var(--accent)' }}>KYOKUSHIN</div>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>{t('foot.tag')}</p>
        </div>
        <nav aria-label={t('foot.platform')}>
          <div className="font-extrabold text-xs uppercase tracking-[.12em] mb-3" style={{ color: 'var(--muted)' }}>{t('foot.platform')}</div>
          <div className="flex flex-col gap-2"><Link to="/tournaments">{t('nav.tournaments')}</Link><Link to="/live">{t('nav.live')}</Link><Link to="/rankings">{t('nav.rankings')}</Link><Link to="/news">{t('nav.news')}</Link></div>
        </nav>
        <nav aria-label={t('foot.athletes')}>
          <div className="font-extrabold text-xs uppercase tracking-[.12em] mb-3" style={{ color: 'var(--muted)' }}>{t('foot.athletes')}</div>
          <div className="flex flex-col gap-2"><Link to="/athletes">{t('nav.athletes')}</Link><Link to="/clubs">{t('nav.clubs')}</Link><Link to="/verify">{t('nav.verify')}</Link></div>
        </nav>
        <nav aria-label={t('foot.org')}>
          <div className="font-extrabold text-xs uppercase tracking-[.12em] mb-3" style={{ color: 'var(--muted)' }}>{t('foot.org')}</div>
          <div className="flex flex-col gap-2">
            {can('tournaments.create') && <Link to="/organizer">{t('org.create')}</Link>}
            {can('matches.manage') && <Link to="/referee">{t('cmdk.referee')}</Link>}
            <Link to="/me">{t('nav.cabinet')}</Link>
          </div>
        </nav>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 text-xs flex gap-4" style={{ color: 'var(--muted)' }}>
          <span>KWF</span><span className="ml-auto">{t('foot.rights')}</span>
        </div>
      </div>
    </footer>
  );
}

/** AppShell: header + main + footer + role bottom nav. No role business UI inside. */
export function AppShell({ onCmdk, children }: { onCmdk: () => void; children: React.ReactNode }) {
  return (
    <>
      <Header onCmdk={onCmdk} />
      <main className="max-w-7xl mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>
      <Footer />
      <BottomNav />
    </>
  );
}
