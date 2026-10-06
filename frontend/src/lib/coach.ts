/** Coach 2.0 P1: profile form helpers (pure — unit-tested).
 *
 * Mirrors PUT /api/auth/profile validation (lengths, experience 0-80).
 * Identity stays User.full_name; only allowlisted fields are submitted.
 */
export interface ProfileForm {
  full_name: string;
  bio: string;
  city: string;
  country: string;
  specialization: string;
  experience_years: string;
  is_public: boolean;
}

export interface ProfileBody {
  full_name: string;
  bio: string;
  city: string;
  country: string;
  specialization: string;
  experience_years: number | null;
  is_public: boolean;
}

/** i18n key of the first validation problem, or null when submittable. */
export function validateProfileForm(f: ProfileForm): string | null {
  if (!f.full_name.trim()) return 'coach2.needName';
  if (f.bio.length > 2000) return 'coach2.badBio';
  if (f.city.length > 128 || f.country.length > 64 || f.specialization.length > 128) {
    return 'coach2.badField';
  }
  if (f.experience_years.trim() !== '') {
    const n = Number(f.experience_years);
    if (!Number.isInteger(n) || n < 0 || n > 80) return 'coach2.badExp';
  }
  return null;
}

/** Parse a valid form into the PUT /api/auth/profile body. */
export function toProfileBody(f: ProfileForm): ProfileBody {
  return {
    full_name: f.full_name.trim(),
    bio: f.bio.trim(),
    city: f.city.trim(),
    country: f.country.trim(),
    specialization: f.specialization.trim(),
    experience_years: f.experience_years.trim() === '' ? null : Number(f.experience_years),
    is_public: f.is_public,
  };
}

/** Profile completeness (real onboarding value only): filled / total fields. */
export function profileCompleteness(p: {
  full_name: string; bio: string; city: string; country: string;
  specialization: string; experience_years: number | null; avatar: string | null;
}): { done: number; total: number } {
  const fields = [p.full_name.trim() !== '', p.bio.trim() !== '', p.city.trim() !== '',
    p.country.trim() !== '', p.specialization.trim() !== '',
    p.experience_years != null, p.avatar != null];
  return { done: fields.filter(Boolean).length, total: fields.length };
}
