import { Link, useLocation } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useAuth } from '../../auth';
import { resolveBottomNav } from '../../config/navigation';
import { useGuardianWards } from '../../lib/queries';

export function BottomNav() {
  const { t } = useLang();
  const { roles, role, can } = useAuth();
  const loc = useLocation();
  // Guardian detection is data-driven (no backend role).
  const { data: wards } = useGuardianWards(!!roles.length);
  const items = resolveBottomNav({ roles, role, can, hasGuardianWards: !!(wards ?? []).length });
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t md:hidden"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Role navigation">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          const Icon = it.icon;
          const active = loc.pathname === it.to.split('?')[0] && (it.to.includes('?tab=') ? loc.search.includes(it.to.split('?tab=')[1]) : !loc.search.includes('tab=') || it.to === loc.pathname);
          return (
            <Link key={it.to + it.labelKey} to={it.to}
              className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold min-h-[56px] justify-center"
              style={{ color: active ? 'var(--accent)' : 'var(--muted)' }} aria-current={active ? 'page' : undefined}>
              <Icon size={19} />
              <span className="truncate max-w-full px-1">{t(it.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
