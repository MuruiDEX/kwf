import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { useLang } from './i18n';
import { Skeleton } from './components/ui/core';
import type { Me as MeUser, Role } from './types/api';

export type Me = MeUser | null;

// ---------- toast (no new deps): event-based mini notifications ----------
type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
let toastId = 0;
export function notify(msg: string, kind: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent('kwf-toast', { detail: { id: ++toastId, msg, kind } }));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent).detail as Toast;
      setItems(p => [...p.slice(-2), t]);
      setTimeout(() => setItems(p => p.filter(x => x.id !== t.id)), 3200);
    };
    window.addEventListener('kwf-toast', h);
    return () => window.removeEventListener('kwf-toast', h);
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center px-4 w-full max-w-md" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className="card toast-in px-4 py-2.5 text-sm font-bold shadow-xl w-auto max-w-full"
          style={{ background: 'var(--bg)', borderColor: t.kind === 'err' ? 'var(--live)' : 'var(--accent)' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ---------- auth ----------
export type RegisterInput = { email: string; password: string; full_name: string; role: string };

type AuthCtx = {
  user: Me;
  role: Role;
  roles: Role[];
  loading: boolean;
  permissions: string[];
  can: (perm: string) => boolean;
  hasRole: (...rs: Role[]) => boolean;
  refresh: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, role: 'public', roles: ['public'], loading: true, permissions: [], can: () => false, hasRole: () => false, refresh: () => {}, login: async () => {}, register: async () => {}, logout: async () => {} });

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeUser>('/api/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
  const user: Me = data ?? null;
  const { data: permData } = useQuery({
    queryKey: ['my-perms'],
    queryFn: () => api<{ role: string; permissions: string[] }>('/api/auth/permissions'),
    retry: false,
    staleTime: 60_000,
    enabled: !!user,
  });
  const permissions: string[] = user ? (permData?.permissions ?? []) : [];
  // Multi-role: backend returns the roles SET (primary + secondaries); the
  // primary `role` stays for display/backward compatibility. UI context
  // (cabinet switcher) never changes these — authorization stays server-side.
  const roles: Role[] = user
    ? [...new Set([...(user.roles ?? []), user.role])] as Role[]
    : ['public'];
  const can = useCallback((perm: string) => permissions.includes(perm), [permissions]);
  const hasRole = useCallback((...rs: Role[]) => rs.some((r) => roles.includes(r)), [roles]);

  // A 401 from any non-auth endpoint means the session died mid-use
  // (expiry, logout in another tab): drop stale identity immediately.
  useEffect(() => {
    const h = () => {
      qc.setQueryData(['me'], null);
      void refetch();
    };
    window.addEventListener('kwf-unauthorized', h);
    return () => window.removeEventListener('kwf-unauthorized', h);
  }, [qc, refetch]);

  const login = useCallback(async (email: string, password: string) => {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await qc.invalidateQueries({ queryKey: ['me'] });
    await refetch();
  }, [qc, refetch]);

  // Single-request auto-login: backend sets the cookie on /register,
  // so no second login call here — just re-read /me.
  const register = useCallback(async (input: RegisterInput) => {
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
    await qc.invalidateQueries({ queryKey: ['me'] });
    await refetch();
  }, [qc, refetch]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* cookie may be absent */ }
    // Drop all user-scoped caches so the next account never sees stale data.
    qc.clear();
    qc.setQueryData(['me'], null);
  }, [qc]);

  return (
    <Ctx.Provider value={{
      user, role: user?.role ?? 'public', roles, loading: isLoading, permissions, can, hasRole,
      refresh: () => { void refetch(); }, login, register, logout,
    }}>
      {children}
    </Ctx.Provider>
  );
}

// ---------- route guard: frontend hint only, backend stays source of truth ----------
// Access = (no roles required OR any required role held OR admin) AND (no perm required OR has perm).
export function RequireRole({ roles, perm, children }: { roles?: Role[]; perm?: string; children: JSX.Element }) {
  const { user, loading, can, hasRole } = useAuth();
  const loc = useLocation();
  const { t } = useLang();
  const isAdmin = hasRole('admin');
  if (loading) return <Skeleton className="h-60" />;
  if (!user) return <Navigate to="/me" state={{ from: loc.pathname }} replace />;
  if (roles && !hasRole(...roles) && !isAdmin) {
    // Permission holders may pass role-only gates when the page is perm-aware.
    if (!(perm && can(perm))) {
      return (
        <div className="card p-8 text-center max-w-md mx-auto fade-up space-y-2">
          <div className="font-bold text-lg">{t('auth.denied')}</div>
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('auth.deniedHint')}</div>
        </div>
      );
    }
  }
  if (perm && !can(perm) && !isAdmin) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto fade-up space-y-2">
        <div className="font-bold text-lg">{t('auth.denied')}</div>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('auth.deniedHint')}</div>
      </div>
    );
  }
  return children;
}
