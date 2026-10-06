import { describe, expect, it } from 'vitest';
import { toGroupCreate, validateGroupForm } from './groups';

describe('validateGroupForm', () => {
  it('accepts a bare name and full bounds', () => {
    expect(validateGroupForm({ name: 'A', level: '', age_min: '', age_max: '' })).toBeNull();
    expect(validateGroupForm({ name: 'A', level: 'x', age_min: '10', age_max: '12' })).toBeNull();
  });
  it('requires a name', () => {
    expect(validateGroupForm({ name: '  ', level: '', age_min: '', age_max: '' })).toBe('gr.needName');
  });
  it('rejects inverted or wild bounds', () => {
    const bad = [
      { name: 'A', level: '', age_min: '13', age_max: '10' },
      { name: 'A', level: '', age_min: '-1', age_max: '' },
      { name: 'A', level: '', age_min: '', age_max: '100' },
      { name: 'A', level: '', age_min: 'x', age_max: '' },
    ];
    for (const f of bad) expect(validateGroupForm(f)).toBe('gr.badBounds');
  });
});

describe('toGroupCreate', () => {
  it('parses blanks to nulls and trims', () => {
    expect(toGroupCreate({ name: ' A ', level: '', age_min: '', age_max: '' }, 7)).toEqual({
      club_id: 7, name: 'A', level: '', age_min: null, age_max: null,
    });
  });
});
