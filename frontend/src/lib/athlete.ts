/** Athlete P1: pure dashboard derivations (unit-tested).
 *
 * Pending actions come only from real existing state (registrations +
 * unread notes). No invented statuses; every action deep-links already.
 */
import type { AthleteRecentItem, Bracket, BracketMatch, MyRegistration } from '../types/api';

export interface PendingAction {
  key: string;
  labelKey: string;
  to: string;
  tone: 'gold' | 'gray' | 'live';
}

export function pendingActions(
  regs: MyRegistration[] | undefined,
  unread: number,
): PendingAction[] {
  const out: PendingAction[] = [];
  for (const r of regs ?? []) {
    if (r.reg_status === 'pending') {
      out.push({
        key: `reg-${r.id}`, labelKey: 'ath.pendingReg',
        to: `/tournaments/${r.tournament_id}`, tone: 'gray',
      });
    } else if (r.reg_status === 'rejected') {
      out.push({
        key: `rej-${r.id}`, labelKey: 'ath.rejectedReg',
        to: `/tournaments/${r.tournament_id}`, tone: 'live',
      });
    }
  }
  if (unread > 0) {
    out.push({ key: 'notes', labelKey: 'ath.unreadNotes', to: '/notifications', tone: 'gold' });
  }
  return out;
}

/** Nearest upcoming application (earliest date among non-finished). */
export function nearestReg(regs: MyRegistration[] | undefined): MyRegistration | null {
  const open = (regs ?? []).filter((r) => r.status !== 'finished' && r.status !== 'live');
  if (!open.length) return null;
  return [...open].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

/** Athlete P2: matches of one athlete across brackets (no fabricated rows). */
export function myMatches(brackets: Bracket[] | undefined, athleteId: number): BracketMatch[] {
  const out: BracketMatch[] = [];
  for (const b of brackets ?? []) {
    for (const m of b.matches) {
      if (m.a === athleteId || m.b === athleteId) out.push(m);
    }
  }
  return out.sort((a, b) => (a.round - b.round) || (a.pos - b.pos));
}

/** Athlete P2: next unscheduled/unfinished fight, if any. */
export function nextFight(matches: BracketMatch[]): BracketMatch | null {
  const open = matches.filter((m) => m.winner == null && (m.a != null || m.b != null));
  if (!open.length) return null;
  return [...open].sort((a, b) => (a.round - b.round) || (a.pos - b.pos))[0];
}

/** Athlete P2: currently live fight, if any. */
export function liveFight(matches: BracketMatch[]): BracketMatch | null {
  return matches.find((m) => m.status === 'live') ?? null;
}

/** Athlete P2: finished place from the public results history (null = none yet). */
export function placeFromHistory(
  recent: AthleteRecentItem[] | undefined, tournamentId: number,
): number | null {
  const hit = (recent ?? []).find((r) => r.tournament_id === tournamentId);
  return hit?.place ?? null;
}
