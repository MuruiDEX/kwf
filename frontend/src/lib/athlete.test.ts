import { describe, expect, it } from 'vitest';
import { liveFight, myMatches, nearestReg, nextFight, pendingActions, placeFromHistory } from './athlete';
import type { BracketMatch, MyRegistration } from '../types/api';

const reg = (over: Partial<MyRegistration>): MyRegistration => ({
  id: 1, athlete_id: 7, tournament_id: 3, tournament: 'Cup', date: '2026-12-01',
  status: 'registration', category_id: 1, category: 'U40', reg_status: 'approved',
  review_note: '', checked_in: false, weigh_in_status: 'pending', ...over,
});

describe('pendingActions', () => {
  it('returns empty when nothing is pending', () => {
    expect(pendingActions([reg({})], 0)).toEqual([]);
    expect(pendingActions([], 0)).toEqual([]);
    expect(pendingActions(undefined, 0)).toEqual([]);
  });
  it('surfaces pending/rejected regs and unread notes with links', () => {
    const out = pendingActions(
      [reg({ id: 1, reg_status: 'pending' }), reg({ id: 2, reg_status: 'rejected' }), reg({ id: 3 })],
      2,
    );
    expect(out.map((a) => a.key)).toEqual(['reg-1', 'rej-2', 'notes']);
    expect(out.every((a) => a.to.startsWith('/'))).toBe(true);
  });
});

describe('nearestReg', () => {
  it('picks the earliest non-finished application', () => {
    expect(nearestReg(undefined)).toBeNull();
    const out = nearestReg([
      reg({ id: 1, date: '2026-12-10', status: 'finished' }),
      reg({ id: 2, date: '2026-12-05' }),
      reg({ id: 3, date: '2026-11-20' }),
    ]);
    expect(out?.id).toBe(3);
  });
});

const match = (over: Partial<BracketMatch>): BracketMatch => ({
  id: 1, round: 1, pos: 0, a: 7, b: 8, winner: null, status: 'scheduled',
  tatami_id: null, scheduled_at: null, score_a: 0, score_b: 0, next: null, ...over,
});

describe('myMatches/nextFight/liveFight', () => {
  const brackets = [{ id: 1, category_id: 1, size: 4, matches: [
    match({ id: 1, round: 1, a: 7, b: 8, winner: 7, status: 'finished' }),
    match({ id: 2, round: 1, a: 9, b: 10, winner: null, status: 'scheduled' }),
    match({ id: 3, round: 2, a: 7, b: null, winner: null, status: 'scheduled' }),
  ] }];
  it('selects only the athlete fights in round order', () => {
    expect(myMatches(brackets, 7).map((m) => m.id)).toEqual([1, 3]);
    expect(myMatches(brackets, 99)).toEqual([]);
    expect(myMatches(undefined, 7)).toEqual([]);
  });
  it('finds the next open fight and the live one', () => {
    const mine = myMatches(brackets, 7);
    expect(nextFight(mine)?.id).toBe(3);
    expect(liveFight(mine)).toBeNull();
    expect(liveFight([{ ...mine[0], status: 'live' }])?.id).toBe(1);
    expect(nextFight(myMatches(brackets, 8))).toBeNull();
  });
});

describe('placeFromHistory', () => {
  it('returns the finished place or null', () => {
    const recent = [{ tournament_id: 3, tournament: 'Cup', date: '2026-12-01', category: 'U40', result: 'champion', place: 1 } as const];
    expect(placeFromHistory(recent, 3)).toBe(1);
    expect(placeFromHistory(recent, 4)).toBeNull();
    expect(placeFromHistory(undefined, 3)).toBeNull();
  });
});
