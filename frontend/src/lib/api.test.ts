import { describe, expect, it } from 'vitest';
import { ApiError, errMsg, pageItems } from './api';

describe('pageItems', () => {
  it('unwraps the P1 envelope', () => {
    expect(pageItems({ items: [1, 2], total: 2, limit: 100, offset: 0 })).toEqual([1, 2]);
  });
  it('tolerates a bare array (legacy shape)', () => {
    expect(pageItems([1, 2])).toEqual([1, 2]);
  });
  it('returns [] for null/undefined/empty envelope', () => {
    expect(pageItems(null)).toEqual([]);
    expect(pageItems(undefined)).toEqual([]);
    expect(pageItems({ items: [], total: 0, limit: 100, offset: 0 })).toEqual([]);
  });
  it('returns a copy, not the live array', () => {
    const src = [1];
    const out = pageItems(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
});

describe('ApiError', () => {
  it('preserves status for UI branching (409/422/429)', () => {
    for (const s of [409, 422, 429, 403]) {
      const e = new ApiError(s, `detail-${s}`);
      expect(e).toBeInstanceOf(Error);
      expect(e.status).toBe(s);
      expect(e.detail).toBe(`detail-${s}`);
      expect(e.message).toBe(`detail-${s}`);
    }
  });
});

describe('errMsg', () => {
  it('prefers ApiError detail', () => {
    expect(errMsg(new ApiError(409, 'downstream finished'))).toBe('downstream finished');
  });
  it('falls back to Error.message', () => {
    expect(errMsg(new Error('boom'))).toBe('boom');
  });
  it('falls back for non-errors', () => {
    expect(errMsg('weird')).toBe('Error');
    expect(errMsg(null, 'n/a')).toBe('n/a');
  });
});
