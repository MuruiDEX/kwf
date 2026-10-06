import { describe, expect, it } from 'vitest';
import { profileCompleteness, toProfileBody, validateProfileForm } from './coach';

const good = {
  full_name: 'Ayan', bio: 'Kyokushin 10y', city: 'Almaty', country: 'KZ',
  specialization: 'Kids', experience_years: '10', is_public: true,
};

describe('validateProfileForm', () => {
  it('accepts a complete valid form', () => {
    expect(validateProfileForm(good)).toBeNull();
    expect(validateProfileForm({ ...good, experience_years: '', bio: '' })).toBeNull();
  });
  it('requires a name and sane fields', () => {
    expect(validateProfileForm({ ...good, full_name: '  ' })).toBe('coach2.needName');
    expect(validateProfileForm({ ...good, bio: 'x'.repeat(2001) })).toBe('coach2.badBio');
    expect(validateProfileForm({ ...good, city: 'x'.repeat(129) })).toBe('coach2.badField');
    expect(validateProfileForm({ ...good, experience_years: '81' })).toBe('coach2.badExp');
    expect(validateProfileForm({ ...good, experience_years: '-1' })).toBe('coach2.badExp');
    expect(validateProfileForm({ ...good, experience_years: '1.5' })).toBe('coach2.badExp');
  });
});

describe('toProfileBody', () => {
  it('trims and nulls empty experience', () => {
    expect(toProfileBody({ ...good, experience_years: '' })).toEqual({ ...good, experience_years: null });
  });
});

describe('profileCompleteness', () => {
  it('counts only truly filled fields', () => {
    expect(profileCompleteness({
      full_name: 'A', bio: '', city: '', country: '', specialization: '', experience_years: null, avatar: null,
    })).toEqual({ done: 1, total: 7 });
    expect(profileCompleteness({
      full_name: 'A', bio: 'b', city: 'c', country: 'k', specialization: 's', experience_years: 5, avatar: '/x',
    })).toEqual({ done: 7, total: 7 });
  });
});
