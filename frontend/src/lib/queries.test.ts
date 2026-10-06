import { describe, expect, it } from 'vitest';
import { qk } from './queries';

/** Query keys are a cache contract: changing them splits caches and causes refetch storms. */
describe('query keys', () => {
  it('keeps legacy keys for unfiltered lists', () => {
    expect(qk.tournaments()).toEqual(['tournaments']);
    expect(qk.rankings()).toEqual(['rankings']);
    expect(qk.adminUsers()).toEqual(['admin-users']);
  });
  it('uses filtered tuples only when filters are set', () => {
    expect(qk.tournaments('cup', '')).toEqual(['tournaments', 'cup', '']);
    expect(qk.tournaments('', 'live')).toEqual(['tournaments', '', 'live']);
    expect(qk.rankings('gender=male')).toEqual(['rankings', 'gender=male']);
    expect(qk.adminUsers('a', 'coach')).toEqual(['admin-users', 'a', 'coach']);
  });
  it('scopes entity keys by id', () => {
    expect(qk.tournament(7)).toEqual(['t', '7']);
    expect(qk.regs(7)).toEqual(['regs', '7']);
    expect(qk.brackets(7)).toEqual(['br', '7']);
    expect(qk.validation(7, 'kk')).toEqual(['val', '7', 'kk']);
    expect(qk.live(7)).toEqual(['live', '7']);
    expect(qk.athlete(3)).toEqual(['athlete', '3']);
    expect(qk.club(3)).toEqual(['club', '3']);
    expect(qk.newsDetail('slug')).toEqual(['news', 'slug']);
    expect(qk.results(7)).toEqual(['results', '7']);
    expect(qk.report(7, 'ru')).toEqual(['report', '7', 'ru']);
  });
  it('keeps singleton keys stable', () => {
    expect(qk.me).toEqual(['me']);
    expect(qk.clubs).toEqual(['clubs']);
    expect(qk.news).toEqual(['news']);
    expect(qk.notes).toEqual(['notes']);
    expect(qk.audit).toEqual(['audit']);
    expect(qk.orgreq).toEqual(['orgreq']);
    expect(qk.tournamentsLive).toEqual(['tournaments-live']);
  });
  it('keys the C3 guardian reads without colliding with self-service caches', () => {
    expect(qk.guardianWards).toEqual(['guardian-wards']);
    expect(qk.guardianRegs(7)).toEqual(['guardian-regs', 7]);
    expect(qk.guardianRegs('all')).toEqual(['guardian-regs', 'all']);
    // guardian caches stay separate from athlete self-service keys
    expect(qk.guardianRegs(7)).not.toEqual(['my-regs']);
    expect(qk.guardianWards).not.toEqual(['my-athletes']);
  });
  it('keys D2 P2 training groups by club and id', () => {
    expect(qk.trainingGroups(7)).toEqual(['training-groups', 7]);
    expect(qk.trainingGroups('all')).toEqual(['training-groups', 'all']);
    expect(qk.trainingGroups(7, true)).toEqual(['training-groups', 7, 'incl']);
    expect(qk.trainingGroup(7)).toEqual(['training-group', '7']);
    expect(qk.trainingGroup(7)).not.toEqual(['my-athletes']);
  });
  it('keys D2 P3 session lists by club and group filter', () => {
    expect(qk.sessions(7)).toEqual(['sessions', 7, 'all']);
    expect(qk.sessions(7, 3)).toEqual(['sessions', 7, 3]);
    expect(qk.sessions('all')).toEqual(['sessions', 'all', 'all']);
  });
  it('keeps the Coach 2.0 profile key stable', () => {
    expect(qk.myProfile).toEqual(['my-profile']);
  });
  it('keys athlete group membership reads', () => {
    expect(qk.athleteGroups(7)).toEqual(['athlete-groups', '7']);
  });
  it('keys coach directory and public profiles', () => {
    expect(qk.coaches()).toEqual(['coaches']);
    expect(qk.coaches('a', 'Almaty', 'KZ')).toEqual(['coaches', 'a', 'Almaty', 'KZ']);
    expect(qk.coach(7)).toEqual(['coach', '7']);
    expect(qk.myGroups).toEqual(['my-groups']);
  });
});
