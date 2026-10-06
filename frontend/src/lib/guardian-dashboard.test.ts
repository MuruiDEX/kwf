import { describe, expect, it } from 'vitest';
import { nextSession, notesActions, wardPendingActions } from './guardian-dashboard';
import type { GuardianLink, WardRegistration } from '../types/api';

const reg = (over: Partial<WardRegistration>): WardRegistration => ({
  id: 1, athlete_id: 7, athlete: 'Kid', tournament_id: 3, tournament: 'Cup',
  date: '2026-12-01', status: 'registration', category_id: 1, category: 'U40',
  reg_status: 'approved', review_note: '', checked_in: false,
  weigh_in_status: 'pending', ...over,
});
const link = (over: Partial<GuardianLink>): GuardianLink => ({
  id: 1, guardian_user_id: 9, athlete_id: 7, status: 'pending', ...over,
});

describe('wardPendingActions', () => {
  it('returns empty when nothing needs attention', () => {
    expect(wardPendingActions({ wardId: 7, wardName: 'Kid', regs: [reg({})], outgoing: [] })).toEqual([]);
    expect(wardPendingActions({ wardId: 7, wardName: 'Kid', regs: undefined, outgoing: [] })).toEqual([]);
  });
  it('surfaces outgoing pending links without inventing a CTA target', () => {
    const out = wardPendingActions({ wardId: 7, wardName: 'Kid', regs: [], outgoing: [link({})] });
    expect(out).toHaveLength(1);
    expect(out[0].to).toBeUndefined();
    expect(out[0].detail).toBe('Kid');
  });
  it('ignores other wards and non-pending links', () => {
    const out = wardPendingActions({
      wardId: 7, wardName: 'Kid', regs: [],
      outgoing: [link({ athlete_id: 8 }), link({ athlete_id: 7, status: 'approved' })],
    });
    expect(out).toEqual([]);
  });
  it('surfaces pending/rejected regs with tournament deep links', () => {
    const out = wardPendingActions({
      wardId: 7, wardName: 'Kid',
      regs: [reg({ id: 1, reg_status: 'pending' }), reg({ id: 2, reg_status: 'rejected' }), reg({ id: 3 })],
      outgoing: [],
    });
    expect(out.map((a) => a.key)).toEqual(['reg-1', 'rej-2']);
    expect(out.every((a) => a.to === '/tournaments/3')).toBe(true);
  });
});

describe('notesActions', () => {
  it('returns empty at zero, one item otherwise', () => {
    expect(notesActions(0)).toEqual([]);
    expect(notesActions(3)).toHaveLength(1);
    expect(notesActions(3)[0].to).toBe('/notifications');
  });
});

describe('nextSession', () => {
  const s = (id: number, starts_at: string) => ({ id, starts_at });
  it('picks the earliest future session', () => {
    expect(nextSession(undefined)).toBeNull();
    expect(nextSession([], new Date())).toBeNull();
    const out = nextSession(
      [s(1, '2026-12-09 18:00:00'), s(2, '2026-12-11 09:00:00'), s(3, '2026-12-10 20:00:00')],
      new Date(2026, 11, 10, 12, 0, 0),
    );
    expect(out?.id).toBe(3);
  });
});
