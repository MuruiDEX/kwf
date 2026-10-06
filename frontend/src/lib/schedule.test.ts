import { describe, expect, it } from 'vitest';
import { dayKeyOf, groupSessionsByDay, todaySessions, upcomingSessions, weekStart } from './schedule';const S = (id: number, starts_at: string) => ({ id, starts_at });

describe('todaySessions', () => {
  it('keeps only same-calendar-day sessions, ascending', () => {
    const items = [S(1, '2026-12-10 20:00:00'), S(2, '2026-12-10 18:00:00'), S(3, '2026-12-11 09:00:00')];
    const out = todaySessions(items, new Date(2026, 11, 10, 12, 0, 0));
    expect(out.map((s) => s.id)).toEqual([2, 1]);
  });
  it('returns empty when nothing is today', () => {
    expect(todaySessions([S(1, '2026-12-11 09:00:00')], new Date(2026, 11, 10))).toEqual([]);
  });
});

describe('upcomingSessions', () => {
  it('skips today and past, caps the list', () => {
    const items = [
      S(1, '2026-12-09 18:00:00'),
      S(2, '2026-12-10 20:00:00'),
      S(3, '2026-12-12 09:00:00'),
      S(4, '2026-12-11 09:00:00'),
    ];
    const out = upcomingSessions(items, new Date(2026, 11, 10, 12, 0, 0), 1);
    expect(out.map((s) => s.id)).toEqual([4]);
  });
});

describe('groupSessionsByDay', () => {
  it('groups by local day, days and rows ascending', () => {
    const items = [S(1, '2026-12-11 20:00:00'), S(2, '2026-12-10 18:00:00'), S(3, '2026-12-10 09:00:00')];
    const out = groupSessionsByDay(items);
    expect(out.map((g) => g.day)).toEqual(['2026-12-10', '2026-12-11']);
    expect(out[0].items.map((s) => s.id)).toEqual([3, 2]);
  });
});

describe('weekStart/dayKeyOf', () => {
  it('starts weeks on Monday', () => {
    // Thursday 2026-12-10 -> Monday 2026-12-07; next week 2026-12-14
    expect(dayKeyOf(weekStart(0, new Date(2026, 11, 10)))).toBe('2026-12-07');
    expect(dayKeyOf(weekStart(1, new Date(2026, 11, 10)))).toBe('2026-12-14');
    expect(dayKeyOf(weekStart(0, new Date(2026, 11, 7)))).toBe('2026-12-07');
  });
});
