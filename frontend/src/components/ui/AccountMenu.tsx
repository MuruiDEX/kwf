import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useLang } from '../../i18n';
import { useAuth } from '../../auth';
import { useMyOrgRequest } from '../../lib/queries';
import { ProfileAvatar } from '../../pages/ProfileEdit';
import { OrgRequestForm } from '../../pages/AuthForms';
import { ROLE_HOME } from '../../config/navigation';

export function RoleSwitcher({ onNav }: { onNav: () => void }) {
  const { t } = useLang();
  const { roles, role, hasRole } = useAuth();
  const req = useMyOrgRequest(!hasRole('organizer'));
  const [showForm, setShowForm] = useState(false);
  const shown = roles.filter((r) => r !== 'public');
  return (
    <div className="py-2 border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="px-1 pb-1 text-xs font-bold uppercase" style={{ color: 'var(--muted)' }}>
        {t('acct.roles')}
      </div>
      {shown.map((r) => (
        <Link key={r} to={ROLE_HOME[r] ?? '/me'} onClick={onNav}
              className="flex items-center gap-2 py-1.5 font-bold text-sm">
          <span aria-hidden>{r === role ? '✓' : '·'}</span> {t(`role.${r}`)}
        </Link>
      ))}
      {!hasRole('organizer') && (
        <div className="pt-1">
          {req.data == null && !showForm && (
            <button className="text-xs font-bold underline" onClick={() => setShowForm(true)}>
              {t('acct.getOrganizer')}
            </button>
          )}
          {req.data != null && (
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {t('acct.reqStatus')}: {t(`acct.req_${req.data.status}`) ?? req.data.status}
            </div>
          )}
          {showForm && <OrgRequestForm />}
        </div>
      )}
    </div>
  );
}

export function AccountMenu({ onNav }: { onNav: () => void }) {
  const { t } = useLang();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  const out = async () => {
    onNav();
    await logout();
    nav('/me', { replace: true });
  };
  return (
    <div className="card absolute right-0 top-12 w-64 p-3 z-30 text-sm shadow-xl" style={{ background: 'var(--bg)' }} role="menu" aria-label={t('me.profile')}>
      <div className="flex items-center gap-2 px-1 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <ProfileAvatar name={user.full_name || user.email} size={36} />
        <div className="min-w-0">
          <div className="font-extrabold truncate">{user.full_name || '—'}</div>
          <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>{user.email}</div>
        </div>
      </div>
      <RoleSwitcher onNav={onNav} />
      <Link to="/me" onClick={onNav} className="block py-2 font-bold text-sm">{t('me.profile')}</Link>
      <button onClick={out} className="flex items-center gap-2 py-2 font-bold text-sm w-full text-left">
        <LogOut size={15} /> {t('me.out')}
      </button>
    </div>
  );
}
