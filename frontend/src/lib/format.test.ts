import { describe, expect, it } from 'vitest';
import { fmtDay, fmtMon } from './format';

describe('format helpers', () => {
  it('fmtDay extracts the day or em-dash', () => {
    expect(fmtDay('2026-12-01')).toBe(1);
    expect(fmtDay('garbage')).toBe('—');
    expect(fmtDay(null)).toBe('—');
  });
  it('fmtMon localizes the month', () => {
    expect(fmtMon('2026-12-01', 'ru')).toMatch(/дек/);
    expect(fmtMon('2026-12-01', 'kk')).toBeTruthy();
    expect(fmtMon('garbage', 'ru')).toBe('');
  });
});
