import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isGoneError, resolveWardId } from './guardian';
import type { Ward } from '../types/api';

const w = (id: number, name: string): Ward => ({ id, name } as Ward);

describe('resolveWardId', () => {
  it('returns null with no wards', () => {
    expect(resolveWardId([], null)).toBeNull();
    expect(resolveWardId(undefined, null)).toBeNull();
    expect(resolveWardId([], 7)).toBeNull();
  });
  it('auto-selects the single ward', () => {
    expect(resolveWardId([w(7, 'A')], null)).toBe(7);
  });
  it('auto-selects the first of many when nothing chosen', () => {
    expect(resolveWardId([w(7, 'A'), w(9, 'B')], null)).toBe(7);
  });
  it('keeps the current ward while still approved', () => {
    expect(resolveWardId([w(7, 'A'), w(9, 'B')], 9)).toBe(9);
  });
  it('falls back to first when the selected ward is gone (revoked)', () => {
    expect(resolveWardId([w(9, 'B')], 7)).toBe(9);
  });
});

describe('isGoneError', () => {
  it('treats 403/404 denials as gone', () => {
    expect(isGoneError(new ApiError(403, 'Foreign athlete'))).toBe(true);
    expect(isGoneError(new ApiError(404, 'Not found'))).toBe(true);
  });
  it('keeps other failures as retryable', () => {
    expect(isGoneError(new ApiError(500, 'x'))).toBe(false);
    expect(isGoneError(new ApiError(429, 'x'))).toBe(false);
    expect(isGoneError(new Error('boom'))).toBe(false);
    expect(isGoneError(null)).toBe(false);
    expect(isGoneError(undefined)).toBe(false);
  });
});
