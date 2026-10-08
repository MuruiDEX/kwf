import { describe, expect, it } from 'vitest';
import { filterNav, getActiveRoleKey, resolveBottomNav, resolveMeHome, resolvePostLogin, ROLE_HOME } from './navigation';

const can = (perms: string[]) => (p: string) => perms.includes(p);

describe('navigation single source of truth', () => {
  it('ROLE_HOME covers all workspaces', () => {
    for (const r of ['athlete', 'guardian', 'coach', 'referee', 'organizer', 'admin']) {
      expect(ROLE_HOME[r]).toBeTruthy();
    }
    expect(ROLE_HOME.athlete).toBe('/athlete');
    expect(ROLE_HOME.guardian).toBe('/guardian');
  });

  it('/me dispatcher routes by active role', () => {
    expect(resolveMeHome({ roles: ['athlete'], role: 'athlete', can: can([]) })).toBe('/athlete');
    expect(resolveMeHome({ roles: ['coach'], role: 'coach', can: can(['athletes.manage']) })).toBe('/coach');
    expect(resolveMeHome({ roles: ['referee'], role: 'referee', can: can(['matches.manage']) })).toBe('/referee');
    expect(resolveMeHome({ roles: ['organizer'], role: 'organizer', can: can(['tournaments.manage']) })).toBe('/organizer');
    expect(resolveMeHome({ roles: ['admin'], role: 'admin', can: can([]) })).toBe('/admin');
    expect(resolveMeHome({ roles: ['public'], role: 'public', can: can([]) })).toBe('/me');
    expect(resolveMeHome({ roles: ['coach'], role: 'coach', can: can([]), hasGuardianWards: true })).toBe('/coach');
  });

  it('guardian resolved by wards, not backend role', () => {
    expect(getActiveRoleKey({ roles: ['public'], role: 'public', can: can([]), hasGuardianWards: true })).toBe('guardian');
    expect(getActiveRoleKey({ roles: ['public'], role: 'public', can: can([]) })).toBe('public');
  });

  it('perm holders pass role+perm gates (grants)', () => {
    const items = [{ to: '/referee', labelKey: 'x', icon: {} as never, roles: ['referee'] as never[], perm: 'matches.manage' }];
    expect(filterNav(items, { roles: ['coach'], can: can(['matches.manage']) })).toHaveLength(1);
    expect(filterNav(items, { roles: ['coach'], can: can([]) })).toHaveLength(0);
  });

  it('post-login honors from when allowed, else role home', () => {
    const coach = { roles: ['coach'] as never[], role: 'coach' as never, can: can(['athletes.manage']) };
    expect(resolvePostLogin('/organizer', coach)).toBe('/coach');
    expect(resolvePostLogin('/coach', coach)).toBe('/coach');
    expect(resolvePostLogin('/tournaments/5', coach)).toBe('/tournaments/5');
    expect(resolvePostLogin('/admin', coach)).toBe('/coach');
    expect(resolvePostLogin(undefined, coach)).toBe('/coach');
    const org = { roles: ['organizer'] as never[], role: 'organizer' as never, can: can(['tournaments.manage']) };
    expect(resolvePostLogin('/organizer', org)).toBe('/organizer');
  });

  it('bottom nav differs per role and caps at 5', () => {
    const mk = (roles: never[], perms: string[], wards = false) =>
      resolveBottomNav({ roles, role: roles[0] as never, can: can(perms), hasGuardianWards: wards });
    const athlete = mk(['athlete'] as never[], []);
    const referee = mk(['referee'] as never[], ['matches.manage']);
    const organizer = mk(['organizer'] as never[], ['tournaments.manage']);
    expect(athlete.map((i) => i.to)).toContain('/athlete');
    expect(referee.map((i) => i.to)).toContain('/referee?tab=queue');
    expect(organizer.map((i) => i.to)).toContain('/organizer?tab=apps');
    for (const nav of [athlete, referee, organizer]) expect(nav.length).toBeLessThanOrEqual(5);
    expect(athlete.map((i) => i.to).join()).not.toBe(referee.map((i) => i.to).join());
  });
});
