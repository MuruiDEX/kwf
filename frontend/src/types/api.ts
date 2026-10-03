/** KWF API types — mirror backend responses (FastAPI + Pydantic schemas + hand-built dicts).
 *  P1 envelope: { items, total, limit, offset } for all pure-list GETs.
 *  Notifications keep { unread, items, total, limit, offset }.
 */

export type TournamentStatus = 'upcoming' | 'registration' | 'live' | 'finished';
export type WeighInStatus = 'pending' | 'ok' | 'over' | 'under';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'bye';
export type Gender = 'male' | 'female';
export type Role = 'public' | 'athlete' | 'coach' | 'referee' | 'organizer' | 'admin';
export type FinishOutcome = 'finished' | 'repeated' | 'corrected';

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Tournament {
  id: number;
  name: string;
  city: string;
  country: string;
  organization: string;
  start_date: string;
  status: TournamentStatus;
  type: string;
  tatami_count: number;
  participants: number;
  /** B1: internal owner id — present for authenticated readers only. */
  created_by?: number | null;
}

export interface Category {
  id: number;
  name: string;
  gender: Gender;
  age_min: number;
  age_max: number;
  weight_min: number;
  weight_max: number;
}

export interface TournamentDetail extends Tournament {
  categories: Category[];
}

export type RegStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface Registration {
  id: number;
  athlete_id: number;
  athlete: string;
  category_id: number;
  category: string;
  club_id: number | null;
  club: string;
  /** B1: exact values only in scoped views (?mine, /scoped, /me/*). */
  birth_year?: number | null;
  gender: Gender | null;
  weight?: number | null;
  /** B1: public derived bands (never exact). */
  age_group: string;
  weight_class: string;
  checked_in: boolean;
  /** Exact weight is PII: null for anonymous readers (P0). */
  weigh_in_kg: number | null;
  weigh_in_status: WeighInStatus;
  /** Moderation status: visible to staff + owning coach, null otherwise. */
  status: RegStatus | null;
  review_note: string | null;
}

export interface MyAthlete {
  id: number;
  name: string;
  gender: Gender;
  birth_year: number;
  weight: number;
  club: string;
}

export interface MyRegistration {
  id: number;
  athlete_id: number;
  tournament_id: number;
  tournament: string;
  date: string;
  status: TournamentStatus | string;
  category_id: number;
  category: string;
  reg_status: RegStatus;
  review_note: string;
  checked_in: boolean;
  weigh_in_status: WeighInStatus;
}

export interface TatamiAssignment {
  id: number;
  name: string;
  referee_id: number | null;
  referee: string | null;
}

export interface RefereeOption {
  id: number;
  name: string;
}

export interface MyAssignment {
  tatami_id: number;
  tatami: string;
  tournament_id: number;
  tournament: string;
  fights: { id: number; status: string; a: string | null; b: string | null; scheduled_at: string | null }[];
}

export interface BracketMatch {
  id: number;
  round: number;
  pos: number;
  a: number | null;
  b: number | null;
  winner: number | null;
  status: MatchStatus;
  tatami_id: number | null;
  scheduled_at: string | null;
  score_a: number;
  score_b: number;
  next: number | null;
}

export interface Bracket {
  id: number;
  category_id: number;
  size: number;
  matches: BracketMatch[];
}

export interface ValidationItem {
  key: string;
  ok: boolean;
  message: string;
  suggestion?: string;
  level?: string;
  count?: number;
  items?: ConflictItem[];
}

export interface ConflictItem {
  message: string;
  suggestion?: string;
  [k: string]: unknown;
}

export interface TimerState {
  action: 'running' | 'paused' | 'idle';
  duration_sec: number;
  ends_at: number | null;
  remaining_sec?: number;
  updated_at: number;
  match_id: number;
}

export interface LiveFight {
  id: number;
  a: number | null;
  b: number | null;
  a_name: string | null;
  b_name: string | null;
  tatami_id: number | null;
  status: MatchStatus;
  timer: TimerState | null;
}

export interface LiveState {
  live: LiveFight[];
  queue: LiveFight[];
}

export type LiveEvent =
  | { type: 'fight_finished'; match_id: number; winner: number; score_a: number; score_b: number }
  | ({ type: 'timer' } & Partial<TimerState> & { match_id: number });

export interface FinishResult {
  ok: boolean;
  winner: number;
  next: number | null;
  outcome: FinishOutcome;
}

export interface Athlete {
  id: number;
  name: string;
  club_id: number | null;
  country: string;
  points: number;
  wins: number;
  losses: number;
  /** B1: exact only in scoped views (?mine=true, /scoped); public has bands. */
  weight?: number;
  gender: Gender;
  birth_year?: number;
  age_group: string;
  weight_class: string;
}

export interface AthleteHistoryItem {
  tournament_id: number;
  tournament: string;
  date: string;
  category: string;
  result: 'champion' | 'finalist' | 'semifinalist' | 'participant' | 'registered';
}

export interface AthleteProfile extends Omit<Athlete, 'club_id'> {
  first_name: string;
  last_name: string;
  gender: Gender;
  birth_year?: number;
  level: string;
  club: string;
  club_id: number | null;
  history: AthleteHistoryItem[];
}

/** B1: GET /api/athletes/{id}/scoped — public fields + exact values.
 *  Explicit allowlist (coach scope or linked self); never user_id/created_by.
 */
export interface ScopedAthlete extends AthleteProfile {
  birth_year: number;
  weight: number;
}

export interface Club {
  id: number;
  name: string;
  country: string;
  city: string;
  coach: string;
}

export interface ClubDetail extends Club {
  athletes: Pick<Athlete, 'id' | 'name' | 'points' | 'wins' | 'losses'>[];
  titles: number;
  /** B2: roster pagination + profile sections (all public, PII-free). */
  athlete_count: number;
  upcoming_tournaments: ClubTournament[];
  recent_results: ClubResult[];
}

export interface RankingEntry {
  rank: number;
  id: number;
  name: string;
  club_id: number | null;
  /** B1: exact weight removed from public rankings (filters still work). */
  points: number;
  wins: number;
  losses: number;
}

export interface NewsItem {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
}

export interface NewsDetail extends NewsItem {
  body: string;
  created_at: string;
}

export interface Standing {
  category_id: number;
  category: string;
  champion_id: number | null;
  champion: string;
  finalists: string[];
}

export interface MedalRow {
  athlete_id: number;
  athlete: string;
  club: string;
  /** B2: deep-link to the public club profile (additive, name was public). */
  club_id?: number | null;
  gold: number;
  titles: string[];
}

/** B2: public club profile sections (all PII-free by construction). */
export interface ClubTournament {
  id: number;
  name: string;
  city: string;
  start_date: string;
  status: TournamentStatus;
  participants: number;
}

export interface ClubResult {
  tournament_id: number;
  tournament: string;
  date: string;
  gold: number;
  silver: number;
  bronze: number;
}

export interface ClubScheduleItem {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
}

export interface ClubSchedule {
  items: ClubScheduleItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ResultsResponse {
  tournament: string;
  standings: Standing[];
  medal_table: MedalRow[];
}

export interface ReportStats {
  participants: number;
  countries: number;
  clubs: number;
  fights_total: number;
  fights_finished: number;
  club_gold: [string, number][];
}

export interface ReportResponse {
  tournament: string;
  stats: ReportStats;
  standings: Standing[];
  markdown: string;
}

export interface PodiumSpot {
  id: number;
  name: string;
  club: string;
}

export interface Podium {
  category_id: number;
  category: string;
  gold: PodiumSpot | null;
  silver: PodiumSpot | null;
  bronze: PodiumSpot[];
}

export interface IssuedDoc {
  code: string;
  kind: string;
  athlete_id: number | null;
  athlete: string;
  place: string;
  category: string;
  template: string;
  at: string;
}

export interface AthleteDoc {
  code: string;
  kind: string;
  tournament: string;
  date: string;
  place: string;
  category: string;
}

export interface DocVerify {
  valid: boolean;
  code?: string;
  kind?: string;
  athlete?: string;
  tournament?: string;
  date?: string;
  place?: string;
  category?: string;
}

export interface KwfNotification {
  id: number;
  type: string;
  message: string;
  link: string;
  is_read: boolean;
  at: string;
}

export interface NotesResponse {
  unread: number;
  items: KwfNotification[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditItem {
  id: number;
  actor: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  roles: Role[];
  is_active: boolean;
  created_at: string;
  grants?: string[];
}

export type PermissionKey =
  | 'tournaments.create' | 'tournaments.manage' | 'tournaments.manage_all'
  | 'athletes.manage' | 'clubs.manage' | 'news.manage' | 'documents.manage'
  | 'matches.manage' | 'users.view' | 'audit.view'
  | 'roles.manage' | 'organizer_requests.manage';

export interface PermissionMeta {
  key: PermissionKey;
  group: string;
  roles: Role[];
  grantable: boolean;
}

export interface AdminUserDetail extends AdminUser {
  grants: string[];
  effective: string[];
  roles: Role[];
}

export interface MyPermissions {
  role: Role;
  permissions: string[];
}

export interface OrganizerRequest {
  id: number;
  user: string;
  email: string;
  org_name: string;
  message: string;
  at: string;
}

export interface Me {
  id: number;
  email: string;
  role: Role;
  /** Multi-role set (primary + secondaries); absent on old responses. */
  roles?: Role[];
  full_name: string;
}

export interface SearchTournamentHit {
  id: number;
  name: string;
  city: string;
  start_date: string;
  status: TournamentStatus;
}

export interface SearchResult {
  athletes: { id: number; name: string }[];
  clubs: { id: number; name: string }[];
  /** Wave A1 additive key: absent on old cached responses — always guard. */
  tournaments?: SearchTournamentHit[];
}

export type SearchScope = 'athletes' | 'clubs' | 'tournaments';

export interface TrainingSession {
  id: number;
  club_id: number;
  club: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  note: string;
}

export interface SpravkaField {
  name: string;
  label: string;
  required: boolean;
  source: 'auto' | 'manual';
}

export interface SpravkaTemplate {
  key: string;
  title: string;
  need_tournament: boolean;
  fields: SpravkaField[];
}
