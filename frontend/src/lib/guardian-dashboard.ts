/** Guardian 2.0: pure dashboard derivations (unit-tested).
 *
 * Actions come only from real backend-backed state: outgoing pending links,
 * ward registration statuses, unread notification count. WardRegistration
 * extends MyRegistration, so athlete helpers apply directly — no duplication.
 */
import { nearestReg } from './athlete';
import { parseLocal } from './schedule';
import type { GuardianLink, WardRegistration } from '../types/api';

export interface DashboardAction {
  key: string;
  labelKey: string;
  detail?: string;
  to?: string;
  tone: 'gold' | 'gray' | 'live';
}

/** Per-ward actions: outgoing pending request notice + reg attention items. */
export function wardPendingActions(args: {
  wardId: number;
  wardName: string;
  regs: WardRegistration[] | undefined;
  outgoing: GuardianLink[];
}): DashboardAction[] {
  const out: DashboardAction[] = [];
  const pending = args.outgoing.find(
    (l) => l.athlete_id === args.wardId && l.status === 'pending',
  );
  if (pending) {
    out.push({
      key: `link-${pending.id}`, labelKey: 'guard.linkPending',
      detail: args.wardName, tone: 'gray',
    });
  }
  for (const r of args.regs ?? []) {
    if (r.reg_status === 'pending') {
      out.push({
        key: `reg-${r.id}`, labelKey: 'guard.regAttention',
        detail: `${args.wardName} · ${r.tournament}`,
        to: `/tournaments/${r.tournament_id}`, tone: 'gold',
      });
    } else if (r.reg_status === 'rejected') {
      out.push({
        key: `rej-${r.id}`, labelKey: 'guard.regRejected',
        detail: `${args.wardName} · ${r.tournament}`,
        to: `/tournaments/${r.tournament_id}`, tone: 'live',
      });
    }
  }
  return out;
}

/** Dashboard-level notice for unread notifications (not ward-scoped by API). */
export function notesActions(unread: number): DashboardAction[] {
  if (unread <= 0) return [];
  return [{ key: 'notes', labelKey: 'guard.unreadNotes', to: '/notifications', tone: 'gold' }];
}

export interface SessionLike {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  group: string | null;
}

/** Next future session across a ward club's schedule (null = none yet). */
export function nextSession<T extends { id: number; starts_at: string }>(
  items: T[] | undefined, now = new Date(),
): T | null {
  const future = (items ?? []).filter((s) => parseLocal(s.starts_at) >= now);
  if (!future.length) return null;
  return [...future].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0];
}

export { nearestReg };
