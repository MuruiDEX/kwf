import { describe, expect, it } from 'vitest';
import { toAthleteCreate, validateAthleteForm, type AthleteForm } from './athletes';

const good: AthleteForm = {
  first_name: 'Test', last_name: 'Kid', gender: 'male',
  birth_year: '2015', weight_kg: '34', level: 'novice', country: 'KZ', club_id: '',
};

describe('validateAthleteForm', () => {
  it('accepts a complete valid form', () => {
    expect(validateAthleteForm(good)).toBeNull();
  });
  it('requires first and last name', () => {
    expect(validateAthleteForm({ ...good, first_name: '  ' })).toBe('ac.needName');
    expect(validateAthleteForm({ ...good, last_name: '' })).toBe('ac.needName');
  });
  it('rejects bad gender', () => {
    expect(validateAthleteForm({ ...good, gender: '' })).toBe('ac.badGender');
    expect(validateAthleteForm({ ...good, gender: 'other' })).toBe('ac.badGender');
  });
  it('rejects out-of-range birth years', () => {
    for (const by of ['', 'abc', '1919', '2031', '2015.5']) {
      expect(validateAthleteForm({ ...good, birth_year: by })).toBe('ac.badBirth');
    }
  });
  it('rejects out-of-range weights', () => {
    for (const w of ['', 'abc', '-1', '501']) {
      expect(validateAthleteForm({ ...good, weight_kg: w })).toBe('ac.badWeight');
    }
    expect(validateAthleteForm({ ...good, weight_kg: '34,5' })).toBeNull();
  });
});

describe('toAthleteCreate', () => {
  it('parses into the API body, empty club becomes null', () => {
    expect(toAthleteCreate(good)).toEqual({
      first_name: 'Test', last_name: 'Kid', gender: 'male',
      birth_year: 2015, weight_kg: 34, level: 'novice', country: 'KZ', club_id: null,
    });
  });
  it('keeps explicit club and level', () => {
    const body = toAthleteCreate({ ...good, club_id: '7', level: 'elite' });
    expect(body.club_id).toBe(7);
    expect(body.level).toBe('elite');
  });
});
