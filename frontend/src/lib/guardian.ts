/** C3: pure guardian-cabinet helpers (no React, no fetch — unit-tested).
 *
 * Selection is in-memory only (never localStorage): it is UI context, not an
 * authorization decision. The backend (C2) stays authoritative on every
 * request; a revoked ward surfaces as 403/404 and is handled via isGoneError.
 */
import { ApiError } from './api';
import type { Ward } from '../types/api';

/** Resolve the visible ward: keep the current one while still approved,
 *  otherwise auto-select the first (covers the single-ward case), else null.
 *  Never exposes link internals — ids come from the approved-wards list. */
export function resolveWardId(wards: Ward[] | undefined, selected: number | null): number | null {
  if (!wards?.length) return null;
  if (selected != null && wards.some((w) => w.id === selected)) return selected;
  return wards[0].id;
}

/** True when a protected ward query was denied (revoked / never-authorized).
 *  Network and server errors are NOT gone-errors — those keep showing retry. */
export function isGoneError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404);
}
