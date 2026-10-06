/** D2 P1: athlete creation form helpers (pure — unit-tested).
 *
 * Raw form state stays string-based (inputs); validation mirrors the backend
 * AthleteIn contract (names non-empty, gender enum, birth 1920-2030,
 * weight 0-500). Ownership/club scope is enforced server-side — the UI only
 * offers the coach's own clubs plus "no club".
 */
export interface AthleteForm {
  first_name: string;
  last_name: string;
  gender: string;
  birth_year: string;
  weight_kg: string;
  level: string;
  country: string;
  club_id: string; // '' = unattached
}

export interface AthleteCreateBody {
  first_name: string;
  last_name: string;
  gender: string;
  birth_year: number;
  weight_kg: number;
  level: string;
  country: string;
  club_id: number | null;
}

/** i18n key of the first validation problem, or null when submittable. */
export function validateAthleteForm(f: AthleteForm): string | null {
  if (!f.first_name.trim() || !f.last_name.trim()) return 'ac.needName';
  if (f.gender !== 'male' && f.gender !== 'female') return 'ac.badGender';
  const by = Number(f.birth_year);
  if (!f.birth_year.trim() || !Number.isFinite(by) || !Number.isInteger(by) || by < 1920 || by > 2030) {
    return 'ac.badBirth';
  }
  const w = Number(String(f.weight_kg).replace(',', '.'));
  if (!String(f.weight_kg).trim() || !Number.isFinite(w) || w < 0 || w > 500) {
    return 'ac.badWeight';
  }
  return null;
}

/** Parse a valid form into the POST /api/athletes body. */
export function toAthleteCreate(f: AthleteForm): AthleteCreateBody {
  return {
    first_name: f.first_name.trim(),
    last_name: f.last_name.trim(),
    gender: f.gender,
    birth_year: Number(f.birth_year),
    weight_kg: Number(String(f.weight_kg).replace(',', '.')),
    level: f.level || 'novice',
    country: f.country.trim(),
    club_id: f.club_id === '' ? null : Number(f.club_id),
  };
}
