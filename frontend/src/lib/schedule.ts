/** D2 P3: pure schedule helpers (unit-tested).
 *
 * Server datetimes arrive as "YYYY-MM-DD HH:MM:SS" (no zone — stored
 * as-received); parsed as LOCAL wall time, which is exactly how the coach
 * entered them via datetime-local inputs.
 */

export interface DatedSession {
  id: number;
  starts_at: string;
}

export function parseLocal(wall: string): Date {
  return new Date(wall.replace(' ', 'T'));
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Sessions happening today (local), ascending. */
export function todaySessions<T extends DatedSession>(items: T[], now = new Date()): T[] {
  const today = dayKey(now);
  return items
    .filter((s) => dayKey(parseLocal(s.starts_at)) === today)
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
}

/** Future sessions after today (local), ascending, capped. */
export function upcomingSessions<T extends DatedSession>(items: T[], now = new Date(), limit = 10): T[] {
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return items
    .filter((s) => parseLocal(s.starts_at) >= startOfTomorrow)
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
    .slice(0, limit);
}

/** Group sessions by local calendar day, ascending. */
export function groupSessionsByDay<T extends DatedSession>(items: T[]): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const s of items) {
    const d = parseLocal(s.starts_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, list]) => ({
      day,
      items: [...list].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)),
    }));
}

/** Monday 00:00 of the week `offsetWeeks` from the week of `now`. */
export function weekStart(offsetWeeks: number, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow + offsetWeeks * 7);
  return d;
}

export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
