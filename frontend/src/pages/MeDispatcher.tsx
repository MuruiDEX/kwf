import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Skeleton } from '../components/ui/core';
import { resolveMeHome, resolvePostLogin } from '../config/navigation';
import { useGuardianWards } from '../lib/queries';
import { Auth } from './Organizer';
import { Cabinet } from './Cabinet';

/** /me dispatcher: canonical home per active role. Legacy Cabinet stays as
 *  fallback for public/unknown (login form lives in Organizer.Auth when guest).
 *  Multi-role: getActiveRoleKey priority admin > organizer > coach > referee > athlete > guardian.
 *  Protected-page bounce (`state.from`) is honored when the user may open it.
 */
export function MeDispatcher() {
  const { user, loading, permsLoading, roles, role, can } = useAuth();
  const loc = useLocation();
  const { data: wards, isLoading: wLoading } = useGuardianWards(!!user);
  // Wait for roles+permissions+wards: dispatching on partial auth sends
  // multi-role users to the wrong home (e.g. coach instead of organizer).
  if (loading || permsLoading || (user && wLoading)) return <Skeleton className="h-60 max-w-3xl" />;
  if (!user) return <Auth />;
  const auth = { roles, role, can, hasGuardianWards: !!(wards ?? []).length };
  const from = (loc.state as { from?: string } | null)?.from;
  const home = from ? resolvePostLogin(from, auth) : resolveMeHome(auth);
  // No workspace (plain public user): legacy cabinet as compat layer.
  if (home === '/me') return <Cabinet />;
  if (home === loc.pathname + loc.search) return <Cabinet />;
  return <Navigate to={home} replace />;
}
