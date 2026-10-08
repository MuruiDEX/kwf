import type { LucideIcon } from 'lucide-react';
import {
  Bell, CalendarDays, FileCheck2, Home, Inbox,Layers, LayoutDashboard, Newspaper,
  Scale, ScrollText, Swords, Trophy, User, Users, FileText, Tv, Timer,
} from 'lucide-react';
import type { Role } from '../types/api';

export type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** empty = public */
  roles?: Role[];
  /** permission required (any-of with roles, admin bypass handled in resolver) */
  perm?: string;
  /** hide from desktop header but keep in mobile/bottom/cmdk */
  mobileOnly?: boolean;
  /** show only when guardian has wards */
  guardianOnly?: boolean;
};

export type RoleKey = 'public' | 'athlete' | 'guardian' | 'coach' | 'referee' | 'organizer' | 'admin';

/** Single source of truth for ALL navigation surfaces.
 *  Header / Footer / BottomNav / CommandMenu / Admin sidebar / Cabinet actions
 *  must render from here via resolveRoleNav — never hardcode menus.
 */
export const PUBLIC_NAV: NavItem[] = [
  { to: '/tournaments', labelKey: 'nav.tournaments', icon: Trophy },
  { to: '/athletes', labelKey: 'nav.athletes', icon: User },
  { to: '/rankings', labelKey: 'nav.rankings', icon: Layers },
  { to: '/live', labelKey: 'nav.live', icon: Tv },
  { to: '/news', labelKey: 'nav.news', icon: Newspaper },
  { to: '/clubs', labelKey: 'nav.clubs', icon: Users },
  { to: '/coaches', labelKey: 'nav.coaches', icon: User },
];

export const ROLE_NAV: Record<RoleKey, NavItem[]> = {
  public: PUBLIC_NAV,
  athlete: [
    { to: '/athlete', labelKey: 'rx.home', icon: Home, roles: ['athlete'] },
    { to: '/athlete?tab=tournaments', labelKey: 'rx.myTournaments', icon: Trophy, roles: ['athlete'] },
    { to: '/athlete?tab=results', labelKey: 'rx.results', icon: Swords, roles: ['athlete'] },
    { to: '/rankings', labelKey: 'nav.rankings', icon: Layers },
    { to: '/athlete?tab=docs', labelKey: 'rx.docs', icon: FileCheck2, roles: ['athlete'] },
    { to: '/athlete?tab=profile', labelKey: 'rx.profile', icon: User, roles: ['athlete'] },
  ],
  guardian: [
    { to: '/guardian', labelKey: 'rx.home', icon: Home },
    { to: '/guardian?tab=children', labelKey: 'rx.children', icon: Users },
    { to: '/guardian?tab=tournaments', labelKey: 'rx.childTournaments', icon: Trophy },
    { to: '/guardian?tab=results', labelKey: 'rx.results', icon: Swords },
    { to: '/guardian?tab=docs', labelKey: 'rx.docs', icon: FileCheck2 },
    { to: '/me', labelKey: 'rx.profile', icon: User },
  ],
  coach: [
    { to: '/coach', labelKey: 'rx.home', icon: Home, roles: ['coach'] },
    { to: '/coach?tab=team', labelKey: 'rx.team', icon: Users, roles: ['coach'] },
    { to: '/coach?tab=athletes', labelKey: 'rx.athletes', icon: User, roles: ['coach'] },
    { to: '/tournaments', labelKey: 'nav.tournaments', icon: Trophy },
    { to: '/coach?tab=regs', labelKey: 'rx.regs', icon: Inbox, roles: ['coach'] },
    { to: '/coach?tab=schedule', labelKey: 'rx.schedule', icon: CalendarDays, roles: ['coach'] },
    { to: '/coach?tab=docs', labelKey: 'rx.docs', icon: FileCheck2, roles: ['coach'] },
  ],
  referee: [
    { to: '/referee', labelKey: 'rx.home', icon: Home, roles: ['referee', 'organizer'], perm: 'matches.manage' },
    { to: '/referee?tab=assign', labelKey: 'rx.assign', icon: CalendarDays, roles: ['referee', 'organizer'], perm: 'matches.manage' },
    { to: '/referee?tab=queue', labelKey: 'rx.queue', icon: Swords, roles: ['referee', 'organizer'], perm: 'matches.manage' },
    { to: '/referee?tab=weighin', labelKey: 'tab.weighin', icon: Scale, roles: ['referee', 'organizer'], perm: 'matches.manage' },
    { to: '/referee?tab=history', labelKey: 'rx.history', icon: ScrollText, roles: ['referee', 'organizer'], perm: 'matches.manage' },
  ],
  organizer: [
    { to: '/organizer', labelKey: 'rx.home', icon: Home, perm: 'tournaments.manage' },
    { to: '/organizer?tab=tournaments', labelKey: 'rx.myTournaments', icon: Trophy, perm: 'tournaments.manage' },
    { to: '/organizer?tab=apps', labelKey: 'rx.apps', icon: Inbox, perm: 'tournaments.manage' },
    { to: '/organizer?tab=weighin', labelKey: 'tab.weighin', icon: Scale, perm: 'tournaments.manage' },
    { to: '/organizer?tab=brackets', labelKey: 'tab.brackets', icon: Swords, perm: 'tournaments.manage' },
    { to: '/live', labelKey: 'nav.live', icon: Tv },
    { to: '/organizer?tab=docs', labelKey: 'rx.docs', icon: FileCheck2, perm: 'tournaments.manage' },
  ],
  admin: [
    { to: '/admin', labelKey: 'adm.dash', icon: LayoutDashboard },
    { to: '/admin/requests', labelKey: 'adm.requests', icon: Inbox },
    { to: '/admin/users', labelKey: 'adm.users', icon: FileText },
    { to: '/admin/clubs', labelKey: 'nav.clubs', icon: Users },
    { to: '/admin/tournaments', labelKey: 'adm.tournaments', icon: Trophy },
    { to: '/admin/news', labelKey: 'adm.news', icon: Newspaper },
    { to: '/admin/roles', labelKey: 'adm.roles', icon: Scale },
    { to: '/admin/audit', labelKey: 'adm.audit', icon: ScrollText },
    { to: '/admin/system', labelKey: 'adm.system', icon: Timer },
  ],
};

/** Canonical home per primary role. Guardian has no backend role — resolved by wards. */
export const ROLE_HOME: Record<string, string> = {
  coach: '/coach',
  referee: '/referee',
  organizer: '/organizer',
  admin: '/admin',
  athlete: '/athlete',
  guardian: '/guardian',
  public: '/me',
};

export type AuthLite = {
  roles: Role[];
  role: Role;
  can: (perm: string) => boolean;
  hasGuardianWards?: boolean;
};

export function getActiveRoleKey(a: AuthLite): RoleKey {
  if (a.roles.includes('admin')) return 'admin';
  if (a.roles.includes('organizer') && a.can('tournaments.manage')) return 'organizer';
  if (a.roles.includes('coach')) return 'coach';
  if (a.roles.includes('referee') && a.can('matches.manage')) return 'referee';
  if (a.roles.includes('athlete')) return 'athlete';
  if (a.hasGuardianWards) return 'guardian';
  // organizer/coach/referee without perms still get their workspace (gated inside)
  if (a.roles.includes('organizer')) return 'organizer';
  if (a.roles.includes('referee')) return 'referee';
  return 'public';
}

/** Dispatcher for /me: returns canonical home path. */
export function resolveMeHome(a: AuthLite): string {
  const key = getActiveRoleKey(a);
  if (key === 'public') return '/me';
  return ROLE_HOME[key] ?? '/me';
}

/** Post-login redirect: honor `from` when the user may actually open it,
 *  otherwise fall back to the role home. Backend stays source of truth
 *  (RequireRole shows the denied card for anything else). */
export function resolvePostLogin(from: string | undefined, a: AuthLite): string {
  if (!from || !from.startsWith('/')) return resolveMeHome(a);
  const isAdmin = a.roles.includes('admin');
  if (from.startsWith('/admin')) return (isAdmin ? from : resolveMeHome(a));
  if (from.startsWith('/organizer')) return (a.can('tournaments.manage') || isAdmin ? from : resolveMeHome(a));
  if (from.startsWith('/referee')) return (a.can('matches.manage') || isAdmin ? from : resolveMeHome(a));
  if (from.startsWith('/coach')) return (a.roles.includes('coach') || isAdmin ? from : resolveMeHome(a));
  if (from.startsWith('/athlete')) return (a.roles.includes('athlete') || isAdmin ? from : resolveMeHome(a));
  if (from.startsWith('/guardian')) return from;
  if (from === '/me' || from.startsWith('/me?')) return resolveMeHome(a);
  return from;
}

/** Filter a nav list by roles/permissions (admin bypasses everything). */
export function filterNav(items: NavItem[], a: Pick<AuthLite, 'roles' | 'can'>): NavItem[] {
  const isAdmin = a.roles.includes('admin');
  if (isAdmin) return items;
  return items.filter((it) => {
    const roleOk = !it.roles || it.roles.some((r) => a.roles.includes(r));
    const permOk = !it.perm || a.can(it.perm);
    // roles+perm = OR (matches RequireRole semantics: perm holders pass role gates)
    if (it.roles && it.perm) return roleOk || permOk;
    return roleOk && permOk;
  });
}

export function resolveRoleNav(a: AuthLite): NavItem[] {
  const key = getActiveRoleKey(a);
  if (key === 'public') return PUBLIC_NAV;
  return filterNav(ROLE_NAV[key], a);
}

/** Bottom navigation per role (mobile). Max 5 items, profile last. */
export function resolveBottomNav(a: AuthLite): NavItem[] {
  const key = getActiveRoleKey(a);
  switch (key) {
    case 'athlete':
      return filterNav([
        { to: '/athlete', labelKey: 'rx.home', icon: Home, roles: ['athlete'] },
        { to: '/athlete?tab=tournaments', labelKey: 'rx.myTournaments', icon: Trophy, roles: ['athlete'] },
        { to: '/athlete?tab=results', labelKey: 'rx.results', icon: Swords, roles: ['athlete'] },
        { to: '/athlete?tab=docs', labelKey: 'rx.docs', icon: FileCheck2, roles: ['athlete'] },
        { to: '/me', labelKey: 'rx.profile', icon: User },
      ], a);
    case 'guardian':
      return [
        { to: '/guardian', labelKey: 'rx.home', icon: Home },
        { to: '/guardian?tab=children', labelKey: 'rx.children', icon: Users },
        { to: '/guardian?tab=tournaments', labelKey: 'rx.childTournaments', icon: Trophy },
        { to: '/guardian?tab=docs', labelKey: 'rx.docs', icon: FileCheck2 },
        { to: '/me', labelKey: 'rx.profile', icon: User },
      ];
    case 'coach':
      return filterNav([
        { to: '/coach', labelKey: 'rx.home', icon: Home, roles: ['coach'] },
        { to: '/coach?tab=team', labelKey: 'rx.team', icon: Users, roles: ['coach'] },
        { to: '/tournaments', labelKey: 'nav.tournaments', icon: Trophy },
        { to: '/coach?tab=regs', labelKey: 'rx.regs', icon: Inbox, roles: ['coach'] },
        { to: '/me', labelKey: 'rx.profile', icon: User },
      ], a);
    case 'referee':
      return filterNav([
        { to: '/referee', labelKey: 'rx.home', icon: Home, roles: ['referee', 'organizer'], perm: 'matches.manage' },
        { to: '/referee?tab=assign', labelKey: 'rx.assign', icon: CalendarDays, roles: ['referee', 'organizer'], perm: 'matches.manage' },
        { to: '/referee?tab=queue', labelKey: 'rx.queue', icon: Swords, roles: ['referee', 'organizer'], perm: 'matches.manage' },
        { to: '/referee?tab=weighin', labelKey: 'tab.weighin', icon: Scale, roles: ['referee', 'organizer'], perm: 'matches.manage' },
        { to: '/me', labelKey: 'rx.profile', icon: User },
      ], a);
    case 'organizer':
      return filterNav([
        { to: '/organizer', labelKey: 'rx.home', icon: Home, perm: 'tournaments.manage' },
        { to: '/organizer?tab=tournaments', labelKey: 'rx.myTournaments', icon: Trophy, perm: 'tournaments.manage' },
        { to: '/organizer?tab=apps', labelKey: 'rx.apps', icon: Inbox, perm: 'tournaments.manage' },
        { to: '/live', labelKey: 'nav.live', icon: Tv },
        { to: '/me', labelKey: 'rx.profile', icon: User },
      ], a);
    case 'admin':
      return [
        { to: '/admin', labelKey: 'adm.dash', icon: LayoutDashboard },
        { to: '/admin/requests', labelKey: 'adm.requests', icon: Inbox },
        { to: '/admin/users', labelKey: 'adm.users', icon: FileText },
        { to: '/admin/tournaments', labelKey: 'adm.tournaments', icon: Trophy },
        { to: '/admin/audit', labelKey: 'adm.audit', icon: ScrollText },
      ];
    default:
      return [
        { to: '/tournaments', labelKey: 'nav.tournaments', icon: Trophy },
        { to: '/live', labelKey: 'nav.live', icon: Tv },
        { to: '/search', labelKey: 'nav.search', icon: Bell },
        { to: '/rankings', labelKey: 'nav.rankings', icon: Layers },
        { to: '/me', labelKey: 'nav.cabinet', icon: User },
      ];
  }
}
