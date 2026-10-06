/** D2 P2: training-group form helpers (pure — unit-tested).
 *
 * Validation mirrors the backend GroupIn contract (name required,
 * age_min <= age_max). Club ownership is enforced server-side.
 */
export interface GroupForm {
  name: string;
  level: string;
  age_min: string;
  age_max: string;
}

/** i18n key of the first validation problem, or null when submittable. */
export function validateGroupForm(f: GroupForm): string | null {
  if (!f.name.trim()) return 'gr.needName';
  const hasMin = f.age_min.trim() !== '';
  const hasMax = f.age_max.trim() !== '';
  const lo = Number(f.age_min);
  const hi = Number(f.age_max);
  if ((hasMin && (!Number.isFinite(lo) || lo < 0 || lo > 99)) ||
      (hasMax && (!Number.isFinite(hi) || hi < 0 || hi > 99))) {
    return 'gr.badBounds';
  }
  if (hasMin && hasMax && lo > hi) return 'gr.badBounds';
  return null;
}

/** Parse a valid form into the POST /api/groups body. */
export function toGroupCreate(f: GroupForm, club_id: number): Record<string, unknown> {
  return {
    club_id,
    name: f.name.trim(),
    level: f.level.trim(),
    age_min: f.age_min.trim() === '' ? null : Number(f.age_min),
    age_max: f.age_max.trim() === '' ? null : Number(f.age_max),
  };
}
